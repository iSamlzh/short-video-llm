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
        <section className="rationale-portrait-fit" aria-labelledby="evidence-heading">
          <h3 id="evidence-heading">画像匹配依据</h3>
          <p>{(brief.portraitFitSummary
            ?? brief.ipEvidenceRefs.map((reference) => reference.relevance).filter(Boolean).join("；"))
            || "画像显示当前 IP 具备与这条选题相关的真实经历和表达基础。"}</p>
        </section>
        <section className="rationale-reasoning" aria-labelledby="reasoning-heading">
          <h3 id="reasoning-heading">选题推导</h3>
          <dl>
            <div><dt>推荐结论</dt><dd>{brief.recommendationSummary ?? brief.whyToday}</dd></div>
            <div><dt>受众卡点</dt><dd>{brief.audienceProblem}</dd></div>
            <div><dt>选题切入</dt><dd>{brief.topicOpportunity ?? brief.whyToday}</dd></div>
            <div><dt>内容目标</dt><dd>{brief.objective}</dd></div>
          </dl>
        </section>
        {brief.structureChoice && <section className="rationale-structure" aria-labelledby="structure-heading">
          <h3 id="structure-heading">结构选择</h3>
          <strong>{brief.structureChoice.structureName}</strong>
          <p>{brief.structureChoice.reason}</p>
        </section>}
        <section className="rationale-validation" aria-labelledby="validation-heading">
          <h3 id="validation-heading">验证与风险</h3>
          <dl>
            <div><dt>重复性判断</dt><dd>{repetitionLabels[brief.repetitionRisk]}</dd></div>
            <div><dt>历史表现</dt><dd>{brief.recentDataStatus === "available" ? brief.recentDataSummary : "尚未使用历史表现"}</dd></div>
            <div><dt>发布后观察</dt><dd>{brief.nextSignal}</dd></div>
          </dl>
        </section>
      </div>
    </dialog>}
  </>
}
