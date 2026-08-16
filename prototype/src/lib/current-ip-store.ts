import type { IpProfile } from "../domain/models"
import { ipProfileSchema } from "../domain/schemas"

export const CURRENT_IP_KEY = "content-prototype-current-ip-v1"

export function loadCurrentIp(): IpProfile | null {
  const raw = window.localStorage.getItem(CURRENT_IP_KEY)
  if (!raw) return null

  try {
    const parsed = ipProfileSchema.safeParse(JSON.parse(raw))
    if (parsed.success) return parsed.data
  } catch {
    // Invalid browser data is discarded below.
  }

  window.localStorage.removeItem(CURRENT_IP_KEY)
  return null
}

export function saveCurrentIp(profile: IpProfile) {
  window.localStorage.setItem(CURRENT_IP_KEY, JSON.stringify(ipProfileSchema.parse(profile)))
}

export function clearCurrentIp() {
  window.localStorage.removeItem(CURRENT_IP_KEY)
}
