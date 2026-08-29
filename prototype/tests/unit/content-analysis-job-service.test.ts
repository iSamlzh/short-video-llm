import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type Database from "better-sqlite3"
import type { PlatformAccessContext } from "../../src/domain/access"
import { openDatabase } from "../../src/lib/db/database"
import { seedDemoData } from "../../src/scripts/demo-data"
import { ContentAnalysisJobService } from "../../src/services/content-analysis-job-service"

const operator: PlatformAccessContext = {
  audience: "platform", userId: "user-platform", platformRole: "platform_operator",
}

describe("ContentAnalysisJobService", () => {
  let database: Database.Database

  beforeEach(async () => {
    database = openDatabase(":memory:")
    await seedDemoData(database, "demo-password")
  })

  afterEach(() => database.close())

  it("后台处理时保存阶段并只向任务表写结果引用", async () => {
    const analysis = {
      analyze: vi.fn(async (_context: unknown, _sampleId: string, progress?: (stage: string, message: string) => void) => {
        progress?.("structure_analysis", "正在识别爆款结构")
        progress?.("evidence_validation", "正在校验证据引用")
        progress?.("persistence", "正在保存拆解结果")
        return { id: "analysis-generated-1", confidentialPayload: "不应进入 Agent 任务表" }
      }),
    }
    const modelTasks = { run: vi.fn(async (_input: unknown, task: () => Promise<unknown>) => task()) }
    const service = new ContentAnalysisJobService(database, analysis as any, modelTasks as any, {
      NODE_ENV: "production", CONTENT_ANALYSIS_WORKER_CONCURRENCY: "1",
    })
    const queued = service.enqueue(operator, "sample-neighbor", "agent-service-request-12345678")

    expect(queued.status).toBe("queued")
    await service.drain()

    expect(service.get(operator, queued.id)).toMatchObject({
      status: "succeeded", stage: "review_ready", resultReference: "analysis-generated-1",
    })
    const stored = database.prepare("SELECT result_reference,payload_json FROM agent_jobs WHERE id=?").get(queued.id)
    expect(stored).toEqual({ result_reference: "analysis-generated-1", payload_json: JSON.stringify({ sampleId: "sample-neighbor" }) })
  })

  it("模型超时自动重排且页面可读取重试等待状态", async () => {
    const analysis = { analyze: vi.fn() }
    const modelTasks = {
      run: vi.fn(async () => { throw Object.assign(new Error("模型调用超时"), { code: "LLM_TIMEOUT", retryable: true }) }),
    }
    const service = new ContentAnalysisJobService(database, analysis as any, modelTasks as any, {
      NODE_ENV: "production", CONTENT_ANALYSIS_WORKER_CONCURRENCY: "1",
    })
    const queued = service.enqueue(operator, "sample-neighbor", "agent-timeout-request-12345678")

    await service.drain()

    expect(service.get(operator, queued.id)).toMatchObject({
      status: "queued", stage: "retry_wait", errorCode: "LLM_TIMEOUT", retryable: true, attemptCount: 1,
    })
  })

  it("开发和 E2E 环境提交后自动启动内嵌 Worker", async () => {
    const analysis = { analyze: vi.fn(async () => ({ id: "analysis-inline-1" })) }
    const modelTasks = { run: vi.fn(async (_input: unknown, task: () => Promise<unknown>) => task()) }
    const service = new ContentAnalysisJobService(database, analysis as any, modelTasks as any, {
      APP_ENV: "e2e", NODE_ENV: "production", CONTENT_ANALYSIS_WORKER_CONCURRENCY: "1",
    })
    const queued = service.enqueue(operator, "sample-neighbor", "agent-inline-request-12345678")

    service.kick()

    await vi.waitFor(() => expect(service.get(operator, queued.id).status).toBe("succeeded"))
  })
})
