import { currentRequestLogContext } from "./observability/request-log"
import { structuredLog } from "./observability/structured-log"

const lastEmitted = new Map<string, number>()

export function operationalAlert(event: string, detail: Record<string, string | number | boolean | null>, now = Date.now()) {
  const intervalMs = 5 * 60_000
  if (now - (lastEmitted.get(event) ?? 0) < intervalMs) return
  lastEmitted.set(event, now)
  structuredLog("error", event, {
    requestId: currentRequestLogContext()?.requestId,
    ...detail,
    occurredAt: new Date(now).toISOString(),
  })
}

export function clearOperationalAlertState() {
  lastEmitted.clear()
}
