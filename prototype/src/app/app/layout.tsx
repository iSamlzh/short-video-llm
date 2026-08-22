import type { ReactNode } from "react"
import { requireTenantAccess } from "@/lib/auth/request-access"
import { TenantMasthead } from "@/components/shell/TenantMasthead"
import { getAppDatabase } from "@/lib/db/app-database"
import { WorkspaceContextService } from "@/services/workspace-context-service"

export default async function TenantLayout({ children }: { children: ReactNode }) {
  const access = await requireTenantAccess()
  const database = getAppDatabase()
  const context = new WorkspaceContextService(database).get(access.userId)
  const user = database.prepare("SELECT display_name displayName FROM users WHERE id=?").get(access.userId) as { displayName: string } | undefined
  return <div className="app-shell"><TenantMasthead context={context} userName={user?.displayName ?? "用户"} />{children}</div>
}
