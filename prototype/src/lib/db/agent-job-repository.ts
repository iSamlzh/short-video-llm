import { randomUUID } from "node:crypto"
import type Database from "better-sqlite3"

export type AgentJobStatus = "queued" | "running" | "succeeded" | "failed" | "timed_out" | "cancelled"

type AgentJobRow = {
  id: string
  scope_type: "tenant" | "platform"
  scope_id: string
  actor_user_id: string
  job_type: "content_analysis"
  resource_type: "content_sample"
  resource_id: string
  batch_id: string | null
  parent_job_id: string | null
  idempotency_key: string
  status: AgentJobStatus
  stage: string
  progress_message: string
  payload_json: string
  result_reference: string | null
  error_code: string | null
  retryable: number
  attempt_count: number
  max_attempts: number
  available_at: string
  heartbeat_at: string | null
  started_at: string | null
  finished_at: string | null
  created_at: string
  updated_at: string
}

export class AgentJobRepository {
  constructor(private readonly database: Database.Database) {}

  enqueue(input: {
    scopeType: "platform"
    scopeId: "platform"
    actorUserId: string
    resourceId: string
    idempotencyKey: string
    batchId?: string
    parentJobId?: string
  }) {
    return this.database.transaction(() => {
      const existing = this.findScoped(input.scopeType, input.scopeId, input.idempotencyKey)
      if (existing) return { job: existing, created: false }
      const active = this.findActiveForResource(input.scopeType, input.scopeId, input.resourceId)
      if (active) return { job: active, created: false }
      const id = randomUUID()
      const now = new Date().toISOString()
      this.database.prepare(`INSERT INTO agent_jobs
        (id,scope_type,scope_id,actor_user_id,job_type,resource_type,resource_id,batch_id,parent_job_id,
         idempotency_key,status,stage,progress_message,payload_json,available_at,created_at,updated_at)
        VALUES (?,?,?,?,'content_analysis','content_sample',?,?,?,?,'queued','queued',?, ?,?,?,?)`)
        .run(id, input.scopeType, input.scopeId, input.actorUserId, input.resourceId, input.batchId ?? null, input.parentJobId ?? null,
          input.idempotencyKey, "等待 Agent 接手", JSON.stringify({ sampleId: input.resourceId }), now, now, now)
      return { job: this.require(id), created: true }
    })()
  }

  claimNext(jobType: "content_analysis" = "content_analysis") {
    return this.database.transaction(() => {
      const now = new Date().toISOString()
      const row = this.database.prepare(`SELECT id FROM agent_jobs
        WHERE status='queued' AND job_type=? AND available_at<=?
        ORDER BY available_at,created_at LIMIT 1`).get(jobType, now) as { id: string } | undefined
      if (!row) return null
      const result = this.database.prepare(`UPDATE agent_jobs SET status='running',stage='source_validation',
        progress_message='正在检查样本与来源',attempt_count=attempt_count+1,
        started_at=COALESCE(started_at,?),heartbeat_at=?,updated_at=? WHERE id=? AND status='queued'`)
        .run(now, now, now, row.id)
      return result.changes === 1 ? this.require(row.id) : null
    })()
  }

  updateProgress(id: string, stage: string, progressMessage: string) {
    const now = new Date().toISOString()
    this.database.prepare(`UPDATE agent_jobs SET stage=?,progress_message=?,heartbeat_at=?,updated_at=?
      WHERE id=? AND status='running'`).run(stage, progressMessage, now, now, id)
    return this.require(id)
  }

  heartbeat(id: string) {
    const now = new Date().toISOString()
    this.database.prepare("UPDATE agent_jobs SET heartbeat_at=?,updated_at=? WHERE id=? AND status='running'")
      .run(now, now, id)
  }

  succeed(id: string, resultReference: string) {
    const now = new Date().toISOString()
    this.database.prepare(`UPDATE agent_jobs SET status='succeeded',stage='review_ready',
      progress_message='拆解完成，等待人工复核',result_reference=?,error_code=NULL,retryable=0,
      heartbeat_at=?,finished_at=?,updated_at=? WHERE id=? AND status='running'`)
      .run(resultReference, now, now, now, id)
    return this.require(id)
  }

  failOrRequeue(id: string, errorCode: string, retryable: boolean) {
    return this.database.transaction(() => {
      const current = this.require(id)
      const now = new Date()
      if (retryable && current.attemptCount < current.maxAttempts) {
        const delayMs = Math.min(15_000, 2_000 * 2 ** Math.max(0, current.attemptCount - 1))
        this.database.prepare(`UPDATE agent_jobs SET status='queued',stage='retry_wait',
          progress_message=?,error_code=?,retryable=1,available_at=?,heartbeat_at=NULL,updated_at=? WHERE id=?`)
          .run(`第 ${current.attemptCount} 次处理未完成，准备自动重试`, errorCode,
            new Date(now.getTime() + delayMs).toISOString(), now.toISOString(), id)
      } else {
        const status: AgentJobStatus = errorCode === "LLM_TIMEOUT" ? "timed_out" : "failed"
        this.database.prepare(`UPDATE agent_jobs SET status=?,stage='failed',progress_message=?,
          error_code=?,retryable=?,heartbeat_at=?,finished_at=?,updated_at=? WHERE id=?`)
          .run(status, failureMessage(errorCode), errorCode, retryable ? 1 : 0,
            now.toISOString(), now.toISOString(), now.toISOString(), id)
      }
      return this.require(id)
    })()
  }

