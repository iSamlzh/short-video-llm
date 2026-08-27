import { z } from "zod"
import { getAppDatabase } from "@/lib/db/app-database"
import { IdentityRepository } from "@/lib/db/identity-repository"
import { LocalIdentityProvider } from "@/lib/auth/local-identity-provider"
import { SessionRepository } from "@/lib/auth/session"
import { SESSION_COOKIE } from "@/lib/auth/request-access"
import { shouldUseSecureSessionCookie } from "@/lib/runtime-features"
import { setRequestLogIdentity, withRequestLog } from "@/lib/observability/request-log"

export const runtime = "nodejs"

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

async function post(request: Request) {
  const parsed = loginSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ errorCode: "INVALID_CREDENTIALS", message: "账号或密码不正确" }, { status: 401 })
  const database = getAppDatabase()
  try {
    const identity = await new LocalIdentityProvider(new IdentityRepository(database))
      .authenticate(parsed.data.email, parsed.data.password)
    setRequestLogIdentity({ userId: identity.userId, audience: identity.audience })
    const token = new SessionRepository(database).create(identity.userId, identity.audience)
    const response = Response.json({ audience: identity.audience, mustChangePassword: identity.mustChangePassword })
    response.headers.append("Set-Cookie", `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200${shouldUseSecureSessionCookie(process.env) ? "; Secure" : ""}`)
    return response
  } catch {
    return Response.json({ errorCode: "INVALID_CREDENTIALS", message: "账号或密码不正确" }, { status: 401 })
  }
}

export const POST = withRequestLog(post)
