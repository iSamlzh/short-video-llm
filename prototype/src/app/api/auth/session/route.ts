import { resolveCurrentAccess } from "@/lib/auth/request-access"
import { withRequestLog } from "@/lib/observability/request-log"

async function get(_request: Request) {
  const context = await resolveCurrentAccess()
  return context ? Response.json(context) : Response.json({ errorCode: "UNAUTHENTICATED" }, { status: 401 })
}

export const GET = withRequestLog(get)
