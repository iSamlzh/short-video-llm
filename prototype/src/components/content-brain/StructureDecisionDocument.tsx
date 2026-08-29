"use client"

import { useState } from "react"
import { ArrowRight, Check, Flask, ShieldCheck, X } from "@phosphor-icons/react"
import type { CandidateRecord, ContentBrainApi, StructurePreview } from "./types"

const decisions = { merge_existing: "归入现有结构", upgrade_existing: "升级现有结构", create_new: "新建结构" }

export function StructureDecisionDocument({ candidate, api, canActivate, onUpdated, onActivated }: {
  candidate: CandidateRecord
  api: ContentBrainApi
  canActivate: boolean
  onUpdated: () => void
  onActivated: (structureName: string) => void | Promise<void>
}) {
  const [preview, setPreview] = useState<StructurePreview | null>(candidate.preview ?? null)
  const [payload, setPayload] = useState(candidate.payload)
  const [dirty, setDirty] = useState(false)
  const [pending, setPending] = useState<"save" | "preview" | "reject" | "activate" | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [reason, setReason] = useState("")
  const [rejecting, setRejecting] = useState(false)
  const [rejectReason, setRejectReason] = useState("")
  const [error, setError] = useState("")

  async function previewNow() {
    setPending("preview"); setError("")
    try { setPreview(await api.previewCandidate(candidate.id, { expectedVersion: candidate.version })) }
    catch (cause) { setError(cause instanceof Error ? cause.message : "试生成失败，请重试") }
    finally { setPending(null) }
  }
  async function saveDraft() {
    setPending("save"); setError("")
    try {
      await api.saveCandidate(candidate.id, { expectedVersion: candidate.version, payload })
      setDirty(false); onUpdated()
    } catch (cause) { setError(cause instanceof Error ? cause.message : "结构草稿保存失败，请重试") }
    finally { setPending(null) }
  }
  async function activate() {
    setPending("activate"); setError("")
    try {
      await api.activateCandidate(candidate.id, { expectedVersion: candidate.version, reason })
      setConfirming(false)
      await onActivated(payload.name)
    } catch (cause) { setError(cause instanceof Error ? cause.message : "启用失败，请重试") }
    finally { setPending(null) }
  }
  async function reject() {
    setPending("reject"); setError("")
    try {
      await api.rejectCandidate(candidate.id, { expectedVersion: candidate.version, reason: rejectReason })
      setRejecting(false); onUpdated()
    } catch (cause) { setError(cause instanceof Error ? cause.message : "结构驳回失败，请重试") }
    finally { setPending(null) }
  }

  if (candidate.status === "active") return <ActivatedDecisionDocument candidate={{ ...candidate, payload, preview }} />

  return <article className="brain-decision-document">
    <header className="brain-document-heading"><div><span className="brain-kicker">Agent 建议</span><h1>{decisions[payload.decision]}</h1><p>{payload.name}</p></div><span className="brain-confidence">置信度 {confidence(payload.confidence)}</span></header>
    <section className="brain-decision-reason"><h2>为什么这样判断</h2><p>{payload.differences.join("；") || "与当前结构库存在可复用关系，需要人工结合试生成结果确认。"}</p></section>
    <section className="brain-structure-flow"><h2>拟议结构</h2>{payload.nodes.map((node, index) => <div key={`${node.kind}-${index}`}><span>{node.kind}</span><ArrowRight size={18} /><label><span className="brain-visually-hidden">{node.kind}结构指令</span><textarea aria-label={`${node.kind}结构指令`} value={node.instruction} rows={2} onChange={(event) => {
      setPayload({ ...payload, nodes: payload.nodes.map((item, itemIndex) => itemIndex === index ? { ...item, instruction: event.target.value } : item) })
      setDirty(true)
    }} /></label></div>)}<button className="brain-button-secondary brain-save-structure" disabled={!dirty || pending !== null} onClick={saveDraft}>{pending === "save" ? "正在保存" : "保存结构草稿"}</button></section>
    <section className="brain-rules-grid"><div><h2>质量要求</h2>{payload.qualityRules.map((item) => <p key={item}><Check size={17} />{item}</p>)}</div><div><h2>风险边界</h2>{payload.riskRules.map((item) => <p key={item}><ShieldCheck size={17} />{item}</p>)}</div></section>
    {preview ? <section className="brain-preview-document">
      <header><Flask size={24} /><div><h2>这份结构如何生成口播稿</h2><p>{preview.payload.topic}</p></div></header>
      <blockquote>{preview.payload.script}</blockquote>
      <div className="brain-mapping-list">{preview.payload.nodeMappings.map((item) => <p key={`${item.node}-${item.excerpt}`}><strong>{item.node}</strong><span>{item.excerpt}</span></p>)}</div>
    </section> : <section className="brain-preview-prompt"><h2>先看真实生成效果</h2><p>试生成使用固定模拟 IP，不读取或写入任何团长数据。</p><button className="brain-button-primary" disabled={pending !== null} onClick={previewNow}>{pending === "preview" ? "正在试生成" : "试生成"}</button></section>}
    {error && !confirming && <p className="brain-inline-error" role="alert">{error}</p>}
    <section className="brain-candidate-reject">
      <button className="brain-text-button" onClick={() => setRejecting(!rejecting)}>驳回结构</button>
      {rejecting && <label>结构驳回原因<textarea aria-label="结构驳回原因" value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} rows={3} /><button className="brain-button-danger" disabled={rejectReason.trim().length < 2 || pending !== null} onClick={reject}>{pending === "reject" ? "正在驳回" : "确认驳回结构"}</button></label>}
    </section>
    {preview && <footer className="brain-document-actions">
      <button className="brain-button-secondary" disabled={pending !== null} onClick={previewNow}>重新试生成</button>
      {canActivate ? <button className="brain-button-primary" onClick={() => { setError(""); setConfirming(true) }}>启用这个结构</button> : <button className="brain-button-primary" onClick={() => setSubmitted(true)}>提交启用审核</button>}
    </footer>}
    {submitted && <p className="brain-success-note" role="status">已提交管理员复核。结构尚未进入团长创作。</p>}
    {confirming && <div className="brain-dialog-backdrop"><section className="brain-confirm-dialog" role="dialog" aria-modal="true" aria-label="确认启用结构版本">
      <button className="brain-icon-button brain-dialog-close" aria-label="关闭确认启用" onClick={() => setConfirming(false)}><X size={20} /></button>
      <h2>确认启用结构版本</h2>
      <dl><div><dt>候选版本</dt><dd>{candidate.version}</dd></div><div><dt>适用范围</dt><dd>{payload.applicability.ipTags.join("、") || "通用"}</dd></div><div><dt>原回退点</dt><dd>{payload.targetTemplateId ? "当前已启用稳定版本" : "无，首次启用"}</dd></div></dl>
      <label>启用原因<textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} placeholder="记录试生成结论和启用依据。" /></label>
      {error && <p className="brain-inline-error" role="alert">{error}</p>}
      <footer><button className="brain-button-secondary" onClick={() => setConfirming(false)}>暂不启用</button><button className="brain-button-primary" disabled={reason.trim().length < 2 || pending !== null} onClick={activate}>{pending === "activate" ? "正在启用" : "确认启用"}</button></footer>
    </section></div>}
  </article>
}

