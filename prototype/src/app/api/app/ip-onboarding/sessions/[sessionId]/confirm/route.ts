import type { AccessContext } from "@/domain/access"
import { resolveCurrentAccess } from "@/lib/auth/request-access"
import { onboardingFailure, onboardingHttpContext } from "@/services/ip-onboarding-http"
import { getIpOnboardingServices, type IpOnboardingServices } from "@/services/ip-onboarding-service-factory"
import { z } from "zod"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const inputSchema = z.object({ portraitDraftVersion: z.number().int().positive() }).strict()
type Deps = Pick<IpOnboardingServices, "profiles">

export async function handleConfirm(
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
    return Response.json(deps.profiles.confirmOnboarding(resolved.context, { sessionId, ...input }))
  } catch (error) {
    return onboardingFailure(error, "ONBOARDING_CONFIRM_INPUT_INVALID")
  }
}

type Context = { params: Promise<{ sessionId: string }> }
export async function POST(request: Request, context: Context) {
  return handleConfirm(
    request,
    (await context.params).sessionId,
    await resolveCurrentAccess(),
    getIpOnboardingServices(),
  )
}
