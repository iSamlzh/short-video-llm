import { TeamDelegationView } from "@/components/team/TeamDelegationView"
import { requireTenantAccess } from "@/lib/auth/request-access"
import { getAppDatabase } from "@/lib/db/app-database"
import { TeamService } from "@/services/team-service"

export default async function TeamPage() {
  const access = await requireTenantAccess()
  return <main><TeamDelegationView initialData={new TeamService(getAppDatabase()).list(access)} /></main>
}
