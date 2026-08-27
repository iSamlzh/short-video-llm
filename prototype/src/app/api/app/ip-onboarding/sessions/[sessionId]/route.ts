import type { AccessContext } from "@/domain/access"
import { resolveCurrentAccess } from "@/lib/auth/request-access"
import { onboardingFailure, onboardingHttpContext } from "@/services/ip-onboarding-http"
import { getIpOnboardingServices, type IpOnboardingServices } from "@/services/ip-onboarding-service-factory"
import { withRequestLog } from "@/lib/observability/request-log"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Deps = Pick<IpOnboardingServices, "sessions">

export async function handleSession(request: Request, sessionId: string, access: AccessContext | null, deps: Deps) {
  const resolved = onboardingHttpContext(access)
  if (resolved.response) return resolved.response
  try {
    if (request.method !== "GET") return Response.json({ errorCode: "NOT_FOUND" }, { status: 404 })
    return Response.json(deps.sessions.getSession(resolved.context, sessionId))
  } catch (error) {
    return onboardingFailure(error)
  }
}

type Context = { params: Promise<{ sessionId: string }> }
async function get(request: Request, context: Context) {
  return handleSession(request, (await context.params).sessionId, await resolveCurrentAccess(), getIpOnboardingServices())
}

export const GET = withRequestLog(get)
