"use client"

import { useState } from "react"
import { CaretDown, CheckCircle, CloudArrowUp, Eye, PencilSimple } from "@phosphor-icons/react"

export function ReviewBriefView({ brief, onImport, onConfirm }: { brief: any; onImport?: () => void; onConfirm?: () => Promise<void> | void }) {
  const [confirmed, setConfirmed] = useState(false)
  return <div className="document-page review-view">
    <section className="result-lead">
      <div><p className="eyebrow">{brief.lead}</p><p>我分析了当前账号 {brief.sampleCount ?? 12} 条内容；先讲共同结论，再说明证据边界。<small className="data-origin-label">{brief.dataOriginLabel}</small></p></div>
      <div className="lead-actions"><button className="primary-button" onClick={async () => { await onConfirm?.(); setConfirmed(true) }}>{confirmed ? "已形成当前 IP 的创作记忆" : "确认并形成创作记忆"}</button><button className="secondary-button">补充业务反馈</button><div className="text-actions"><button><Eye size={19} />查看全部 {brief.sampleCount ?? 12} 条</button><button onClick={onImport}><CloudArrowUp size={19} />导入新数据</button></div></div>
    </section>
    <div className="document-grid">
      <article className="primary-document review-document">
        <section><h1>本周结论</h1><p>{brief.summary}</p></section>
        <section><h2>三条证据</h2>{brief.evidence.map((item: any, index: number) => <details className="evidence-row" key={item.title} open={index === 0}><summary><span className="evidence-index">{index + 1}</span><strong>“{item.title}”</strong><span>{item.finding}</span><CaretDown size={18} /></summary><div><p>关键数据（相对本周平均）</p><ul>{item.metrics.map((metric: string) => <li key={metric}>{metric}</li>)}</ul><div className="text-actions"><button>查看原视频</button><button>查看原脚本</button></div></div></details>)}</section>
        <section className="editable-conclusion"><h2>不能确定的部分</h2><p>{brief.uncertain}</p><PencilSimple size={20} /></section>
        <section className="editable-conclusion"><h2>下一周创作建议</h2><ul>{brief.next.map((item: string) => <li key={item}>{item}</li>)}</ul><PencilSimple size={20} /></section>
      </article>
      <aside className="evidence-rail">
        <h2 className="success-text"><CheckCircle size={22} weight="fill" />确认后会发生什么</h2>
        <section><h3>更新本团队/本 IP 的推荐优先级</h3><p>本周确认的结论将更新“林姐”的创作优先级排序，影响后续选题与内容方向。</p></section>
        <section><h3>不影响平台模板与通用策略</h3><p>本次确认仅作用于“林姐内容团队 / 林姐 / 视频号”的个性化记忆，不会改动系统模板或通用策略。</p></section>
        <section><h3>本次数据范围</h3><ul><li>内容范围：当前账号导入的 {brief.sampleCount ?? 12} 条内容</li><li>分析方法：真实信号优先，结合互动质量</li><li>{brief.evidenceLimits ?? "只表达相关性，不声称平台因果。"}</li></ul></section>
      </aside>
    </div>
  </div>
}
