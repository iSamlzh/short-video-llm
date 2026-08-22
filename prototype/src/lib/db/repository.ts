import { randomUUID } from "node:crypto"
import { createHash } from "node:crypto"
import type Database from "better-sqlite3"
import { contentReviewSchema, ipProfileSchema, metricSnapshotSchema, qualityReportSchema, type ContentReview, type MetricSnapshot, type QualityReport, type ScriptCandidate, type TopicDirectionCandidate } from "../../domain/schemas"
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
      this.database.prepare("UPDATE script_batches SET superseded = 1 WHERE run_id = ?").run(runId)
      this.database.prepare("UPDATE script_selections SET is_current = 0 WHERE run_id = ?").run(runId)
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

  saveScriptBatch(runId: string, inputVersion: number, items: ScriptCandidate[], idempotencyKey: string): VersionedBatch<ScriptCandidate> {
    const existing = this.commandResult<VersionedBatch<ScriptCandidate>>(idempotencyKey)
    if (existing) return existing
    const transaction = this.database.transaction(() => {
      const version = this.nextVersion("script_batches", runId)
      const result = { version, inputVersion, items, superseded: false }
      this.database.prepare(`INSERT INTO script_batches
        (run_id,version,input_version,schema_version,payload_json,created_at) VALUES (?,?,?,?,?,?)`)
        .run(runId, version, inputVersion, SCHEMA_VERSION, JSON.stringify(items), new Date().toISOString())
      this.saveCommand(idempotencyKey, runId, "GENERATE_SCRIPTS", result)
      return result
    })
    return transaction()
  }

  listScriptBatches(runId: string): VersionedBatch<ScriptCandidate>[] {
    const rows = this.database.prepare("SELECT * FROM script_batches WHERE run_id = ? ORDER BY version").all(runId) as Row[]
    return rows.map(row => ({
      version: Number(row.version), inputVersion: Number(row.input_version),
      items: JSON.parse(String(row.payload_json)), superseded: Boolean(row.superseded),
    }))
  }

  getScriptBatch(runId: string, version?: number) {
    const batches = this.listScriptBatches(runId).filter(batch => !batch.superseded)
    return version ? batches.find(batch => batch.version === version) ?? null : batches.at(-1) ?? null
  }

  selectScript(runId: string, batchVersion: number, scriptId: string) {
    const batch = this.getScriptBatch(runId, batchVersion)
    const script = batch?.items.find(item => item.id === scriptId)
    const topic = this.getCurrentTopicSelection(runId)
    if (!batch || !script || !topic || script.topicDirectionId !== topic.topicId) throw new Error("SCRIPT_SELECTION_STALE")
    const transaction = this.database.transaction(() => {
      this.database.prepare("UPDATE script_selections SET is_current = 0 WHERE run_id = ?").run(runId)
      const version = this.nextVersion("script_selections", runId)
      const createdAt = new Date().toISOString()
      this.database.prepare(`INSERT INTO script_selections
        (run_id,version,batch_version,item_id,is_current,schema_version,created_at) VALUES (?,?,?,?,1,?,?)`)
        .run(runId, version, batchVersion, scriptId, SCHEMA_VERSION, createdAt)
      return { version, batchVersion, scriptId, isCurrent: true, createdAt }
    })
    return transaction()
  }

  getCurrentScriptSelection(runId: string) {
    const row = this.database.prepare("SELECT * FROM script_selections WHERE run_id = ? AND is_current = 1 ORDER BY version DESC LIMIT 1").get(runId) as Row | undefined
    return row ? { version: Number(row.version), batchVersion: Number(row.batch_version), scriptId: String(row.item_id), isCurrent: true } : null
  }

  getSelectedScript(runId: string) {
    const selection = this.getCurrentScriptSelection(runId)
    const batch = selection ? this.getScriptBatch(runId, selection.batchVersion) : null
    return selection && batch ? batch.items.find(item => item.id === selection.scriptId) ?? null : null
  }

  saveQualityReport(runId: string, report: QualityReport, scriptSelectionVersion: number) {
    const checked = qualityReportSchema.parse(report)
    const version = this.nextVersion("quality_reports", runId)
    const createdAt = new Date().toISOString()
    this.database.prepare("INSERT INTO quality_reports (run_id,version,schema_version,payload_json,created_at,script_selection_version) VALUES (?,?,?,?,?,?)")
      .run(runId, version, SCHEMA_VERSION, JSON.stringify(checked), createdAt, scriptSelectionVersion)
    return { version, ...checked, scriptSelectionVersion, createdAt }
  }

  getLatestQualityReport(runId: string) {
    const row = this.database.prepare("SELECT * FROM quality_reports WHERE run_id = ? ORDER BY version DESC LIMIT 1").get(runId) as Row | undefined
    return row ? {
      version: Number(row.version),
      ...qualityReportSchema.parse(JSON.parse(String(row.payload_json))),
      scriptSelectionVersion: row.script_selection_version == null ? null : Number(row.script_selection_version),
    } : null
  }

  lockSelectedScript(runId: string, scriptSelectionVersion: number) {
    const script = this.getSelectedScript(runId)
    if (!script) throw new Error("SCRIPT_SELECTION_REQUIRED")
    const version = this.nextVersion("locked_scripts", runId)
    const sha256 = createHash("sha256").update(JSON.stringify(script)).digest("hex")
    const createdAt = new Date().toISOString()
    this.database.prepare("INSERT INTO locked_scripts (run_id,version,schema_version,sha256,payload_json,created_at,script_selection_version) VALUES (?,?,?,?,?,?,?)")
      .run(runId, version, SCHEMA_VERSION, sha256, JSON.stringify(script), createdAt, scriptSelectionVersion)
    return { version, sha256, script: structuredClone(script), scriptSelectionVersion, createdAt }
  }

  getLatestLockedScript(runId: string) {
    const row = this.database.prepare("SELECT * FROM locked_scripts WHERE run_id = ? ORDER BY version DESC LIMIT 1").get(runId) as Row | undefined
    return row ? {
      version: Number(row.version),
      sha256: String(row.sha256),
      script: JSON.parse(String(row.payload_json)) as ScriptCandidate,
      scriptSelectionVersion: row.script_selection_version == null ? null : Number(row.script_selection_version),
      createdAt: String(row.created_at),
    } : null
  }

  getLockedScriptForSelection(runId: string, scriptSelectionVersion: number) {
    const row = this.database.prepare(`SELECT * FROM locked_scripts
      WHERE run_id = ? AND script_selection_version = ? ORDER BY version DESC LIMIT 1`)
      .get(runId, scriptSelectionVersion) as Row | undefined
    return row ? {
      version: Number(row.version),
      sha256: String(row.sha256),
      script: JSON.parse(String(row.payload_json)) as ScriptCandidate,
      scriptSelectionVersion: Number(row.script_selection_version),
      createdAt: String(row.created_at),
    } : null
  }

  saveMetricSnapshot(runId: string, snapshot: MetricSnapshot) {
    const checked = metricSnapshotSchema.parse(snapshot)
    const version = this.nextVersion("metric_snapshots", runId)
    const createdAt = new Date().toISOString()
    this.database.prepare("INSERT INTO metric_snapshots (run_id,version,schema_version,payload_json,created_at) VALUES (?,?,?,?,?)")
      .run(runId, version, SCHEMA_VERSION, JSON.stringify(checked), createdAt)
    return { version, ...checked, createdAt }
  }

  getLatestMetricSnapshot(runId: string) {
    const row = this.database.prepare("SELECT * FROM metric_snapshots WHERE run_id = ? ORDER BY version DESC LIMIT 1").get(runId) as Row | undefined
    return row ? { version: Number(row.version), ...metricSnapshotSchema.parse(JSON.parse(String(row.payload_json))) } : null
  }

  saveReview(runId: string, review: ContentReview) {
    const checked = contentReviewSchema.parse(review)
    const version = this.nextVersion("reviews", runId)
    const createdAt = new Date().toISOString()
    this.database.prepare("INSERT INTO reviews (run_id,version,schema_version,payload_json,created_at) VALUES (?,?,?,?,?)")
      .run(runId, version, SCHEMA_VERSION, JSON.stringify(checked), createdAt)
    return { version, ...checked, createdAt }
  }

  getLatestReview(runId: string) {
    const row = this.database.prepare("SELECT * FROM reviews WHERE run_id = ? ORDER BY version DESC LIMIT 1").get(runId) as Row | undefined
    return row ? { version: Number(row.version), ...contentReviewSchema.parse(JSON.parse(String(row.payload_json))) } : null
  }

  recordStepError(runId: string, error: { code: string; message: string; retryFromState: RunState }) {
    this.database.prepare("INSERT INTO step_errors (run_id,error_code,message,retry_from_state,schema_version,created_at) VALUES (?,?,?,?,?,?)")
      .run(runId, error.code, error.message, error.retryFromState, SCHEMA_VERSION, new Date().toISOString())
  }

  listStepErrors(runId: string) {
    const rows = this.database.prepare("SELECT * FROM step_errors WHERE run_id = ? ORDER BY id").all(runId) as Row[]
    return rows.map(row => ({
      errorCode: String(row.error_code),
      message: String(row.message),
      retryFromState: String(row.retry_from_state) as RunState,
      createdAt: String(row.created_at),
    }))
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
