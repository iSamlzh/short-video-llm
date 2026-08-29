"use client"

import { useEffect, useMemo, useState } from "react"
import { ArrowClockwise, BookOpen, FilePlus, Files, SealCheck } from "@phosphor-icons/react"
import { AnalysisReviewDocument } from "./AnalysisReviewDocument"
import { AgentQueueSummary, AgentTaskDocument, latestJobForResource } from "./AgentTaskDocument"
import { SampleIntakeDocument } from "./SampleIntakeDocument"
import { StructureDecisionDocument } from "./StructureDecisionDocument"
import { StructureLedger } from "./StructureLedger"
import type { ActiveStructure, AgentJob, ContentBrainApi, SampleSummary, SampleWorkspace } from "./types"

const defaultBrowserApi = browserApi()

export function ContentBrainWorkspace({ initialSamples, initialStructures, initialJobs = [], canActivate, api = defaultBrowserApi }: {
  initialSamples: SampleSummary[]
  initialStructures: ActiveStructure[]
  initialJobs?: AgentJob[]
  canActivate: boolean
  api?: ContentBrainApi
}) {
  const [view, setView] = useState<"samples" | "structures" | "review">("samples")
  const [samples, setSamples] = useState(initialSamples)
  const [structures, setStructures] = useState(initialStructures)
  const [jobs, setJobs] = useState(initialJobs)
  const [workspace, setWorkspace] = useState<SampleWorkspace | null>(null)
  const [intake, setIntake] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [taskPending, setTaskPending] = useState(false)

  async function openSample(sampleId: string) {
    setLoading(true); setError("")
    try { setWorkspace(await api.getSample(sampleId)); setView("review") }
    catch (cause) { setError(cause instanceof Error ? cause.message : "样本读取失败，请重试") }
    finally { setLoading(false) }
  }
  async function refresh(current = workspace) {
    if (current) setWorkspace(await api.getSample(current.sample.id))
    const [nextSamples, nextStructures, nextJobs] = await Promise.all([api.listSamples(), api.listStructures(), api.listTasks()])
    setSamples(nextSamples)
    setStructures(nextStructures)
    setJobs(nextJobs)
  }
  async function acceptReviewUpdate(next?: SampleWorkspace) {
    if (!next) return refresh()
    setWorkspace(next)
    const [nextSamples, nextStructures, nextJobs] = await Promise.all([api.listSamples(), api.listStructures(), api.listTasks()])
    setSamples(nextSamples)
    setStructures(nextStructures)
    setJobs(nextJobs)
  }
  const candidate = workspace?.candidates.at(-1)
  const workspaceJob = workspace ? latestJobForResource(jobs, workspace.sample.id) : undefined
  const activeSignature = useMemo(() => jobs
    .filter((job) => job.status === "queued" || job.status === "running")
    .map((job) => `${job.id}:${job.status}:${job.stage}:${job.updatedAt}`).join("|"), [jobs])

  useEffect(() => {
    if (!activeSignature) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const [nextJobs, nextSamples] = await Promise.all([api.listTasks(), api.listSamples()])
        if (stopped) return
        setJobs(nextJobs)
        setSamples(nextSamples)
        if (workspace) {
          const nextJob = latestJobForResource(nextJobs, workspace.sample.id)
          if (nextJob && ["succeeded", "failed", "timed_out", "cancelled"].includes(nextJob.status)) {
            setWorkspace(await api.getSample(workspace.sample.id))
          }
        }
      } catch {
        // 轮询失败不覆盖当前任务状态；下一轮自动恢复。
      }
      if (!stopped) timer = setTimeout(poll, document.hidden ? 10_000 : 2_000)
    }
    timer = setTimeout(poll, 1_000)
    return () => { stopped = true; clearTimeout(timer) }
  }, [activeSignature, api, workspace?.sample.id])

  async function startAnalysis(sampleId: string) {
    setTaskPending(true); setError("")
    try {
      const job = await api.analyze(sampleId)
      setJobs((current) => mergeJobs(current, [job]))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "拆解任务创建失败，请重试")
    } finally { setTaskPending(false) }
  }

  async function retryAnalysis(jobId: string) {
    setTaskPending(true); setError("")
    try {
      const job = await api.retryTask(jobId)
      setJobs((current) => mergeJobs(current, [job]))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "任务重新排队失败，请重试")
    } finally { setTaskPending(false) }
  }

  return <div className="brain-workspace">
    <nav className="brain-task-navigation" aria-label="内容大脑任务">
      <button aria-current={view === "samples" ? "page" : undefined} onClick={() => { setView("samples"); setWorkspace(null) }}><Files size={19} />爆款样本</button>
      <button aria-current={view === "structures" ? "page" : undefined} onClick={() => setView("structures")}><BookOpen size={19} />结构库</button>
      <button aria-current={view === "review" ? "page" : undefined} onClick={() => setView("review")}><SealCheck size={19} />待复核</button>
      {!intake && view === "samples" && <button className="brain-new-sample" onClick={() => { setIntake(true); setView("samples") }}><FilePlus size={19} />新增爆款样本</button>}
    </nav>
    <AgentQueueSummary jobs={jobs} />
    {error && <div className="brain-workspace-error" role="alert"><p>{error}</p><button onClick={() => refresh()}><ArrowClockwise size={18} />重试</button></div>}
    {loading ? <div className="brain-loading-document" aria-label="正在读取样本"><span /><span /><span /></div> : null}
    {!loading && intake && <SampleIntakeDocument api={api} onCancel={() => setIntake(false)} onCompleted={(next, nextJobs, duplicate) => {
      setWorkspace(next); setJobs((current) => mergeJobs(current, nextJobs)); setIntake(false); setView("review")
      if (duplicate) setError("该内容已存在，已打开原有拆解任务。")
    }} />}
    {!loading && !intake && view === "structures" && <StructureLedger structures={structures} />}
    {!loading && !intake && view === "review" && workspace && (candidate
      ? <StructureDecisionDocument candidate={candidate} api={api} canActivate={canActivate} onUpdated={() => refresh()} />
      : workspace.analyses.length
        ? <AnalysisReviewDocument workspace={workspace} api={api} onUpdated={acceptReviewUpdate} />
        : <AgentTaskDocument job={workspaceJob} sampleTitle={workspace.sample.title} pending={taskPending}
          onStart={() => startAnalysis(workspace.sample.id)} onRetry={retryAnalysis} />)}
    {!loading && !intake && view === "review" && !workspace && <section className="brain-empty-state"><h2>选择一条待复核样本</h2><p>从爆款样本列表打开 Agent 已完成的拆解任务。</p><button className="brain-button-secondary" onClick={() => setView("samples")}>查看样本</button></section>}
    {!loading && !intake && view === "samples" && <section className="brain-sample-index">
      <header><h1>从真实内容开始</h1><p>先提供一条真实内容，Agent 再提炼可复用结构。</p></header>
      {samples.length ? <div className="brain-sample-list">{samples.map((sample) => {
        const job = latestJobForResource(jobs, sample.id)
        return <button key={sample.id} onClick={() => openSample(sample.id)}><span><strong>{sample.title}</strong><small>{sample.sourcePlatform}</small></span><em>{jobStatusText(job, sample.status)}</em></button>
      })}</div> : <div className="brain-empty-state"><FilePlus size={32} /><h2>还没有爆款样本</h2><p>使用右上角“新增爆款样本”粘贴原文或导入已授权文件，系统会直接开始拆解。</p></div>}
    </section>}
  </div>
}

