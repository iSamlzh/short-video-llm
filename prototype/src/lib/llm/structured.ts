import type { z } from "zod"
import type { LlmAdapter, LlmOperation, TokenUsage } from "./adapter"
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

type GenerateOptions<T> = {
  adapter: LlmAdapter
  operation: Exclude<LlmOperation, "repair">
  input: unknown
  schema: z.ZodType<T>
  timeoutMs: number
  jsonRoot?: "object" | "array"
}

export type StructuredLlmResult<T> = { data: T; model: string; usage?: TokenUsage }

function combineUsage(first?: TokenUsage, repaired?: TokenUsage): TokenUsage | undefined {
  if (!first && !repaired) return undefined
  return {
    promptTokens: (first?.promptTokens ?? 0) + (repaired?.promptTokens ?? 0),
    completionTokens: (first?.completionTokens ?? 0) + (repaired?.completionTokens ?? 0),
    totalTokens: (first?.totalTokens ?? 0) + (repaired?.totalTokens ?? 0),
  }
}

export async function generateStructuredResult<T>(options: GenerateOptions<T>): Promise<StructuredLlmResult<T>> {
  const first = await options.adapter.generate({
    operation: options.operation,
    systemPrompt: prompts[options.operation],
    input: options.input,
    timeoutMs: options.timeoutMs,
    jsonRoot: options.jsonRoot,
  })
  const checked = validate(options.schema, first.text)
  if (checked.success) return { data: checked.data, model: first.model, usage: first.usage }

  const repaired = await options.adapter.generate({
    operation: "repair",
    systemPrompt: "只修复 JSON 结构，使其满足字段约束；不要添加解释。",
    input: { original: first.text, issues: checked.issues.map(issue => ({ path: issue.path, code: issue.code, message: issue.message })) },
    timeoutMs: options.timeoutMs,
    jsonRoot: options.jsonRoot,
  })
  const repairedChecked = validate(options.schema, repaired.text)
  if (repairedChecked.success) {
    return { data: repairedChecked.data, model: repaired.model, usage: combineUsage(first.usage, repaired.usage) }
  }
  throw Object.assign(new Error("模型结构化输出修复失败"), { code: "MODEL_SCHEMA_INVALID", status: 502, retryable: true })
}

export async function generateStructured<T>(options: GenerateOptions<T>): Promise<T> {
  return (await generateStructuredResult(options)).data
}

export class StructuredLlmClient {
  constructor(private readonly adapter: LlmAdapter) {}
  async generateStructured<T>(
    operation: Exclude<LlmOperation, "repair">,
    input: unknown,
    schema: z.ZodType<T>,
    jsonRoot: "object" | "array" = "object",
  ) {
    const timeoutMs = Number(process.env.LLM_TIMEOUT_SECONDS ?? 60) * 1000
    return this.withOperationLog(operation, () => generateStructured({ adapter: this.adapter, operation, input, schema, timeoutMs, jsonRoot }))
  }

  async generateStructuredResult<T>(
    operation: Exclude<LlmOperation, "repair">,
    input: unknown,
    schema: z.ZodType<T>,
    jsonRoot: "object" | "array" = "object",
  ) {
    const timeoutMs = Number(process.env.LLM_TIMEOUT_SECONDS ?? 60) * 1000
    return this.withOperationLog(operation, () => generateStructuredResult({ adapter: this.adapter, operation, input, schema, timeoutMs, jsonRoot }))
  }

  private async withOperationLog<T>(operation: Exclude<LlmOperation, "repair">, call: () => Promise<T>) {
    const startedAt = Date.now()
    try {
      const result = await call()
      console.info("model_operation", { operation, durationMs: Date.now() - startedAt, outcome: "success" })
      return result
    } catch (error) {
      const code = (error as { code?: string }).code ?? "MODEL_OPERATION_FAILED"
      console.info("model_operation", { operation, durationMs: Date.now() - startedAt, outcome: "failure", errorCode: code })
      throw error
    }
  }
}
