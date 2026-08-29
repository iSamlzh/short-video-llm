import type { z } from "zod"
import type { LlmAdapter, LlmOperation, TokenUsage } from "./adapter"
import { prompts } from "../../prompts"
import { currentModelExecutionContext } from "./model-execution-context"
import { currentRequestLogContext } from "../observability/request-log"
import { structuredLog } from "../observability/structured-log"

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
  repairTimeoutMs?: number
  deadlineAt?: number
  recordUsage?: (model: string, usage?: TokenUsage) => void
  jsonRoot?: "object" | "array"
  signal?: AbortSignal
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
  const first = await runModelStage(options.operation, "initial", () => options.adapter.generate({
      operation: options.operation,
      systemPrompt: prompts[options.operation],
      input: options.input,
      timeoutMs: boundedTimeout(options.timeoutMs, options.deadlineAt),
      jsonRoot: options.jsonRoot,
      signal: options.signal,
    }))
  options.recordUsage?.(first.model, first.usage)
  const checked = validate(options.schema, first.text)
  if (checked.success) return { data: checked.data, model: first.model, usage: first.usage }

  logSchemaFailure(options.operation, "initial", first.text, checked.issues, first.finishReason)

  const repaired = await runModelStage(options.operation, "repair", () => options.adapter.generate({
      operation: "repair",
      systemPrompt: `${prompts[options.operation]}\n\n当前任务只修复上一份输出。必须严格遵守上面的完整输出契约，保留原有有效内容，补齐缺失字段，纠正字段类型并删除额外字段；只返回修复后的 JSON，不要解释。`,
      input: { original: first.text, issues: checked.issues.map(issue => ({ path: issue.path, code: issue.code, message: issue.message })) },
      timeoutMs: boundedTimeout(options.repairTimeoutMs ?? options.timeoutMs, options.deadlineAt),
      jsonRoot: options.jsonRoot,
      signal: options.signal,
    }))
  options.recordUsage?.(repaired.model, repaired.usage)
  const repairedChecked = validate(options.schema, repaired.text)
  if (repairedChecked.success) {
    return { data: repairedChecked.data, model: repaired.model, usage: combineUsage(first.usage, repaired.usage) }
  }
  logSchemaFailure(options.operation, "repair", repaired.text, repairedChecked.issues, repaired.finishReason)
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
    return (await this.execute(operation, input, schema, jsonRoot)).data
  }

  async generateStructuredResult<T>(
    operation: Exclude<LlmOperation, "repair">,
    input: unknown,
    schema: z.ZodType<T>,
    jsonRoot: "object" | "array" = "object",
  ) {
    return this.execute(operation, input, schema, jsonRoot)
  }

  private async execute<T>(
    operation: Exclude<LlmOperation, "repair">,
    input: unknown,
    schema: z.ZodType<T>,
    jsonRoot: "object" | "array",
  ) {
    const context = currentModelExecutionContext()
    const legacyTimeoutMs = positiveConfiguredSeconds(process.env.LLM_TIMEOUT_SECONDS, 60) * 1000
    const primaryTimeoutMs = positiveConfiguredSeconds(process.env.LLM_PRIMARY_TIMEOUT_SECONDS, legacyTimeoutMs / 1000) * 1000
    const repairTimeoutMs = positiveConfiguredSeconds(process.env.LLM_REPAIR_TIMEOUT_SECONDS, 60) * 1000
    return this.withOperationLog(operation, async () => {
      const result = await generateStructuredResult({
        adapter: this.adapter,
        operation,
        input,
        schema,
        timeoutMs: primaryTimeoutMs,
        repairTimeoutMs,
        deadlineAt: context?.deadlineAt,
        recordUsage: context?.recordUsage,
        jsonRoot,
        signal: context?.signal,
      })
      return result
    })
  }

  private async withOperationLog<T extends StructuredLlmResult<unknown>>(operation: Exclude<LlmOperation, "repair">, call: () => Promise<T>) {
    const startedAt = Date.now()
    const taskId = currentModelExecutionContext()?.taskId
    const tenantId = currentModelExecutionContext()?.tenantId
    const scopeType = currentModelExecutionContext()?.scopeType
    const scopeId = currentModelExecutionContext()?.scopeId
    try {
      const result = await call()
      structuredLog("info", "model_operation", {
        requestId: currentRequestLogContext()?.requestId,
        operation,
        taskId,
        tenantId,
        scopeType,
        scopeId,
        model: result.model,
        totalTokens: result.usage?.totalTokens,
        durationMs: Date.now() - startedAt,
        outcome: "success",
      })
      return result
    } catch (error) {
      const context = currentModelExecutionContext()
      const value = error as { code?: string; transportCode?: string }
      const originalCode = value.code ?? "MODEL_OPERATION_FAILED"
      const code = originalCode === "MODEL_TASK_CANCELLED" && context && Date.now() >= context.deadlineAt
        ? "LLM_TIMEOUT"
        : originalCode
      structuredLog("error", "model_operation", {
        requestId: currentRequestLogContext()?.requestId,
        operation,
        taskId,
        tenantId,
        scopeType,
        scopeId,
        durationMs: Date.now() - startedAt,
        outcome: "failure",
        errorCode: code,
        ...(value.transportCode ? { transportCode: value.transportCode } : {}),
      })
      throw error
    }
  }
}

function boundedTimeout(configuredTimeoutMs: number, deadlineAt?: number) {
  return positiveTimeout(deadlineAt
    ? Math.min(configuredTimeoutMs, deadlineAt - Date.now())
    : configuredTimeoutMs)
}

function positiveTimeout(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    throw Object.assign(new Error("模型调用超时"), { code: "LLM_TIMEOUT", status: 504, retryable: true })
  }
  return Math.max(1, Math.floor(value))
}

function positiveConfiguredSeconds(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

async function runModelStage<T extends { model: string; text: string; usage?: TokenUsage }>(
  operation: Exclude<LlmOperation, "repair">,
  stage: "initial" | "repair",
  call: () => Promise<T>,
) {
  const startedAt = Date.now()
  const context = currentModelExecutionContext()
  try {
    const result = await call()
    structuredLog("info", "model_stage", {
      requestId: currentRequestLogContext()?.requestId,
      taskId: context?.taskId,
      operation,
      stage,
      model: result.model,
      totalTokens: result.usage?.totalTokens,
      responseChars: result.text.length,
      durationMs: Date.now() - startedAt,
      outcome: "received",
    })
    return result
  } catch (error) {
    const value = error as { code?: string; transportCode?: string }
    structuredLog("error", "model_stage", {
      requestId: currentRequestLogContext()?.requestId,
      taskId: context?.taskId,
      operation,
      stage,
      durationMs: Date.now() - startedAt,
      outcome: "failure",
      errorCode: value.code ?? "MODEL_STAGE_FAILED",
      ...(value.transportCode ? { transportCode: value.transportCode } : {}),
    })
    throw error
  }
}

function logSchemaFailure(
  operation: Exclude<LlmOperation, "repair">,
  stage: "initial" | "repair",
  text: string,
  issues: Array<{ path: PropertyKey[]; code: string }>,
  finishReason?: string,
) {
  const paths = [...new Set(issues.map((issue) => issue.path.length ? issue.path.join(".") : "$"))]
    .slice(0, 12)
    .join(",")
  const context = currentModelExecutionContext()
  structuredLog("warn", "model_schema_validation_failed", {
    requestId: currentRequestLogContext()?.requestId,
    taskId: context?.taskId,
    operation,
    stage,
    responseChars: text.length,
    issueCount: issues.length,
    issuePaths: paths,
    finishReason,
  })
}
