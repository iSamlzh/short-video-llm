"use client"

import { useEffect, useMemo, useState } from "react"
import { ArrowClockwise, BookOpen, FilePlus, Files, SealCheck, TrendUp } from "@phosphor-icons/react"
import { AnalysisReviewDocument } from "./AnalysisReviewDocument"
import { AgentQueueSummary, AgentTaskDocument, latestJobForResource } from "./AgentTaskDocument"
import { SampleIntakeDocument } from "./SampleIntakeDocument"
import { SampleQueueDocument } from "./SampleQueueDocument"
import { StructureDecisionDocument } from "./StructureDecisionDocument"
import { StructureLedger } from "./StructureLedger"
import { StructureEvolutionWorkspace } from "./StructureEvolutionWorkspace"
import type { ActiveStructure, AgentJob, ContentBrainApi, SampleQueueFilters, SampleQueuePage, SampleSummary, SampleWorkspace, StructureEvaluation } from "./types"

const defaultBrowserApi = browserApi()

export function ContentBrainWorkspace({ initialSamples, initialSamplePage, initialStructures, initialEvaluations = [], initialJobs = [], canActivate, evolutionEnabled = false, api = defaultBrowserApi }: {
  initialSamples: SampleSummary[]
  initialSamplePage?: SampleQueuePage
  initialStructures: ActiveStructure[]
  initialEvaluations?: StructureEvaluation[]
  initialJobs?: AgentJob[]
  canActivate: boolean
  evolutionEnabled?: boolean
  api?: ContentBrainApi
}) {
  const [view, setView] = useState<"samples" | "structures" | "evolution" | "review">("samples")
  const [samplePage, setSamplePage] = useState(initialSamplePage ?? legacySamplePage(initialSamples))
  const [sampleFilters, setSampleFilters] = useState<SampleQueueFilters>({ queue: "todo", limit: 50 })
  const [queueLoading, setQueueLoading] = useState(false)
  const [queueError, setQueueError] = useState("")
  const [queueNotice, setQueueNotice] = useState("")
  const [structures, setStructures] = useState(initialStructures)
  const [evaluations, setEvaluations] = useState(initialEvaluations)
  const [jobs, setJobs] = useState(initialJobs)
  const [workspace, setWorkspace] = useState<SampleWorkspace | null>(null)
  const [intake, setIntake] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [taskPending, setTaskPending] = useState(false)

  async function openSample(sampleId: string) {
    setLoading(true); setError("")
    try { setWorkspace(await api.getSample(sampleId)); setView("review") }
    catch (cause) { setError(cause instanceof Error ? cause.message : "样本读取失败，请重试") }
    finally { setLoading(false) }
  }
  async function refresh(current = workspace) {
    if (current) setWorkspace(await api.getSample(current.sample.id))
    const [nextPage, nextStructures, nextJobs, nextEvaluations] = await Promise.all([api.listSampleQueue(sampleFilters), api.listStructures(), api.listTasks(), api.listEvaluations()])
    setSamplePage(nextPage)
    setStructures(nextStructures)
    setJobs(nextJobs)
    setEvaluations(nextEvaluations)
  }
  async function acceptReviewUpdate(next?: SampleWorkspace) {
    if (!next) return refresh()
    setWorkspace(next)
    const [nextPage, nextStructures, nextJobs] = await Promise.all([api.listSampleQueue(sampleFilters), api.listStructures(), api.listTasks()])
    setSamplePage(nextPage)
    setStructures(nextStructures)
    setJobs(nextJobs)
  }
  async function finishActivation(structureName: string) {
    setWorkspace(null)
    setView("structures")
    setNotice(`“${structureName}”已启用，当前版本已经进入团长口播稿创作。`)
    try {
      const [nextPage, nextStructures, nextJobs] = await Promise.all([api.listSampleQueue(sampleFilters), api.listStructures(), api.listTasks()])
      setSamplePage(nextPage)
      setStructures(nextStructures)
      setJobs(nextJobs)
    } catch {
      setError("结构已经启用，但结构库刷新失败，请点击重试。")
    }
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
        const [nextJobs, nextPage] = await Promise.all([api.listTasks(), api.listSampleQueue(sampleFilters)])
        if (stopped) return
        setJobs(nextJobs)
        setSamplePage(nextPage)
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
  }, [activeSignature, api, workspace?.sample.id, sampleFilters])

  async function changeSampleFilters(nextFilters: SampleQueueFilters) {
    const normalized = { ...nextFilters, cursor: undefined }
    setQueueLoading(true); setQueueError(""); setQueueNotice("")
    try {
      const next = await api.listSampleQueue(normalized)
      setSampleFilters(normalized)
      setSamplePage(next)
    } catch (cause) { setQueueError(cause instanceof Error ? cause.message : "样本队列读取失败，请重试") }
    finally { setQueueLoading(false) }
  }

  async function loadMoreSamples() {
    if (!samplePage.nextCursor) return
    setQueueLoading(true); setQueueError("")
    try {
      const next = await api.listSampleQueue({ ...sampleFilters, cursor: samplePage.nextCursor })
      setSamplePage({ ...next, items: [...samplePage.items, ...next.items] })
    } catch (cause) { setQueueError(cause instanceof Error ? cause.message : "更多样本读取失败，请重试") }
    finally { setQueueLoading(false) }
  }

  async function retryMany(jobIds: string[]) {
    setQueueLoading(true); setQueueError(""); setQueueNotice("")
    try {
      const result = await api.retryManyTasks(jobIds)
      setQueueNotice(`已将 ${result.accepted} 条异常样本重新加入拆解队列。`)
      setSamplePage(await api.listSampleQueue(sampleFilters))
    } catch (cause) { setQueueError(cause instanceof Error ? cause.message : "批量重试失败，请刷新后再试") }
    finally { setQueueLoading(false) }
  }

  async function startAnalysis(sampleId: string) {
    setTaskPending(true); setError("")
    try {
      const job = await api.analyze(sampleId)
      setJobs((current) => mergeJobs(current, [job]))
      setSamplePage(await api.listSampleQueue(sampleFilters))
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
      <button aria-current={view === "samples" ? "page" : undefined} onClick={() => { setView("samples"); setWorkspace(null); setNotice(""); void changeSampleFilters(sampleFilters) }}><Files size={19} />爆款样本</button>
      <button aria-current={view === "structures" ? "page" : undefined} onClick={() => setView("structures")}><BookOpen size={19} />结构库</button>
      <button aria-current={view === "evolution" ? "page" : undefined} onClick={() => setView("evolution")}><TrendUp size={19} />结构进化</button>
      <button aria-current={view === "review" ? "page" : undefined} onClick={() => { setView("review"); setNotice("") }}><SealCheck size={19} />待复核</button>
      {!intake && view === "samples" && <button className="brain-new-sample" onClick={() => { setIntake(true); setView("samples") }}><FilePlus size={19} />新增爆款样本</button>}
    </nav>
    <AgentQueueSummary jobs={jobs} />
    {view === "structures" && notice && <p className="brain-success-note brain-workspace-success" role="status">{notice}</p>}
    {error && <div className="brain-workspace-error" role="alert"><p>{error}</p><button onClick={() => refresh()}><ArrowClockwise size={18} />重试</button></div>}
    {loading ? <div className="brain-loading-document" aria-label="正在读取样本"><span /><span /><span /></div> : null}
    {!loading && intake && <SampleIntakeDocument api={api} onCancel={() => setIntake(false)} onCompleted={(next, nextJobs, duplicate) => {
      setWorkspace(next); setJobs((current) => mergeJobs(current, nextJobs)); setIntake(false); setView("review")
      if (duplicate) setError("该内容已存在，已打开原有拆解任务。")
    }} />}
    {!loading && !intake && view === "structures" && <StructureLedger structures={structures} />}
    {!loading && !intake && view === "evolution" && <StructureEvolutionWorkspace
      structures={structures} evaluations={evaluations} evolutionEnabled={evolutionEnabled} api={api}
      onEvaluated={(next) => setEvaluations((current) => [next, ...current.filter((item) => item.templateVersionId !== next.templateVersionId)])}
      onOpenCandidate={openSample}
    />}
    {!loading && !intake && view === "review" && workspace && (candidate
      ? <StructureDecisionDocument candidate={candidate} api={api} canActivate={canActivate} onUpdated={() => refresh()} onActivated={finishActivation} />
      : workspace.analyses.length
        ? <AnalysisReviewDocument workspace={workspace} api={api} onUpdated={acceptReviewUpdate} />
        : <AgentTaskDocument job={workspaceJob} sampleTitle={workspace.sample.title} pending={taskPending}
          onStart={() => startAnalysis(workspace.sample.id)} onRetry={retryAnalysis} />)}
    {!loading && !intake && view === "review" && !workspace && <section className="brain-empty-state"><h2>选择一条待复核样本</h2><p>从爆款样本列表打开 Agent 已完成的拆解任务。</p><button className="brain-button-secondary" onClick={() => setView("samples")}>查看样本</button></section>}
    {!loading && !intake && view === "samples" && <>
      {queueNotice && <p className="brain-success-note brain-workspace-success" role="status">{queueNotice}</p>}
      <SampleQueueDocument page={samplePage} filters={sampleFilters} loading={queueLoading} error={queueError}
        onFiltersChange={changeSampleFilters} onLoadMore={loadMoreSamples} onOpenSample={openSample} onRetryMany={retryMany} />
    </>}
  </div>
}

function mergeJobs(current: AgentJob[], incoming: AgentJob[]) {
  const merged = new Map(current.map((job) => [job.id, job]))
  for (const job of incoming) merged.set(job.id, job)
  return [...merged.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
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
    listSampleQueue: (filters) => { const search = new URLSearchParams(); Object.entries(filters).forEach(([key, value]) => { if (value !== undefined && value !== "") search.set(key, String(value)) }); return request(`/sample-queue?${search}`) },
    retryManyTasks: (jobIds) => request("/tasks/bulk-retry", modelJson({ jobIds })),
    listEvaluations: () => request("/evaluations"), getEvaluation: (id) => request(`/evaluations/${id}`),
    evaluateStructure: (id) => request(`/structures/${id}/evaluate`, modelJson({})),
    proposeEvolution: (id) => request(`/evaluations/${id}/propose`, modelJson({})),
  }
}

function legacySamplePage(samples: SampleSummary[]): SampleQueuePage {
  const items = samples.map((sample) => ({
    ...sample,
    workStage: (sample.status === "completed" ? "completed" : sample.status === "rejected" ? "rejected" : sample.status === "analysis_failed" ? "failed" : sample.status === "review_required" ? "review_required" : sample.status === "candidate_ready" || sample.status === "reviewed" ? "decision_required" : sample.status === "analyzing" ? "running" : "waiting_analysis") as SampleQueuePage["items"][number]["workStage"],
    createdAt: sample.updatedAt ?? new Date(0).toISOString(), queueAt: sample.updatedAt ?? new Date(0).toISOString(), createdBy: "平台运营", latestJob: null,
  }))
  const counts = { todo: 0, waiting_analysis: 0, running: 0, review_required: 0, decision_required: 0, failed: 0, completed: 0, rejected: 0, all: items.length }
  items.forEach((item) => { counts[item.workStage] += 1 })
  counts.todo = counts.waiting_analysis + counts.running + counts.review_required + counts.decision_required + counts.failed
  return { items: items.filter((item) => !["completed", "rejected"].includes(item.workStage)), counts, nextCursor: null }
}
