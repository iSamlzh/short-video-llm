import { randomUUID } from "node:crypto"
import type Database from "better-sqlite3"
import type { TokenUsage } from "../llm/adapter"
import { modelTaskError } from "../llm/model-task-error"

export type ModelTaskStatus = "running" | "succeeded" | "failed" | "cancelled" | "timed_out"

type ModelTaskRow = {
  id: string
  tenant_id: string | null
  scope_type: "tenant" | "platform"
  scope_id: string
  actor_user_id: string
  run_id: string | null
  operation: string
  idempotency_key: string
  status: ModelTaskStatus
  model: string | null
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  error_code: string | null
  request_id: string | null
  request_started_at: string
  request_finished_at: string | null
  created_at: string
  updated_at: string
}

export type BeginModelTaskInput = {
  tenantId?: string
  scopeType: "tenant" | "platform"
  scopeId: string
  actorUserId: string
  operation: string
  idempotencyKey: string
  requestId?: string
  globalConcurrency: number
  scopeConcurrency: number
  scopeDailyTasks: number
  scopeDailyTokens: number
}

export class ModelTaskRepository {
  constructor(private readonly database: Database.Database) {}

  begin(input: BeginModelTaskInput) {
    return this.database.transaction(() => {
      this.expireStaleRunningTasks()
      const existing = this.findScoped(input.scopeType, input.scopeId, input.idempotencyKey)
      if (existing) return { kind: "existing" as const, task: existing }

      const runningGlobal = Number((this.database.prepare("SELECT COUNT(*) AS count FROM model_tasks WHERE status='running'").get() as { count: number }).count)
      if (runningGlobal >= input.globalConcurrency) throw modelTaskError("MODEL_GLOBAL_CONCURRENCY_LIMIT", 429, true)
      const runningScope = Number((this.database.prepare("SELECT COUNT(*) AS count FROM model_tasks WHERE status='running' AND scope_type=? AND scope_id=?")
        .get(input.scopeType, input.scopeId) as { count: number }).count)
      if (runningScope >= input.scopeConcurrency) throw modelTaskError(
        input.scopeType === "tenant" ? "MODEL_TENANT_CONCURRENCY_LIMIT" : "MODEL_PLATFORM_CONCURRENCY_LIMIT",
        429,
        true,
      )

      const dayStart = chinaDayStart()
      const usage = this.database.prepare(`SELECT COUNT(*) AS task_count, COALESCE(SUM(total_tokens),0) AS token_count
        FROM model_tasks WHERE scope_type=? AND scope_id=? AND created_at>=? AND status!='cancelled'`)
        .get(input.scopeType, input.scopeId, dayStart.toISOString()) as { task_count: number; token_count: number }
      if (Number(usage.task_count) >= input.scopeDailyTasks) throw modelTaskError("MODEL_DAILY_TASK_LIMIT", 429, false)
      if (Number(usage.token_count) >= input.scopeDailyTokens) throw modelTaskError("MODEL_DAILY_TOKEN_LIMIT", 429, false)

      const id = randomUUID()
      const now = new Date().toISOString()
      this.database.prepare(`INSERT INTO model_tasks
        (id,tenant_id,scope_type,scope_id,actor_user_id,operation,idempotency_key,status,request_id,request_started_at,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,'running',?,?,?,?)`)
        .run(id, input.tenantId ?? null, input.scopeType, input.scopeId, input.actorUserId, input.operation,
          input.idempotencyKey, input.requestId ?? null, now, now, now)
      return { kind: "started" as const, task: this.require(id) }
    })()
  }

  addUsage(id: string, model: string, usage?: TokenUsage) {
    this.database.prepare(`UPDATE model_tasks SET
      model=?, prompt_tokens=prompt_tokens+?, completion_tokens=completion_tokens+?,
      total_tokens=total_tokens+?, updated_at=? WHERE id=? AND status='running'`)
      .run(model, usage?.promptTokens ?? 0, usage?.completionTokens ?? 0, usage?.totalTokens ?? 0, new Date().toISOString(), id)
  }

  succeed(id: string, result: unknown) {
    const now = new Date().toISOString()
    const runId = result && typeof result === "object" && "runId" in result && typeof result.runId === "string"
      ? result.runId : null
    this.database.prepare(`UPDATE model_tasks SET status='succeeded',run_id=COALESCE(?,run_id),
      request_finished_at=?,updated_at=? WHERE id=? AND status='running'`)
      .run(runId, now, now, id)
    return this.require(id)
  }

  fail(id: string, status: Exclude<ModelTaskStatus, "running" | "succeeded">, errorCode: string) {
    const now = new Date().toISOString()
    this.database.prepare(`UPDATE model_tasks SET status=?,error_code=?,request_finished_at=?,updated_at=?
      WHERE id=? AND status='running'`).run(status, errorCode, now, now, id)
    return this.require(id)
  }

  find(tenantId: string, idempotencyKey: string) {
    return this.findScoped("tenant", tenantId, idempotencyKey)
  }

  findScoped(scopeType: "tenant" | "platform", scopeId: string, idempotencyKey: string) {
    const row = this.database.prepare("SELECT * FROM model_tasks WHERE scope_type=? AND scope_id=? AND idempotency_key=?")
      .get(scopeType, scopeId, idempotencyKey) as ModelTaskRow | undefined
    return row ? mapTask(row) : null
  }

  require(id: string) {
    const row = this.database.prepare("SELECT * FROM model_tasks WHERE id=?").get(id) as ModelTaskRow | undefined
    if (!row) throw new Error("MODEL_TASK_NOT_FOUND")
    return mapTask(row)
  }

  private expireStaleRunningTasks() {
    const cutoff = new Date(Date.now() - 15 * 60_000).toISOString()
    const now = new Date().toISOString()
    this.database.prepare(`UPDATE model_tasks SET status='failed',error_code='MODEL_TASK_STALE',
      request_finished_at=?,updated_at=? WHERE status='running' AND request_started_at<?`)
      .run(now, now, cutoff)
  }
}

function mapTask(row: ModelTaskRow) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    actorUserId: row.actor_user_id,
    runId: row.run_id,
    operation: row.operation,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    model: row.model,
    usage: {
      promptTokens: Number(row.prompt_tokens),
      completionTokens: Number(row.completion_tokens),
      totalTokens: Number(row.total_tokens),
    },
    errorCode: row.error_code,
    requestId: row.request_id,
    startedAt: row.request_started_at,
    finishedAt: row.request_finished_at,
  }
}

function chinaDayStart() {
  const chinaOffsetMs = 8 * 60 * 60 * 1000
  const chinaNow = new Date(Date.now() + chinaOffsetMs)
  return new Date(Date.UTC(
    chinaNow.getUTCFullYear(),
    chinaNow.getUTCMonth(),
    chinaNow.getUTCDate(),
  ) - chinaOffsetMs)
}
