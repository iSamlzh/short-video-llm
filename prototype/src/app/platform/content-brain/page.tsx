import { requirePlatformAccess } from "@/lib/auth/request-access"
import { PlatformMasthead } from "@/components/shell/PlatformMasthead"
import { ContentBrainWorkspace } from "@/components/content-brain/ContentBrainWorkspace"
import { ContentBrainRepository } from "@/lib/db/content-brain-repository"
import { getAppDatabase } from "@/lib/db/app-database"
import { getContentBrainServices } from "@/services/content-brain-service-factory"

export default async function ContentBrainPage() {
  const access = await requirePlatformAccess()
  if (!access) return <main className="access-denied"><h1>无权访问平台运营空间</h1><p>该入口与客户工作空间完全隔离。</p></main>
  const repository = new ContentBrainRepository(getAppDatabase())
  const services = getContentBrainServices()
  const jobs = services.analysisJobs.list(access)
  return <div className="app-shell platform-brain-shell">
    <PlatformMasthead operatorName="陈默" role={access.platformRole === "platform_admin" ? "平台管理员" : "平台运营"} />
    <main><ContentBrainWorkspace
      initialSamples={repository.listSamples()}
      initialStructures={repository.listActivePackages()}
      initialEvaluations={services.evaluations.listCurrent()}
      initialJobs={jobs}
      canActivate={access.platformRole === "platform_admin"}
      evolutionEnabled={process.env.STRUCTURE_EVOLUTION_CANDIDATES_ENABLED === "true"}
    /></main>
  </div>
}
