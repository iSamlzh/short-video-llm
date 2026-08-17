import { randomUUID } from "node:crypto"
import type Database from "better-sqlite3"
import type { AccessContext, Capability } from "../domain/access"
import { requireTenantCapability } from "../lib/auth/guards"

type MemberAccess = {
  roleKey: string
  capabilities: Capability[]
  ipIds: string[]
  contentAccountIds: string[]
}

export class TeamService {
  constructor(private readonly database: Database.Database) {}

  updateAccess(context: AccessContext, membershipId: string, next: MemberAccess) {
    const actor = requireTenantCapability(context, "team.manage")
    const target = this.database.prepare("SELECT tenant_id FROM memberships WHERE id = ? AND status = 'active'")
      .get(membershipId) as { tenant_id: string } | undefined
    if (!target || target.tenant_id !== actor.tenantId) throw new Error("MEMBERSHIP_SCOPE_FORBIDDEN")

    if (next.capabilities.some((capability) => !actor.capabilities.includes(capability))) {
      throw new Error("CANNOT_GRANT_CAPABILITY")
    }
    if (next.ipIds.some((ipId) => !actor.ipIds.includes(ipId))) throw new Error("CANNOT_GRANT_IP_SCOPE")
    if (next.contentAccountIds.some((accountId) => !actor.contentAccountIds.includes(accountId))) {
      throw new Error("CANNOT_GRANT_ACCOUNT_SCOPE")
    }

    this.database.transaction(() => {
      this.database.prepare("UPDATE memberships SET role_key = ? WHERE id = ?").run(next.roleKey, membershipId)
      this.database.prepare("DELETE FROM membership_capabilities WHERE membership_id = ?").run(membershipId)
      this.database.prepare("DELETE FROM membership_ip_scopes WHERE membership_id = ?").run(membershipId)
      this.database.prepare("DELETE FROM membership_account_scopes WHERE membership_id = ?").run(membershipId)
      const capabilityInsert = this.database.prepare("INSERT INTO membership_capabilities (membership_id,capability) VALUES (?,?)")
      const ipInsert = this.database.prepare("INSERT INTO membership_ip_scopes (membership_id,ip_profile_id) VALUES (?,?)")
      const accountInsert = this.database.prepare("INSERT INTO membership_account_scopes (membership_id,content_account_id) VALUES (?,?)")
      for (const capability of [...new Set(next.capabilities)]) capabilityInsert.run(membershipId, capability)
      for (const ipId of [...new Set(next.ipIds)]) ipInsert.run(membershipId, ipId)
      for (const accountId of [...new Set(next.contentAccountIds)]) accountInsert.run(membershipId, accountId)
      this.database.prepare(`INSERT INTO audit_logs
        (id,tenant_id,actor_user_id,action,resource_type,resource_id,detail_json,created_at)
        VALUES (?,?,?,?,?,?,?,?)`).run(
        randomUUID(), actor.tenantId, actor.userId, "team.access.updated", "membership", membershipId,
        JSON.stringify(next), new Date().toISOString(),
      )
    })()
    return this.getMemberAccess(membershipId)
  }

  getMemberAccess(membershipId: string): MemberAccess {
    const membership = this.database.prepare("SELECT role_key FROM memberships WHERE id = ?").get(membershipId) as { role_key: string } | undefined
    if (!membership) throw new Error("MEMBERSHIP_NOT_FOUND")
    const capabilities = this.database.prepare("SELECT capability FROM membership_capabilities WHERE membership_id = ? ORDER BY capability")
      .all(membershipId) as Array<{ capability: Capability }>
    const ips = this.database.prepare("SELECT ip_profile_id FROM membership_ip_scopes WHERE membership_id = ? ORDER BY ip_profile_id")
      .all(membershipId) as Array<{ ip_profile_id: string }>
    const accounts = this.database.prepare("SELECT content_account_id FROM membership_account_scopes WHERE membership_id = ? ORDER BY content_account_id")
      .all(membershipId) as Array<{ content_account_id: string }>
    return {
      roleKey: membership.role_key,
      capabilities: capabilities.map((row) => row.capability),
      ipIds: ips.map((row) => row.ip_profile_id),
      contentAccountIds: accounts.map((row) => row.content_account_id),
    }
  }

  ensureCurrentContext(userId: string, tenantId: string, ipIds: string[], contentAccountIds: string[]) {
    const current = this.database.prepare(`SELECT ip_profile_id, content_account_id FROM user_current_context
      WHERE user_id = ? AND tenant_id = ?`).get(userId, tenantId) as {
        ip_profile_id: string | null
        content_account_id: string | null
      } | undefined
    if (current?.ip_profile_id && ipIds.includes(current.ip_profile_id)
      && (!current.content_account_id || contentAccountIds.includes(current.content_account_id))) {
      return { ipProfileId: current.ip_profile_id, contentAccountId: current.content_account_id }
    }

    const ipProfileId = ipIds[0] ?? null
    const contentAccountId = contentAccountIds[0] ?? null
    this.database.prepare(`INSERT INTO user_current_context
      (user_id,tenant_id,ip_profile_id,content_account_id,updated_at) VALUES (?,?,?,?,?)
      ON CONFLICT(user_id,tenant_id) DO UPDATE SET
        ip_profile_id = excluded.ip_profile_id,
        content_account_id = excluded.content_account_id,
        updated_at = excluded.updated_at`)
      .run(userId, tenantId, ipProfileId, contentAccountId, new Date().toISOString())
    return { ipProfileId, contentAccountId }
  }
}
