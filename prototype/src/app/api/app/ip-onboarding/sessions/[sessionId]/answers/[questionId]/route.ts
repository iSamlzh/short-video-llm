import type { AccessContext } from "@/domain/access"
import { resolveCurrentAccess } from "@/lib/auth/request-access"
import { onboardingFailure, onboardingHttpContext } from "@/services/ip-onboarding-http"
import { getIpOnboardingServices, type IpOnboardingServices } from "@/services/ip-onboarding-service-factory"
import { onboardingAnswerInputSchema } from "@/services/ip-onboarding-session-service"
import { withRequestLog } from "@/lib/observability/request-log"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Deps = Pick<IpOnboardingServices, "sessions">

export async function handleAnswer(
  request: Request,
  sessionId: string,
  questionId: string,
  access: AccessContext | null,
  deps: Deps,
) {
  const resolved = onboardingHttpContext(access)
  if (resolved.response) return resolved.response
  try {
    if (request.method !== "PUT") return Response.json({ errorCode: "NOT_FOUND" }, { status: 404 })
    const input = onboardingAnswerInputSchema.parse(await request.json().catch(() => null))
    const method = input.mode === "revise" ? "reviseAnswer" : "answerQuestion"
    return Response.json(deps.sessions[method](resolved.context, { ...input, sessionId, questionId }))
  } catch (error) {
    return onboardingFailure(error, "ANSWER_INVALID")
  }
}

type Context = { params: Promise<{ sessionId: string; questionId: string }> }
async function put(request: Request, context: Context) {
  const params = await context.params
  return handleAnswer(request, params.sessionId, params.questionId, await resolveCurrentAccess(), getIpOnboardingServices())
}

export const PUT = withRequestLog(put)
