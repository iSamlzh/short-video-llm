import { ContentHistoryWorkspace } from "@/components/content/ContentHistoryWorkspace"
import { requireTenantAccess } from "@/lib/auth/request-access"
import { getAppDatabase } from "@/lib/db/app-database"
import { ContentHistoryService } from "@/services/content-history-service"

export default async function ContentHistoryPage() {
  const access = await requireTenantAccess()
  const database = getAppDatabase()
  const current = database.prepare(`SELECT ip_profile_id ipId,content_account_id accountId FROM user_current_context
    WHERE user_id=? AND tenant_id=?`).get(access.userId, access.tenantId) as { ipId: string | null; accountId: string | null } | undefined
  const initialQuery = { ipId: current?.ipId ?? "", accountId: current?.accountId ?? "" }
  const initial = new ContentHistoryService(database).list(access, initialQuery)
  return <ContentHistoryWorkspace initial={initial} initialQuery={initialQuery} />
}
