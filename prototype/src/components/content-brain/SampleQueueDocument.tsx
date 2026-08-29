"use client"

import { useEffect, useMemo, useState } from "react"
import { ArrowClockwise, CaretRight, CheckSquare, Clock, Funnel, MagnifyingGlass, WarningCircle } from "@phosphor-icons/react"
import type { SampleQueueFilters, SampleQueueItem, SampleQueueName, SampleQueuePage } from "./types"

const queueOptions: Array<{ value: SampleQueueName; label: string }> = [
  { value: "todo", label: "待处理" },
  { value: "waiting_analysis", label: "待拆解" },
  { value: "running", label: "拆解中" },
  { value: "review_required", label: "待复核" },
  { value: "decision_required", label: "待决策" },
  { value: "failed", label: "异常" },
  { value: "completed", label: "已完成" },
  { value: "rejected", label: "已驳回" },
  { value: "all", label: "全部" },
]

export function SampleQueueDocument({ page, filters, loading, error, onFiltersChange, onLoadMore, onOpenSample, onRetryMany }: {
  page: SampleQueuePage
  filters: SampleQueueFilters
  loading: boolean
  error: string
  onFiltersChange: (filters: SampleQueueFilters) => void | Promise<void>
  onLoadMore: () => void | Promise<void>
  onOpenSample: (sampleId: string) => void | Promise<void>
  onRetryMany: (jobIds: string[]) => void | Promise<void>
}) {
  const [query, setQuery] = useState(filters.q ?? "")
  const [sourcePlatform, setSourcePlatform] = useState(filters.sourcePlatform ?? "")
  const [batchId, setBatchId] = useState(filters.batchId ?? "")
  const [from, setFrom] = useState(filters.from ?? "")
  const [to, setTo] = useState(filters.to ?? "")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const retryableJobs = useMemo(() => page.items
    .filter((item) => item.workStage === "failed" && item.latestJob?.retryable)
    .map((item) => item.latestJob!.id), [page.items])

  useEffect(() => {
    setSelected((current) => new Set([...current].filter((id) => retryableJobs.includes(id))))
  }, [retryableJobs.join("|")])

  function applyFilters(event: React.FormEvent) {
    event.preventDefault()
    void onFiltersChange({
      queue: filters.queue,
      q: query.trim() || undefined,
      sourcePlatform: sourcePlatform || undefined,
      batchId: batchId.trim() || undefined,
      from: from || undefined,
      to: to || undefined,
      limit: filters.limit ?? 50,
    })
  }

  function clearFilters() {
    setQuery(""); setSourcePlatform(""); setBatchId(""); setFrom(""); setTo("")
    void onFiltersChange({ queue: filters.queue, limit: filters.limit ?? 50 })
  }

  const hasFilters = Boolean(filters.q || filters.sourcePlatform || filters.batchId || filters.from || filters.to)
  return <section className="brain-sample-index brain-queue-index">
    <header className="brain-queue-heading">
      <div><span className="brain-kicker">平台内容工作队列</span><h1>今天先处理这些</h1><p>Agent 自动推进拆解，人工只处理复核、决策和异常。最早进入队列的样本不会被新导入内容淹没。</p></div>
      <span>{page.counts.todo} 条待处理</span>
    </header>

    <nav className="brain-queue-tabs" aria-label="样本工作阶段">
      {queueOptions.map((option) => <button key={option.value} aria-current={filters.queue === option.value ? "page" : undefined} onClick={() => {
        setSelected(new Set())
        void onFiltersChange({ ...filters, queue: option.value, cursor: undefined })
      }}><span>{option.label}</span><strong>{page.counts[option.value]}</strong></button>)}
    </nav>

    <form className="brain-queue-filters" onSubmit={applyFilters}>
      <label className="brain-queue-search"><MagnifyingGlass size={17} /><span className="brain-visually-hidden">搜索标题、作者或来源链接</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、作者或来源链接" /></label>
      <label><span className="brain-visually-hidden">来源平台</span><select value={sourcePlatform} onChange={(event) => setSourcePlatform(event.target.value)}><option value="">全部平台</option><option value="wechat_channels">视频号</option><option value="douyin">抖音</option><option value="xiaohongshu">小红书</option><option value="other">其他</option></select></label>
      <label><span className="brain-visually-hidden">导入批次</span><input value={batchId} onChange={(event) => setBatchId(event.target.value)} placeholder="导入批次" /></label>
      <label><span className="brain-visually-hidden">开始日期</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      <label><span className="brain-visually-hidden">结束日期</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      <button className="brain-button-secondary" type="submit" disabled={loading}><Funnel size={17} />筛选</button>
      {hasFilters && <button className="brain-text-button" type="button" onClick={clearFilters}>清除</button>}
    </form>

    {selected.size > 0 && <div className="brain-queue-selection" role="status"><span><CheckSquare size={18} />已选择 {selected.size} 条可重试异常</span><button className="brain-button-primary" disabled={loading} onClick={() => void onRetryMany([...selected])}><ArrowClockwise size={17} />重新拆解</button></div>}
    {error && <p className="brain-inline-error" role="alert">{error}</p>}

    {page.items.length ? <div className="brain-queue-list" aria-busy={loading}>{page.items.map((item) => <QueueRow key={item.id} item={item} selected={Boolean(item.latestJob && selected.has(item.latestJob.id))} onSelect={(checked) => {
      if (!item.latestJob) return
      setSelected((current) => { const next = new Set(current); if (checked) next.add(item.latestJob!.id); else next.delete(item.latestJob!.id); return next })
    }} onOpen={() => onOpenSample(item.id)} />)}</div> : <section className="brain-empty-state brain-queue-empty">
      {filters.queue === "failed" ? <WarningCircle size={32} /> : <Clock size={32} />}
      <h2>{emptyTitle(filters.queue)}</h2>
      <p>{hasFilters ? "当前筛选条件下没有样本，可以清除条件或切换工作阶段。" : emptyDescription(filters.queue)}</p>
      {hasFilters && <button className="brain-button-secondary" onClick={clearFilters}>清除筛选条件</button>}
    </section>}

    {page.nextCursor && <footer className="brain-queue-more"><button className="brain-button-secondary" disabled={loading} onClick={() => void onLoadMore()}>{loading ? "正在读取" : "加载更多"}</button></footer>}
  </section>
}

