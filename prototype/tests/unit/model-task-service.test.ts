import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type Database from "better-sqlite3"
import { openDatabase } from "../../src/lib/db/database"
import { ModelTaskRepository } from "../../src/lib/db/model-task-repository"
import { currentModelExecutionContext } from "../../src/lib/llm/model-execution-context"
import { seedDemoData } from "../../src/scripts/demo-data"
import { ModelTaskService } from "../../src/services/model-task-service"
import { withRequestLog } from "../../src/lib/observability/request-log"

const baseInput = {
  tenantId: "tenant-linjie",
  actorUserId: "user-owner",
  operation: "creation.script",
}

describe("ModelTaskService", () => {
  let database: Database.Database

  beforeEach(async () => {
    database = openDatabase(":memory:")
    await seedDemoData(database, "demo-password")
  })

  afterEach(() => {
    vi.restoreAllMocks()
    database.close()
  })

  it("相同幂等键只执行一次，并仅通过 Run 引用复用业务结果", async () => {
    const service = new ModelTaskService(database)
    const execute = vi.fn(async (): Promise<{ runId: string; confidentialDraft?: string; reused?: boolean }> => (
      { runId: "run-1", confidentialDraft: "完整口播稿不应写入任务表" }
    ))
    const input = { ...baseInput, idempotencyKey: "request-12345678" }

    await expect(service.run(input, execute)).resolves.toMatchObject({ runId: "run-1" })
    await expect(service.run(input, execute, (runId) => ({ runId: runId ?? "", reused: true })))
      .resolves.toEqual({ runId: "run-1", reused: true })

    expect(execute).toHaveBeenCalledTimes(1)
    expect(database.prepare("SELECT run_id,status FROM model_tasks").get()).toEqual({ run_id: "run-1", status: "succeeded" })
    const columns = database.prepare("PRAGMA table_info(model_tasks)").all() as Array<{ name: string }>
    expect(columns.map(column => column.name)).not.toContain("result_json")
  })

  it("按租户限制并行模型任务，不把请求无限排队", async () => {
    const service = new ModelTaskService(database, {
      MODEL_GLOBAL_CONCURRENCY: "10",
      MODEL_TENANT_CONCURRENCY: "1",
      MODEL_TENANT_DAILY_TASKS: "100",
      MODEL_TENANT_DAILY_TOKENS: "100000",
      LLM_TIMEOUT_SECONDS: "60",
    })
    let release!: () => void
    const pending = new Promise<void>((resolve) => { release = resolve })
    const first = service.run({ ...baseInput, idempotencyKey: "request-concurrent-1" }, async () => {
      await pending
      return { runId: "run-1" }
    })

    await vi.waitFor(() => {
      expect(new ModelTaskRepository(database).find("tenant-linjie", "request-concurrent-1")?.status).toBe("running")
    })
    await expect(service.run(
      { ...baseInput, idempotencyKey: "request-concurrent-2" },
      async () => ({ runId: "run-2" }),
    )).rejects.toMatchObject({ code: "MODEL_TENANT_CONCURRENCY_LIMIT", status: 429, retryable: true })

    release()
    await first
  })

  it("累计模型 Token 用量并在达到日额度后拒绝新任务", async () => {
    const service = new ModelTaskService(database, {
      MODEL_GLOBAL_CONCURRENCY: "10",
      MODEL_TENANT_CONCURRENCY: "2",
      MODEL_TENANT_DAILY_TASKS: "100",
      MODEL_TENANT_DAILY_TOKENS: "10",
      LLM_TIMEOUT_SECONDS: "60",
    })
    await service.run({ ...baseInput, idempotencyKey: "request-token-limit-1" }, async () => {
      currentModelExecutionContext()?.recordUsage("test-model", {
        promptTokens: 4,
        completionTokens: 6,
        totalTokens: 10,
      })
      return { runId: "run-1" }
    })

    await expect(service.run(
      { ...baseInput, idempotencyKey: "request-token-limit-2" },
      async () => ({ runId: "run-2" }),
    )).rejects.toMatchObject({ code: "MODEL_DAILY_TOKEN_LIMIT", status: 429, retryable: false })
    expect(new ModelTaskRepository(database).find("tenant-linjie", "request-token-limit-1")?.usage.totalTokens).toBe(10)
  })

  it("请求在执行前取消时记录取消状态且不调用模型任务", async () => {
    const controller = new AbortController()
    controller.abort()
    const execute = vi.fn(async () => ({ runId: "run-never" }))
    const service = new ModelTaskService(database)

    await expect(service.run({
      ...baseInput,
      idempotencyKey: "request-cancelled-1",
      signal: controller.signal,
    }, execute)).rejects.toMatchObject({ code: "MODEL_TASK_CANCELLED", status: 499 })

    expect(execute).not.toHaveBeenCalled()
    expect(new ModelTaskRepository(database).find("tenant-linjie", "request-cancelled-1")?.status).toBe("cancelled")
  })

  it("把 HTTP requestId 保存到模型任务用于跨日志追踪", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined)
    const service = new ModelTaskService(database)
    const handler = withRequestLog(async () => {
      await service.run(
        { ...baseInput, idempotencyKey: "request-trace-12345678" },
        async () => ({ runId: "run-traced" }),
      )
      return Response.json({ ok: true })
    })

    await handler(new Request("http://localhost/api/app/creation/script", {
      method: "POST",
      headers: { "x-request-id": "req_trace_12345678" },
    }))

    expect(database.prepare("SELECT request_id FROM model_tasks WHERE idempotency_key=?")
      .get("request-trace-12345678")).toEqual({ request_id: "req_trace_12345678" })
  })

  it("平台内容任务使用独立作用域和额度，不占用租户额度", async () => {
    database.prepare(`INSERT INTO users
      (id,email_normalized,display_name,password_hash,audience,platform_role,status,data_origin,created_at)
      VALUES ('platform-test','platform@test.local','平台测试员','hash','platform','platform_operator','active','demo',?)`)
      .run(new Date().toISOString())
    const service = new ModelTaskService(database, {
      MODEL_GLOBAL_CONCURRENCY: "10",
      MODEL_PLATFORM_CONCURRENCY: "1",
      MODEL_PLATFORM_DAILY_TASKS: "10",
      MODEL_PLATFORM_DAILY_TOKENS: "1000",
      LLM_TIMEOUT_SECONDS: "60",
    })

    await expect(service.run({
      scopeType: "platform",
      actorUserId: "platform-test",
      operation: "content_brain.analysis",
      idempotencyKey: "platform-task-12345678",
    }, async () => ({ analysisId: "analysis-1" }))).resolves.toEqual({ analysisId: "analysis-1" })

    expect(database.prepare(`SELECT tenant_id,scope_type,scope_id,status FROM model_tasks
      WHERE idempotency_key='platform-task-12345678'`).get()).toEqual({
      tenant_id: null, scope_type: "platform", scope_id: "platform", status: "succeeded",
    })
  })
})
