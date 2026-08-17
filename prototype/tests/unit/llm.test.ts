import { afterEach, describe, expect, it, vi } from "vitest"
import { topicBatchSchema } from "../../src/domain/schemas"
import { FakeLlmAdapter } from "../../src/lib/llm/fake"
import { OpenAiCompatibleAdapter, sanitizeModelCall } from "../../src/lib/llm/adapter"
import { generateStructured, generateStructuredResult } from "../../src/lib/llm/structured"

const validTopicBatch = Array.from({ length: 3 }, (_, index) => ({
  id: `topic-${index + 1}`,
  title: `团长真实经历选题${index + 1}`,
  angle: "从社区团购的真实经历切入，讲清可复用的方法",
  audienceTension: "想拓展业务但缺少可信方法",
  ipFitEvidence: ["三年社区团购运营经历"],
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
  })

  it("stops after one failed repair", async () => {
    const adapter = new FakeLlmAdapter([{ text: "bad" }, { text: "still bad" }])
    await expect(generateStructured({
      adapter, operation: "topics", input: {}, schema: topicBatchSchema, timeoutMs: 100,
    })).rejects.toMatchObject({ code: "MODEL_SCHEMA_INVALID" })
    expect(adapter.calls).toHaveLength(2)
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
})