function QueueRow({ item, selected, onSelect, onOpen }: { item: SampleQueueItem; selected: boolean; onSelect: (checked: boolean) => void; onOpen: () => void | Promise<void> }) {
  const canRetry = item.workStage === "failed" && item.latestJob?.retryable
  return <article className={`brain-queue-row is-${item.workStage}`}>
    <div className="brain-queue-row-select">{canRetry ? <label><input type="checkbox" checked={selected} onChange={(event) => onSelect(event.target.checked)} /><span className="brain-visually-hidden">选择 {item.title}</span></label> : <span />}</div>
    <button className="brain-queue-row-main" onClick={onOpen}>
      <span className="brain-queue-row-title"><strong>{item.title}</strong><small>{sourceLabel(item.sourcePlatform)} · {formatTime(item.createdAt)}{item.latestJob?.batchId ? ` · 批次 ${shortBatch(item.latestJob.batchId)}` : ""}</small></span>
      <span className="brain-queue-row-progress"><em>{stageLabel(item.workStage)}</em><small>{progressText(item)}</small></span>
      <span className="brain-queue-row-action">{actionLabel(item.workStage)}<CaretRight size={17} /></span>
    </button>
  </article>
}

function progressText(item: SampleQueueItem) {
  if (item.latestJob?.progressMessage) return item.latestJob.progressMessage
  if (item.workStage === "waiting_analysis") return "等待 Agent 接手"
  if (item.workStage === "review_required") return "拆解完成，等待人工复核"
  if (item.workStage === "decision_required") return "结构候选等待人工决策"
  if (item.workStage === "completed") return "结构已经启用"
  return "样本状态已更新"
}

function stageLabel(stage: SampleQueueItem["workStage"]) {
  return ({ waiting_analysis: "待拆解", running: "拆解中", review_required: "待复核", decision_required: "待决策", failed: "异常", completed: "已完成", rejected: "已驳回" })[stage]
}

function actionLabel(stage: SampleQueueItem["workStage"]) {
  return ({ waiting_analysis: "查看排队", running: "查看进度", review_required: "复核拆解", decision_required: "决策结构", failed: "查看异常", completed: "查看档案", rejected: "查看记录" })[stage]
}

function emptyTitle(queue: SampleQueueName) {
  return ({ todo: "没有待处理样本", waiting_analysis: "没有等待拆解的样本", running: "当前没有正在拆解的样本", review_required: "没有等待复核的样本", decision_required: "没有等待决策的候选", failed: "当前没有异常任务", completed: "还没有已完成样本", rejected: "还没有已驳回样本", all: "还没有爆款样本" })[queue]
}

function emptyDescription(queue: SampleQueueName) {
  return queue === "todo" ? "新增或导入样本后，Agent 会自动进入拆解队列。" : "切换其他工作阶段，或新增一条真实爆款样本。"
}

function sourceLabel(value: string) {
  return ({ wechat_channels: "视频号", douyin: "抖音", xiaohongshu: "小红书", other: "其他" } as Record<string, string>)[value] ?? value
}

function formatTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "时间未知"
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date)
}

function shortBatch(value: string) {
  return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value
}
