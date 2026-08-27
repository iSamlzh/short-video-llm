"use client"

import { ArrowClockwise, ArrowRight, CopySimple, DownloadSimple, FileText, MagnifyingGlass, X } from "@phosphor-icons/react"
import { FormEvent, useState } from "react"
import { replaceDocument } from "@/lib/client-navigation"
import type { ContentHistoryService } from "@/services/content-history-service"

type HistoryList = ReturnType<ContentHistoryService["list"]>
type HistoryItem = HistoryList["items"][number]
type HistoryDetail = ReturnType<ContentHistoryService["detail"]>

const statusLabels = {
  topic_ready: "已有选题",
  draft: "待定稿",
  locked: "已定稿",
  published: "已发布",
  reviewed: "已复盘",
} as const

export function ContentHistoryWorkspace({ initial, initialQuery = { ipId: "", accountId: "" } }: {
  initial: HistoryList
  initialQuery?: { ipId: string; accountId: string }
}) {
  const [result, setResult] = useState(initial)
  const [detail, setDetail] = useState<HistoryDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState("")
  const [query, setQuery] = useState({ keyword: "", ipId: initialQuery.ipId, accountId: initialQuery.accountId, status: "", from: "", to: "" })

  async function search(page = 1) {
    setLoading(true); setNotice("")
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(result.pageSize) })
      Object.entries(query).forEach(([key, value]) => { if (value) params.set(key, value) })
      setResult(await read(fetch(`/api/app/content?${params}`)))
    } catch (error) { setNotice(messageOf(error)) }
    finally { setLoading(false) }
  }

  async function open(item: HistoryItem) {
    setLoading(true); setNotice("")
    try { setDetail(await read(fetch(`/api/app/content/${encodeURIComponent(item.runId)}`))) }
    catch (error) { setNotice(messageOf(error)) }
    finally { setLoading(false) }
  }

  async function recreate() {
    if (!detail) return
    setLoading(true); setNotice("Agent 正在参考这篇内容生成新的表达，历史稿件不会被修改…")
    try {
      const operationKey = crypto.randomUUID()
      const pool = await read(fetch("/api/app/creation/topics", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": `${operationKey}:topics` },
        body: JSON.stringify({ intent: "change_expression", fromRunId: detail.runId }),
      }))
      await read(fetch("/api/app/creation/scripts", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": `${operationKey}:script` },
        body: JSON.stringify({
          runId: pool.runId,
          topicId: pool.recommendedTopicId,
          intent: "change_expression",
          fromRunId: detail.runId,
        }),
      }))
      replaceDocument("/app/today")
    } catch (error) { setNotice(messageOf(error)); setLoading(false) }
  }

  async function openReview() {
    if (!detail?.accountId) return
    setLoading(true); setNotice("")
    try {
      await read(fetch("/api/app/context", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountId: detail.accountId }),
      }))
      replaceDocument("/app/review")
    } catch (error) { setNotice(messageOf(error)); setLoading(false) }
  }

  function submit(event: FormEvent) { event.preventDefault(); void search(1) }

  return <main className="content-history-page">
    <header className="content-history-heading">
      <div><p className="eyebrow">内容资产</p><h1>每一篇稿，都保留它为什么产生。</h1><p>按 IP、账号和阶段找回内容；画像、结构、记忆、发布与复盘依据不会随当前配置变化。</p></div>
      <a className="primary-button" href="/app/today">开始今天的创作 <ArrowRight size={17} /></a>
    </header>

    <form className="content-history-filters" onSubmit={submit}>
      <label className="history-keyword"><span>搜索内容</span><div><MagnifyingGlass size={17} /><input value={query.keyword} onChange={(event) => setQuery({ ...query, keyword: event.target.value })} placeholder="标题、选题或 IP" /></div></label>
      <label><span>IP</span><select value={query.ipId} onChange={(event) => setQuery({ ...query, ipId: event.target.value, accountId: "" })}><option value="">全部 IP</option>{result.filters.ips.map((ip) => <option key={ip.id} value={ip.id}>{ip.label}{ip.status === "disabled" ? "（已归档）" : ""}</option>)}</select></label>
      <label><span>账号</span><select value={query.accountId} onChange={(event) => setQuery({ ...query, accountId: event.target.value })}><option value="">全部账号</option>{result.filters.accounts.filter((account) => !query.ipId || account.ipId === query.ipId).map((account) => <option key={account.id} value={account.id}>{platformLabel(account.platform)}｜{account.label}{account.status === "disabled" ? "（已归档）" : ""}</option>)}</select></label>
      <label><span>阶段</span><select value={query.status} onChange={(event) => setQuery({ ...query, status: event.target.value })}><option value="">全部阶段</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label><span>开始日期</span><input type="date" value={query.from} onChange={(event) => setQuery({ ...query, from: event.target.value })} /></label>
      <label><span>结束日期</span><input type="date" value={query.to} onChange={(event) => setQuery({ ...query, to: event.target.value })} /></label>
      <button className="secondary-button" disabled={loading} type="submit">筛选</button>
    </form>
    {notice && <p className="workspace-notice workspace-notice-error" role="alert">{notice}</p>}

    <section className="content-history-layout">
      <div className="history-stream" aria-busy={loading}>
        <div className="history-stream-summary"><strong>{result.total}</strong><span>篇内容记录</span></div>
        {result.items.length ? result.items.map((item) => <button className={`history-card ${detail?.runId === item.runId ? "is-active" : ""}`} key={item.runId} onClick={() => void open(item)} type="button">
          <span className={`history-status history-status-${item.status}`}>{statusLabels[item.status]}</span>
          <span className="history-card-date">{item.businessDate}</span>
          <strong>{item.title}</strong>
          <span className="history-topic">选题：{item.topicTitle}</span>
          <span className="history-card-meta">{item.ipName} · {item.accountLabel} · {item.currentRevision ? `文稿 v${item.currentRevision}` : "待生成文稿"}</span>
        </button>) : <div className="history-empty"><FileText size={28} /><h2>还没有符合条件的内容</h2><p>调整筛选，或从今天的选题开始第一篇。</p></div>}
        {result.totalPages > 1 && <nav className="history-pagination" aria-label="内容记录分页"><button disabled={result.page <= 1 || loading} onClick={() => void search(result.page - 1)}>上一页</button><span>{result.page} / {result.totalPages}</span><button disabled={result.page >= result.totalPages || loading} onClick={() => void search(result.page + 1)}>下一页</button></nav>}
      </div>
      <HistoryDetailPanel detail={detail} loading={loading} onClose={() => setDetail(null)} onRecreate={() => void recreate()} onOpenReview={() => void openReview()} />
    </section>
  </main>
}

