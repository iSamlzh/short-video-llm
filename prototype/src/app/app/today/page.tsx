import { DailyCreationWorkspace } from "@/components/creation/DailyCreationWorkspace"
import { requireTenantAccess } from "@/lib/auth/request-access"
import { getAppDatabase } from "@/lib/db/app-database"

export default async function TodayPage() {
  const access = await requireTenantAccess()
  const current = getAppDatabase().prepare(`SELECT ip_profile_id,content_account_id FROM user_current_context
    WHERE user_id=? AND tenant_id=?`).get(access.userId, access.tenantId) as { ip_profile_id: string; content_account_id: string | null } | undefined
  const allowed = new Set(access.contentAccountIds)
  const accounts = current ? (getAppDatabase().prepare(`SELECT id,platform,account_name FROM content_accounts
    WHERE tenant_id=? AND ip_profile_id=? AND status='active'
    ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END,created_at,id`).all(
    access.tenantId, current.ip_profile_id, current.content_account_id,
  ) as Array<{ id: string; platform: string; account_name: string }>).filter((item) => allowed.has(item.id)).map((item) => ({
    id: item.id,
    platform: item.platform,
    label: `${item.platform === "wechat_channels" ? "视频号" : item.platform === "douyin" ? "抖音" : item.platform}｜${item.account_name}`,
  })) : []
  return <DailyCreationWorkspace publicationAccounts={accounts} />
}
