import { randomUUID } from "node:crypto"
import type Database from "better-sqlite3"
import type { TenantAccessContext } from "../domain/access"
import { ipProfileSchema } from "../domain/schemas"
import { requireTenantCapability } from "../lib/auth/guards"

export class IpProfileService {
  constructor(private readonly database: Database.Database) {}

  createAndSelect(context: TenantAccessContext, input: { profile: unknown; account: { platform: string; name: string } }) {
    requireTenantCapability(context, "content.create")
    const profile = ipProfileSchema.parse(input.profile)
    if (!input.account.platform || !input.account.name.trim()) throw new Error("ACCOUNT_REQUIRED")
    const ipId = randomUUID()
    const accountId = randomUUID()
    const now = new Date().toISOString()
    const tenant = this.database.prepare("SELECT data_origin FROM tenants WHERE id=? AND status='active'").get(context.tenantId) as { data_origin: "demo" | "formal" } | undefined
    if (!tenant) throw new Error("TENANT_NOT_FOUND")
    this.database.transaction(() => {
      this.database.prepare(`INSERT INTO ip_profiles
        (id,tenant_id,display_name,profile_json,verification_status,version,status,data_origin,created_at,updated_at)
        VALUES (?,?,?,?,'verified',1,'active',?,?,?)`).run(ipId, context.tenantId, profile.displayName, JSON.stringify(profile), tenant.data_origin, now, now)
      this.database.prepare(`INSERT INTO content_accounts
        (id,tenant_id,ip_profile_id,platform,account_name,platform_account_id,status,data_origin,created_at)
        VALUES (?,?,?,?,?,NULL,'active',?,?)`).run(accountId, context.tenantId, ipId, input.account.platform, input.account.name.trim(), tenant.data_origin, now)
      this.database.prepare("INSERT INTO membership_ip_scopes (membership_id,ip_profile_id) VALUES (?,?)").run(context.membershipId, ipId)
      this.database.prepare("INSERT INTO membership_account_scopes (membership_id,content_account_id) VALUES (?,?)").run(context.membershipId, accountId)
      this.database.prepare(`INSERT INTO user_current_context (user_id,tenant_id,ip_profile_id,content_account_id,updated_at)
        VALUES (?,?,?,?,?) ON CONFLICT(user_id,tenant_id) DO UPDATE SET
        ip_profile_id=excluded.ip_profile_id,content_account_id=excluded.content_account_id,updated_at=excluded.updated_at`)
        .run(context.userId, context.tenantId, ipId, accountId, now)
    })()
    return { ipId, accountId, profile }
  }
}
