import type { AccessContext } from "@/domain/access"
import { resolveCurrentAccess } from "@/lib/auth/request-access"
import { onboardingFailure, onboardingHttpContext } from "@/services/ip-onboarding-http"
import { getIpOnboardingServices, type IpOnboardingServices } from "@/services/ip-onboarding-service-factory"
import { z } from "zod"
import { withRequestLog } from "@/lib/observability/request-log"
import { requireIdempotencyKey } from "@/lib/http/idempotency-key"
import type { ModelTaskService } from "@/services/model-task-service"
import { getModelTaskService } from "@/services/model-task-service-factory"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const inputSchema = z.object({ expectedVersion: z.number().int().positive() }).strict()
type Deps = Pick<IpOnboardingServices, "sessions"> & { modelTasks?: ModelTaskService }

export async function handlePortraitPreview(
  request: Request,
  sessionId: string,
  access: AccessContext | null,
  deps: Deps,
) {
  const resolved = onboardingHttpContext(access)
  if (resolved.response) return resolved.response
  try {
    if (request.method !== "POST") return Response.json({ errorCode: "NOT_FOUND" }, { status: 404 })
    const input = inputSchema.parse(await request.json().catch(() => null))
    const generate = () => deps.sessions.generatePortraitPreview(resolved.context, { sessionId, ...input })
    const result = deps.modelTasks
      ? await deps.modelTasks.run({
        tenantId: resolved.context.tenantId,
        actorUserId: resolved.context.userId,
        operation: "ip.portrait.preview",
        idempotencyKey: requireIdempotencyKey(request),
        signal: request.signal,
      }, generate, () => deps.sessions.getSession(resolved.context, sessionId))
      : await generate()
    return Response.json(result)
  } catch (error) {
    return onboardingFailure(error, "PORTRAIT_PREVIEW_INPUT_INVALID")
  }
}

type Context = { params: Promise<{ sessionId: string }> }
async function post(request: Request, context: Context) {
  return handlePortraitPreview(
    request,
    (await context.params).sessionId,
    await resolveCurrentAccess(),
    { ...getIpOnboardingServices(), modelTasks: getModelTaskService() },
  )
}

export const POST = withRequestLog(post)