function jobStatusText(job: AgentJob | undefined, sampleStatus: string) {
  if (!job) return statusText(sampleStatus)
  return ({ queued: "等待拆解", running: "拆解中", succeeded: statusText(sampleStatus), failed: "拆解失败", timed_out: "拆解超时", cancelled: "已取消" } as Record<string, string>)[job.status]
}

function mergeJobs(current: AgentJob[], incoming: AgentJob[]) {
  const merged = new Map(current.map((job) => [job.id, job]))
  for (const job of incoming) merged.set(job.id, job)
  return [...merged.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
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
    analyze: (id, batchId) => request(`/samples/${id}/analyze`, modelJson(batchId ? { batchId } : {})), getSample: (id) => request(`/samples/${id}`),
    getTask: (id) => request(`/tasks/${id}`), listTasks: () => request("/tasks"), retryTask: (id) => request(`/tasks/${id}/retry`, modelJson({})),
    saveAnalysis: (id, input) => request(`/analyses/${id}`, json("PUT", input)), approveAnalysis: (id, input) => request(`/analyses/${id}/approve`, modelJson(input)),
    rejectAnalysis: (id, input) => request(`/analyses/${id}/reject`, json("POST", input)), saveCandidate: (id, input) => request(`/candidates/${id}`, json("PUT", input)),
    previewCandidate: (id, input) => request(`/candidates/${id}/preview`, modelJson(input)), rejectCandidate: (id, input) => request(`/candidates/${id}/reject`, json("POST", input)),
    activateCandidate: (id, input) => request(`/candidates/${id}/activate`, json("POST", input)), listSamples: () => request("/samples"), listStructures: () => request("/structures"),
  }
}
