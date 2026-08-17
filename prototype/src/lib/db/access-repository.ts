import type Database from "better-sqlite3"
import type { Capability } from "../../domain/access"

type MembershipRow = {
  membership_id: string
  tenant_id: string
}

export class AccessRepository {
  constructor(private readonly database: Database.Database) {}

  resolveTenant(userId: string) {
    const membership = this.database.prepare(`SELECT m.id membership_id, m.tenant_id
      FROM memberships m JOIN tenants t ON t.id = m.tenant_id
      JOIN users u ON u.id = m.user_id
      WHERE m.user_id = ? AND m.status = 'active' AND t.status = 'active'
        AND u.status = 'active' AND u.audience = 'tenant'
      ORDER BY m.created_at LIMIT 1`).get(userId) as MembershipRow | undefined
    if (!membership) return null

    const capabilityRows = this.database.prepare(
      "SELECT capability FROM membership_capabilities WHERE membership_id = ? ORDER BY capability",
    ).all(membership.membership_id) as Array<{ capability: Capability }>
    const ipRows = this.database.prepare(`SELECT s.ip_profile_id
      FROM membership_ip_scopes s JOIN ip_profiles i ON i.id = s.ip_profile_id
      WHERE s.membership_id = ? AND i.status = 'active' ORDER BY s.ip_profile_id`)
      .all(membership.membership_id) as Array<{ ip_profile_id: string }>
    const accountRows = this.database.prepare(`SELECT s.content_account_id
      FROM membership_account_scopes s JOIN content_accounts a ON a.id = s.content_account_id
      WHERE s.membership_id = ? AND a.status = 'active' ORDER BY s.content_account_id`)
      .all(membership.membership_id) as Array<{ content_account_id: string }>

    return {
      membershipId: membership.membership_id,
      tenantId: membership.tenant_id,
      capabilities: capabilityRows.map((row) => row.capability),
      ipIds: ipRows.map((row) => row.ip_profile_id),
      contentAccountIds: accountRows.map((row) => row.content_account_id),
    }
  }

  resolvePlatform(userId: string) {
    return this.database.prepare(`SELECT platform_role FROM users
      WHERE id = ? AND audience = 'platform' AND status = 'active'`)
      .get(userId) as { platform_role: "platform_operator" | "platform_admin" } | undefined
  }
}
