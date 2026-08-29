"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { DailyCreationView } from "./DailyCreationView"
import { GenerationProgress } from "./GenerationProgress"
import type { PublicationAccount, PublicationRecord } from "./PublicationReceipt"
import { normalizeScriptSegments, spokenSegmentText, type ScriptSegment } from "../../domain/creation-contracts"
import { useModelOperation, type ModelOperationStage } from "../../hooks/use-model-operation"
import { CreationStartPanel, ManualTopicPlanner, type ManualTopicPool } from "./ManualTopicPlanner"

type ApiError = { errorCode?: string; message?: string; retryable?: boolean }
type CreationIntent = "initial" | "change_topic" | "change_expression"
type CreationOperation = CreationIntent | "manual_topics" | "manual_script"
type TopicPoolResult = { runId: string; recommendedTopicId: string }
type PendingTopicCheckpoint = {
  intent: CreationIntent
  fromRunId?: string
  pool: TopicPoolResult
}

class ApiRequestError extends Error {
  constructor(message: string, readonly code?: string, readonly retryable = false) {
    super(message)
    this.name = "ApiRequestError"
  }
}

async function readJson(response: Response) {
  if (response.status === 204) return null
  const body = await response.json() as ApiError & Record<string, any>
  if (!response.ok) throw new ApiRequestError(body.message || body.errorCode || "生成失败", body.errorCode, Boolean(body.retryable))
  return body
}

