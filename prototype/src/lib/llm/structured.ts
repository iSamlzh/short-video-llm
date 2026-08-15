import type { z } from "zod"
import type { LlmAdapter, LlmOperation } from "./adapter"
import { prompts } from "../../prompts"

function parseJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
  return JSON.parse(trimmed)
}

function validate<T>(schema: z.ZodType<T>, text: string) {
  try {
    const parsed = parseJson(text)
    const checked = schema.safeParse(parsed)
    return checked.success ? { success: true as const, data: checked.data } : { success: false as const, issues: checked.error.issues }
  } catch {
    return { success: false as const, issues: [{ path: [], code: "invalid_json", message: "Response is not valid JSON" }] }
  }
}

export async function generateStructured<T>(options: {
  adapter: LlmAdapter
  operation: Exclude<LlmOperation, "repair">
  input: unknown
  schema: z.ZodType<T>
  timeoutMs: number
  jsonRoot?: "object" | "array"
}): Promise<T> {
  const first = await options.adapter.generate({
    operation: options.operation,
    systemPrompt: prompts[options.operation],
    input: options.input,
    timeoutMs: options.timeoutMs,
    jsonRoot: options.jsonRoot,
  })
  const checked = validate(options.schema, first.text)
  if (checked.success) return checked.data

  const repaired = await options.adapter.generate({
    operation: "repair",
    systemPrompt: "只修复 JSON 结构，使其满足字段约束；不要添加解释。",
    input: { original: first.text, issues: checked.issues.map(issue => ({ path: issue.path, code: issue.code, message: issue.message })) },
    timeoutMs: options.timeoutMs,
    jsonRoot: options.jsonRoot,
  })
  const repairedChecked = validate(options.schema, repaired.text)
  if (repairedChecked.success) return repairedChecked.data
  throw Object.assign(new Error("模型结构化输出修复失败"), { code: "MODEL_SCHEMA_INVALID", retryable: true })
}

export class StructuredLlmClient {
  constructor(private readonly adapter: LlmAdapter) {}
  generateStructured<T>(
    operation: Exclude<LlmOperation, "repair">,
    input: unknown,
    schema: z.ZodType<T>,
    jsonRoot: "object" | "array" = "object",
  ) {
    const timeoutMs = Number(process.env.LLM_TIMEOUT_SECONDS ?? 60) * 1000
    return generateStructured({ adapter: this.adapter, operation, input, schema, timeoutMs, jsonRoot })
  }
}
