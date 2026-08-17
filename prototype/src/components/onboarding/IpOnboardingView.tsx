"use client"

import { useState } from "react"
import { CheckCircle, FileText, PencilSimple, Question } from "@phosphor-icons/react"

export function IpOnboardingView({ portrait, onConfirm }: { portrait: any; onConfirm?: () => Promise<void> | void }) {
  const [correction, setCorrection] = useState("")
  const [status, setStatus] = useState("")
  return <div className="document-page onboarding-view">
    <section className="result-lead">
      <div><h1 className="eyebrow">{portrait.headline}</h1><p>这是根据你的介绍形成的 IP 草稿，不是公开介绍；确认后才用于内容创作。</p></div>
      <div className="lead-actions"><button className="primary-button" onClick={async () => { setStatus("正在建立当前 IP…"); try { await onConfirm?.() } catch (error) { setStatus(error instanceof Error ? error.message : "保存失败") } }}>这个理解准确，开始创作</button><button className="secondary-button" onClick={() => document.querySelector<HTMLTextAreaElement>('[aria-label="告诉 Agent 哪里不对"]')?.focus()}>告诉 Agent 哪里不对</button>{status && <p className="inline-status" role="status">{status}</p>}</div>
    </section>
    <div className="document-grid">
      <article className="primary-document">
        <h2 className="document-title">{portrait.name}<span className="title-divider" />{portrait.title}</h2>
        <section className="portrait-section"><FileText size={28} weight="light" /><div><h2>你是谁</h2><p>{portrait.identity}</p></div></section>
        <section className="portrait-section"><CheckCircle size={28} weight="light" /><div><h2>你为什么值得被听见</h2><p>{portrait.authority}</p></div></section>
        <section className="portrait-section"><FileText size={28} weight="light" /><div><h2>你的内容应该服务谁</h2><p>{portrait.audience}</p></div></section>
        <section className="portrait-section"><CheckCircle size={28} weight="light" /><div><h2>你的表达边界</h2><p>{portrait.boundaries.join("　|　")}</p></div></section>
        <section className="portrait-section"><PencilSimple size={28} weight="light" /><div className="direction-row"><h2>第一阶段内容方向</h2>{portrait.directions.map((item: string, index: number) => <span key={item} className={index === 0 ? "recommended-text" : ""}>{item}{index === 0 && <small>Agent 推荐</small>}</span>)}</div></section>
      </article>
      <aside className="evidence-rail">
        <h2>这份判断来自哪里</h2>
        <section><h3><FileText size={20} />你的原始介绍（节选）</h3><blockquote>“{portrait.source}”</blockquote></section>
        <section><h3 className="success-text"><CheckCircle size={20} weight="fill" />已验证的事实</h3><ul>{portrait.verifiedFacts.map((item: string) => <li key={item}>{item}</li>)}</ul></section>
        <section><h3 className="warning-text"><Question size={20} weight="fill" />可能需要你确认的一项</h3><p>{portrait.uncertainFact}</p></section>
        <label className="correction-field">有哪一句不像你？<small>告诉我需要调整的地方，我会重新理解。</small><textarea value={correction} onChange={(event) => setCorrection(event.target.value)} aria-label="告诉 Agent 哪里不对" /><PencilSimple size={20} /></label>
        <section><h3>首个创作账号</h3><p>{portrait.account}</p></section>
      </aside>
    </div>
  </div>
}
