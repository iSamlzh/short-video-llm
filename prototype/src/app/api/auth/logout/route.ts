import { cookies } from "next/headers"
import { getAppDatabase } from "@/lib/db/app-database"
import { SessionRepository } from "@/lib/auth/session"
import { SESSION_COOKIE } from "@/lib/auth/request-access"

export const runtime = "nodejs"

export async function POST() {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  if (token) new SessionRepository(getAppDatabase()).revoke(token)
  jar.delete(SESSION_COOKIE)
  return Response.json({ ok: true })
}
