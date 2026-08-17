import { Archive, CheckCircle } from "@phosphor-icons/react"
import type { ActiveStructure } from "./types"

export function StructureLedger({ structures }: { structures: ActiveStructure[] }) {
  if (!structures.length) return <section className="brain-empty-state brain-ledger-empty"><Archive size={32} /><h2>还没有已启用结构</h2><p>结构必须经过样本拆解、人工复核和试生成后才能进入团长创作。</p></section>
  return <section className="brain-ledger">
    <header className="brain-document-heading"><div><h1>已启用结构</h1><p>这里只有当前可参与团长创作检索的正式版本。</p></div></header>
    {structures.map((structure) => <details key={structure.templateVersionId} className="brain-ledger-entry">
      <summary><span><CheckCircle size={21} />{structure.name}</span><small>{structure.isGeneral ? "通用结构" : "定向结构"}，{structure.sourceCount} 条启用记录</small></summary>
      <div><h3>结构节点</h3>{structure.nodes.map((node) => <p key={`${node.kind}-${node.instruction}`}><strong>{node.kind}</strong>{node.instruction}</p>)}<h3>适用范围</h3><p>{[...structure.applicability.ipTags, ...structure.applicability.audiences, ...structure.applicability.goals].join("、") || "通用"}</p></div>
    </details>)}
  </section>
}
