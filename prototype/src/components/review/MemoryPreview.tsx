"use client"

import { useEffect, useState } from "react"
import { CheckCircle, LockKey } from "@phosphor-icons/react"

export function MemoryPreview({ brief, onConfirm }: { brief: any; onConfirm?: (input: { keep: string[]; avoid: string[]; nextContentSignals: string[] }) => Promise<void> | void }) {
  const [keep, setKeep] = useState(brief.payload.keep.join("\n"))
  const [avoid, setAvoid] = useState(brief.payload.avoid.join("\n"))
  const [signals, setSignals] = useState(brief.payload.nextContentSignals.join("\n"))
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => { setKeep(brief.payload.keep.join("\n")); setAvoid(brief.payload.avoid.join("\n")); setSignals(brief.payload.nextContentSignals.join("\n")); setConfirmed(false) }, [brief.id, brief.version, brief.payload])
  async function confirm() { setBusy(true); try { await onConfirm?.({ keep: lines(keep), avoid: lines(avoid), nextContentSignals: lines(signals) }); setConfirmed(true) } finally { setBusy(false) } }
  return <aside className="evidence-rail memory-preview"><h2><LockKey size={21} />本账号的私有创作记忆</h2><p>只作用于当前团队 / IP / 内容账号，不会改动平台模板或通用策略。</p><label>继续保留<textarea aria-label="继续保留" value={keep} onChange={(event) => setKeep(event.target.value)} /></label><label>尽量避免<textarea aria-label="尽量避免" value={avoid} onChange={(event) => setAvoid(event.target.value)} /></label><label>下一轮信号<textarea aria-label="下一轮信号" value={signals} onChange={(event) => setSignals(event.target.value)} /></label><section className="memory-evidence-limit"><h3>证据边界（只读）</h3><p>{brief.evidenceLimits ?? brief.payload.evidenceLimits}</p></section>{brief.canConfirm && !confirmed && <button className="primary-button" type="button" disabled={busy} onClick={() => void confirm()}>{busy ? "正在确认…" : "确认并用于后续创作"}</button>}{confirmed && <p className="memory-confirmed" role="status"><CheckCircle size={19} weight="fill" />已形成不可变记忆 v{brief.version}</p>}</aside>
}

function lines(value: string) { return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean) }
