import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import nextEnv from "@next/env"
import type { LlmAdapter, LlmRequest, LlmResponse } from "../../src/lib/llm/adapter"
import { OpenAiCompatibleAdapter } from "../../src/lib/llm/adapter"
import { PrototypeRepository } from "../../src/lib/db/repository"
import { StructuredLlmClient } from "../../src/lib/llm/structured"
import { RunService } from "../../src/services/run-service"

nextEnv.loadEnvConfig(process.cwd())

const required = ["LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL"] as const
const missing = required.filter(name => !process.env[name])
if (missing.length) {
  console.error(`SKIP: 缺少真实模型配置：${missing.join(", ")}`)
  process.exitCode = 2
} else {
  const calls: Array<{ operation: string; durationMs: number; totalTokens?: number; model: string }> = []
  class TimedAdapter implements LlmAdapter {
    constructor(private readonly inner: LlmAdapter) {}
    async generate(request: LlmRequest): Promise<LlmResponse> {
      const started = performance.now()
      const response = await this.inner.generate(request)
      calls.push({ operation: request.operation, durationMs: Math.round(performance.now() - started), totalTokens: response.usage?.totalTokens, model: response.model })
      return response
    }
  }

  const repository = new PrototypeRepository(join(mkdtempSync(join(tmpdir(), "content-live-smoke-")), "smoke.sqlite"))
  try {
    const service = new RunService(repository, new StructuredLlmClient(new TimedAdapter(new OpenAiCompatibleAdapter())))
    const run = service.createRun({
      displayName: "测试团长", experience: "三年社区团购运营经历，真实服务过多个社区并持续复盘",
      expertise: "社区团购运营", audience: "希望拓展本地业务的人", voiceStyle: "直接、实在、有案例", boundaries: "不承诺确定收益",
    })
    const topics = await service.generateTopics(run.id, run.inputVersion)
    if (topics.items.length < 3 || topics.items.length > 5) throw new Error("LIVE_TOPICS_COUNT_INVALID")
    service.selectTopic(run.id, topics.version, topics.items[0].id)
    const scripts = await service.generateScripts(run.id, run.inputVersion)
    if (scripts.items.length !== 1 || scripts.items[0].topicDirectionId !== topics.items[0].id) throw new Error("LIVE_SINGLE_SCRIPT_INVALID")
    service.selectScript(run.id, scripts.version, scripts.items[0].id)
    service.lockScript(run.id)
    const businessCalls = calls.filter(call => call.operation !== "repair")
    const repairCalls = calls.filter(call => call.operation === "repair")
    if (businessCalls.length !== 2 || businessCalls[0].operation !== "topics" || businessCalls[1].operation !== "scripts" || repairCalls.length > 2) {
      throw new Error(`LIVE_MODEL_CALL_BOUNDARY_INVALID:${calls.map(call => call.operation).join(",")}`)
    }
    console.table(calls.map(call => ({ operation: call.operation, model: call.model, durationMs: call.durationMs, totalTokens: call.totalTokens ?? "n/a" })))
  } finally {
    repository.close()
  }
}
