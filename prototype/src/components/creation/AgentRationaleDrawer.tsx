"use client"

import { useEffect, useRef, useState } from "react"
import { X } from "@phosphor-icons/react"
import type { CreationDecisionBrief } from "../../domain/creation-contracts"

const repetitionLabels = {
  low: "低重复风险",
  medium: "中等重复风险",
  high: "高重复风险",
} as const

export function AgentRationaleDrawer({ brief }: { brief: CreationDecisionBrief }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open) {
      if (!dialog.open) {
        if (typeof dialog.showModal === "function") dialog.showModal()
        else dialog.setAttribute("open", "")
      }
      closeRef.current?.focus()
      return () => triggerRef.current?.focus()
    } else if (dialog.open) {
      if (typeof dialog.close === "function") dialog.close()
      else dialog.removeAttribute("open")
    }
  }, [open])

  function openDialog() {
    setOpen(true)
  }

  function closeDialog() {
    setOpen(false)
  }

  return <>
    <button ref={triggerRef} className="rationale-trigger" type="button" aria-expanded={open} aria-controls="agent-rationale-dialog" onClick={openDialog}>
      查看完整判断依据
    </button>
    {open && <dialog
      ref={dialogRef}
      id="agent-rationale-dialog"
      className="agent-rationale-dialog"
      aria-labelledby="rationale-dialog-title"
      onCancel={(event) => { event.preventDefault(); closeDialog() }}
      onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); closeDialog() } }}
      onClick={(event) => { if (event.target === event.currentTarget) closeDialog() }}
    >
      <div className="agent-rationale-panel">
        <header>
          <div>
            <p>Agent 判断记录</p>
            <h2 id="rationale-dialog-title">这次推荐依据</h2>
          </div>
          <button ref={closeRef} type="button" aria-label="关闭判断依据" onClick={closeDialog}><X size={20} aria-hidden="true" /></button>
        </header>
        <section aria-labelledby="evidence-heading">
          <h3 id="evidence-heading">来自当前 IP 的已确认信息</h3>
          <ul className="rationale-evidence-list">
            {brief.ipEvidenceRefs.map((reference) => <li key={reference.sourceAnswerId}>
              <strong>{reference.label}</strong>
              <span>{reference.sourceAnswerId.startsWith("memory:") ? "账号已确认复盘" : "IP 建档回答"}</span>
            </li>)}
          </ul>
        </section>
        <section className="rationale-risk" aria-labelledby="risk-heading">
          <h3 id="risk-heading">重复性判断</h3>
          <p>{repetitionLabels[brief.repetitionRisk]}</p>
        </section>
        <section className="rationale-data" aria-labelledby="data-heading">
          <h3 id="data-heading">历史表现使用情况</h3>
          <p>{brief.recentDataStatus === "available" ? brief.recentDataSummary : "尚未使用历史表现"}</p>
        </section>
      </div>
    </dialog>}
  </>
}
