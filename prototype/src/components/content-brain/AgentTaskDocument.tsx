"use client"

import { useEffect, useState } from "react"
import { ArrowClockwise, Check, Circle, Clock, Warning } from "@phosphor-icons/react"
import type { AgentJob } from "./types"

const stages = [
  { key: "queued", label: "任务已进入队列" },
  { key: "source_validation", label: "检查样本与来源" },
  { key: "structure_analysis", label: "识别爆款结构" },
  { key: "evidence_validation", label: "校验证据引用" },
  { key: "persistence", label: "保存拆解结果" },
  { key: "review_ready", label: "等待运营复核" },
] as const

export function AgentTaskDocument({ job, sampleTitle, onStart, onRetry, pending = false }: {
  job?: AgentJob
  sampleTitle: string
  onStart: () => void
  onRetry: (jobId: string) => void
  pending?: boolean
}) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!job || !["queued", "running"].includes(job.status)) return
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [job])

  if (!job) return <section className="brain-agent-task">
    <header className="brain-document-heading"><div><span className="brain-kicker">{sampleTitle}</span><h1>准备拆解内容</h1><p>Agent 会识别结构、核验证据，再把结论交给运营复核。</p></div></header>
    <div className="brain-agent-idle"><Circle size={22} /><div><strong>尚未开始拆解</strong><p>任务开始后可以离开页面，后台会继续执行。</p></div></div>
    <footer className="brain-document-actions"><button className="brain-button-primary" disabled={pending} onClick={onStart}>{pending ? "正在创建任务" : "开始拆解"}</button></footer>
  </section>

  const terminalFailure = ["failed", "timed_out", "cancelled"].includes(job.status)
  const elapsed = elapsedText(job.startedAt ?? job.createdAt, job.finishedAt, now)
  const currentIndex = stages.findIndex((stage) => stage.key === job.stage)
  const safeIndex = currentIndex < 0 ? (job.status === "succeeded" ? stages.length - 1 : 0) : currentIndex

  return <section className="brain-agent-task" aria-live="polite">
    <header className="brain-document-heading">
      <div><span className="brain-kicker">{sampleTitle}</span><h1>{terminalFailure ? "拆解没有完成" : job.status === "succeeded" ? "拆解已经完成" : "Agent 正在拆解这条内容"}</h1><p>{job.progressMessage}</p></div>
      <span className="brain-agent-elapsed"><Clock size={17} />{elapsed}</span>
    </header>
    <ol className="brain-agent-stages">
      {stages.map((stage, index) => {
        const complete = job.status === "succeeded" || index < safeIndex
        const current = !terminalFailure && job.status !== "succeeded" && index === safeIndex
        const failed = terminalFailure && index === safeIndex
        return <li key={stage.key} className={complete ? "is-complete" : current ? "is-current" : failed ? "is-failed" : ""}>
          <span>{complete ? <Check size={16} weight="bold" /> : failed ? <Warning size={16} weight="fill" /> : <Circle size={14} weight={current ? "fill" : "regular"} />}</span>
          <div><strong>{stage.label}</strong>{current && <small>{job.progressMessage}</small>}</div>
        </li>
      })}
    </ol>
    {!terminalFailure && job.status !== "succeeded" && <p className="brain-agent-leave-note">通常需要 20～90 秒。你可以离开本页面，任务会继续运行。</p>}
    {terminalFailure && <div className="brain-agent-failure" role="alert"><Warning size={20} /><div><strong>{job.progressMessage}</strong><p>错误标识：{job.errorCode ?? "AGENT_JOB_FAILED"}</p></div></div>}
    {terminalFailure && job.retryable && <footer className="brain-document-actions"><button className="brain-button-primary" disabled={pending} onClick={() => onRetry(job.id)}><ArrowClockwise size={18} />{pending ? "正在重新排队" : "重新拆解"}</button></footer>}
  </section>
}

export function AgentQueueSummary({ jobs }: { jobs: AgentJob[] }) {
  const latestBatchId = jobs.filter((job) => job.batchId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.batchId
  const relevant = latestBatchId ? latestByResource(jobs.filter((job) => job.batchId === latestBatchId)) : []
  if (relevant.length < 2) return null
  const succeeded = relevant.filter((job) => job.status === "succeeded").length
  const running = relevant.filter((job) => job.status === "running").length
  const queued = relevant.filter((job) => job.status === "queued").length
  const failed = relevant.filter((job) => ["failed", "timed_out", "cancelled"].includes(job.status)).length
  return <section className="brain-queue-summary" aria-label="爆款样本拆解进度">
    <div><span>爆款样本拆解</span><strong>{succeeded} / {relevant.length} 已完成</strong></div>
    <p>{running} 条处理中 · {queued} 条等待中{failed ? ` · ${failed} 条需要处理` : ""}</p>
    <div className="brain-queue-track"><span style={{ width: `${Math.round(succeeded / relevant.length * 100)}%` }} /></div>
  </section>
}

export function latestJobForResource(jobs: AgentJob[], resourceId: string) {
  return jobs.filter((job) => job.resourceId === resourceId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
}

function latestByResource(jobs: AgentJob[]) {
  const map = new Map<string, AgentJob>()
  for (const job of [...jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    if (!map.has(job.resourceId)) map.set(job.resourceId, job)
  }
  return [...map.values()]
}

function elapsedText(start: string, finish: string | null | undefined, now: number) {
  const seconds = Math.max(0, Math.floor(((finish ? new Date(finish).getTime() : now) - new Date(start).getTime()) / 1_000))
  if (seconds < 60) return `已运行 ${seconds} 秒`
  return `已运行 ${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
}
