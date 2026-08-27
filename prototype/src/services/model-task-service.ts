import type Database from "better-sqlite3"
import { ModelTaskRepository } from "../lib/db/model-task-repository"
import { withModelExecutionContext } from "../lib/llm/model-execution-context"
import { modelTaskError } from "../lib/llm/model-task-error"
import { currentRequestLogContext, linkRequestToTask } from "../lib/observability/request-log"

type CommonModelTaskInput = {
  actorUserId: string
  operation: string
  idempotencyKey: string
  signal?: AbortSignal
}

export type RunModelTaskInput = CommonModelTaskInput & (
  | { tenantId: string; scopeType?: "tenant"; scopeId?: never }
  | { tenantId?: never; scopeType: "platform"; scopeId?: "platform" }
)

export class ModelTaskService {
  private readonly repository: ModelTaskRepository

  constructor(database: Database.Database, private readonly environment: Record<string, string | undefined> = process.env) {
    this.repository = new ModelTaskRepository(database)
  }

  async run<T>(
    input: RunModelTaskInput,
    task: () => Promise<T>,
    reuse?: (runId: string | null) => Promise<T> | T,
  ): Promise<T> {
    validateIdempotencyKey(input.idempotencyKey)
    const scope = resolveScope(input)
    const platformScope = scope.scopeType === "platform"
    const begun = this.repository.begin({
      tenantId: scope.tenantId,
      scopeType: scope.scopeType,
      scopeId: scope.scopeId,
      actorUserId: input.actorUserId,
      operation: input.operation,
      idempotencyKey: input.idempotencyKey,
      requestId: currentRequestLogContext()?.requestId,
      globalConcurrency: positiveInteger(this.environment.MODEL_GLOBAL_CONCURRENCY, 10),
      scopeConcurrency: positiveInteger(platformScope
        ? this.environment.MODEL_PLATFORM_CONCURRENCY
        : this.environment.MODEL_TENANT_CONCURRENCY, 2),
      scopeDailyTasks: positiveInteger(platformScope
        ? this.environment.MODEL_PLATFORM_DAILY_TASKS
        : this.environment.MODEL_TENANT_DAILY_TASKS, platformScope ? 200 : 500),
      scopeDailyTokens: positiveInteger(platformScope
        ? this.environment.MODEL_PLATFORM_DAILY_TOKENS
        : this.environment.MODEL_TENANT_DAILY_TOKENS, platformScope ? 3_000_000 : 5_000_000),
    })

    if (begun.kind === "existing") {
      if (begun.task.status === "succeeded") {
        if (reuse) return reuse(begun.task.runId)
        throw modelTaskError("MODEL_TASK_ALREADY_SUCCEEDED", 409, false)
      }
      if (begun.task.status === "running") throw modelTaskError("MODEL_TASK_IN_PROGRESS", 409, true)
      throw modelTaskError(begun.task.errorCode ?? "MODEL_TASK_PREVIOUSLY_FAILED", 409, true)
    }

    const taskId = begun.task.id
    linkRequestToTask(taskId)
    const timeoutMs = positiveInteger(this.environment.LLM_TIMEOUT_SECONDS, 60) * 1000
    if (input.signal?.aborted) {
      this.repository.fail(taskId, "cancelled", "MODEL_TASK_CANCELLED")
      throw modelTaskError("MODEL_TASK_CANCELLED", 499, false)
    }

    const operationController = new AbortController()
    let timedOut = false
    const cancelFromCaller = () => operationController.abort()
    input.signal?.addEventListener("abort", cancelFromCaller, { once: true })
    const timeout = setTimeout(() => {
      timedOut = true
      operationController.abort()
    }, timeoutMs)

    try {
      const execution = withModelExecutionContext({
        taskId,
        tenantId: scope.tenantId,
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        operation: input.operation,
        signal: operationController.signal,
        deadlineAt: Date.now() + timeoutMs,
        recordUsage: (model, usage) => this.repository.addUsage(taskId, model, usage),
      }, task)
      const result = await Promise.race([
        execution,
        new Promise<never>((_, reject) => {
          operationController.signal.addEventListener("abort", () => {
            reject(timedOut
              ? Object.assign(new Error("模型调用超时"), { code: "LLM_TIMEOUT", status: 504, retryable: true })
              : modelTaskError("MODEL_TASK_CANCELLED", 499, false))
          }, { once: true })
        }),
      ])
      this.repository.succeed(taskId, result)
      return result
    } catch (error) {
      const originalCode = (error as { code?: string }).code ?? "MODEL_TASK_FAILED"
      const code = timedOut ? "LLM_TIMEOUT" : originalCode
      const status = code === "MODEL_TASK_CANCELLED" ? "cancelled"
        : code === "LLM_TIMEOUT" ? "timed_out"
          : "failed"
      this.repository.fail(taskId, status, code)
      if (timedOut && originalCode !== "LLM_TIMEOUT") {
        throw Object.assign(new Error("模型调用超时"), { code: "LLM_TIMEOUT", status: 504, retryable: true })
      }
      throw error
    } finally {
      clearTimeout(timeout)
      input.signal?.removeEventListener("abort", cancelFromCaller)
    }
  }
}

function resolveScope(input: RunModelTaskInput) {
  if (input.scopeType === "platform") {
    return { scopeType: "platform" as const, scopeId: input.scopeId ?? "platform", tenantId: undefined }
  }
  return { scopeType: "tenant" as const, scopeId: input.tenantId, tenantId: input.tenantId }
}

function validateIdempotencyKey(value: string) {
  if (!/^[A-Za-z0-9:_-]{8,160}$/.test(value)) throw modelTaskError("IDEMPOTENCY_KEY_INVALID", 400, false)
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}
