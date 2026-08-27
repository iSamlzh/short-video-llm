import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { AccessRepository } from "../db/access-repository"
import { getAppDatabase } from "../db/app-database"
import { SessionRepository } from "./session"
import { AccessService } from "../../services/access-service"
import { setRequestLogIdentity } from "../observability/request-log"

export const SESSION_COOKIE = "content_agent_session"

export async function resolveCurrentAccess() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  if (!token) return null
  const database = getAppDatabase()
  const session = new SessionRepository(database).resolve(token)
  if (!session) return null
  if (session.mustChangePassword) return null
  try {
    const access = new AccessService(new AccessRepository(database)).resolve(session.userId, session.audience)
    setRequestLogIdentity({
      userId: access.userId,
      tenantId: access.audience === "tenant" ? access.tenantId : undefined,
      audience: access.audience,
    })
    return access
  } catch {
    return null
  }
}

export async function resolveCurrentSession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  if (!token) return null
  const session = new SessionRepository(getAppDatabase()).resolve(token)
  return session ? { ...session, token } : null
}

export async function requireTenantAccess() {
  const context = await resolveCurrentAccess()
  if (!context) redirect("/login")
  if (context.audience !== "tenant") redirect("/platform/content-brain")
  return context
}

export async function requirePlatformAccess() {
  const context = await resolveCurrentAccess()
  if (!context) redirect("/login")
  if (context.audience !== "platform") return null
  return context
}
