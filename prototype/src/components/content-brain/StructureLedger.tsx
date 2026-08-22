import { Archive, CaretDown, CheckCircle } from "@phosphor-icons/react"
import type { ActiveStructure } from "./types"

export function StructureLedger({ structures }: { structures: ActiveStructure[] }) {
  if (!structures.length) return <section className="brain-empty-state brain-ledger-empty"><Archive size={32} /><h2>还没有已启用结构</h2><p>结构必须经过样本拆解、人工复核和试生成后才能进入团长创作。</p></section>
  return <section className="brain-ledger">
    <header className="brain-ledger-heading">
      <div><span className="brain-kicker">内容结构资产</span><h1>结构库</h1><p>当前启用版本会参与团长口播稿创作检索；展开即可核对完整结构与使用边界。</p></div>
      <strong>{structures.length} 个当前启用版本</strong>
    </header>
    <div className="brain-ledger-list">
      {structures.map((structure, structureIndex) => <details key={structure.templateVersionId} className="brain-ledger-entry" open={structureIndex === 0 ? true : undefined}>
        <summary>
          <span className="brain-ledger-index">{String(structureIndex + 1).padStart(2, "0")}</span>
          <span className="brain-ledger-title"><strong>{structure.name}</strong><small>{structure.isGeneral ? "通用结构" : "定向结构"} · {structure.sourceCount} 条启用记录</small></span>
          <span className="brain-ledger-meta"><em>v{structure.version}</em><span><CheckCircle size={17} weight="fill" />已启用</span><CaretDown className="brain-ledger-caret" size={18} /></span>
        </summary>
        <div className="brain-ledger-body">
          <section className="brain-ledger-scope" aria-labelledby={`scope-${structure.templateVersionId}`}>
            <h2 id={`scope-${structure.templateVersionId}`}>适用范围</h2>
            <dl>
              <ScopeRow label="IP 属性" values={structure.applicability.ipTags} />
              <ScopeRow label="目标受众" values={structure.applicability.audiences} />
              <ScopeRow label="内容目标" values={structure.applicability.goals} />
            </dl>
          </section>
          <section className="brain-ledger-steps" aria-labelledby={`steps-${structure.templateVersionId}`}>
            <h2 id={`steps-${structure.templateVersionId}`}>结构步骤</h2>
            <ol>{structure.nodes.map((node, nodeIndex) => <li key={`${node.kind}-${node.instruction}`}>
              <span>{String(nodeIndex + 1).padStart(2, "0")}</span>
              <div><header><h3>{node.kind}</h3><small>{node.required ? "必填" : "选填"}</small></header><p>{node.instruction}</p></div>
            </li>)}</ol>
          </section>
          <div className="brain-ledger-rules">
            <RuleSection title="质量标准" rules={structure.qualityRules} emptyText="暂无额外质量标准" />
            <RuleSection title="风险边界" rules={structure.riskRules} emptyText="暂无额外风险边界" />
          </div>
          <footer><span>版本标识</span><code>{structure.templateVersionId}</code></footer>
        </div>
      </details>)}
    </div>
  </section>
}

function ScopeRow({ label, values }: { label: string; values: string[] }) {
  return <div><dt>{label}</dt><dd>{values.length ? values.map((value) => <span key={value}>{value}</span>) : <span>通用</span>}</dd></div>
}

function RuleSection({ title, rules, emptyText }: { title: string; rules: string[]; emptyText: string }) {
  return <section><h2>{title}</h2>{rules.length ? <ul>{rules.map((rule) => <li key={rule}>{rule}</li>)}</ul> : <p>{emptyText}</p>}</section>
}
