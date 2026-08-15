import { randomUUID } from "node:crypto"
import type Database from "better-sqlite3"
import { ipProfileSchema, type TopicDirectionCandidate } from "../../domain/schemas"
import type { IpProfile, PrototypeRun, RunState, VersionedBatch } from "../../domain/models"
import { openDatabase } from "./database"

const SCHEMA_VERSION = 1
type Row = Record<string, unknown>

export class PrototypeRepository {
  private readonly database: Database.Database

  constructor(path: string) {
    this.database = openDatabase(path)
  }

  close() { this.database.close() }

  createRun(input: IpProfile): PrototypeRun {
    const ipProfile = ipProfileSchema.parse(input)
    const now = new Date().toISOString()
    const run: PrototypeRun = {
      id: randomUUID(), state: "READY_FOR_TOPICS", inputVersion: 1,
      schemaVersion: SCHEMA_VERSION, ipProfile, createdAt: now, updatedAt: now,
    }
    this.database.prepare(`INSERT INTO runs
      (id,state,input_version,schema_version,ip_profile_json,created_at,updated_at)
      VALUES (@id,@state,@inputVersion,@schemaVersion,@ipProfileJson,@createdAt,@updatedAt)`)
      .run({ ...run, ipProfileJson: JSON.stringify(ipProfile) })
    return run
  }

  getRun(runId: string): PrototypeRun | null {
    const row = this.database.prepare("SELECT * FROM runs WHERE id = ?").get(runId) as Row | undefined
    if (!row) return null
    return {
      id: String(row.id), state: String(row.state) as RunState,
      inputVersion: Number(row.input_version), schemaVersion: Number(row.schema_version),
      ipProfile: ipProfileSchema.parse(JSON.parse(String(row.ip_profile_json))),
      createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    }
  }

  requireRun(runId: string) {
    const run = this.getRun(runId)
    if (!run) throw new Error("RUN_NOT_FOUND")
    return run
  }

  requireVersion(runId: string, inputVersion: number) {
    const run = this.requireRun(runId)
    if (run.inputVersion !== inputVersion) throw new Error("VERSION_CONFLICT")
    return run
  }

  setState(runId: string, state: RunState) {
    this.database.prepare("UPDATE runs SET state = ?, updated_at = ? WHERE id = ?")
      .run(state, new Date().toISOString(), runId)
    return this.requireRun(runId)
  }

  bumpInputVersion(runId: string) {
    this.database.prepare("UPDATE runs SET input_version = input_version + 1, updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), runId)
    return this.requireRun(runId)
  }

  saveTopicBatch(runId: string, inputVersion: number, items: TopicDirectionCandidate[], idempotencyKey: string): VersionedBatch<TopicDirectionCandidate> {
    const existing = this.commandResult<VersionedBatch<TopicDirectionCandidate>>(idempotencyKey)
    if (existing) return existing
    const transaction = this.database.transaction(() => {
      const version = this.nextVersion("topic_batches", runId)
      const result = { version, inputVersion, items, superseded: false }
      this.database.prepare(`INSERT INTO topic_batches
        (run_id,version,input_version,schema_version,payload_json,created_at) VALUES (?,?,?,?,?,?)`)
        .run(runId, version, inputVersion, SCHEMA_VERSION, JSON.stringify(items), new Date().toISOString())
      this.saveCommand(idempotencyKey, runId, "GENERATE_TOPICS", result)
      return result
    })
    return transaction()
  }

  listTopicBatches(runId: string): VersionedBatch<TopicDirectionCandidate>[] {
    const rows = this.database.prepare("SELECT * FROM topic_batches WHERE run_id = ? ORDER BY version").all(runId) as Row[]
    return rows.map(row => ({
      version: Number(row.version), inputVersion: Number(row.input_version),
      items: JSON.parse(String(row.payload_json)), superseded: Boolean(row.superseded),
    }))
  }

  getTopicBatch(runId: string, version?: number) {
    const batches = this.listTopicBatches(runId)
    return version ? batches.find(batch => batch.version === version) ?? null : batches.at(-1) ?? null
  }

  selectTopic(runId: string, batchVersion: number, topicId: string) {
    const batch = this.getTopicBatch(runId, batchVersion)
    if (!batch || !batch.items.some(item => item.id === topicId)) throw new Error("TOPIC_SELECTION_INVALID")
    const transaction = this.database.transaction(() => {
      this.database.prepare("UPDATE topic_selections SET is_current = 0 WHERE run_id = ?").run(runId)
      const version = this.nextVersion("topic_selections", runId)
      const createdAt = new Date().toISOString()
      this.database.prepare(`INSERT INTO topic_selections
        (run_id,version,batch_version,item_id,is_current,schema_version,created_at) VALUES (?,?,?,?,1,?,?)`)
        .run(runId, version, batchVersion, topicId, SCHEMA_VERSION, createdAt)
      return { version, batchVersion, topicId, isCurrent: true, createdAt }
    })
    return transaction()
  }

  listTopicSelections(runId: string) {
    const rows = this.database.prepare("SELECT * FROM topic_selections WHERE run_id = ? ORDER BY version").all(runId) as Row[]
    return rows.map(row => ({
      version: Number(row.version), batchVersion: Number(row.batch_version), topicId: String(row.item_id),
      isCurrent: Boolean(row.is_current), createdAt: String(row.created_at),
    }))
  }

  getCurrentTopicSelection(runId: string) {
    return this.listTopicSelections(runId).findLast(item => item.isCurrent) ?? null
  }

  private nextVersion(table: string, runId: string) {
    const allowed = new Set(["topic_batches", "topic_selections", "script_batches", "script_selections", "quality_reports", "locked_scripts", "metric_snapshots", "reviews"])
    if (!allowed.has(table)) throw new Error("INVALID_TABLE")
    const row = this.database.prepare(`SELECT COALESCE(MAX(version), 0) + 1 AS next FROM ${table} WHERE run_id = ?`).get(runId) as Row
    return Number(row.next)
  }

  private commandResult<T>(key: string): T | null {
    const row = this.database.prepare("SELECT result_json FROM commands WHERE idempotency_key = ?").get(key) as Row | undefined
    return row ? JSON.parse(String(row.result_json)) as T : null
  }

  private saveCommand(key: string, runId: string, command: string, result: unknown) {
    this.database.prepare("INSERT INTO commands (idempotency_key,run_id,command,result_json,created_at) VALUES (?,?,?,?,?)")
      .run(key, runId, command, JSON.stringify(result), new Date().toISOString())
  }
}