export function DailyCreationWorkspace({ publicationAccounts = [] }: { publicationAccounts?: PublicationAccount[] }) {
  const [draft, setDraft] = useState<any>(null)
  const [error, setError] = useState("")
  const [loadingCurrent, setLoadingCurrent] = useState(true)
  const [operation, setOperation] = useState<CreationOperation | null>(null)
  const [busyAction, setBusyAction] = useState<"saving" | "finalizing" | null>(null)
  const [notice, setNotice] = useState("")
  const [manualOpen, setManualOpen] = useState(false)
  const [manualTopicPool, setManualTopicPool] = useState<ManualTopicPool | null>(null)
  const pendingTopicCheckpointRef = useRef<PendingTopicCheckpoint | null>(null)
  const modelOperation = useModelOperation()

  const create = useCallback(async (intent: CreationIntent = "initial", fromRunId?: string) => {
    setOperation(intent)
    setManualOpen(false)
    setManualTopicPool(null)
    setError("")
    setNotice("")
    pendingTopicCheckpointRef.current = null
    await modelOperation.start({
      initialStage: initialStageFor(intent),
      task: async (signal) => {
        const checkpoint = pendingTopicCheckpointRef.current
        const canResumeScript = checkpoint
          && checkpoint.intent === intent
          && checkpoint.fromRunId === fromRunId
        let pool: TopicPoolResult | null
        if (canResumeScript) {
          pool = checkpoint.pool
        } else {
          pool = await fetch("/api/app/creation/topics", {
            method: "POST",
            headers: { "content-type": "application/json", "idempotency-key": `${createIdempotencyKey()}:topics` },
            body: JSON.stringify({ intent, ...(fromRunId ? { fromRunId } : {}) }),
            signal,
          }).then(readJson) as TopicPoolResult | null
        }
        if (!pool) throw new Error("选题池生成结果为空")
        pendingTopicCheckpointRef.current = { intent, fromRunId, pool }
        return fetch("/api/app/creation/scripts", {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": `${createIdempotencyKey()}:script` },
          body: JSON.stringify({ runId: pool.runId, topicId: pool.recommendedTopicId, intent, ...(fromRunId ? { fromRunId } : {}) }),
          signal,
        }).then(readJson)
      },
      onSuccess: (result) => {
        pendingTopicCheckpointRef.current = null
        setDraft(result)
        setOperation(null)
      },
    })
  }, [modelOperation.start])

  useEffect(() => {
    let active = true
    void fetch("/api/app/creation/current").then(readJson).then((current) => {
      if (!active) return
      setLoadingCurrent(false)
      if (current) { setDraft(current); setOperation(null); return }
    }).catch((value) => {
      if (!active) return
      setError(value instanceof Error ? value.message : "读取失败")
      setLoadingCurrent(false)
    })
    return () => { active = false }
  }, [create])

  async function generateManualTopics(topicBrief: string) {
    setOperation("manual_topics")
    setError("")
    setNotice("")
    await modelOperation.start({
      initialStage: "selecting",
      task: async (signal) => fetch("/api/app/creation/topics", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": `${createIdempotencyKey()}:manual-topics` },
        body: JSON.stringify({ mode: "manual", ...(topicBrief ? { topicBrief } : {}) }),
        signal,
      }).then(readJson) as Promise<ManualTopicPool>,
      onSuccess: (pool) => {
        setManualTopicPool(pool)
        setOperation(null)
      },
    })
  }

  async function generateManualScript(runId: string, topicId: string) {
    setOperation("manual_script")
    setError("")
    setNotice("")
    await modelOperation.start({
      initialStage: "writing",
      task: async (signal) => fetch("/api/app/creation/scripts", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": `${createIdempotencyKey()}:manual-script` },
        body: JSON.stringify({ runId, topicId, intent: "initial" }),
        signal,
      }).then(readJson),
      onSuccess: (result) => {
        setDraft(result)
        setManualOpen(false)
        setManualTopicPool(null)
        setOperation(null)
      },
    })
  }

  function closeManualPlanner() {
    modelOperation.cancel()
    setManualOpen(false)
    setManualTopicPool(null)
    setOperation(null)
    setError("")
  }

  async function save(segments: ScriptSegment[]) {
    setBusyAction("saving")
    setError("")
    setNotice("正在保存修改…")
    try {
      const result = await fetch(`/api/app/creation/runs/${draft.runId}/draft`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedRevision: draft.revision, segments }),
      }).then(readJson)
      if (!result) throw new Error("保存结果为空")
      setDraft(result)
      setNotice(result.saved ? "修改已保存，请人工确认事实与表达边界" : "内容没有变化，无需创建新版本")
    } catch (value) {
      const message = value instanceof Error ? value.message : "保存失败"
      setError(message)
      setNotice("")
      throw value
    } finally {
      setBusyAction(null)
    }
  }

  async function finalize({ segments }: { segments: ScriptSegment[] }) {
    setBusyAction("finalizing")
    setError("")
    setNotice("正在确认定稿…")
    try {
      const result = await fetch(`/api/app/creation/runs/${draft.runId}/finalize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedRevision: draft.revision, segments }),
      }).then(readJson)
      if (!result) throw new Error("定稿结果为空")
      setDraft(result)
      setNotice("已确认定稿，现在可以下载口播稿")
    } catch (value) {
      setError(value instanceof Error ? value.message : "定稿失败")
      setNotice("")
      throw value
    } finally {
      setBusyAction(null)
    }
  }

  function download() {
    const link = document.createElement("a")
    link.href = `/api/app/creation/runs/${encodeURIComponent(draft.runId)}/download`
    link.download = ""
    document.body.appendChild(link)
    link.click()
    link.remove()
  }

  async function copy() {
    await navigator.clipboard.writeText(spokenSegmentText(normalizeScriptSegments({
      segments: draft.segments,
      paragraphs: draft.paragraphs,
    })))
    setNotice("口播正文已复制")
  }

  async function savePublication(input: {
    runId: string; lockedVersion: number; contentAccountId: string; identity: string; publishedAt: string
  }) {
    const isUrl = /^https?:\/\//i.test(input.identity)
    return fetch("/api/app/publications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        runId: input.runId,
        lockedVersion: input.lockedVersion,
        contentAccountId: input.contentAccountId,
        ...(isUrl ? { videoUrl: input.identity } : { platformVideoId: input.identity }),
        publishedAt: input.publishedAt,
      }),
    }).then(readJson) as Promise<PublicationRecord>
  }

  async function loadPublications() {
    if (!draft?.runId || !draft?.lockedVersion) return []
    return fetch(`/api/app/publications?runId=${encodeURIComponent(draft.runId)}&lockedVersion=${draft.lockedVersion}`)
      .then(readJson) as Promise<PublicationRecord[]>
  }

  function cancelGeneration() {
    const cancelledOperation = operation
    modelOperation.cancel()
    setOperation(null)
    if (cancelledOperation === "manual_topics" || cancelledOperation === "manual_script") return
    if (!draft) setNotice("已取消本次生成，你可以重新选择创作方式")
  }

  if (loadingCurrent && !draft) return <main className="agent-working" aria-live="polite"><p className="eyebrow">正在读取今日创作</p><h1 className="text-balance">先确认是否已有可继续使用的稿件。</h1><p className="text-pretty">如果没有，Agent 会直接开始生成今天的选题和口播稿。</p></main>
  if (modelOperation.state && !draft && operation) return <main className="agent-working"><GenerationProgress operation={operation} state={modelOperation.state} detailsVisible={modelOperation.detailsVisible} error={modelOperation.error} standalone onCancel={cancelGeneration} onRetry={() => void modelOperation.retry()} /></main>
  if (error && !draft) return <main className="agent-error"><p className="eyebrow">这次没有生成成功</p><h1>{error}</h1><p>已保留当前 IP 与账号上下文，可直接重试；不会产生半成品。</p><button className="primary-button" onClick={() => void create("initial")}>重新生成</button></main>
  if (!draft) return <main>
    {notice && <p className="workspace-notice" role="status">{notice}</p>}
    {manualOpen
      ? <ManualTopicPlanner
        pool={manualTopicPool}
        onGenerateTopics={(topicBrief) => void generateManualTopics(topicBrief)}
        onGenerateScript={(runId, topicId) => void generateManualScript(runId, topicId)}
        onReset={() => setManualTopicPool(null)}
        onCancel={closeManualPlanner}
        hasExistingDraft={false}
      />
      : <CreationStartPanel onAuto={() => void create("initial")} onManual={() => setManualOpen(true)} />}
  </main>
  return <main>
    {modelOperation.state && operation && <GenerationProgress operation={operation} state={modelOperation.state} detailsVisible={modelOperation.detailsVisible} error={modelOperation.error} onCancel={cancelGeneration} onRetry={() => void modelOperation.retry()} />}
    {(notice || error) && <p className={`workspace-notice ${error ? "workspace-notice-error" : ""}`} role={error ? "alert" : "status"}>{error || notice}</p>}
    {manualOpen && !modelOperation.state && <ManualTopicPlanner
      pool={manualTopicPool}
      onGenerateTopics={(topicBrief) => void generateManualTopics(topicBrief)}
      onGenerateScript={(runId, topicId) => void generateManualScript(runId, topicId)}
      onReset={() => setManualTopicPool(null)}
      onCancel={closeManualPlanner}
      hasExistingDraft
    />}
    {(!manualOpen || modelOperation.state) && <DailyCreationView draft={draft} regenerating={modelOperation.running || manualOpen} busyAction={busyAction} onSave={save} onFinalize={finalize} onDownload={download} onCopy={copy} onManualCreate={() => { setManualOpen(true); setManualTopicPool(null) }} onRegenerate={(intent) => void create(intent, draft.runId)} publicationAccounts={publicationAccounts} onSavePublication={savePublication} onLoadPublications={loadPublications} />}
  </main>
}

function createIdempotencyKey() {
  return globalThis.crypto?.randomUUID?.()
    ?? `client-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function initialStageFor(intent: CreationIntent): ModelOperationStage {
  if (intent === "initial") return "preparing"
  if (intent === "change_topic") return "selecting"
  return "writing"
}
