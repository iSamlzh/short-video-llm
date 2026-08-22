import { DailyCreationWorkspace } from "@/components/creation/DailyCreationWorkspace"
import { requireTenantAccess } from "@/lib/auth/request-access"
import { getAppDatabase } from "@/lib/db/app-database"
import { redirect } from "next/navigation"
import Link from "next/link"

export default async function TodayPage() {
  const access = await requireTenantAccess()
  const current = getAppDatabase().prepare(`SELECT ip_profile_id,content_account_id FROM user_current_context
    WHERE user_id=? AND tenant_id=?`).get(access.userId, access.tenantId) as { ip_profile_id: string; content_account_id: string | null } | undefined
  if (!current?.ip_profile_id) redirect("/app/setup/ip")
  if (!current.content_account_id) return <main className="empty-workspace-context">
    <p className="eyebrow">当前 IP 尚未绑定账号</p>
    <h1>绑定内容账号后，才能生成和归档对应平台的口播稿。</h1>
    <p>当前 IP 会继续保留，不会重复建档。你也可以先新增另一个 IP。</p>
    <div><Link className="primary-button" href="/app/team">前往团队设置</Link><Link className="secondary-button" href="/app/setup/ip">新增 IP</Link></div>
  </main>
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
  return <DailyCreationWorkspace key={current.content_account_id} publicationAccounts={accounts} />
}
