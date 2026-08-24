"use client"

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react"
import { ImportOutcome } from "./ImportOutcome"
import { ReviewBriefView } from "./ReviewBriefView"
import { replaceDocument } from "@/lib/client-navigation"

type ReviewApi = {
  getCurrentReview: () => Promise<any>
  getBatch: (batchId: string) => Promise<any>
  importMetrics: (file: File) => Promise<{ batchId: string }>
  generateReview: () => Promise<any>
  confirmMatch: (matchId: string, publicationId: string, version: number) => Promise<any>
  createExternal: (matchId: string, version: number) => Promise<any>
  confirmMemory: (reviewId: string, input: { keep: string[]; avoid: string[]; nextContentSignals: string[] }) => Promise<any>
  startNextRound: (sourceReviewId: string, expectedMemoryVersion: number) => Promise<any>
}

export function ReviewWorkspace({ contentAccountId, initialBatchId, accountLabel = "当前内容账号", api }: { contentAccountId: string; initialBatchId?: string | null; accountLabel?: string; api?: ReviewApi }) {
  const client = useMemo(() => api ?? browserApi(contentAccountId), [api, contentAccountId])
  const [brief, setBrief] = useState<any>(null)
  const [outcome, setOutcome] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState("")
  const [noticeKind, setNoticeKind] = useState<"status" | "error">("status")
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { let active = true; void Promise.all([client.getCurrentReview(), initialBatchId ? client.getBatch(initialBatchId) : Promise.resolve(null)]).then(([current, batch]) => { if (active) { setBrief(current); setOutcome(batch) } }).catch((error) => { if (active) { setNoticeKind("error"); setNotice(error instanceof Error ? error.message : "读取失败") } }).finally(() => { if (active) setLoading(false) }); return () => { active = false } }, [client, initialBatchId])
  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return
    setLoading(true); setNoticeKind("status"); setNotice("正在导入并匹配真实数据…")
    try { const imported = await client.importMetrics(file); setOutcome(await client.getBatch(imported.batchId)); setNotice("可用数据已关联，Agent 正在生成复盘…"); setBrief(await client.generateReview()); setNotice("真实数据复盘已更新") }
    catch (error) { setNoticeKind("error"); setNotice(error instanceof Error ? error.message : "导入失败") }
    finally { setLoading(false); event.target.value = "" }
  }
  async function refreshBatch(action: () => Promise<any>) { await action(); if (outcome?.batchId) setOutcome(await client.getBatch(outcome.batchId)); setBrief(await client.generateReview()) }
  async function confirmHighConfidence(items: Array<{ matchId: string; publicationId: string; version: number }>) {
    setLoading(true); setNoticeKind("status"); setNotice(`正在确认 ${items.length} 条高置信候选…`)
    try {
      for (const item of items) await client.confirmMatch(item.matchId, item.publicationId, item.version)
      if (outcome?.batchId) setOutcome(await client.getBatch(outcome.batchId))
      setBrief(await client.generateReview()); setNotice("候选已确认，复盘已更新")
    } catch (error) { setNoticeKind("error"); setNotice(error instanceof Error ? error.message : "批量确认失败") }
    finally { setLoading(false) }
  }
  async function confirmMemory(memory: { keep: string[]; avoid: string[]; nextContentSignals: string[] }) {
    const confirmed = await client.confirmMemory(brief.id, memory)
    setBrief((current: any) => current ? {
      ...current,
      status: "confirmed",
      canConfirm: false,
      confirmation: {
        status: "confirmed",
        memoryId: confirmed.id,
        memoryVersion: confirmed.version,
        confirmedAt: confirmed.createdAt,
        sourceReviewId: confirmed.sourceReviewId,
      },
    } : current)
    setNoticeKind("status"); setNotice(`已形成私有创作记忆 v${confirmed.version}`)
    return confirmed
  }
  async function startNextRound() {
    const version = brief?.confirmation?.memoryVersion
    if (!brief?.id || !version) return
    setLoading(true); setNoticeKind("status"); setNotice(`正在依据私有记忆 v${version} 生成下一条…`)
    try {
      await client.startNextRound(brief.id, version)
      replaceDocument("/app/today")
    } catch (error) {
      setNoticeKind("error"); setNotice(error instanceof Error ? error.message : "下一轮生成失败，请重试")
      setLoading(false)
    }
  }
  return <main><input ref={input} aria-label="导入真实平台数据" className="visually-hidden" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={importFile} />{notice && <p className={`workspace-notice review-workspace-notice ${noticeKind === "error" ? "workspace-notice-error" : ""}`} role={noticeKind === "error" ? "alert" : "status"}>{notice}</p>}{loading && !brief && !outcome ? <section className="agent-working"><p className="eyebrow">Agent 正在读取 {accountLabel} 的真实数据</p><h1>先找出真正值得你看的内容。</h1></section> : <>{outcome && <ImportOutcome result={outcome} onConfirm={(matchId, publicationId, version) => refreshBatch(() => client.confirmMatch(matchId, publicationId, version))} onCreateExternal={(matchId, version) => refreshBatch(() => client.createExternal(matchId, version))} onConfirmHighConfidence={confirmHighConfidence} />}{brief ? <ReviewBriefView brief={brief} onImport={() => input.current?.click()} onConfirm={confirmMemory} onStartNextRound={startNextRound} /> : <section className="empty-review"><p className="eyebrow">当前账号还没有可复盘的真实数据</p><h1>导入平台文件，Agent 会先给结论，再说明证据边界。</h1><p>首版支持 CSV 和 XLSX；平台 API 自动回流放在二期。</p><button className="primary-button" onClick={() => input.current?.click()}>导入真实数据</button></section>}</>}</main>
}

function browserApi(contentAccountId: string): ReviewApi {
  return {
    getCurrentReview: () => fetch(`/api/app/reviews/current?contentAccountId=${encodeURIComponent(contentAccountId)}`).then(read),
    getBatch: (batchId) => fetch(`/api/app/metrics/imports/${encodeURIComponent(batchId)}`).then(read),
    importMetrics: (file) => { const form = new FormData(); form.append("file", file); return fetch("/api/app/metrics/imports", { method: "POST", body: form }).then(read) },
    generateReview: () => fetch("/api/app/reviews/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contentAccountId }) }).then(read),
    confirmMatch: (matchId, publicationId, expectedVersion) => fetch(`/api/app/metrics/matches/${encodeURIComponent(matchId)}/confirm`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ publicationId, expectedVersion }) }).then(read),
    createExternal: (matchId, expectedVersion) => fetch(`/api/app/metrics/matches/${encodeURIComponent(matchId)}/external`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedVersion }) }).then(read),
    confirmMemory: (reviewId, input) => fetch(`/api/app/reviews/${encodeURIComponent(reviewId)}/confirm`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }).then(read),
    startNextRound: (sourceReviewId, expectedMemoryVersion) => fetch("/api/app/creation/next-round", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceReviewId, expectedMemoryVersion }) }).then(read),
  }
}

async function read(response: Response) { if (response.status === 204) return null; const body = await response.json(); if (!response.ok) throw new Error(body.message || body.errorCode || "请求失败"); return body }
