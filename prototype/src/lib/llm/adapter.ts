export type LlmOperation = "topics" | "scripts" | "qa" | "review" | "repair"
export interface TokenUsage { promptTokens?: number; completionTokens?: number; totalTokens?: number }
export interface LlmRequest {
  operation: LlmOperation
  systemPrompt: string
  input: unknown
  timeoutMs: number
  jsonRoot?: "object" | "array"
}
export interface LlmResponse { text: string; model: string; usage?: TokenUsage }
export interface LlmAdapter { generate(request: LlmRequest): Promise<LlmResponse> }

export function sanitizeModelCall(input: { apiKey?: string; operation: LlmOperation; model: string }) {
  return { operation: input.operation, model: input.model }
}

export class OpenAiCompatibleAdapter implements LlmAdapter {
  constructor(private readonly config = {
    baseUrl: process.env.LLM_BASE_URL,
    apiKey: process.env.LLM_API_KEY,
    model: process.env.LLM_MODEL,
  }) {}

  async generate(request: LlmRequest): Promise<LlmResponse> {
    const { baseUrl, apiKey, model } = this.config
    if (!baseUrl || !apiKey || !model) throw Object.assign(new Error("请先配置真实模型连接"), { code: "LLM_NOT_CONFIGURED", retryable: false })
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), request.timeoutMs)
      try {
        const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            temperature: request.operation === "qa" ? 0.1 : 0.6,
            messages: [
              { role: "system", content: request.systemPrompt },
              { role: "user", content: JSON.stringify(request.input) },
            ],
            ...(request.jsonRoot === "array" ? {} : { response_format: { type: "json_object" } }),
          }),
          signal: controller.signal,
        })
        if (!response.ok) {
          const retryable = response.status === 429 || response.status >= 500
          if (retryable && attempt === 0) continue
          throw Object.assign(new Error(`模型服务返回 ${response.status}`), { code: "LLM_HTTP_ERROR", retryable })
        }
        const body = await response.json() as {
          choices?: Array<{ message?: { content?: string } }>
          model?: string
          usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
        }
        const text = body.choices?.[0]?.message?.content
        if (!text) throw Object.assign(new Error("模型没有返回内容"), { code: "LLM_EMPTY_RESPONSE", retryable: true })
        return {
          text, model: body.model ?? model,
          usage: body.usage ? {
            promptTokens: body.usage.prompt_tokens,
            completionTokens: body.usage.completion_tokens,
            totalTokens: body.usage.total_tokens,
          } : undefined,
        }
      } catch (error) {
        if (attempt === 0 && (error instanceof TypeError || (error instanceof Error && error.name === "AbortError"))) continue
        if (error instanceof Error && error.name === "AbortError") {
          throw Object.assign(new Error("模型调用超时"), { code: "LLM_TIMEOUT", retryable: true })
        }
        throw error
      } finally {
        clearTimeout(timeout)
      }
    }
    throw Object.assign(new Error("模型服务暂时不可用"), { code: "LLM_UNAVAILABLE", retryable: true })
  }
}
