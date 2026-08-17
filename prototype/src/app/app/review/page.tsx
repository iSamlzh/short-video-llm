import { ReviewWorkspace } from "@/components/review/ReviewWorkspace"
import { requireTenantAccess } from "@/lib/auth/request-access"
import { getAppDatabase } from "@/lib/db/app-database"

export default async function ReviewPage() {
  const access = await requireTenantAccess()
  const current = getAppDatabase().prepare(`SELECT c.content_account_id,a.account_name,a.platform FROM user_current_context c LEFT JOIN content_accounts a ON a.id=c.content_account_id WHERE c.user_id=? AND c.tenant_id=?`).get(access.userId, access.tenantId) as { content_account_id: string | null; account_name: string | null; platform: string | null } | undefined
  if (!current?.content_account_id) return <ReviewWorkspace contentAccountId="" accountLabel="当前账号" />
  const batch = getAppDatabase().prepare(`SELECT id FROM metric_import_batches WHERE tenant_id=? AND content_account_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1`).get(access.tenantId, current.content_account_id) as { id: string } | undefined
  const platform = current.platform === "wechat_channels" ? "视频号" : current.platform === "douyin" ? "抖音" : current.platform
  return <ReviewWorkspace contentAccountId={current.content_account_id} accountLabel={`${platform ?? "账号"}｜${current.account_name ?? "当前账号"}`} initialBatchId={batch?.id} />
}
