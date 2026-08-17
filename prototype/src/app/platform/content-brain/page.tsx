import { requirePlatformAccess } from "@/lib/auth/request-access"
import { PlatformMasthead } from "@/components/shell/PlatformMasthead"
import { ContentBrainWorkspace } from "@/components/content-brain/ContentBrainWorkspace"
import { ContentBrainRepository } from "@/lib/db/content-brain-repository"
import { getAppDatabase } from "@/lib/db/app-database"

export default async function ContentBrainPage() {
  const access = await requirePlatformAccess()
  if (!access) return <main className="access-denied"><h1>无权访问平台运营空间</h1><p>该入口与客户工作空间完全隔离。</p></main>
  const repository = new ContentBrainRepository(getAppDatabase())
  return <div className="app-shell platform-brain-shell">
    <PlatformMasthead operatorName="陈默" role={access.platformRole === "platform_admin" ? "平台管理员" : "平台运营"} />
    <main><ContentBrainWorkspace
      initialSamples={repository.listSamples()}
      initialStructures={repository.listActivePackages()}
      canActivate={access.platformRole === "platform_admin"}
    /></main>
  </div>
}
