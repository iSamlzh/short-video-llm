import type { AccessContext } from "@/domain/access"
import { resolveCurrentAccess } from "@/lib/auth/request-access"
import { onboardingFailure, onboardingHttpContext } from "@/services/ip-onboarding-http"
import { getIpOnboardingServices, type IpOnboardingServices } from "@/services/ip-onboarding-service-factory"
import { startOnboardingSessionInputSchema } from "@/services/ip-onboarding-session-service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Deps = Pick<IpOnboardingServices, "sessions">

export async function handleSessions(request: Request, access: AccessContext | null, deps: Deps) {
  const resolved = onboardingHttpContext(access)
  if (resolved.response) return resolved.response
  try {
    if (request.method === "GET") {
      const session = deps.sessions.getActiveSession(resolved.context)
      return session ? Response.json(session) : new Response(null, { status: 204 })
    }
    if (request.method === "POST") {
      const input = startOnboardingSessionInputSchema.parse(await request.json().catch(() => null))
      return Response.json(deps.sessions.startSession(resolved.context, input), { status: 201 })
    }
    return Response.json({ errorCode: "NOT_FOUND" }, { status: 404 })
  } catch (error) {
    return onboardingFailure(error)
  }
}

export async function GET(request: Request) {
  return handleSessions(request, await resolveCurrentAccess(), getIpOnboardingServices())
}

export async function POST(request: Request) {
  return handleSessions(request, await resolveCurrentAccess(), getIpOnboardingServices())
}
