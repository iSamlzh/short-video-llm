"use client"

import { CloudArrowUp } from "@phosphor-icons/react"
import { MemoryPreview } from "./MemoryPreview"
import { MetricEvidenceView } from "./MetricEvidenceView"

export function ReviewBriefView({ brief, onImport, onConfirm, onStartNextRound }: {
  brief: any
  onImport?: () => void
  onConfirm?: (input: { keep: string[]; avoid: string[]; nextContentSignals: string[] }) => Promise<any> | any
  onStartNextRound?: () => Promise<void> | void
}) {
  const payload = brief.payload
  const tierMessage = brief.sampleTier === "facts_only" ? `当前只有 ${brief.sampleCount ?? payload.observations.length} 条可关联视频，只展示事实` : brief.sampleTier === "tentative" ? "样本较少，暂不能形成长期记忆" : null
  return <div className="document-page review-view">
    <section className="result-lead review-result-lead"><div><p className="eyebrow">真实数据复盘 · 版本 v{brief.version}</p><h1>{payload.headline}</h1><p>先讲能确定的事实，再把假设和证据边界分开。</p>{tierMessage && <p className="sample-tier-note">{tierMessage}</p>}</div><div className="lead-actions"><button className="secondary-button" type="button" onClick={onImport}><CloudArrowUp size={19} />导入新数据</button></div></section>
    <div className="document-grid"><article className="primary-document review-document real-review-document">
      <section><h2>能确定什么</h2>{payload.observations.length ? <ol className="review-observations">{payload.observations.map((item: any, index: number) => <li key={`${index}-${item.text}`}><p>{item.text}</p><span>证据 {item.evidenceSnapshotIds.map((id: string) => <span className="evidence-reference" key={id}>{id}</span>)}</span></li>)}</ol> : <p>当前还没有足够的已关联真实数据。</p>}</section>
      <section><h2>比较可能但不能确定</h2>{payload.hypotheses.length ? <ul className="review-hypotheses">{payload.hypotheses.map((item: any) => <li key={item.text}><span>{item.confidence === "medium" ? "中置信度" : "低置信度"}</span><p>{item.text}</p></li>)}</ul> : <p>当前样本不足以形成可靠假设。</p>}</section>
      <section><h2>不能推断什么</h2><p>{brief.evidenceLimits ?? payload.evidenceLimits}</p></section>
      <section><h2>下一轮建议</h2><ol>{payload.nextContentSignals.map((item: string) => <li key={item}>{item}</li>)}</ol></section>
    </article><MemoryPreview brief={brief} onConfirm={onConfirm} onStartNextRound={onStartNextRound} /></div>
    {payload.structureEvidence?.length > 0 && <details className="review-evidence-details"><summary>查看指标如何落到内容结构</summary><MetricEvidenceView evidence={payload.structureEvidence} /></details>}
  </div>
}
