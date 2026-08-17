import { resolveCurrentAccess } from "@/lib/auth/request-access"
import { getAppDatabase } from "@/lib/db/app-database"
import { TeamService } from "@/services/team-service"

export async function POST() {
  const access = await resolveCurrentAccess()
  if (!access) return Response.json({ errorCode: "UNAUTHENTICATED" }, { status: 401 })
  if (access.audience !== "tenant") return Response.json({ errorCode: "TENANT_AUDIENCE_REQUIRED" }, { status: 403 })
  try {
    const database = getAppDatabase()
    const target = database.prepare(`SELECT m.id FROM memberships m JOIN users u ON u.id=m.user_id
      WHERE m.tenant_id=? AND u.display_name='小周' AND m.status='active'`).get(access.tenantId) as { id: string } | undefined
    if (!target) throw new Error("TEAM_MEMBER_NOT_FOUND")
    const current = database.prepare(`SELECT ip_profile_id,content_account_id FROM user_current_context
      WHERE user_id=? AND tenant_id=?`).get(access.userId, access.tenantId) as { ip_profile_id: string | null; content_account_id: string | null } | undefined
    if (!current?.ip_profile_id || !current.content_account_id) throw new Error("CURRENT_ACCOUNT_REQUIRED")
    const result = new TeamService(database).updateAccess(access, target.id, {
      roleKey: "operator",
      capabilities: ["ip.view", "content.create", "content.edit", "review.view"],
      ipIds: [current.ip_profile_id],
      contentAccountIds: [current.content_account_id],
    })
    return Response.json({ confirmed: true, access: result })
  } catch (error) {
    const message = (error as Error).message
    return Response.json({ errorCode: message, message }, { status: message.includes("FORBIDDEN") ? 403 : 400 })
  }
}
