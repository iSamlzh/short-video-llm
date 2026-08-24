"use client"

import { useEffect, useState } from "react"
import { CheckCircle, LockKey } from "@phosphor-icons/react"

type MemoryInput = { keep: string[]; avoid: string[]; nextContentSignals: string[] }

type MemoryPreviewProps = {
  brief: any
  onConfirm?: (input: MemoryInput) => Promise<any> | any
  onStartNextRound?: () => Promise<void> | void
}

export function MemoryPreview({ brief, onConfirm, onStartNextRound }: MemoryPreviewProps) {
  const [keep, setKeep] = useState(brief.payload.keep.join("\n"))
  const [avoid, setAvoid] = useState(brief.payload.avoid.join("\n"))
  const [signals, setSignals] = useState(brief.payload.nextContentSignals.join("\n"))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const confirmed = brief.confirmation?.status === "confirmed"
  useEffect(() => {
    setKeep(brief.payload.keep.join("\n"))
    setAvoid(brief.payload.avoid.join("\n"))
    setSignals(brief.payload.nextContentSignals.join("\n"))
    setError("")
  }, [brief.id, brief.version, brief.payload])

  async function confirm() {
    setBusy(true)
    setError("")
    try {
      await onConfirm?.({ keep: lines(keep), avoid: lines(avoid), nextContentSignals: lines(signals) })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "记忆确认失败，请重试")
    } finally {
      setBusy(false)
    }
  }

  return <aside className="evidence-rail memory-preview">
    <h2><LockKey size={21} />本账号的私有创作记忆</h2>
    <p>只作用于当前团队 / IP / 内容账号，不会改动平台模板或通用策略。</p>
    <label>继续保留<textarea aria-label="继续保留" value={keep} disabled={confirmed} onChange={(event) => setKeep(event.target.value)} /></label>
    <label>尽量避免<textarea aria-label="尽量避免" value={avoid} disabled={confirmed} onChange={(event) => setAvoid(event.target.value)} /></label>
    <label>下一轮信号<textarea aria-label="下一轮信号" value={signals} disabled={confirmed} onChange={(event) => setSignals(event.target.value)} /></label>
    <section className="memory-evidence-limit">
      <h3>证据边界（只读）</h3>
      <p>{brief.evidenceLimits ?? brief.payload.evidenceLimits}</p>
    </section>
    {brief.samplesUntilMemory > 0 && <p className="sample-tier-note">
      当前 {brief.sampleCount}/{brief.memoryThreshold ?? 5} 条，还需 {brief.samplesUntilMemory} 条独立发布数据才能形成长期记忆。
    </p>}
    {brief.canConfirm && !confirmed && <button className="primary-button" type="button" disabled={busy} onClick={() => void confirm()}>
      {busy ? "正在确认…" : "确认并用于后续创作"}
    </button>}
    {error && <p className="workspace-notice workspace-notice-error" role="alert">{error}</p>}
    {confirmed && <>
      <p className="memory-confirmed" role="status"><CheckCircle size={19} weight="fill" />已形成不可变记忆 v{brief.confirmation.memoryVersion}</p>
      {onStartNextRound && <button className="primary-button" type="button" onClick={() => void onStartNextRound()}>用本次复盘生成下一条</button>}
    </>}
  </aside>
}

function lines(value: string) { return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean) }
