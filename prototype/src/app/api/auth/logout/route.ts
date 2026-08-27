import { cookies } from "next/headers"
import { getAppDatabase } from "@/lib/db/app-database"
import { SessionRepository } from "@/lib/auth/session"
import { SESSION_COOKIE } from "@/lib/auth/request-access"
import { withRequestLog } from "@/lib/observability/request-log"

export const runtime = "nodejs"

async function post(_request: Request) {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  if (token) new SessionRepository(getAppDatabase()).revoke(token)
  jar.delete(SESSION_COOKIE)
  return Response.json({ ok: true })
}

export const POST = withRequestLog(post)
