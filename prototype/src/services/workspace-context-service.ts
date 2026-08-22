import type Database from "better-sqlite3"
import { AccessError } from "../domain/access"

export type WorkspaceContextOption = { id: string; label: string }
export type WorkspaceContext = {
  team: WorkspaceContextOption
  ip: WorkspaceContextOption | null
  account: WorkspaceContextOption | null
  teams: WorkspaceContextOption[]
  ips: WorkspaceContextOption[]
  accounts: WorkspaceContextOption[]
}

export class WorkspaceContextService {
  constructor(private readonly database: Database.Database) {}

  get(userId: string): WorkspaceContext {
    const membership = this.currentMembership(userId)
    if (!membership) throw new AccessError("FORBIDDEN_CONTEXT")
    return this.build(userId, membership)
  }

  switch(userId: string, input: { teamId?: string; ipId?: string; accountId?: string }): WorkspaceContext {
    return this.database.transaction(() => {
      const current = this.currentMembership(userId)
      const targetTeamId = input.teamId ?? current?.tenantId
      const membership = targetTeamId ? this.memberships(userId).find((item) => item.tenantId === targetTeamId) : undefined
      if (!membership) throw new AccessError("FORBIDDEN_CONTEXT")

      const ips = this.allowedIps(membership)
      const allAccounts = this.allowedAccounts(membership)
      const existing = this.database.prepare(`SELECT ip_profile_id ipId,content_account_id accountId
        FROM user_current_context WHERE user_id=? AND tenant_id=?`).get(userId, membership.tenantId) as {
        ipId: string | null; accountId: string | null
      } | undefined

      const requestedAccount = input.accountId ? allAccounts.find((item) => item.id === input.accountId) : undefined
      if (input.accountId && !requestedAccount) throw new AccessError("FORBIDDEN_CONTEXT")
      const requestedIpId = input.ipId ?? requestedAccount?.ipId
      const ip = requestedIpId
        ? ips.find((item) => item.id === requestedIpId)
        : ips.find((item) => item.id === existing?.ipId) ?? ips[0]
      if (requestedIpId && !ip) throw new AccessError("FORBIDDEN_CONTEXT")
      if (requestedAccount && requestedAccount.ipId !== ip?.id) throw new AccessError("FORBIDDEN_CONTEXT")

      const accounts = ip ? allAccounts.filter((item) => item.ipId === ip.id) : []
      const account = requestedAccount
        ?? accounts.find((item) => item.id === existing?.accountId)
        ?? accounts[0]
        ?? null
      const now = new Date().toISOString()
      this.database.prepare(`INSERT INTO user_current_tenant (user_id,tenant_id,updated_at) VALUES (?,?,?)
        ON CONFLICT(user_id) DO UPDATE SET tenant_id=excluded.tenant_id,updated_at=excluded.updated_at`)
        .run(userId, membership.tenantId, now)
      this.database.prepare(`INSERT INTO user_current_context
        (user_id,tenant_id,ip_profile_id,content_account_id,updated_at) VALUES (?,?,?,?,?)
        ON CONFLICT(user_id,tenant_id) DO UPDATE SET ip_profile_id=excluded.ip_profile_id,
          content_account_id=excluded.content_account_id,updated_at=excluded.updated_at`)
        .run(userId, membership.tenantId, ip?.id ?? null, account?.id ?? null, now)
      return this.build(userId, membership)
    })()
  }

  private build(userId: string, membership: MembershipOption): WorkspaceContext {
    const teams = this.memberships(userId)
    const ips = this.allowedIps(membership)
    const current = this.database.prepare(`SELECT ip_profile_id ipId,content_account_id accountId
      FROM user_current_context WHERE user_id=? AND tenant_id=?`).get(userId, membership.tenantId) as {
      ipId: string | null; accountId: string | null
    } | undefined
    const ip = ips.find((item) => item.id === current?.ipId) ?? null
    const accounts = ip ? this.allowedAccounts(membership).filter((item) => item.ipId === ip.id) : []
    const account = accounts.find((item) => item.id === current?.accountId) ?? null
    return {
      team: { id: membership.tenantId, label: membership.teamName },
      ip: ip ? { id: ip.id, label: ip.label } : null,
      account: account ? { id: account.id, label: account.label } : null,
      teams: teams.map((item) => ({ id: item.tenantId, label: item.teamName })),
      ips: ips.map(({ id, label }) => ({ id, label })),
      accounts: accounts.map(({ id, label }) => ({ id, label })),
    }
  }

  private currentMembership(userId: string) {
    return this.memberships(userId)[0]
  }

  private memberships(userId: string): MembershipOption[] {
    return this.database.prepare(`SELECT m.id membershipId,m.tenant_id tenantId,t.name teamName
      FROM memberships m JOIN tenants t ON t.id=m.tenant_id
      JOIN users u ON u.id=m.user_id
      LEFT JOIN user_current_tenant c ON c.user_id=m.user_id
      WHERE m.user_id=? AND m.status='active' AND t.status='active'
        AND u.status='active' AND u.audience='tenant'
      ORDER BY CASE WHEN c.tenant_id=m.tenant_id THEN 0 ELSE 1 END,m.created_at,m.id`)
      .all(userId) as MembershipOption[]
  }

  private allowedIps(membership: MembershipOption): IpOption[] {
    return this.database.prepare(`SELECT i.id,i.display_name label
      FROM membership_ip_scopes s JOIN ip_profiles i ON i.id=s.ip_profile_id
      WHERE s.membership_id=? AND i.tenant_id=? AND i.status='active'
      ORDER BY i.created_at,i.id`).all(membership.membershipId, membership.tenantId) as IpOption[]
  }

  private allowedAccounts(membership: MembershipOption): AccountOption[] {
    const rows = this.database.prepare(`SELECT a.id,a.ip_profile_id ipId,a.platform,a.account_name accountName,
      a.is_default isDefault
      FROM membership_account_scopes s JOIN content_accounts a ON a.id=s.content_account_id
      WHERE s.membership_id=? AND a.tenant_id=? AND a.status='active'
      ORDER BY a.is_default DESC,a.created_at,a.id`).all(membership.membershipId, membership.tenantId) as Array<{
        id: string; ipId: string; platform: string; accountName: string; isDefault: number
      }>
    return rows.map((row) => ({ ...row, label: `${platformLabel(row.platform)}｜${row.accountName}` }))
  }
}

type MembershipOption = { membershipId: string; tenantId: string; teamName: string }
type IpOption = { id: string; label: string }
type AccountOption = { id: string; ipId: string; label: string }

function platformLabel(platform: string) {
  if (platform === "wechat_channels") return "视频号"
  if (platform === "douyin") return "抖音"
  return platform
}
