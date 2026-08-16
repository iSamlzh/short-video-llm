"use client"

import { useState } from "react"

type ScriptItem = {
  id: string
  title: string
  hook: string
  body: string
  estimatedSeconds: number
}

export function ScriptCandidateList({ items, pending, onConfirm }: { items: ScriptItem[]; pending: boolean; onConfirm: (item: ScriptItem) => void }) {
  const [selectedId, setSelectedId] = useState(items[0]?.id ?? "")
  const selected = items.find((item) => item.id === selectedId)

  return <>
    <div className="script-list">{items.map((item, index) => <label className={`script-row ${item.id === selectedId ? "selected" : ""}`} key={item.id}>
      <input type="radio" name="script-candidate" value={item.id} checked={item.id === selectedId} onChange={() => setSelectedId(item.id)} aria-label={`${item.title}，${item.hook}`} />
      <span className="script-index">版本 {index + 1}</span>
      <span className="script-copy"><small>约 {item.estimatedSeconds} 秒</small><strong>{item.title}</strong><b>{item.hook}</b><p>{item.body}</p></span>
    </label>)}</div>
    <div className="stage-actions"><span>选择后将自动进入独立质量检查</span><button className="primary-action" type="button" disabled={pending || !selected} onClick={() => selected && onConfirm(selected)}>选择这版并进入质检</button></div>
  </>
}
