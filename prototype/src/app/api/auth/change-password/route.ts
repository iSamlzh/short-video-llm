import { cookies } from "next/headers"
import { z } from "zod"
import { getAppDatabase } from "@/lib/db/app-database"
import { IdentityRepository } from "@/lib/db/identity-repository"
import { hashPassword } from "@/lib/auth/password"
import { resolveCurrentSession, SESSION_COOKIE } from "@/lib/auth/request-access"
import { SessionRepository } from "@/lib/auth/session"
import { shouldUseSecureSessionCookie } from "@/lib/runtime-features"
import { setRequestLogIdentity, withRequestLog } from "@/lib/observability/request-log"

export const runtime = "nodejs"

const schema = z.object({
  password: z.string().min(10).max(128)
    .regex(/[A-Za-z]/, "密码必须包含字母")
    .regex(/[0-9]/, "密码必须包含数字"),
  confirmation: z.string(),
}).refine(value => value.password === value.confirmation, { message: "两次输入的密码不一致", path: ["confirmation"] })

async function post(request: Request) {
  const session = await resolveCurrentSession()
  if (!session) return Response.json({ errorCode: "UNAUTHENTICATED", message: "登录已失效，请重新登录" }, { status: 401 })
  setRequestLogIdentity({ userId: session.userId, audience: session.audience })
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ errorCode: "PASSWORD_INVALID", message: parsed.error.issues[0]?.message ?? "密码不符合要求" }, { status: 400 })

  const database = getAppDatabase()
  new IdentityRepository(database).updatePassword(session.userId, await hashPassword(parsed.data.password), false)
  const sessions = new SessionRepository(database)
  sessions.revokeAll(session.userId)
  const token = sessions.create(session.userId, session.audience)
  const response = Response.json({ ok: true, audience: session.audience })
  const jar = await cookies()
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 43_200,
    secure: shouldUseSecureSessionCookie(process.env),
  })
  return response
}

export const POST = withRequestLog(post)
