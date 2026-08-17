import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { AccessRepository } from "../db/access-repository"
import { getAppDatabase } from "../db/app-database"
import { SessionRepository } from "./session"
import { AccessService } from "../../services/access-service"

export const SESSION_COOKIE = "content_agent_session"

export async function resolveCurrentAccess() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  if (!token) return null
  const database = getAppDatabase()
  const session = new SessionRepository(database).resolve(token)
  if (!session) return null
  try {
    return new AccessService(new AccessRepository(database)).resolve(session.userId, session.audience)
  } catch {
    return null
  }
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
