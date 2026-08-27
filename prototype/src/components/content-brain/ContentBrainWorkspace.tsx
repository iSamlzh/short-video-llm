"use client"

import { useState } from "react"
import { ArrowClockwise, BookOpen, FilePlus, Files, SealCheck } from "@phosphor-icons/react"
import { AnalysisReviewDocument } from "./AnalysisReviewDocument"
import { SampleIntakeDocument } from "./SampleIntakeDocument"
import { StructureDecisionDocument } from "./StructureDecisionDocument"
import { StructureLedger } from "./StructureLedger"
import type { ActiveStructure, ContentBrainApi, SampleSummary, SampleWorkspace } from "./types"

export function ContentBrainWorkspace({ initialSamples, initialStructures, canActivate, api = browserApi() }: {
  initialSamples: SampleSummary[]
  initialStructures: ActiveStructure[]
  canActivate: boolean
  api?: ContentBrainApi
}) {
  const [view, setView] = useState<"samples" | "structures" | "review">("samples")
  const [samples, setSamples] = useState(initialSamples)
  const [structures, setStructures] = useState(initialStructures)
  const [workspace, setWorkspace] = useState<SampleWorkspace | null>(null)
  const [intake, setIntake] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function openSample(sampleId: string) {
    setLoading(true); setError("")
    try { setWorkspace(await api.getSample(sampleId)); setView("review") }
    catch (cause) { setError(cause instanceof Error ? cause.message : "样本读取失败，请重试") }
    finally { setLoading(false) }
  }
  async function refresh(current = workspace) {
    if (current) setWorkspace(await api.getSample(current.sample.id))
    setSamples(await api.listSamples())
    setStructures(await api.listStructures())
  }
  async function acceptReviewUpdate(next?: SampleWorkspace) {
    if (!next) return refresh()
    setWorkspace(next)
    const [nextSamples, nextStructures] = await Promise.all([api.listSamples(), api.listStructures()])
    setSamples(nextSamples)
    setStructures(nextStructures)
  }
  const candidate = workspace?.candidates.at(-1)

  return <div className="brain-workspace">
    <nav className="brain-task-navigation" aria-label="内容大脑任务">
      <button aria-current={view === "samples" ? "page" : undefined} onClick={() => { setView("samples"); setWorkspace(null) }}><Files size={19} />爆款样本</button>
      <button aria-current={view === "structures" ? "page" : undefined} onClick={() => setView("structures")}><BookOpen size={19} />结构库</button>
      <button aria-current={view === "review" ? "page" : undefined} onClick={() => setView("review")}><SealCheck size={19} />待复核</button>
      {!intake && view === "samples" && <button className="brain-new-sample" onClick={() => { setIntake(true); setView("samples") }}><FilePlus size={19} />新增爆款样本</button>}
    </nav>
    {error && <div className="brain-workspace-error" role="alert"><p>{error}</p><button onClick={() => refresh()}><ArrowClockwise size={18} />重试</button></div>}
    {loading ? <div className="brain-loading-document" aria-label="正在读取样本"><span /><span /><span /></div> : null}
    {!loading && intake && <SampleIntakeDocument api={api} onCancel={() => setIntake(false)} onCompleted={(next, duplicate) => {
      setWorkspace(next); setIntake(false); setView("review")
      if (duplicate) setError("该内容已存在，已打开原有拆解任务。")
    }} />}
    {!loading && !intake && view === "structures" && <StructureLedger structures={structures} />}
    {!loading && !intake && view === "review" && workspace && (candidate
      ? <StructureDecisionDocument candidate={candidate} api={api} canActivate={canActivate} onUpdated={() => refresh()} />
      : <AnalysisReviewDocument workspace={workspace} api={api} onUpdated={acceptReviewUpdate} />)}
    {!loading && !intake && view === "review" && !workspace && <section className="brain-empty-state"><h2>选择一条待复核样本</h2><p>从爆款样本列表打开 Agent 已完成的拆解任务。</p><button className="brain-button-secondary" onClick={() => setView("samples")}>查看样本</button></section>}
    {!loading && !intake && view === "samples" && <section className="brain-sample-index">
      <header><h1>从真实内容开始</h1><p>先提供一条真实内容，Agent 再提炼可复用结构。</p></header>
      {samples.length ? <div className="brain-sample-list">{samples.map((sample) => <button key={sample.id} onClick={() => openSample(sample.id)}><span><strong>{sample.title}</strong><small>{sample.sourcePlatform}</small></span><em>{statusText(sample.status)}</em></button>)}</div> : <div className="brain-empty-state"><FilePlus size={32} /><h2>还没有爆款样本</h2><p>使用右上角“新增爆款样本”粘贴原文或导入已授权文件，系统会直接开始拆解。</p></div>}
    </section>}
  </div>
}

function statusText(status: string) {
  return ({ draft: "待拆解", analyzing: "拆解中", review_required: "待复核", reviewed: "已复核", candidate_ready: "待决策", completed: "已启用", analysis_failed: "拆解失败", rejected: "已驳回" } as Record<string, string>)[status] ?? status
}

function browserApi(): ContentBrainApi {
  const request = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`/api/platform/content-brain${path}`, init)
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: "请求失败，请重试" }))
      throw new Error(error.message)
    }
    return response.json() as Promise<T>
  }
  const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  const modelJson = (body: unknown): RequestInit => ({ method: "POST", headers: {
    "content-type": "application/json", "idempotency-key": crypto.randomUUID(),
  }, body: JSON.stringify(body) })
  return {
    createSample: (input) => request("/samples", json("POST", input)),
    importSamples: (file, rightsNote) => { const body = new FormData(); body.set("file", file); body.set("rightsNote", rightsNote); return request("/samples/imports", { method: "POST", body }) },
    analyze: (id) => request(`/samples/${id}/analyze`, modelJson({})), getSample: (id) => request(`/samples/${id}`),
    saveAnalysis: (id, input) => request(`/analyses/${id}`, json("PUT", input)), approveAnalysis: (id, input) => request(`/analyses/${id}/approve`, modelJson(input)),
    rejectAnalysis: (id, input) => request(`/analyses/${id}/reject`, json("POST", input)), saveCandidate: (id, input) => request(`/candidates/${id}`, json("PUT", input)),
    previewCandidate: (id, input) => request(`/candidates/${id}/preview`, modelJson(input)), rejectCandidate: (id, input) => request(`/candidates/${id}/reject`, json("POST", input)),
    activateCandidate: (id, input) => request(`/candidates/${id}/activate`, json("POST", input)), listSamples: () => request("/samples"), listStructures: () => request("/structures"),
  }
}