function HistoryDetailPanel({ detail, loading, onClose, onRecreate, onOpenReview }: {
  detail: HistoryDetail | null
  loading: boolean
  onClose: () => void
  onRecreate: () => void
  onOpenReview: () => void
}) {
  if (!detail) return <aside className="history-detail history-detail-empty"><span>选择一篇内容</span><h2>查看它从哪里来，又走到了哪里。</h2><p>这里会显示文稿版本、当时采用的画像与结构，以及发布和复盘结果。</p></aside>
  const currentRevision = detail.revisions.find((revision) => revision.isCurrent) ?? detail.revisions[0]
  return <aside className="history-detail">
    <header><div><span className={`history-status history-status-${detail.status}`}>{statusLabels[detail.status]}</span><h2>{detail.title}</h2><p>{detail.ipName} · {detail.accountLabel} · {detail.businessDate}</p></div><button aria-label="关闭内容详情" onClick={onClose}><X size={18} /></button></header>
    <div className="history-detail-actions">
      {detail.canRecreate && <button className="primary-button" disabled={loading} onClick={onRecreate}><ArrowClockwise size={18} />参考这篇再创作</button>}
      {detail.canDownload && <a className="secondary-button" href={`/api/app/creation/runs/${encodeURIComponent(detail.runId)}/download`}><DownloadSimple size={18} />下载定稿</a>}
      {detail.canOpenReview && <button className="secondary-button" disabled={loading} onClick={onOpenReview}>查看对应复盘</button>}
      {currentRevision && <button className="tertiary-action" type="button" onClick={() => void navigator.clipboard.writeText(currentRevision.segments.filter((segment) => segment.kind === "spoken").map((segment) => segment.text).join("\n\n"))}><CopySimple size={16} />复制正文</button>}
    </div>
    <p className="history-safety-note">再创作会新建内容记录，这篇及其历史版本不会被覆盖。</p>

    {currentRevision && <section className="history-script-preview"><div className="history-section-heading"><span>当前文稿</span><strong>v{currentRevision.revision}{currentRevision.locked ? " · 已定稿" : ""}</strong></div>{currentRevision.segments.filter((segment) => segment.kind === "spoken").map((segment, index) => <article key={segment.id}><span>{String(index + 1).padStart(2, "0")}</span><div><h3>{segment.heading}</h3><p>{segment.text}</p></div></article>)}</section>}

    <details open className="history-lineage"><summary>生成依据</summary><dl>
      <div><dt>IP 画像</dt><dd>{detail.profileSnapshot?.displayName ?? detail.ipName} · v{detail.lineage.profileVersion ?? "历史快照"}</dd></div>
      <div><dt>内容结构</dt><dd>{detail.lineage.structureVersions.length ? detail.lineage.structureVersions.map((item) => `${item.name}${item.version ? ` v${item.version}` : ""}`).join("、") : "未使用结构模板"}</dd></div>
      <div><dt>私有记忆</dt><dd>{detail.lineage.memory ? `v${detail.lineage.memory.version}，来自已确认复盘` : "本次未使用复盘记忆"}</dd></div>
      <div><dt>创建方式</dt><dd>{detail.lineage.triggerType === "review_followup" ? "由复盘结论开启下一轮" : "日常创作"}</dd></div>
    </dl></details>

    <details className="history-versions"><summary>文稿版本（{detail.revisions.length}）</summary>{detail.revisions.map((revision) => <div key={revision.revision}><strong>v{revision.revision}</strong><span>{revision.locked ? `定稿 v${revision.lockedVersion}` : revision.isCurrent ? "当前版本" : "历史版本"}</span><time>{formatDateTime(revision.createdAt)}</time></div>)}</details>

    <details open={detail.publications.length > 0} className="history-outcomes"><summary>发布与真实表现（{detail.publications.length}）</summary>{detail.publications.length ? detail.publications.map((publication) => <article key={publication.id}><strong>{platformLabel(publication.platform)} · {publication.title}</strong><span>{formatDateTime(publication.publishedAt)}</span>{publication.metrics ? <dl><div><dt>播放</dt><dd>{numberText(publication.metrics.plays)}</dd></div><div><dt>完播率</dt><dd>{publication.metrics.completionRate == null ? "—" : `${Math.round(publication.metrics.completionRate * 100)}%`}</dd></div><div><dt>互动</dt><dd>{numberText((publication.metrics.likes ?? 0) + (publication.metrics.comments ?? 0) + (publication.metrics.saves ?? 0) + (publication.metrics.shares ?? 0))}</dd></div></dl> : <p>尚未回流真实平台数据</p>}</article>) : <p>尚未登记发布。</p>}</details>

    {detail.reviews.length > 0 && <details open className="history-reviews"><summary>复盘结论（{detail.reviews.length}）</summary>{detail.reviews.map((review) => <article key={review.id}><strong>复盘 v{review.version} · {review.status === "confirmed" ? "已确认" : "待确认"}</strong><p>{review.summary}</p></article>)}</details>}
  </aside>
}

async function read(promise: Promise<Response>) { const response = await promise; const body = await response.json(); if (!response.ok) throw new Error(body.message || body.errorCode || "请求失败"); return body }
function messageOf(error: unknown) { return error instanceof Error ? error.message : "操作失败，请稍后重试" }
function platformLabel(value: string) { return value === "wechat_channels" ? "视频号" : value === "douyin" ? "抖音" : value === "xiaohongshu" ? "小红书" : value === "kuaishou" ? "快手" : value }
function formatDateTime(value: string) { return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) }
function numberText(value: number | null) { return value == null ? "—" : new Intl.NumberFormat("zh-CN", { notation: "compact" }).format(value) }
