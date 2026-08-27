import { randomBytes, randomUUID } from "node:crypto"
import type Database from "better-sqlite3"
import type { AccessContext, Capability } from "../domain/access"
import { requireTenantCapability } from "../lib/auth/guards"
import { normalizeEmail } from "../lib/auth/local-identity-provider"
import { IdentityRepository } from "../lib/db/identity-repository"
import { SessionRepository } from "../lib/auth/session"
import { hashPassword } from "../lib/auth/password"

type MemberAccess = {
  roleKey: string
  capabilities: Capability[]
  ipIds: string[]
  contentAccountIds: string[]
}

export class TeamService {
  constructor(private readonly database: Database.Database) {}

  list(context: AccessContext) {
    const actor = requireTenantCapability(context, "team.manage")
    const members = this.database.prepare(`SELECT m.id membership_id,m.role_key,m.status,u.id user_id,
      u.display_name,u.email_normalized,u.must_change_password,m.created_at
      FROM memberships m JOIN users u ON u.id=m.user_id
      WHERE m.tenant_id=? ORDER BY CASE m.role_key WHEN 'owner' THEN 0 ELSE 1 END,m.created_at`)
      .all(actor.tenantId) as Array<Record<string, any>>
    const ips = this.database.prepare(`SELECT id,display_name FROM ip_profiles
      WHERE tenant_id=? AND status='active' ORDER BY display_name`).all(actor.tenantId) as Array<{ id: string; display_name: string }>
    const accounts = this.database.prepare(`SELECT a.id,a.account_name,a.platform,a.ip_profile_id
      FROM content_accounts a WHERE a.tenant_id=? AND a.status='active' ORDER BY a.account_name`).all(actor.tenantId) as Array<{ id: string; account_name: string; platform: string; ip_profile_id: string }>
    return {
      members: members.map(member => ({
        membershipId: member.membership_id,
        userId: member.user_id,
        displayName: member.display_name,
        email: member.email_normalized,
        status: member.status,
        mustChangePassword: Boolean(member.must_change_password),
        isCurrentUser: member.user_id === actor.userId,
        ...this.getMemberAccess(member.membership_id),
      })),
      ips,
      accounts,
      grantableCapabilities: actor.capabilities,
      audits: this.database.prepare(`SELECT action,resource_id,detail_json,created_at FROM audit_logs
        WHERE tenant_id=? AND resource_type='membership' ORDER BY created_at DESC LIMIT 30`).all(actor.tenantId),
    }
  }

  async createMember(context: AccessContext, input: {
    email: string
    displayName: string
    roleKey: "operator" | "reviewer"
    ipIds: string[]
    contentAccountIds: string[]
  }) {
    const actor = requireTenantCapability(context, "team.manage")
    const email = normalizeEmail(input.email)
    if (new IdentityRepository(this.database).findByEmail(email)) throw new Error("EMAIL_ALREADY_EXISTS")
    const capabilities = roleCapabilities(input.roleKey).filter(capability => actor.capabilities.includes(capability))
    this.validateScopes(actor, input.ipIds, input.contentAccountIds)
    const userId = randomUUID()
    const membershipId = randomUUID()
    const temporaryPassword = createTemporaryPassword()
    const passwordHash = await hashPassword(temporaryPassword)
    const now = new Date().toISOString()
    this.database.transaction(() => {
      new IdentityRepository(this.database).create({ id: userId, emailNormalized: email, displayName: input.displayName, passwordHash, audience: "tenant", dataOrigin: "formal", mustChangePassword: true })
      this.database.prepare(`INSERT INTO memberships
        (id,tenant_id,user_id,role_key,status,data_origin,created_at) VALUES (?,?,?,?, 'active','formal',?)`)
        .run(membershipId, actor.tenantId, userId, input.roleKey, now)
      this.replaceAccess(membershipId, { roleKey: input.roleKey, capabilities, ipIds: input.ipIds, contentAccountIds: input.contentAccountIds })
      this.audit(actor, "team.member.created", membershipId, { email, displayName: input.displayName, roleKey: input.roleKey, ipIds: input.ipIds, contentAccountIds: input.contentAccountIds })
    })()
    return { membershipId, temporaryPassword }
  }

