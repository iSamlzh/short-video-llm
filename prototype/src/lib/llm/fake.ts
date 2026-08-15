import type { LlmAdapter, LlmRequest, LlmResponse } from "./adapter"

type QueuedResponse = { text: string } | { json: unknown }

export class FakeLlmAdapter implements LlmAdapter {
  readonly calls: LlmRequest[] = []
  private readonly queue: QueuedResponse[]

  constructor(responses: QueuedResponse[] = []) { this.queue = [...responses] }
  enqueue(response: QueuedResponse) { this.queue.push(response) }

  async generate(request: LlmRequest): Promise<LlmResponse> {
    this.calls.push(request)
    const response = this.queue.shift()
    if (!response) throw new Error(`FAKE_LLM_RESPONSE_MISSING:${request.operation}`)
    return { text: "json" in response ? JSON.stringify(response.json) : response.text, model: "fake-test-model" }
  }
}