function ActivatedDecisionDocument({ candidate }: { candidate: CandidateRecord }) {
  const { payload, preview, activation } = candidate
  return <article className="brain-decision-document brain-activated-decision">
    <header className="brain-document-heading">
      <div><span className="brain-kicker">已启用决策</span><h1>{decisions[payload.decision]}</h1><p>{payload.name}</p></div>
      <div className="brain-decision-badges"><span className="brain-active-badge">已启用{activation ? ` · v${activation.templateVersion}` : ""}</span><span className="brain-confidence">置信度 {confidence(payload.confidence)}</span></div>
    </header>

    <section className="brain-activation-record">
      <h2>启用凭证</h2>
      <dl>
        <div><dt>结构版本</dt><dd>{activation ? `v${activation.templateVersion}` : `候选 v${candidate.version}`}</dd></div>
        <div><dt>启用时间</dt><dd>{activation ? formatDateTime(activation.activatedAt) : "历史记录待补齐"}</dd></div>
        <div><dt>启用人</dt><dd>{activation?.activatedBy ?? "平台管理员"}</dd></div>
        <div><dt>启用依据</dt><dd>{activation?.reason || "未填写"}</dd></div>
        <div><dt>来源拆解</dt><dd>{candidate.sourceAnalysisIds?.length ?? 0} 个已复核版本，可追溯到当前爆款样本</dd></div>
      </dl>
    </section>

    <section className="brain-decision-reason">
      <h2>决策依据</h2>
      <p>{payload.differences.join("；") || "该样本形成了可复用结构，并已通过人工复核与试生成。"}</p>
      {payload.similarities.length > 0 && <div className="brain-decision-relation"><strong>与现有结构的共同点</strong><p>{payload.similarities.join("；")}</p></div>}
      {payload.targetTemplateId && <div className="brain-decision-relation"><strong>关联结构</strong><p>{payload.targetTemplateId}</p></div>}
    </section>

    <section className="brain-applicability-record">
      <h2>适用范围</h2>
      <div><TagGroup title="IP 特征" items={payload.applicability.ipTags} /><TagGroup title="目标受众" items={payload.applicability.audiences} /><TagGroup title="内容目标" items={payload.applicability.goals} /></div>
    </section>

    <section className="brain-structure-flow brain-readonly-structure"><h2>已固化结构</h2>{payload.nodes.map((node, index) => <div key={`${node.kind}-${index}`}><span>{node.kind}</span><ArrowRight size={18} /><p>{node.instruction}<small>{node.required ? "必填" : "选填"}</small></p></div>)}</section>

    <section className="brain-rules-grid"><div><h2>质量要求</h2>{payload.qualityRules.map((item) => <p key={item}><Check size={17} />{item}</p>)}</div><div><h2>风险边界</h2>{payload.riskRules.map((item) => <p key={item}><ShieldCheck size={17} />{item}</p>)}</div></section>

    {preview && <section className="brain-preview-document">
      <header><Flask size={24} /><div><h2>启用前试生成记录</h2><p>{preview.payload.topic}</p></div></header>
      <blockquote>{preview.payload.script}</blockquote>
      <div className="brain-mapping-list">{preview.payload.nodeMappings.map((item) => <p key={`${item.node}-${item.excerpt}`}><strong>{item.node}</strong><span>{item.excerpt}</span></p>)}</div>
      <div className="brain-preview-checks"><CheckGroup title="质量检查" items={preview.payload.qualityChecks} /><CheckGroup title="风险检查" items={preview.payload.riskChecks} /></div>
    </section>}
    <p className="brain-immutable-note"><ShieldCheck size={18} />该启用版本为只读记录。如需调整，请从新样本生成新候选版本，不覆盖本次决策。</p>
  </article>
}

function TagGroup({ title, items }: { title: string; items: string[] }) {
  return <section><h3>{title}</h3><p>{items.length ? items.map((item) => <span key={item}>{item}</span>) : <span>通用</span>}</p></section>
}

function CheckGroup({ title, items }: { title: string; items: Array<{ rule: string; passed: boolean }> }) {
  return <section><h3>{title}</h3>{items.map((item) => <p key={item.rule} data-passed={item.passed}><Check size={15} />{item.rule}</p>)}</section>
}

function formatDateTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date)
}

function confidence(value: "low" | "medium" | "high") {
  return value === "high" ? "高" : value === "medium" ? "中" : "低"
}
