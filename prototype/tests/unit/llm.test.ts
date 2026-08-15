import { describe, expect, it } from "vitest"
import { topicBatchSchema } from "../../src/domain/schemas"
import { FakeLlmAdapter } from "../../src/lib/llm/fake"
import { sanitizeModelCall } from "../../src/lib/llm/adapter"
import { generateStructured } from "../../src/lib/llm/structured"

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

  it("never exposes the API key in model call records", () => {
    const record = sanitizeModelCall({ apiKey: "secret-key", operation: "topics", model: "demo" })
    expect(JSON.stringify(record)).not.toContain("secret-key")
    expect(record).toEqual({ operation: "topics", model: "demo" })
  })
})
