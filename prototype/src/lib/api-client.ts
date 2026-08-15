export class PrototypeApiError extends Error {
  constructor(readonly payload: { errorCode: string; message: string; retryable: boolean }, readonly status: number) {
    super(payload.message)
  }
}

async function read<T>(response: Response): Promise<T> {
  const payload = await response.json()
  if (!response.ok) throw new PrototypeApiError(payload, response.status)
  return payload as T
}

export function createRun<T>(body: unknown) {
  return fetch("/api/prototype/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(read<T>)
}
export function getRun<T>(runId: string) { return fetch(`/api/prototype/runs/${runId}`).then(read<T>) }
export function postCommand<T>(runId: string, command: string, body: Record<string, unknown> = {}) {
  return fetch(`/api/prototype/runs/${runId}/${command}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }).then(read<T>)
}
