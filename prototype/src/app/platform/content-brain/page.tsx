import { requirePlatformAccess } from "@/lib/auth/request-access"
import { PlatformMasthead } from "@/components/shell/PlatformMasthead"
import { ContentBrainView } from "@/components/platform/ContentBrainView"
import { demoProductData } from "@/presets/product-demo"
import { ContentBrainRepository } from "@/lib/db/content-brain-repository"
import { getAppDatabase } from "@/lib/db/app-database"

export default async function ContentBrainPage() {
  const access = await requirePlatformAccess()
  if (!access) return <main className="access-denied"><h1>无权访问平台运营空间</h1><p>该入口与客户工作空间完全隔离。</p></main>
  const active = new ContentBrainRepository(getAppDatabase()).listActive()
  const ledger = {
    ...demoProductData.contentBrain,
    lead: `当前 ${active.length} 个已启用结构可参与首期创作，3 个运营判断需要复核`,
    structures: active.map((item) => ({ name: item.name, version: `v${item.version}.0`, scope: item.isGeneral ? "通用 IP" : "团长/本地生意", sources: item.dataOrigin === "demo" ? "演示来源" : "已授权来源", status: "稳定" })),
    selected: active[0] ? { nodes: active[0].nodes.map((node) => `${node}：按已审核规则完成该结构节点`), forbidden: demoProductData.contentBrain.selected.forbidden } : demoProductData.contentBrain.selected,
  }
  return <div className="app-shell"><PlatformMasthead operatorName="陈默" /><main><ContentBrainView ledger={ledger} /></main></div>
}
