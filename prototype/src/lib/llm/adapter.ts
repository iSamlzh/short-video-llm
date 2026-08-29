export type LlmOperation = "ip_portrait" | "topics" | "scripts" | "qa" | "review" | "real_review" | "content_analysis" | "structure_candidate" | "structure_evolution" | "structure_preview" | "repair"
export interface TokenUsage { promptTokens?: number; completionTokens?: number; totalTokens?: number }
export interface LlmRequest {
  operation: LlmOperation
  systemPrompt: string
  input: unknown
  timeoutMs: number
  jsonRoot?: "object" | "array"
  signal?: AbortSignal
}
export interface LlmResponse { text: string; model: string; usage?: TokenUsage; finishReason?: string }
export interface LlmAdapter { generate(request: LlmRequest): Promise<LlmResponse> }
type OpenAiCompatibleConfig = { baseUrl?: string; apiKey?: string; model?: string; streaming?: boolean; maxOutputTokens?: number }

export function sanitizeModelCall(input: { apiKey?: string; operation: LlmOperation; model: string }) {
  return { operation: input.operation, model: input.model }
}

export class OpenAiCompatibleAdapter implements LlmAdapter {
  constructor(private readonly config: OpenAiCompatibleConfig = {
    baseUrl: process.env.LLM_BASE_URL,
    apiKey: process.env.LLM_API_KEY,
    model: process.env.LLM_MODEL,
    streaming: process.env.LLM_STREAMING !== "false",
    maxOutputTokens: positiveInteger(process.env.LLM_MAX_OUTPUT_TOKENS, 3_200),
  }) {}

  async generate(request: LlmRequest): Promise<LlmResponse> {
    const { baseUrl, apiKey, model } = this.config
    if (!baseUrl || !apiKey || !model) throw Object.assign(new Error("请先配置真实模型连接"), { code: "LLM_NOT_CONFIGURED", retryable: false })
    if (request.signal?.aborted) throw modelCancelledError()
    const controller = new AbortController()
    const abortFromCaller = () => controller.abort()
    request.signal?.addEventListener("abort", abortFromCaller, { once: true })
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs)
    try {
      const streaming = this.config.streaming === true
      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          temperature: request.operation === "ip_portrait" || request.operation === "qa" || request.operation === "real_review" || request.operation === "content_analysis" || request.operation === "structure_candidate" || request.operation === "structure_evolution" || request.operation === "structure_preview" ? 0.35 : 0.6,
          messages: [
            { role: "system", content: request.systemPrompt },
            { role: "user", content: JSON.stringify(request.input) },
          ],
          ...(request.jsonRoot === "array" ? {} : { response_format: { type: "json_object" } }),
          ...(streaming ? { stream: true, stream_options: { include_usage: true } } : {}),
          ...(this.config.maxOutputTokens ? { max_tokens: this.config.maxOutputTokens } : {}),
        }),
        signal: controller.signal,
      })
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500
        const code = response.status === 429
          ? "MODEL_RATE_LIMITED"
          : response.status >= 500
            ? "MODEL_SERVICE_UNAVAILABLE"
            : "MODEL_REQUEST_REJECTED"
        throw Object.assign(new Error(modelHttpMessage(response.status)), { code, status: response.status, retryable })
      }
      return streaming ? await readStreamingResponse(response, model) : await readJsonResponse(response, model)
    } catch (error) {
      if (isAbortError(error)) {
        if (request.signal?.aborted) throw modelCancelledError()
        throw modelTimeoutError()
      }
      if (error instanceof TypeError) {
        throw Object.assign(new Error("无法连接模型服务"), {
          code: "MODEL_CONNECTION_FAILED",
          status: 503,
          retryable: true,
          transportCode: transportErrorCode(error),
        })
      }
      throw error
    } finally {
      clearTimeout(timeout)
      request.signal?.removeEventListener("abort", abortFromCaller)
    }
  }
}

type OpenAiUsage = { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }

async function readJsonResponse(response: Response, fallbackModel: string): Promise<LlmResponse> {
  const body = await response.json() as {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string | null }>
    model?: string
    usage?: OpenAiUsage
  }
  const text = body.choices?.[0]?.message?.content
  if (!text) throw Object.assign(new Error("模型没有返回内容"), { code: "LLM_EMPTY_RESPONSE", retryable: true })
  return {
    text,
    model: body.model ?? fallbackModel,
    usage: mapUsage(body.usage),
    finishReason: body.choices?.[0]?.finish_reason ?? undefined,
  }
}

async function readStreamingResponse(response: Response, fallbackModel: string): Promise<LlmResponse> {
  const contentType = response.headers.get("content-type") ?? ""
  if (!contentType.includes("text/event-stream")) return readJsonResponse(response, fallbackModel)

  const payload = await response.text()
  let text = ""
  let model = fallbackModel
  let usage: OpenAiUsage | undefined
  let finishReason: string | undefined
  let pendingData = ""
  const applyEvent = (event: {
    model?: string
    choices?: Array<{ delta?: { content?: string }; message?: { content?: string }; finish_reason?: string | null }>
    usage?: OpenAiUsage
  }) => {
    model = event.model ?? model
    text += event.choices?.[0]?.delta?.content ?? event.choices?.[0]?.message?.content ?? ""
    finishReason = event.choices?.[0]?.finish_reason ?? finishReason
    usage = event.usage ?? usage
  }
  for (const line of payload.split(/\r?\n/)) {
    if (!line.startsWith("data:")) {
      if (!line.trim() && pendingData) throw invalidStreamError()
      continue
    }
    const data = line.slice("data:".length).trim()
    if (!data) continue
    if (data === "[DONE]") {
      if (pendingData) throw invalidStreamError()
      continue
    }
    pendingData += data
    try {
      applyEvent(JSON.parse(pendingData))
      pendingData = ""
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
    }
  }
  if (pendingData) throw invalidStreamError()
  if (!text) throw Object.assign(new Error("模型没有返回内容"), { code: "LLM_EMPTY_RESPONSE", retryable: true })
  return { text, model, usage: mapUsage(usage), finishReason }
}

function invalidStreamError() {
  return Object.assign(new Error("模型流式响应格式无效"), { code: "MODEL_STREAM_INVALID", status: 502, retryable: true })
}

function mapUsage(usage?: OpenAiUsage): TokenUsage | undefined {
  return usage ? {
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
  } : undefined
}

function modelCancelledError() {
  return Object.assign(new Error("已取消本次模型生成"), { code: "MODEL_TASK_CANCELLED", status: 499, retryable: false })
}

function modelTimeoutError() {
  return Object.assign(new Error("模型调用超时"), { code: "LLM_TIMEOUT", status: 504, retryable: true })
}

function modelHttpMessage(status: number) {
  if (status === 429) return "模型服务繁忙，请稍后重试"
  if (status >= 500) return "模型服务暂时不可用"
  return `模型服务拒绝了请求（${status}）`
}

function isAbortError(value: unknown) {
  return typeof value === "object" && value !== null && "name" in value && value.name === "AbortError"
}

function transportErrorCode(error: TypeError) {
  const cause = error.cause
  if (!cause || typeof cause !== "object" || !("code" in cause)) return "UNKNOWN_TRANSPORT_ERROR"
  const code = String(cause.code)
  return /^[A-Z0-9_]+$/.test(code) ? code : "UNKNOWN_TRANSPORT_ERROR"
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}
