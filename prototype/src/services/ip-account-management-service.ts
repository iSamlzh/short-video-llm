import { randomUUID } from "node:crypto"
import type Database from "better-sqlite3"
import type { TenantAccessContext } from "../domain/access"
import { ipProfileSchema } from "../domain/schemas"
import { requireTenantCapability } from "../lib/auth/guards"

export class IpAccountManagementService {
  constructor(private readonly database: Database.Database) {}

  list(context: TenantAccessContext) {
    requireTenantCapability(context, "ip.manage")
    const ips = this.database.prepare(`SELECT i.* FROM ip_profiles i
      JOIN membership_ip_scopes s ON s.ip_profile_id=i.id
      WHERE s.membership_id=? AND i.tenant_id=? ORDER BY i.status DESC,i.updated_at DESC`)
      .all(context.membershipId, context.tenantId) as Array<Record<string, any>>
    return {
      ips: ips.map(ip => ({
        id: ip.id, displayName: ip.display_name, status: ip.status, version: ip.version,
        verificationStatus: ip.verification_status, profile: JSON.parse(ip.profile_json), updatedAt: ip.updated_at,
        versions: this.database.prepare(`SELECT version,display_name,change_summary,created_at FROM ip_profile_versions
          WHERE tenant_id=? AND ip_profile_id=? ORDER BY version DESC`).all(context.tenantId, ip.id),
        accounts: this.database.prepare(`SELECT id,platform,account_name accountName,platform_account_id platformAccountId,
          status,is_default isDefault,created_at createdAt FROM content_accounts
          WHERE tenant_id=? AND ip_profile_id=? ORDER BY status DESC,is_default DESC,created_at`)
          .all(context.tenantId, ip.id),
      })),
    }
  }

