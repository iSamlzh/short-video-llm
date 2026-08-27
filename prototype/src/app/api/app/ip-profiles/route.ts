import { resolveCurrentAccess } from "@/lib/auth/request-access"
import { getAppDatabase } from "@/lib/db/app-database"
import { IpProfileService } from "@/services/ip-profile-service"
import { deprecationHeaders } from "@/lib/http/idempotency-key"
import { withRequestLog } from "@/lib/observability/request-log"

async function post(request: Request) {
  const access = await resolveCurrentAccess()
  if (!access) return Response.json({ errorCode: "UNAUTHENTICATED" }, { status: 401 })
  if (access.audience !== "tenant") return Response.json({ errorCode: "TENANT_AUDIENCE_REQUIRED" }, { status: 403 })
  try {
    return Response.json(new IpProfileService(getAppDatabase()).createAndSelect(access, await request.json()), {
      status: 201,
      headers: deprecationHeaders("/api/app/ip-onboarding/sessions"),
    })
  } catch (error) {
    const value = error as { message?: string; status?: number }
    return Response.json({ errorCode: value.message ?? "INVALID_INPUT", message: value.message ?? "保存失败" }, { status: value.status ?? 400 })
  }
}

export const POST = withRequestLog(post)
