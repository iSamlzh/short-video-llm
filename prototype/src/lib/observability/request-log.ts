import { randomUUID } from "node:crypto"
import { AsyncLocalStorage } from "node:async_hooks"
import { structuredLog } from "./structured-log"

type RequestLogContext = {
  requestId: string
  method: string
  route: string
  tenantId?: string
  userId?: string
  audience?: "tenant" | "platform"
  taskId?: string
}

type RequestIdentity = Pick<RequestLogContext, "tenantId" | "userId" | "audience">
type RouteHandler<R extends Request, Args extends unknown[]> = (request: R, ...args: Args) => Response | Promise<Response>

const storage = new AsyncLocalStorage<RequestLogContext>()
const trustedRequestId = /^[A-Za-z0-9:_-]{8,128}$/

export function withRequestLog<R extends Request, Args extends unknown[]>(handler: RouteHandler<R, Args>): RouteHandler<R, Args> {
  return async (request, ...args) => {
    const startedAt = Date.now()
    const requestId = resolveRequestId(request.headers.get("x-request-id"))
    const context: RequestLogContext = {
      requestId,
      method: request.method,
      route: normalizedRoute(new URL(request.url).pathname),
    }

    return storage.run(context, async () => {
      try {
        const response = await handler(request, ...args)
        const errorCode = await responseErrorCode(response)
        const durationMs = Date.now() - startedAt
        structuredLog(response.status >= 500 ? "error" : response.status >= 400 ? "warn" : "info", "http_request", {
          requestId,
          method: context.method,
          route: context.route,
          status: response.status,
          durationMs,
          tenantId: context.tenantId,
          userId: context.userId,
          audience: context.audience,
          taskId: context.taskId,
          errorCode,
        })
        return withRequestId(response, requestId)
      } catch (error) {
        const value = error as { code?: unknown; name?: unknown }
        structuredLog("error", "http_request", {
          requestId,
          method: context.method,
          route: context.route,
          status: 500,
          durationMs: Date.now() - startedAt,
          tenantId: context.tenantId,
          userId: context.userId,
          audience: context.audience,
          taskId: context.taskId,
          errorCode: safeCode(value.code) ?? safeCode(value.name) ?? "UNHANDLED_ERROR",
        })
        throw error
      }
    })
  }
}

export function setRequestLogIdentity(identity: RequestIdentity) {
  const context = storage.getStore()
  if (!context) return
  if (identity.userId) context.userId = identity.userId
  if (identity.tenantId) context.tenantId = identity.tenantId
  if (identity.audience) context.audience = identity.audience
}

export function linkRequestToTask(taskId: string) {
  const context = storage.getStore()
  if (context && trustedRequestId.test(taskId)) context.taskId = taskId
}

export function currentRequestLogContext() {
  return storage.getStore()
}

function resolveRequestId(value: string | null) {
  return value && trustedRequestId.test(value) ? value : `req_${randomUUID()}`
}

function normalizedRoute(pathname: string) {
  return pathname
    .replace(/\/sessions\/[^/]+/g, "/sessions/:sessionId")
    .replace(/\/answers\/[^/]+/g, "/answers/:questionId")
    .replace(/\/members\/[^/]+/g, "/members/:membershipId")
    .replace(/\/content\/[^/]+/g, "/content/:runId")
    .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "/:id")
}

async function responseErrorCode(response: Response) {
  if (response.status < 400 || !response.headers.get("content-type")?.includes("application/json")) return undefined
  try {
    const value = await response.clone().json() as { errorCode?: unknown }
    return safeCode(value.errorCode)
  } catch {
    return undefined
  }
}

function safeCode(value: unknown) {
  return typeof value === "string" && /^[A-Z0-9:_-]{2,100}$/.test(value) ? value : undefined
}

function withRequestId(response: Response, requestId: string) {
  try {
    response.headers.set("x-request-id", requestId)
    return response
  } catch {
    const headers = new Headers(response.headers)
    headers.set("x-request-id", requestId)
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
  }
}
