"use client"

import { useMemo, useState } from "react"
import { CheckCircle, Quotes, ShieldWarning } from "@phosphor-icons/react"
import type { AnalysisPayload, ContentBrainApi, SampleWorkspace } from "./types"

export function AnalysisReviewDocument({ workspace, api, onUpdated }: {
  workspace: SampleWorkspace
  api: ContentBrainApi
  onUpdated: (workspace?: SampleWorkspace) => void | Promise<void>
}) {
  const current = workspace.analyses.at(-1)
  const [payload, setPayload] = useState<AnalysisPayload | null>(current?.payload ?? null)
  const [pending, setPending] = useState<"save" | "approve" | "reject" | null>(null)
  const [error, setError] = useState("")
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState("")
  const evidenceById = useMemo(() => new Map(payload?.evidenceRefs.map((item) => [item.id, item]) ?? []), [payload])

  if (!current || !payload) return <div className="brain-empty-state"><h2>等待 Agent 拆解</h2><p>拆解完成后，这里会显示结构节点和来源证据。</p></div>

  async function refresh() {
    await onUpdated(await api.getSample(workspace.sample.id))
  }
  async function run(kind: "save" | "approve" | "reject") {
    setPending(kind); setError("")
    try {
      if (kind === "save") await api.saveAnalysis(current!.id, { expectedVersion: current!.version, payload: payload! })
      if (kind === "approve") await api.approveAnalysis(current!.id, { expectedVersion: current!.version, payload: payload! })
      if (kind === "reject") await api.rejectAnalysis(current!.id, { expectedVersion: current!.version, reason })
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失败，请重试")
    } finally { setPending(null) }
  }

  return <div className="brain-review-layout">
    <article className="brain-live-document">
      <header className="brain-document-heading"><div><span className="brain-kicker">{workspace.sample.title}</span><h1>Agent 拆解结论</h1></div><span className="brain-version">拆解版本 {current.version}</span></header>
      <label className="brain-summary-editor">拆解摘要<textarea aria-label="拆解摘要" value={payload.summary} onChange={(event) => setPayload({ ...payload, summary: event.target.value })} rows={3} /></label>
      <section className="brain-node-manuscript">
        <h2>可复用结构节点</h2>
        {payload.nodes.map((node, index) => <div className="brain-node-row" key={`${node.kind}-${index}`}>
          <span>{String(index + 1).padStart(2, "0")}</span>
          <label>{node.kind}<textarea aria-label={`${node.kind}节点`} value={node.instruction} onChange={(event) => {
            const nodes = payload.nodes.map((item, itemIndex) => itemIndex === index ? { ...item, instruction: event.target.value } : item)
            setPayload({ ...payload, nodes })
          }} rows={2} /></label>
          <small>{node.evidenceRefs.map((id) => evidenceById.get(id)?.quote).filter(Boolean).join("；")}</small>
        </div>)}
      </section>
      <section className="brain-patterns"><h2>可复用模式</h2><p>{payload.reusablePatterns.join("；")}</p></section>
      {error && <p className="brain-inline-error" role="alert">{error}</p>}
      {rejecting && <label className="brain-rejection-field">驳回原因<textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} /><button className="brain-button-danger" disabled={!reason.trim() || pending !== null} onClick={() => run("reject")}>确认驳回</button></label>}
      <footer className="brain-document-actions">
        <button className="brain-text-button" onClick={() => setRejecting(!rejecting)}>驳回拆解</button>
        <button className="brain-button-secondary" disabled={pending !== null} onClick={() => run("save")}>{pending === "save" ? "正在保存" : "保存草稿"}</button>
        <button className="brain-button-primary" disabled={pending !== null} onClick={() => run("approve")}>{pending === "approve" ? "正在判断结构" : "通过拆解并判断结构"}</button>
      </footer>
    </article>
    <aside className="brain-evidence-rail">
      <section><h2><Quotes size={21} />来源证据</h2>{payload.evidenceRefs.map((item) => <blockquote key={item.id}>{item.quote}</blockquote>)}</section>
      <section><h2><ShieldWarning size={21} />不可复用事实</h2>{payload.nonReusableFacts.map((item) => <p key={item}>{item}</p>)}</section>
      <section><h2><CheckCircle size={21} />适用范围</h2><p>IP：{payload.applicability.ipTags.join("、") || "未限定"}</p><p>人群：{payload.applicability.audiences.join("、") || "未限定"}</p><p>目标：{payload.applicability.goals.join("、") || "未限定"}</p></section>
    </aside>
  </div>
}