  updateAccess(context: AccessContext, membershipId: string, next: MemberAccess) {
    const actor = requireTenantCapability(context, "team.manage")
    const target = this.database.prepare("SELECT tenant_id,user_id FROM memberships WHERE id = ? AND status = 'active'")
      .get(membershipId) as { tenant_id: string; user_id: string } | undefined
    if (!target || target.tenant_id !== actor.tenantId) throw new Error("MEMBERSHIP_SCOPE_FORBIDDEN")
    if (target.user_id === actor.userId) throw new Error("CANNOT_EDIT_SELF")

    if (next.capabilities.some((capability) => !actor.capabilities.includes(capability))) {
      throw new Error("CANNOT_GRANT_CAPABILITY")
    }
    if (next.ipIds.some((ipId) => !actor.ipIds.includes(ipId))) throw new Error("CANNOT_GRANT_IP_SCOPE")
    if (next.contentAccountIds.some((accountId) => !actor.contentAccountIds.includes(accountId))) {
      throw new Error("CANNOT_GRANT_ACCOUNT_SCOPE")
    }

    this.replaceAccess(membershipId, next)
    this.audit(actor, "team.access.updated", membershipId, next)
    return this.getMemberAccess(membershipId)
  }

  setStatus(context: AccessContext, membershipId: string, status: "active" | "disabled") {
    const actor = requireTenantCapability(context, "team.manage")
    const target = this.member(actor.tenantId, membershipId)
    if (target.user_id === actor.userId) throw new Error("CANNOT_DISABLE_SELF")
    this.database.prepare("UPDATE memberships SET status=? WHERE id=?").run(status, membershipId)
    if (status === "disabled") new SessionRepository(this.database).revokeAll(target.user_id)
    this.audit(actor, status === "active" ? "team.member.enabled" : "team.member.disabled", membershipId, { status })
    return { membershipId, status }
  }

  async resetTemporaryPassword(context: AccessContext, membershipId: string) {
    const actor = requireTenantCapability(context, "team.manage")
    const target = this.member(actor.tenantId, membershipId)
    if (target.user_id === actor.userId) throw new Error("CANNOT_RESET_SELF")
    const temporaryPassword = createTemporaryPassword()
    new IdentityRepository(this.database).updatePassword(target.user_id, await hashPassword(temporaryPassword), true)
    new SessionRepository(this.database).revokeAll(target.user_id)
    this.audit(actor, "team.password.reset", membershipId, {})
    return { membershipId, temporaryPassword }
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

  private member(tenantId: string, membershipId: string) {
    const row = this.database.prepare("SELECT user_id FROM memberships WHERE id=? AND tenant_id=?")
      .get(membershipId, tenantId) as { user_id: string } | undefined
    if (!row) throw new Error("MEMBERSHIP_SCOPE_FORBIDDEN")
    return row
  }

  private validateScopes(actor: Extract<AccessContext, { audience: "tenant" }>, ipIds: string[], accountIds: string[]) {
    if (ipIds.some(id => !actor.ipIds.includes(id))) throw new Error("CANNOT_GRANT_IP_SCOPE")
    if (accountIds.some(id => !actor.contentAccountIds.includes(id))) throw new Error("CANNOT_GRANT_ACCOUNT_SCOPE")
  }

  private replaceAccess(membershipId: string, next: MemberAccess) {
    this.database.transaction(() => {
      this.database.prepare("UPDATE memberships SET role_key=? WHERE id=?").run(next.roleKey, membershipId)
      this.database.prepare("DELETE FROM membership_capabilities WHERE membership_id=?").run(membershipId)
      this.database.prepare("DELETE FROM membership_ip_scopes WHERE membership_id=?").run(membershipId)
      this.database.prepare("DELETE FROM membership_account_scopes WHERE membership_id=?").run(membershipId)
      const capability = this.database.prepare("INSERT INTO membership_capabilities (membership_id,capability) VALUES (?,?)")
      const ip = this.database.prepare("INSERT INTO membership_ip_scopes (membership_id,ip_profile_id) VALUES (?,?)")
      const account = this.database.prepare("INSERT INTO membership_account_scopes (membership_id,content_account_id) VALUES (?,?)")
      for (const value of [...new Set(next.capabilities)]) capability.run(membershipId, value)
      for (const value of [...new Set(next.ipIds)]) ip.run(membershipId, value)
      for (const value of [...new Set(next.contentAccountIds)]) account.run(membershipId, value)
    })()
  }

  private audit(actor: Extract<AccessContext, { audience: "tenant" }>, action: string, membershipId: string, detail: unknown) {
    this.database.prepare(`INSERT INTO audit_logs
      (id,tenant_id,actor_user_id,action,resource_type,resource_id,detail_json,created_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(randomUUID(), actor.tenantId, actor.userId, action, "membership", membershipId, JSON.stringify(detail), new Date().toISOString())
  }
}

function roleCapabilities(role: "operator" | "reviewer"): Capability[] {
  return role === "operator"
    ? ["ip.view", "content.create", "content.edit", "publication.record"]
    : ["ip.view", "metrics.import", "review.generate", "review.view"]
}

function createTemporaryPassword() {
  return `T${randomBytes(9).toString("base64url")}8a`
}
