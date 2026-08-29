import { afterEach, describe, expect, it, vi } from "vitest"
import { topicBatchSchema } from "../../src/domain/schemas"
import { FakeLlmAdapter } from "../../src/lib/llm/fake"
import { OpenAiCompatibleAdapter, sanitizeModelCall } from "../../src/lib/llm/adapter"
import { generateStructured, generateStructuredResult, StructuredLlmClient } from "../../src/lib/llm/structured"

const validTopicBatch = Array.from({ length: 3 }, (_, index) => ({
  id: `topic-${index + 1}`,
  title: `团长真实经历选题${index + 1}`,
  angle: "从社区团购的真实经历切入，讲清可复用的方法",
  audienceTension: "想拓展业务但缺少可信方法",
  ipFitEvidence: ["三年社区团购运营经历"],
  decisionBrief: {
    objective: "建立信任",
    whyToday: "今天需要先回答受众对长期经营可信度的疑问。",
    audienceProblem: "想拓展业务但缺少可信方法",
    ipEvidenceRefs: [{ label: "三年社区团购运营经历", sourceAnswerId: "profile:experience" }],
    recentDataStatus: "none",
    repetitionRisk: "low",
    nextSignal: "发布后观察完播和咨询问题。",
  },
  structureId: "case-breakdown",
  riskNotes: [],
}))