  updateProfile(context: TenantAccessContext, ipId: string, input: {
    expectedVersion: number
    displayName: string
    profile: unknown
    changeSummary: string
  }) {
    requireTenantCapability(context, "ip.manage")
    const current = this.requireIp(context, ipId)
    if (current.version !== input.expectedVersion) throw coded("IP_VERSION_CONFLICT", 409)
    const profile = ipProfileSchema.parse({ ...(input.profile as object), displayName: input.displayName.trim() })
    const version = current.version + 1
    const now = new Date().toISOString()
    this.database.transaction(() => {
      const updated = this.database.prepare(`UPDATE ip_profiles SET display_name=?,profile_json=?,version=?,updated_at=?
        WHERE id=? AND tenant_id=? AND version=?`).run(profile.displayName, JSON.stringify(profile), version, now, ipId, context.tenantId, current.version)
      if (updated.changes !== 1) throw coded("IP_VERSION_CONFLICT", 409)
      this.database.prepare(`INSERT INTO ip_profile_versions
        (id,tenant_id,ip_profile_id,version,display_name,profile_json,change_summary,created_by_user_id,created_at)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(randomUUID(), context.tenantId, ipId, version, profile.displayName, JSON.stringify(profile), input.changeSummary.trim(), context.userId, now)
      this.audit(context, "ip.profile.updated", "ip_profile", ipId, { version, changeSummary: input.changeSummary.trim() })
    })()
    return { ipId, version, profile }
  }

  setIpStatus(context: TenantAccessContext, ipId: string, status: "active" | "disabled") {
    requireTenantCapability(context, "ip.manage")
    const ip = this.requireIp(context, ipId)
    if (ip.status === status) return { ipId, status }
    if (status === "disabled") {
      const active = this.database.prepare("SELECT COUNT(*) count FROM ip_profiles WHERE tenant_id=? AND status='active'").get(context.tenantId) as { count: number }
      if (Number(active.count) <= 1) throw coded("LAST_ACTIVE_IP", 409)
    }
    this.database.transaction(() => {
      this.database.prepare("UPDATE ip_profiles SET status=?,updated_at=? WHERE id=? AND tenant_id=?").run(status, new Date().toISOString(), ipId, context.tenantId)
      if (status === "disabled") this.repairContextsForIp(context.tenantId, ipId)
      this.audit(context, status === "active" ? "ip.restored" : "ip.archived", "ip_profile", ipId, {})
    })()
    return { ipId, status }
  }

  createAccount(context: TenantAccessContext, ipId: string, input: { platform: string; accountName: string; platformAccountId?: string }) {
    requireTenantCapability(context, "ip.manage")
    this.requireIp(context, ipId)
    const id = randomUUID(), now = new Date().toISOString()
    const tenant = this.database.prepare("SELECT data_origin FROM tenants WHERE id=?").get(context.tenantId) as { data_origin: "demo" | "formal" }
    const count = Number((this.database.prepare("SELECT COUNT(*) count FROM content_accounts WHERE tenant_id=? AND ip_profile_id=? AND status='active'").get(context.tenantId, ipId) as { count: number }).count)
    this.database.transaction(() => {
      this.database.prepare(`INSERT INTO content_accounts
        (id,tenant_id,ip_profile_id,platform,account_name,platform_account_id,status,data_origin,is_default,created_at)
        VALUES (?,?,?,?,?,?,'active',?,?,?)`).run(id, context.tenantId, ipId, input.platform, input.accountName.trim(), input.platformAccountId?.trim() || null, tenant.data_origin, count === 0 ? 1 : 0, now)
      this.database.prepare("INSERT INTO membership_account_scopes (membership_id,content_account_id) VALUES (?,?)").run(context.membershipId, id)
      this.audit(context, "content_account.created", "content_account", id, { ipId, platform: input.platform })
    })()
    return { id, isDefault: count === 0 }
  }

  updateAccount(context: TenantAccessContext, accountId: string, input: { accountName: string; platformAccountId?: string }) {
    requireTenantCapability(context, "ip.manage")
    this.requireAccount(context, accountId)
    this.database.prepare(`UPDATE content_accounts SET account_name=?,platform_account_id=? WHERE id=? AND tenant_id=?`)
      .run(input.accountName.trim(), input.platformAccountId?.trim() || null, accountId, context.tenantId)
    this.audit(context, "content_account.updated", "content_account", accountId, {})
    return { accountId }
  }

  setDefaultAccount(context: TenantAccessContext, accountId: string) {
    requireTenantCapability(context, "ip.manage")
    const account = this.requireAccount(context, accountId)
    if (account.status !== "active") throw coded("ACCOUNT_DISABLED", 409)
    this.database.transaction(() => {
      this.database.prepare("UPDATE content_accounts SET is_default=0 WHERE tenant_id=? AND ip_profile_id=?").run(context.tenantId, account.ip_profile_id)
      this.database.prepare("UPDATE content_accounts SET is_default=1 WHERE id=? AND tenant_id=?").run(accountId, context.tenantId)
      this.audit(context, "content_account.default_changed", "content_account", accountId, { ipId: account.ip_profile_id })
    })()
    return { accountId, isDefault: true }
  }

  setAccountStatus(context: TenantAccessContext, accountId: string, status: "active" | "disabled") {
    requireTenantCapability(context, "ip.manage")
    const account = this.requireAccount(context, accountId)
    this.database.transaction(() => {
      this.database.prepare("UPDATE content_accounts SET status=?,is_default=CASE WHEN ?='disabled' THEN 0 ELSE is_default END WHERE id=? AND tenant_id=?")
        .run(status, status, accountId, context.tenantId)
      if (status === "disabled") {
        const next = this.database.prepare(`SELECT id FROM content_accounts WHERE tenant_id=? AND ip_profile_id=? AND status='active' AND id<>? ORDER BY is_default DESC,created_at LIMIT 1`)
          .get(context.tenantId, account.ip_profile_id, accountId) as { id: string } | undefined
        if (account.is_default && next) this.database.prepare("UPDATE content_accounts SET is_default=1 WHERE id=?").run(next.id)
        this.repairContextsForAccount(context.tenantId, account.ip_profile_id, accountId)
      } else {
        const currentDefault = this.database.prepare(`SELECT 1 FROM content_accounts
          WHERE tenant_id=? AND ip_profile_id=? AND status='active' AND is_default=1`).get(context.tenantId, account.ip_profile_id)
        if (!currentDefault) this.database.prepare("UPDATE content_accounts SET is_default=1 WHERE id=?").run(accountId)
      }
      this.audit(context, status === "active" ? "content_account.restored" : "content_account.archived", "content_account", accountId, {})
    })()
    return { accountId, status }
  }

  private requireIp(context: TenantAccessContext, ipId: string) {
    const row = this.database.prepare(`SELECT i.id,i.version,i.status FROM ip_profiles i JOIN membership_ip_scopes s ON s.ip_profile_id=i.id
      WHERE i.id=? AND i.tenant_id=? AND s.membership_id=?`).get(ipId, context.tenantId, context.membershipId) as { id: string; version: number; status: string } | undefined
    if (!row) throw coded("IP_SCOPE_FORBIDDEN", 403)
    return row
  }

  private requireAccount(context: TenantAccessContext, accountId: string) {
    const row = this.database.prepare(`SELECT a.id,a.ip_profile_id,a.status,a.is_default FROM content_accounts a
      JOIN membership_ip_scopes s ON s.ip_profile_id=a.ip_profile_id
      WHERE a.id=? AND a.tenant_id=? AND s.membership_id=?`).get(accountId, context.tenantId, context.membershipId) as { id: string; ip_profile_id: string; status: string; is_default: number } | undefined
    if (!row) throw coded("ACCOUNT_SCOPE_FORBIDDEN", 403)
    return row
  }

  private repairContextsForIp(tenantId: string, ipId: string) {
    const rows = this.database.prepare("SELECT user_id FROM user_current_context WHERE tenant_id=? AND ip_profile_id=?").all(tenantId, ipId) as Array<{ user_id: string }>
    for (const row of rows) {
      const replacement = this.database.prepare(`SELECT i.id ip_id,a.id account_id FROM memberships m
        JOIN membership_ip_scopes s ON s.membership_id=m.id JOIN ip_profiles i ON i.id=s.ip_profile_id AND i.status='active'
        LEFT JOIN membership_account_scopes ma ON ma.membership_id=m.id
        LEFT JOIN content_accounts a ON a.id=ma.content_account_id AND a.ip_profile_id=i.id AND a.status='active'
        WHERE m.user_id=? AND m.tenant_id=? AND m.status='active' ORDER BY a.is_default DESC,i.created_at,a.created_at LIMIT 1`)
        .get(row.user_id, tenantId) as { ip_id: string; account_id: string | null } | undefined
      this.database.prepare("UPDATE user_current_context SET ip_profile_id=?,content_account_id=?,updated_at=? WHERE user_id=? AND tenant_id=?")
        .run(replacement?.ip_id ?? null, replacement?.account_id ?? null, new Date().toISOString(), row.user_id, tenantId)
    }
  }

  private repairContextsForAccount(tenantId: string, ipId: string, accountId: string) {
    const rows = this.database.prepare("SELECT user_id FROM user_current_context WHERE tenant_id=? AND content_account_id=?").all(tenantId, accountId) as Array<{ user_id: string }>
    for (const row of rows) {
      const replacement = this.database.prepare(`SELECT a.id FROM memberships m
        JOIN membership_account_scopes s ON s.membership_id=m.id
        JOIN content_accounts a ON a.id=s.content_account_id AND a.status='active'
        WHERE m.user_id=? AND m.tenant_id=? AND m.status='active' AND a.ip_profile_id=?
        ORDER BY a.is_default DESC,a.created_at,a.id LIMIT 1`).get(row.user_id, tenantId, ipId) as { id: string } | undefined
      this.database.prepare("UPDATE user_current_context SET content_account_id=?,updated_at=? WHERE user_id=? AND tenant_id=?")
        .run(replacement?.id ?? null, new Date().toISOString(), row.user_id, tenantId)
    }
  }

  private audit(context: TenantAccessContext, action: string, resourceType: string, resourceId: string, detail: unknown) {
    this.database.prepare(`INSERT INTO audit_logs (id,tenant_id,actor_user_id,action,resource_type,resource_id,detail_json,created_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(randomUUID(), context.tenantId, context.userId, action, resourceType, resourceId, JSON.stringify(detail), new Date().toISOString())
  }
}

function coded(code: string, status: number) {
  return Object.assign(new Error(code), { code, status })
}
