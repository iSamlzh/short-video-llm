import { ZodError } from "zod"
import type { AccessContext, TenantAccessContext } from "../domain/access"

const statusByCode: Record<string, number> = {
  UNAUTHENTICATED: 401,
  TENANT_AUDIENCE_REQUIRED: 403,
  ONBOARDING_SESSION_NOT_FOUND: 404,
  ANSWER_NOT_FOUND: 404,
  QUESTION_NOT_CURRENT: 409,
  VERSION_CONFLICT: 409,
  ONBOARDING_SESSION_ACTIVE: 409,
  ANSWER_INVALID: 400,
  ONBOARDING_COVERAGE_INCOMPLETE: 400,
  ONBOARDING_STATE_INVALID: 409,
  PORTRAIT_SOURCE_INVALID: 502,
  MODEL_SCHEMA_INVALID: 502,
  IDEMPOTENCY_KEY_MISSING: 400,
  IDEMPOTENCY_KEY_INVALID: 400,
  MODEL_TASK_IN_PROGRESS: 409,
  MODEL_TASK_ALREADY_SUCCEEDED: 409,
  MODEL_TASK_PREVIOUSLY_FAILED: 409,
  MODEL_GLOBAL_CONCURRENCY_LIMIT: 429,
  MODEL_TENANT_CONCURRENCY_LIMIT: 429,
  MODEL_DAILY_TASK_LIMIT: 429,
  MODEL_DAILY_TOKEN_LIMIT: 429,
  LLM_TIMEOUT: 504,
  PORTRAIT_SERVICE_UNAVAILABLE: 503,
  PORTRAIT_DRAFT_REQUIRED: 409,
  PORTRAIT_DRAFT_VERSION_CONFLICT: 409,
  QUESTION_SET_VERSION_UNAVAILABLE: 503,
}

export function onboardingHttpContext(access: AccessContext | null):
  { context: TenantAccessContext; response?: never } | { context?: never; response: Response } {
  if (!access) return { response: failure("UNAUTHENTICATED", 401) }
  if (access.audience !== "tenant") return { response: failure("TENANT_AUDIENCE_REQUIRED", 403) }
  return { context: access }
}

export function onboardingFailure(error: unknown, inputCode = "ONBOARDING_INPUT_INVALID"): Response {
  if (error instanceof ZodError) return failure(inputCode, 400)
  const value = error as { code?: string; message?: string; status?: number; retryable?: boolean }
  const rawCode = value.code ?? value.message ?? "INTERNAL_ERROR"
  const code = /^[A-Z][A-Z0-9_]+$/.test(rawCode) ? rawCode : "INTERNAL_ERROR"
  return failure(code, value.status ?? statusByCode[code] ?? 500, Boolean(value.retryable))
}

function failure(errorCode: string, status: number, retryable = false): Response {
  return Response.json({ errorCode, retryable: retryable || status === 502 || status === 503 || status === 504 }, { status })
}
