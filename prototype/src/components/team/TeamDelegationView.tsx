"use client"

import { useState } from "react"
import { CheckCircle, FileText, Lock, PencilSimple, UserCircle } from "@phosphor-icons/react"

export function TeamDelegationView({ delegation }: { delegation: any }) {
  const [editing, setEditing] = useState(false)
  const [status, setStatus] = useState("")
  async function confirmDelegation() {
    setStatus("正在写入权限…")
    const response = await fetch("/api/app/team/delegate", { method: "POST" })
    const body = await response.json()
    setStatus(response.ok ? "已确认，小周现在只能操作林姐 / 视频号范围" : (body.message || "写入失败"))
  }
  return <div className="document-page team-delegation-view">
    <section className="result-lead">
      <div><p className="eyebrow">{delegation.lead}</p><p>请确认以下分工是否符合你的意图，确认后将邀请小周加入并按此权限开始工作。</p></div>
      <div className="lead-actions"><button className="primary-button" onClick={confirmDelegation}>确认并邀请小周</button><button className="secondary-button" onClick={() => setEditing(!editing)}>改一下安排</button>{status && <p className="inline-status" role="status">{status}</p>}</div>
    </section>
    <div className="document-grid">
      <article className="primary-document delegation-document">
        {editing ? <textarea aria-label="调整分工" defaultValue={delegation.instruction} /> : <blockquote>“{delegation.instruction}”</blockquote>}
        <h2>Agent 理解后的分工</h2>
        <div className="delegation-row"><FileText size={28} /><strong>内容对象</strong><span>{delegation.target}</span></div>
        <div className="delegation-row"><PencilSimple size={28} /><strong>小周可做</strong><span>{delegation.allowed}</span></div>
        <div className="delegation-row"><CheckCircle size={28} /><strong>需要林姐确认</strong><span>{delegation.confirm}</span></div>
        <div className="delegation-row"><Lock size={28} /><strong>始终不可做</strong><span>{delegation.forbidden}</span></div>
        <p className="scope-safe"><CheckCircle size={30} weight="fill" />没有扩大到其他 IP 或账号</p>
      </article>
      <aside className="evidence-rail">
        <h2>邀请后，小周会看到什么</h2>
        <ol className="journey-list">{delegation.journey.map((item: string) => <li key={item}><UserCircle size={24} />{item}</li>)}</ol>
        <section><h3>为什么这样理解</h3><ul><li>你指定小周负责“日常选题、口播稿和复盘”，因此这些环节由小周执行与发起。</li><li>你明确“定稿与发布都由我确认”，因此关键决策与发布动作仅由你完成。</li></ul></section>
        <section><h3>版本记录</h3><div className="version-record"><span className="accent-dot" />v1.0　2026-08-17 10:15　Agent 生成</div></section>
      </aside>
    </div>
  </div>
}
