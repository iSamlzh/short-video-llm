"use client"

import Link from "next/link"
import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { CaretDown, Check, Plus, X } from "@phosphor-icons/react"
import type { WorkspaceContext } from "@/services/workspace-context-service"

type SwitchInput = { teamId?: string; ipId?: string; accountId?: string }

export function WorkspaceContextSwitcher({
  initialContext,
  switchContext = requestContextSwitch,
  canManageIps = false,
}: {
  initialContext: WorkspaceContext
  switchContext?: (input: SwitchInput) => Promise<WorkspaceContext>
  canManageIps?: boolean
}) {
  const router = useRouter()
  const [context, setContext] = useState(initialContext)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)

  function openDialog() {
    setError("")
    const dialog = dialogRef.current
    if (!dialog) return
    if (typeof dialog.showModal === "function") dialog.showModal()
    else dialog.setAttribute("open", "")
    closeRef.current?.focus()
  }

  function closeDialog() {
    const dialog = dialogRef.current
    if (dialog?.hasAttribute("open")) {
      if (typeof dialog.close === "function") dialog.close()
      else dialog.removeAttribute("open")
    }
    triggerRef.current?.focus()
  }

  async function select(input: SwitchInput) {
    if (busy) return
    setBusy(true)
    setError("")
    try {
      const next = await switchContext(input)
      setContext(next)
      closeDialog()
      router.refresh()
    } catch (value) {
      setError(value instanceof Error ? value.message : "暂时无法切换工作空间")
    } finally {
      setBusy(false)
    }
  }

  const ipLabel = context.ip?.label ?? "尚未建立 IP"
  const accountLabel = context.account?.label ?? "尚未绑定账号"

  return <div className="workspace-context-switcher">
    <span className="current-team-name">{context.team.label}</span>
    <button
      ref={triggerRef}
      className="workspace-context-trigger"
      type="button"
      aria-label={`切换当前 IP 和账号，当前 ${ipLabel}，${accountLabel}`}
      onClick={openDialog}
    >
      <span><small>当前 IP</small><strong>{ipLabel}</strong></span>
      <span className="context-account-label">{accountLabel}</span>
      <CaretDown size={16} aria-hidden="true" />
    </button>

    <dialog
      ref={dialogRef}
      className="workspace-context-dialog"
      aria-labelledby="workspace-context-title"
      aria-busy={busy}
      onCancel={(event) => { event.preventDefault(); closeDialog() }}
      onClick={(event) => { if (event.target === event.currentTarget) closeDialog() }}
    >
      <div className="workspace-context-dialog-body">
        <header>
          <div><p>当前工作上下文</p><h2 id="workspace-context-title">切换工作上下文</h2></div>
          <button ref={closeRef} className="context-dialog-close" type="button" aria-label="关闭工作上下文" onClick={closeDialog}><X size={20} aria-hidden="true" /></button>
        </header>

        {context.teams.length > 1 && <section aria-labelledby="context-team-heading">
          <h3 id="context-team-heading">团队</h3>
          <ul>{context.teams.map((team) => <li key={team.id}><button type="button" disabled={busy || team.id === context.team.id} aria-label={`切换到团队：${team.label}`} onClick={() => void select({ teamId: team.id })}>{team.label}{team.id === context.team.id && <Check size={17} aria-hidden="true" />}</button></li>)}</ul>
        </section>}

        <section aria-labelledby="context-ip-heading">
          <h3 id="context-ip-heading">选择 IP</h3>
          {context.ips.length > 0
            ? <ul>{context.ips.map((ip) => <li key={ip.id}><button type="button" disabled={busy || ip.id === context.ip?.id} aria-label={`切换到 IP：${ip.label}`} onClick={() => void select({ ipId: ip.id })}><span>{ip.label}</span>{ip.id === context.ip?.id && <><small>当前</small><Check size={17} aria-hidden="true" /></>}</button></li>)}</ul>
            : <p className="context-empty">当前团队还没有可用 IP。</p>}
        </section>

        {context.ip && <section aria-labelledby="context-account-heading">
          <h3 id="context-account-heading">{context.ip.label}的内容账号</h3>
          {context.accounts.length > 0
            ? <ul>{context.accounts.map((account) => <li key={account.id}><button type="button" disabled={busy || account.id === context.account?.id} aria-label={`切换到账号：${account.label}`} onClick={() => void select({ accountId: account.id })}><span>{account.label}</span>{account.id === context.account?.id && <><small>当前</small><Check size={17} aria-hidden="true" /></>}</button></li>)}</ul>
            : <p className="context-empty">这个 IP 尚未绑定可用内容账号。</p>}
        </section>}

        {error && <p className="context-switch-error" role="alert" aria-live="assertive">{error}</p>}
        <footer>{canManageIps && <Link href="/app/settings/ip" onClick={closeDialog}>管理 IP 与账号</Link>}<Link href="/app/setup/ip" onClick={closeDialog}><Plus size={17} aria-hidden="true" />新增 IP</Link><span>新 IP 建档不会影响当前内容</span></footer>
      </div>
    </dialog>
  </div>
}

async function requestContextSwitch(input: SwitchInput) {
  const response = await fetch("/api/app/context", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  })
  const payload = await response.json().catch(() => ({})) as WorkspaceContext & { message?: string }
  if (!response.ok) throw new Error(payload.message ?? "暂时无法切换工作空间")
  return payload
}
