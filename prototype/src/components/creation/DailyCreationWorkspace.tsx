"use client"

import { useCallback, useEffect, useState } from "react"
import { DailyCreationView } from "./DailyCreationView"

type ApiError = { errorCode?: string; message?: string }

async function readJson(response: Response) {
  if (response.status === 204) return null
  const body = await response.json() as ApiError
  if (!response.ok) throw new Error(body.message || body.errorCode || "生成失败")
  return body
}

export function DailyCreationWorkspace() {
  const [draft, setDraft] = useState<any>(null)
  const [error, setError] = useState("")
  const [generating, setGenerating] = useState(true)
  const [operation, setOperation] = useState<"initial" | "change_topic" | "change_expression" | null>("initial")

  const create = useCallback(async (intent: "initial" | "change_topic" | "change_expression" = "initial", fromRunId?: string) => {
    setGenerating(true)
    setOperation(intent)
    setError("")
    try {
      const result = await fetch("/api/app/creation/auto", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ intent, fromRunId }),
      }).then(readJson)
      setDraft(result)
    } catch (value) {
      setError(value instanceof Error ? value.message : "生成失败")
    } finally {
      setGenerating(false)
      setOperation(null)
    }
  }, [])

  useEffect(() => {
    let active = true
    void fetch("/api/app/creation/current").then(readJson).then((current) => {
      if (!active) return
      if (current) { setDraft(current); setGenerating(false); return }
      return create("initial")
    }).catch((value) => {
      if (!active) return
      setError(value instanceof Error ? value.message : "读取失败")
      setGenerating(false)
    })
    return () => { active = false }
  }, [create])

  if (generating && !draft) return <main className="agent-working" aria-live="polite"><p className="eyebrow">Agent 正在准备今天的内容</p><h1>我在结合当前 IP、账号记忆和内部爆款结构。</h1><p>选题、口播稿与发布前检查会一次完成，通常需要几十秒。</p><div className="agent-progress"><span /><span /><span /></div></main>
  if (error && !draft) return <main className="agent-error"><p className="eyebrow">这次没有生成成功</p><h1>{error}</h1><p>已保留当前 IP 与账号上下文，可直接重试；不会产生半成品。</p><button className="primary-button" onClick={() => void create("initial")}>重新生成</button></main>
  const status = operation === "change_topic" ? "正在切换到本轮下一个选题，并生成可直接拍的新稿…" : operation === "change_expression" ? "正在保留当前选题，换一种完整讲法…" : ""
  return <main>
    {(status || error) && <p className={`workspace-notice ${error ? "workspace-notice-error" : ""}`} role="status">{error || status}</p>}
    <DailyCreationView draft={draft} regenerating={generating} onRegenerate={(intent) => void create(intent, draft.runId)} />
  </main>
}