  recoverStale(staleAfterMs = 120_000) {
    const cutoff = new Date(Date.now() - staleAfterMs).toISOString()
    const stale = this.database.prepare(`SELECT id FROM agent_jobs WHERE status='running'
      AND COALESCE(heartbeat_at,started_at,updated_at)<?`).all(cutoff) as Array<{ id: string }>
    for (const row of stale) this.failOrRequeue(row.id, "AGENT_WORKER_INTERRUPTED", true)
    return stale.length
  }

  createRetry(sourceId: string, actorUserId: string, idempotencyKey: string) {
    const source = this.require(sourceId)
    if (!source.retryable || !["failed", "timed_out"].includes(source.status)) {
      throw new Error("AGENT_JOB_NOT_RETRYABLE")
    }
    return this.enqueue({
      scopeType: "platform", scopeId: "platform", actorUserId,
      resourceId: source.resourceId, idempotencyKey, parentJobId: source.id,
      batchId: source.batchId ?? undefined,
    })
  }

  requireScoped(id: string, scopeType: "platform", scopeId: "platform") {
    const job = this.require(id)
    if (job.scopeType !== scopeType || job.scopeId !== scopeId) throw new Error("AGENT_JOB_NOT_FOUND")
    return job
  }

  require(id: string) {
    const row = this.database.prepare("SELECT * FROM agent_jobs WHERE id=?").get(id) as AgentJobRow | undefined
    if (!row) throw new Error("AGENT_JOB_NOT_FOUND")
    return mapJob(row)
  }

  findScoped(scopeType: "platform", scopeId: "platform", idempotencyKey: string) {
    const row = this.database.prepare(`SELECT * FROM agent_jobs
      WHERE scope_type=? AND scope_id=? AND idempotency_key=?`).get(scopeType, scopeId, idempotencyKey) as AgentJobRow | undefined
    return row ? mapJob(row) : null
  }

  findActiveForResource(scopeType: "platform", scopeId: "platform", resourceId: string) {
    const row = this.database.prepare(`SELECT * FROM agent_jobs WHERE scope_type=? AND scope_id=?
      AND job_type='content_analysis' AND resource_type='content_sample' AND resource_id=?
      AND status IN ('queued','running') ORDER BY created_at DESC LIMIT 1`)
      .get(scopeType, scopeId, resourceId) as AgentJobRow | undefined
    return row ? mapJob(row) : null
  }

  latestForResource(scopeType: "platform", scopeId: "platform", resourceId: string) {
    const row = this.database.prepare(`SELECT * FROM agent_jobs WHERE scope_type=? AND scope_id=?
      AND job_type='content_analysis' AND resource_type='content_sample' AND resource_id=?
      ORDER BY created_at DESC LIMIT 1`).get(scopeType, scopeId, resourceId) as AgentJobRow | undefined
    return row ? mapJob(row) : null
  }

  listScoped(scopeType: "platform", scopeId: "platform", limit = 100) {
    const rows = this.database.prepare(`SELECT * FROM agent_jobs WHERE scope_type=? AND scope_id=?
      AND job_type='content_analysis' ORDER BY created_at DESC LIMIT ?`)
      .all(scopeType, scopeId, Math.min(Math.max(limit, 1), 500)) as AgentJobRow[]
    return rows.map(mapJob)
  }
}

function mapJob(row: AgentJobRow) {
  return {
    id: row.id,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    actorUserId: row.actor_user_id,
    jobType: row.job_type,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    batchId: row.batch_id,
    parentJobId: row.parent_job_id,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    stage: row.stage,
    progressMessage: row.progress_message,
    payload: JSON.parse(row.payload_json) as { sampleId: string },
    resultReference: row.result_reference,
    errorCode: row.error_code,
    retryable: Boolean(row.retryable),
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    availableAt: row.available_at,
    heartbeatAt: row.heartbeat_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function failureMessage(code: string) {
  return ({
    LLM_TIMEOUT: "模型响应超时，可以重新拆解",
    LLM_RATE_LIMITED: "模型服务繁忙，可以稍后重试",
    MODEL_SCHEMA_INVALID: "模型返回结构不完整，可以重新拆解",
    CONTENT_ANALYSIS_EVIDENCE_INVALID: "证据引用校验失败，可以重新拆解",
    AGENT_WORKER_INTERRUPTED: "Agent 执行被中断，可以重新拆解",
  } as Record<string, string>)[code] ?? "拆解未完成，请查看错误详情"
}
