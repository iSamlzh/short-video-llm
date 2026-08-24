import { timingSafeEqual } from "node:crypto"
import { resolveRuntimeFeatures, type RuntimeEnvironment } from "./runtime-features"

export type PrototypeApiAccess = { allowed: true } | { allowed: false; status: 401 | 404 }

export function authorizePrototypeApi(request: Request, environment: RuntimeEnvironment): PrototypeApiAccess {
  const features = resolveRuntimeFeatures(environment)
  if (!features.prototypeApiEnabled) return { allowed: false, status: 404 }
  if (!features.prototypeApiRequiresToken) return { allowed: true }

  const expected = environment.PROTOTYPE_API_TOKEN
  const provided = request.headers.get("x-prototype-token") ?? bearerToken(request.headers.get("authorization"))
  if (!expected || !provided || !sameSecret(expected, provided)) return { allowed: false, status: 401 }
  return { allowed: true }
}

function bearerToken(value: string | null) {
  if (!value?.startsWith("Bearer ")) return null
  return value.slice("Bearer ".length)
}

function sameSecret(expected: string, provided: string) {
  const left = Buffer.from(expected)
  const right = Buffer.from(provided)
  return left.length === right.length && timingSafeEqual(left, right)
}
