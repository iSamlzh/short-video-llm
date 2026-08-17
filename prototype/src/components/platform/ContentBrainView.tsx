"use client"

import { useState } from "react"
import { CaretDown, FileText, ShieldCheck } from "@phosphor-icons/react"

export function ContentBrainView({ ledger }: { ledger: any }) {
  const [selected, setSelected] = useState(2)
  return <div className="document-page content-brain-view">
    <section className="result-lead">
      <div><p className="eyebrow">{ledger.lead}</p><p>Agent 根据新增授权样本与结构使用效果整理了优先级；租户私有内容未参与。</p></div>
      <div className="lead-actions"><button className="primary-button">处理 3 个复核提案</button><button className="secondary-button">导入新样本</button></div>
    </section>
    <div className="document-grid">
      <article className="primary-document structure-ledger">
        <h1>已启用的内容结构</h1>
        <div className="ledger-heading"><span>结构名称</span><span>版本</span><span>适用 IP / 领域</span><span>证据样本数</span><span>当前状态</span></div>
        {ledger.structures.map((structure: any, index: number) => <div className="ledger-entry" key={structure.name}><button className="ledger-row" onClick={() => setSelected(index)}><FileText size={24} /><strong>{structure.name}</strong><span>{structure.version}</span><span>{structure.scope}</span><span>{structure.sources}</span><span className={structure.status === "稳定" ? "success-text" : "accent-text"}>{structure.status}</span><CaretDown size={18} /></button>{selected === index && <div className="ledger-detail"><section><h3>结构节点（抽象层）</h3><ol>{ledger.selected.nodes.map((item: string) => <li key={item}>{item}</li>)}</ol></section><section><h3>禁止条件</h3><ul>{ledger.selected.forbidden.map((item: string) => <li key={item}>{item}</li>)}</ul></section><section><h3>最近一次启用</h3><p>2026-08-16</p><button className="text-link">查看来源证据</button><button className="text-link">预览生成效果</button><button className="text-link">查看版本</button></section></div>}</div>)}
      </article>
      <aside className="evidence-rail judgement-rail">
        <h2>Agent 本周判断</h2>
        {ledger.judgements.map((item: any, index: number) => <section className="judgement-row" key={item.title}><span>{index + 1}</span><div><h3>{item.title}<button className="text-link">{item.action}</button></h3><p>{index === 0 ? "本周新增高质量样本显示，收益表达的可信度阈值可进一步收紧，降低夸大表达风险。" : index === 1 ? "当前样本量仍少，影响稳定性判断。" : "当前未覆盖长口播深度讲解方向，建议启动候选结构探索。"}</p></div></section>)}
        <section><h3>结构如何进入生成</h3><p>仅 ACTIVE 版本 → 作用范围匹配 → IP 适配度排序 → 生成谱系记录</p></section>
        <p className="security-note"><ShieldCheck size={20} />客户永远看不到原文、完整结构与运营备注。</p>
      </aside>
    </div>
  </div>
}
