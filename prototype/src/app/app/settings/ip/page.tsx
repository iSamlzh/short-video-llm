import { requireTenantAccess } from "@/lib/auth/request-access"
import { getAppDatabase } from "@/lib/db/app-database"
import { IpAccountManagementService } from "@/services/ip-account-management-service"
import { IpAccountManagementView } from "@/components/settings/IpAccountManagementView"

export default async function IpSettingsPage() {
  const access = await requireTenantAccess()
  const initialData = new IpAccountManagementService(getAppDatabase()).list(access)
  return <main><IpAccountManagementView initialData={initialData} /></main>
}
