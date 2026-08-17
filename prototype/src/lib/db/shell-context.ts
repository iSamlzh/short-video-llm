import type { TenantAccessContext } from "../../domain/access"
import { getAppDatabase } from "./app-database"

export function getTenantShellContext(context: TenantAccessContext) {
  const row = getAppDatabase().prepare(`SELECT
      t.name team_name,
      u.display_name user_name,
      i.display_name ip_name,
      a.account_name account_name,
      a.platform platform
    FROM tenants t
    JOIN users u ON u.id = ?
    LEFT JOIN user_current_context c ON c.user_id = u.id AND c.tenant_id = t.id
    LEFT JOIN ip_profiles i ON i.id = c.ip_profile_id
    LEFT JOIN content_accounts a ON a.id = c.content_account_id
    WHERE t.id = ?`).get(context.userId, context.tenantId) as {
      team_name: string
      user_name: string
      ip_name: string | null
      account_name: string | null
      platform: string | null
    } | undefined
  if (!row) throw new Error("SHELL_CONTEXT_NOT_FOUND")
  const platformName = row.platform === "wechat_channels" ? "视频号" : row.platform === "douyin" ? "抖音" : row.platform
  return {
    teamName: row.team_name,
    userName: row.user_name,
    ipName: row.ip_name ?? "尚未建立",
    accountName: platformName ?? row.account_name ?? "尚未绑定",
  }
}
