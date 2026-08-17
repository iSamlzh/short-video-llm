"use client"

import { useEffect, useMemo, useState } from "react"
import { CheckCircle, Plus, X } from "@phosphor-icons/react"

export type PublicationAccount = { id: string; label: string; platform: string }
export type PublicationRecord = {
  id: string
  contentAccountId: string
  platform: string
  platformVideoId?: string | null
  videoUrl?: string | null
  publishedAt: string
}

type SaveInput = {
  runId: string
  lockedVersion: number
  contentAccountId: string
  identity: string
  publishedAt: string
}

type Props = {
  runId: string
  lockedVersion: number
  accounts: PublicationAccount[]
  save: (input: SaveInput) => Promise<PublicationRecord>
  load?: () => Promise<PublicationRecord[]>
}

export function PublicationReceipt({ runId, lockedVersion, accounts, save, load }: Props) {
  const [records, setRecords] = useState<PublicationRecord[]>([])
  const [open, setOpen] = useState(false)
  const [identity, setIdentity] = useState("")
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "")
  const [publishedAt, setPublishedAt] = useState(localDateTimeValue())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const usedAccountIds = useMemo(() => new Set(records.map((item) => item.contentAccountId)), [records])

  useEffect(() => {
    if (!load) return
    let active = true
    void load().then((items) => { if (active) setRecords(items) }).catch(() => undefined)
    return () => { active = false }
  }, [load])

  function beginAdditional() {
    const next = accounts.find((account) => !usedAccountIds.has(account.id)) ?? accounts[0]
    setAccountId(next?.id ?? "")
    setIdentity("")
    setPublishedAt(localDateTimeValue())
    setError("")
    setOpen(true)
  }

  async function submit() {
    if (!identity.trim()) { setError("请填写作品 ID 或视频链接"); return }
    if (!accountId) { setError("当前没有可记录的发布账号"); return }
    setSaving(true)
    setError("")
    try {
      const record = await save({
        runId,
        lockedVersion,
        contentAccountId: accountId,
        identity: identity.trim(),
        publishedAt: new Date(publishedAt).toISOString(),
      })
      setRecords((current) => current.some((item) => item.id === record.id) ? current : [...current, record])
      setOpen(false)
      setIdentity("")
    } catch (value) {
      setError(value instanceof Error ? value.message : "保存失败，请重试")
    } finally {
      setSaving(false)
    }
  }

  return <section className="publication-receipt" aria-labelledby="publication-receipt-title">
    {!open && records.length === 0 && <div className="publication-receipt-prompt">
      <div><p id="publication-receipt-title">这条视频已经发布了吗？</p><span>记录后，真实表现会自动回到这篇锁稿。</span></div>
      <button type="button" onClick={() => setOpen(true)} disabled={!accounts.length}>记录已发布</button>
    </div>}

    {!open && records.length > 0 && <div className="publication-records" role="status" aria-live="polite">
      {records.map((record) => {
        const account = accounts.find((item) => item.id === record.contentAccountId)
        return <div className="publication-record" key={record.id}>
          <CheckCircle size={20} weight="fill" />
          <span><strong>{account?.label ?? platformLabel(record.platform)} · 已关联发布</strong><small>{formatPublishedAt(record.publishedAt)} · {record.platformVideoId ?? "视频链接已记录"}</small></span>
        </div>
      })}
      <button className="publication-additional" type="button" onClick={beginAdditional}><Plus size={17} />增加其他账号发布</button>
    </div>}

    {open && <div className="publication-receipt-form">
      <div className="publication-form-heading"><div><p id="publication-receipt-title">记录真实发布</p><span>只需一次，后续导入数据会自动匹配。</span></div><button type="button" aria-label="取消记录发布" onClick={() => { setOpen(false); setError("") }}><X size={19} /></button></div>
      <label>发布账号<select aria-label="发布账号" value={accountId} onChange={(event) => setAccountId(event.target.value)}>{accounts.map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}</select></label>
      <label>作品 ID 或视频链接<input aria-label="作品 ID 或视频链接" value={identity} onChange={(event) => setIdentity(event.target.value)} placeholder="例如 wx-100，或粘贴视频链接" /></label>
      <label>发布时间<input aria-label="发布时间" type="datetime-local" value={publishedAt} onChange={(event) => setPublishedAt(event.target.value)} /></label>
      {error && <p className="publication-error" role="status">{error}</p>}
      <div className="publication-form-actions"><button type="button" className="secondary-button" onClick={() => { setOpen(false); setError("") }}>取消</button><button type="button" className="primary-button" disabled={saving} onClick={() => void submit()}>{saving ? "正在保存…" : error ? "重新保存" : "保存发布记录"}</button></div>
    </div>}
  </section>
}

function localDateTimeValue(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function formatPublishedAt(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value))
}

function platformLabel(platform: string) {
  return platform === "wechat_channels" ? "视频号" : platform === "douyin" ? "抖音" : platform
}
