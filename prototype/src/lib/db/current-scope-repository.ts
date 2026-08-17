import type Database from "better-sqlite3"
import type { TenantAccessContext } from "../../domain/access"
import type { GrowthScope } from "../../domain/growth-loop"
import { requireTenantCapability } from "../auth/guards"

type CurrentScopeRow = {
  ip_profile_id: string
  content_account_id: string
  platform: string
}

export class CurrentScopeRepository {
  constructor(private readonly database: Database.Database) {}

  get(context: TenantAccessContext): GrowthScope {
    const row = this.database.prepare(`SELECT c.ip_profile_id, c.content_account_id, a.platform
      FROM user_current_context c
      JOIN ip_profiles i ON i.id = c.ip_profile_id AND i.tenant_id = c.tenant_id
      JOIN content_accounts a ON a.id = c.content_account_id
        AND a.tenant_id = c.tenant_id AND a.ip_profile_id = c.ip_profile_id
      WHERE c.user_id = ? AND c.tenant_id = ? AND i.status = 'active' AND a.status = 'active'`)
      .get(context.userId, context.tenantId) as CurrentScopeRow | undefined
    if (!row) throw Object.assign(new Error("CURRENT_ACCOUNT_REQUIRED"), { code: "CURRENT_ACCOUNT_REQUIRED" })
    requireTenantCapability(context, "ip.view", {
      ipId: row.ip_profile_id,
      contentAccountId: row.content_account_id,
    })
    return {
      tenantId: context.tenantId,
      ipId: row.ip_profile_id,
      contentAccountId: row.content_account_id,
      platform: row.platform,
    }
  }
}
