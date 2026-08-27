import { AsyncLocalStorage } from "node:async_hooks"
import type { TokenUsage } from "./adapter"

export type ModelExecutionContext = {
  taskId: string
  tenantId?: string
  scopeType: "tenant" | "platform"
  scopeId: string
  operation: string
  signal?: AbortSignal
  deadlineAt: number
  recordUsage: (model: string, usage?: TokenUsage) => void
}

const storage = new AsyncLocalStorage<ModelExecutionContext>()

export function withModelExecutionContext<T>(context: ModelExecutionContext, task: () => Promise<T>) {
  return storage.run(context, task)
}

export function currentModelExecutionContext() {
  return storage.getStore()
}
