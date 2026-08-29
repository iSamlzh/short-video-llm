import type Database from "better-sqlite3"
import type { PlatformAccessContext } from "../domain/access"
import { requirePlatformOperator } from "../lib/auth/guards"
import { AgentJobRepository } from "../lib/db/agent-job-repository"
import { ContentBrainRepository } from "../lib/db/content-brain-repository"
import { ContentAnalysisService } from "./content-analysis-service"
import { ModelTaskService } from "./model-task-service"

const RETRYABLE_CODES = new Set([
  "LLM_TIMEOUT",
  "LLM_RATE_LIMITED",
  "MODEL_SCHEMA_INVALID",
  "CONTENT_ANALYSIS_EVIDENCE_INVALID",
  "MODEL_GLOBAL_CONCURRENCY_LIMIT",
  "MODEL_PLATFORM_CONCURRENCY_LIMIT",
  "MODEL_TASK_IN_PROGRESS",
  "AGENT_WORKER_INTERRUPTED",
])

export class ContentAnalysisJobService {
  private readonly jobs: AgentJobRepository
  private readonly samples: ContentBrainRepository
  private pump: Promise<void> | null = null

  constructor(
    private readonly database: Database.Database,
    private readonly analysis: ContentAnalysisService,
    private readonly modelTasks: ModelTaskService,
    private readonly environment: Record<string, string | undefined> = process.env,
  ) {
    this.jobs = new AgentJobRepository(database)
    this.samples = new ContentBrainRepository(database)
  }

  enqueue(context: PlatformAccessContext, sampleId: string, idempotencyKey: string, batchId?: string) {
    requirePlatformOperator(context)
    this.samples.requireSample(sampleId)
    return this.jobs.enqueue({
      scopeType: "platform",
      scopeId: "platform",
      actorUserId: context.userId,
      resourceId: sampleId,
      idempotencyKey,
      batchId,
    }).job
  }

  retry(context: PlatformAccessContext, jobId: string, idempotencyKey: string) {
    requirePlatformOperator(context)
    this.jobs.requireScoped(jobId, "platform", "platform")
    return this.jobs.createRetry(jobId, context.userId, idempotencyKey).job
  }

  get(context: PlatformAccessContext, jobId: string) {
    requirePlatformOperator(context)
    return this.jobs.requireScoped(jobId, "platform", "platform")
  }

  list(context: PlatformAccessContext, limit = 100) {
    requirePlatformOperator(context)
    return this.jobs.listScoped("platform", "platform", limit)
  }

  kick() {
    const localRuntime = this.environment.APP_ENV === "development" || this.environment.APP_ENV === "e2e"
      || (!this.environment.APP_ENV && this.environment.NODE_ENV !== "production")
    const inline = this.environment.CONTENT_ANALYSIS_INLINE_WORKER === "true"
      || (localRuntime && this.environment.CONTENT_ANALYSIS_INLINE_WORKER !== "false")
    if (!inline || this.pump) return
    this.pump = this.drain()
      .catch((error) => console.error(JSON.stringify({
        event: "content_analysis_inline_worker_failed",
        errorCode: error instanceof Error ? error.message : "AGENT_WORKER_FAILED",
      })))
      .finally(() => { this.pump = null })
  }

  async drain() {
    this.jobs.recoverStale(positiveInteger(this.environment.AGENT_JOB_STALE_SECONDS, 120) * 1000)
    const concurrency = positiveInteger(this.environment.CONTENT_ANALYSIS_WORKER_CONCURRENCY, 2)
    const workers = Array.from({ length: concurrency }, () => this.drainLane())
    await Promise.all(workers)
  }

  async runForever(signal?: AbortSignal) {
    while (!signal?.aborted) {
      await this.drain()
      await delay(1_000, signal)
    }
  }

  private async drainLane() {
    while (true) {
      const job = this.jobs.claimNext()
      if (!job) return
      await this.execute(job)
    }
  }

  private async execute(job: ReturnType<AgentJobRepository["require"]>) {
    const heartbeat = setInterval(() => this.jobs.heartbeat(job.id), 5_000)
    const context: PlatformAccessContext = {
      audience: "platform",
      userId: job.actorUserId,
      platformRole: "platform_operator",
    }
    try {
      const analysis = await this.modelTasks.run({
        scopeType: "platform",
        actorUserId: job.actorUserId,
        operation: "content_brain.analysis",
        idempotencyKey: `agent-job:${job.id}:attempt:${job.attemptCount}`,
      }, () => this.analysis.analyze(context, job.resourceId, (stage, message) => {
        this.jobs.updateProgress(job.id, stage, message)
      }))
      this.jobs.succeed(job.id, analysis.id)
    } catch (error) {
      const value = error as { code?: string; message?: string; retryable?: boolean }
      const rawCode = value.code ?? value.message ?? "AGENT_JOB_FAILED"
      const code = /^[A-Z][A-Z0-9_]+$/.test(rawCode) ? rawCode : "AGENT_JOB_FAILED"
      this.jobs.failOrRequeue(job.id, code, Boolean(value.retryable) || RETRYABLE_CODES.has(code))
    } finally {
      clearInterval(heartbeat)
    }
  }
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function delay(ms: number, signal?: AbortSignal) {
  if (signal?.aborted) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener("abort", () => {
      clearTimeout(timer)
      resolve()
    }, { once: true })
  })
}
