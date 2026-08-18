import type { AccessContext } from "@/domain/access"
import { resolveCurrentAccess } from "@/lib/auth/request-access"
import { onboardingFailure, onboardingHttpContext } from "@/services/ip-onboarding-http"
import { getIpOnboardingServices, type IpOnboardingServices } from "@/services/ip-onboarding-service-factory"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Deps = Pick<IpOnboardingServices, "sessions">

export async function handleReview(request: Request, sessionId: string, access: AccessContext | null, deps: Deps) {
  const resolved = onboardingHttpContext(access)
  if (resolved.response) return resolved.response
  try {
    if (request.method !== "POST") return Response.json({ errorCode: "NOT_FOUND" }, { status: 404 })
    return Response.json(deps.sessions.reviewAnswers(resolved.context, sessionId))
  } catch (error) {
    return onboardingFailure(error)
  }
}

type Context = { params: Promise<{ sessionId: string }> }
export async function POST(request: Request, context: Context) {
  return handleReview(request, (await context.params).sessionId, await resolveCurrentAccess(), getIpOnboardingServices())
}
