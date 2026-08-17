import type { ReactNode } from "react"
import { requireTenantAccess } from "@/lib/auth/request-access"
import { getTenantShellContext } from "@/lib/db/shell-context"
import { TenantMasthead } from "@/components/shell/TenantMasthead"

export default async function TenantLayout({ children }: { children: ReactNode }) {
  const access = await requireTenantAccess()
  const context = getTenantShellContext(access)
  return <div className="app-shell"><TenantMasthead context={context} />{children}</div>
}
