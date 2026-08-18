"use client"

import { useState } from "react"
import type { ReactNode } from "react"
import { CheckCircle, FileText, PencilSimple, Question } from "@phosphor-icons/react"

type Portrait = {
  headline: string; name: string; title: string; identity: string; authority: string; audience: string
  boundaries: readonly string[]; directions: readonly string[]; source: string; verifiedFacts: readonly string[]; uncertainFact: string; account: string
}

export function IpOnboardingView({ portrait, sourceMap = {}, onConfirm, onRequestCorrection }: {
  portrait: Portrait
  sourceMap?: Record<string, string[]>
  onConfirm?: () => Promise<void> | void
  onRequestCorrection?: (fieldPath: string) => void
}) {
  const [status, setStatus] = useState("")
  const [confirming, setConfirming] = useState(false)
  async function confirm() {
    setStatus("正在建立当前IP…")
    setConfirming(true)
    try { await onConfirm?.() } catch (error) {
      setStatus(error instanceof Error ? error.message : "保存失败")
      setConfirming(false)
    }
  }

  return <div className="document-page onboarding-view">
    <section className="result-lead">
      <div><p className="onboarding-kicker">内容画像预览</p><h1 className="eyebrow">{portrait.headline}</h1><p>这不是公开简介，而是 Agent 后续选题与口播稿的工作依据。确认后才会建立当前IP。</p></div>
      <div className="lead-actions"><button className="primary-button" disabled={confirming} onClick={confirm}>{confirming ? "正在建立当前IP…" : "这个理解准确，开始创作"}</button>{status && <p className="inline-status" role="status">{status}</p>}</div>
    </section>
    <div className="document-grid">
      <article className="primary-document">
        <h2 className="document-title">{portrait.name}<span className="title-divider" />{portrait.title}</h2>
        <PortraitSection icon={<FileText size={26} weight="light" />} title="你是谁" text={portrait.identity} field="identityPositioning" sourceMap={sourceMap} onCorrect={onRequestCorrection} />
        <PortraitSection icon={<CheckCircle size={26} weight="light" />} title="你为什么值得被听见" text={portrait.authority} field="identityPositioning" sourceMap={sourceMap} onCorrect={onRequestCorrection} />
        <PortraitSection icon={<FileText size={26} weight="light" />} title="内容应该服务谁" text={portrait.audience} field="targetAudience" sourceMap={sourceMap} onCorrect={onRequestCorrection} />
        <PortraitSection icon={<CheckCircle size={26} weight="light" />} title="表达边界" text={portrait.boundaries.join("；")} field="boundaries" sourceMap={sourceMap} onCorrect={onRequestCorrection} />
        <section className="portrait-section"><PencilSimple size={26} weight="light" /><div className="direction-row"><div className="portrait-section-heading"><h2>第一阶段内容方向</h2><CorrectionButton field="topicPillars" title="第一阶段内容方向" sourceMap={sourceMap} onCorrect={onRequestCorrection} /></div>{portrait.directions.map(item => <span key={item}>{item}</span>)}</div></section>
      </article>
      <aside className="evidence-rail">
        <h2>这份判断来自哪里</h2>
        <section><h3><FileText size={20} />已确认回答摘要</h3><blockquote>“{portrait.source}”</blockquote></section>
        <section><h3 className="success-text"><CheckCircle size={20} weight="fill" />已确认事实</h3><ul>{portrait.verifiedFacts.map(item => <li key={item}>{item}</li>)}</ul></section>
        <section><h3 className="warning-text"><Question size={20} weight="fill" />仍需留意</h3><p>{portrait.uncertainFact}</p></section>
        <section><h3>首个创作账号</h3><p>{portrait.account}</p></section>
        <p className="evidence-note">若画像有误，请修改它所依据的原回答，不新增脱离问题库的自由备注。</p>
      </aside>
    </div>
  </div>
}

function PortraitSection({ icon, title, text, field, sourceMap, onCorrect }: { icon: ReactNode; title: string; text: string; field: string; sourceMap: Record<string, string[]>; onCorrect?: (field: string) => void }) {
  return <section className="portrait-section">{icon}<div><div className="portrait-section-heading"><h2>{title}</h2><CorrectionButton field={field} title={title} sourceMap={sourceMap} onCorrect={onCorrect} /></div><p>{text}</p></div></section>
}

function CorrectionButton({ field, title, sourceMap, onCorrect }: { field: string; title: string; sourceMap: Record<string, string[]>; onCorrect?: (field: string) => void }) {
  if (!onCorrect || !sourceMap[field]?.length) return null
  return <button type="button" className="correction-link" onClick={() => onCorrect(field)}>修改「{title}」</button>
}