describe("structured model client", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("does not force JSON-object mode when the expected root is an array", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(validTopicBatch) } }],
      model: "test-model",
    }), { status: 200, headers: { "content-type": "application/json" } }))
    vi.stubGlobal("fetch", fetchMock)
    const adapter = new OpenAiCompatibleAdapter({
      baseUrl: "https://model.example/v1", apiKey: "secret", model: "test-model",
    })

    await adapter.generate({
      operation: "topics", systemPrompt: "return an array", input: {}, timeoutMs: 1_000, jsonRoot: "array",
    })

    const request = fetchMock.mock.calls[0][1] as RequestInit
    const body = JSON.parse(String(request.body))
    expect(body.response_format).toBeUndefined()
  })

  it("keeps JSON-object mode for object-shaped outputs", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "{}" } }], model: "test-model",
    }), { status: 200, headers: { "content-type": "application/json" } }))
    vi.stubGlobal("fetch", fetchMock)
    const adapter = new OpenAiCompatibleAdapter({
      baseUrl: "https://model.example/v1", apiKey: "secret", model: "test-model",
    })

    await adapter.generate({
      operation: "qa", systemPrompt: "return an object", input: {}, timeoutMs: 1_000, jsonRoot: "object",
    })

    const request = fetchMock.mock.calls[0][1] as RequestInit
    const body = JSON.parse(String(request.body))
    expect(body.response_format).toEqual({ type: "json_object" })
  })

  it("流式读取 SSE 内容并保留 Token 用量", async () => {
    const streamBody = [
      'data: {"model":"stream-model","choices":[{"delta":{"content":"{\\"ok\\":"}}]}',
      'data: {"model":"stream-model","choices":[{"delta":{"content":"true}"}}]}',
      'data: {"model":"stream-model","choices":[],"usage":{"prompt_tokens":12,"completion_tokens":3,"total_tokens":15}}',
      "data: [DONE]",
      "",
    ].join("\n")
    const fetchMock = vi.fn().mockResolvedValue(new Response(streamBody, {
      status: 200,
      headers: { "content-type": "text/event-stream; charset=utf-8" },
    }))
    vi.stubGlobal("fetch", fetchMock)
    const adapter = new OpenAiCompatibleAdapter({
      baseUrl: "https://model.example/v1", apiKey: "secret", model: "test-model", streaming: true,
    })

    const result = await adapter.generate({
      operation: "qa", systemPrompt: "return an object", input: {}, timeoutMs: 1_000, jsonRoot: "object",
    })

    const request = fetchMock.mock.calls[0][1] as RequestInit
    const body = JSON.parse(String(request.body))
    expect(body).toMatchObject({ stream: true, stream_options: { include_usage: true } })
    expect(result).toEqual({
      text: '{"ok":true}', model: "stream-model",
      usage: { promptTokens: 12, completionTokens: 3, totalTokens: 15 },
    })
  })

  it("repairs invalid structured output only once", async () => {
    const adapter = new FakeLlmAdapter([
      { text: "not-json" },
      { json: validTopicBatch },
    ])
    const result = await generateStructured({
      adapter,
      operation: "topics",
      input: { ip: "example" },
      schema: topicBatchSchema,
      timeoutMs: 60_000,
    })
    expect(result).toEqual(validTopicBatch)
    expect(adapter.calls.map(call => call.operation)).toEqual(["topics", "repair"])
    expect(adapter.calls[1].systemPrompt).toContain("decisionBrief 必须包含")
    expect(adapter.calls[1].systemPrompt).toContain("当前任务只修复上一份输出")
  })

  it("stops after one failed repair", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined)
    const adapter = new FakeLlmAdapter([{ text: "bad" }, { text: "still bad" }])
    await expect(generateStructured({
      adapter, operation: "topics", input: {}, schema: topicBatchSchema, timeoutMs: 100,
    })).rejects.toMatchObject({ code: "MODEL_SCHEMA_INVALID" })
    expect(adapter.calls).toHaveLength(2)
    const records = info.mock.calls.map(call => JSON.parse(String(call[0])))
    expect(records.filter(record => record.event === "model_schema_validation_failed")).toEqual([
      expect.objectContaining({ operation: "topics", stage: "initial", responseChars: 3, issuePaths: "$" }),
      expect.objectContaining({ operation: "topics", stage: "repair", responseChars: 9, issuePaths: "$" }),
    ])
    expect(JSON.stringify(records)).not.toContain("still bad")
    info.mockRestore()
  })

  it("保留最终模型并合并首次与修复调用的 Token Usage", async () => {
    const adapter = new FakeLlmAdapter([
      { text: "bad", model: "first-model", usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 } },
      { json: validTopicBatch, model: "repair-model", usage: { promptTokens: 4, completionTokens: 8, totalTokens: 12 } },
    ])
    const result = await generateStructuredResult({
      adapter, operation: "topics", input: {}, schema: topicBatchSchema, timeoutMs: 100,
    })
    expect(result).toMatchObject({
      data: validTopicBatch,
      model: "repair-model",
      usage: { promptTokens: 14, completionTokens: 10, totalTokens: 24 },
    })
  })

  it("never exposes the API key in model call records", () => {
    const record = sanitizeModelCall({ apiKey: "secret-key", operation: "topics", model: "demo" })
    expect(JSON.stringify(record)).not.toContain("secret-key")
    expect(record).toEqual({ operation: "topics", model: "demo" })
  })

  it.each([
    [429, "MODEL_RATE_LIMITED", 429],
    [503, "MODEL_SERVICE_UNAVAILABLE", 503],
  ] as const)("将 HTTP %s 映射成稳定模型错误 %s", async (httpStatus, errorCode, status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: httpStatus })))
    const adapter = new OpenAiCompatibleAdapter({
      baseUrl: "https://model.example/v1", apiKey: "secret", model: "test-model",
    })

    await expect(adapter.generate({
      operation: "topics", systemPrompt: "prompt", input: {}, timeoutMs: 1_000,
    })).rejects.toMatchObject({ code: errorCode, status, retryable: true })
  })

  it("将网络连接失败映射成可重试稳定错误", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed: secret prompt must not leak", {
      cause: Object.assign(new Error("socket closed"), { code: "UND_ERR_SOCKET" }),
    }))
    vi.stubGlobal("fetch", fetchMock)
    const adapter = new OpenAiCompatibleAdapter({
      baseUrl: "https://model.example/v1", apiKey: "secret", model: "test-model",
    })

    await expect(adapter.generate({
      operation: "topics", systemPrompt: "sensitive", input: { private: "content" }, timeoutMs: 1_000,
    })).rejects.toMatchObject({ code: "MODEL_CONNECTION_FAILED", status: 503, retryable: true, transportCode: "UND_ERR_SOCKET" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("超时后不重复提交生成任务，并保留兼容错误码", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError"))
    vi.stubGlobal("fetch", fetchMock)
    const adapter = new OpenAiCompatibleAdapter({
      baseUrl: "https://model.example/v1", apiKey: "secret", model: "test-model",
    })

    await expect(adapter.generate({
      operation: "topics", systemPrompt: "prompt", input: {}, timeoutMs: 1_000,
    })).rejects.toMatchObject({ code: "LLM_TIMEOUT", status: 504, retryable: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("用户取消后立即停止，不把取消误报成超时", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const adapter = new OpenAiCompatibleAdapter({
      baseUrl: "https://model.example/v1", apiKey: "secret", model: "test-model",
    })
    const controller = new AbortController()
    controller.abort()

    await expect(adapter.generate({
      operation: "topics", systemPrompt: "prompt", input: {}, timeoutMs: 1_000, signal: controller.signal,
    })).rejects.toMatchObject({ code: "MODEL_TASK_CANCELLED", status: 499, retryable: false })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("首次生成和结构修复共享同一个总超时预算", async () => {
    const timeouts: number[] = []
    let calls = 0
    const adapter = {
      async generate(request: Parameters<OpenAiCompatibleAdapter["generate"]>[0]) {
        timeouts.push(request.timeoutMs)
        calls += 1
        if (calls === 1) {
          await new Promise(resolve => setTimeout(resolve, 20))
          return { text: "bad", model: "test-model" }
        }
        return { text: JSON.stringify(validTopicBatch), model: "test-model" }
      },
    }

    await generateStructured({ adapter, operation: "topics", input: {}, schema: topicBatchSchema, timeoutMs: 200 })

    expect(timeouts).toHaveLength(2)
    expect(timeouts[1]).toBeLessThan(timeouts[0])
  })

  it("模型调用日志只记录操作、耗时和结果，不记录 Prompt 或 API Key", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined)
    const client = new StructuredLlmClient(new FakeLlmAdapter([{ json: validTopicBatch }]))

    await client.generateStructured("topics", { apiKey: "secret-key", private: "sensitive prompt" }, topicBatchSchema, "array")

    expect(JSON.parse(String(info.mock.calls[0]?.[0]))).toMatchObject({
      event: "model_operation", operation: "topics", outcome: "success", durationMs: expect.any(Number),
    })
    const serialized = JSON.stringify(info.mock.calls)
    expect(serialized).not.toContain("secret-key")
    expect(serialized).not.toContain("sensitive prompt")
    info.mockRestore()
  })
})
