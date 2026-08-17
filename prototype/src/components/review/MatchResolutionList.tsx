"use client"

import { ArrowRight, LinkSimple } from "@phosphor-icons/react"

export function MatchResolutionList({ matches, onConfirm = async () => undefined, onCreateExternal = async () => undefined }: {
  matches: any[]
  onConfirm?: (matchId: string, publicationId: string, version: number) => Promise<void>
  onCreateExternal?: (matchId: string, version: number) => Promise<void>
}) {
  const unresolved = matches.filter((item) => item.status === "candidate" || item.status === "unmatched")
  if (!unresolved.length) return null
  return <section className="match-resolution-list" aria-labelledby="match-resolution-title">
    <div className="review-section-heading"><p className="eyebrow">只处理异常</p><h3 id="match-resolution-title">有 {unresolved.length} 条需要你看一眼</h3></div>
    {unresolved.map((match) => <article className="match-resolution-row" key={match.id}>
      <div className="imported-reference"><span>导入内容</span><strong>{match.snapshot?.title ?? "未命名内容"}</strong><small>{formatTime(match.snapshot?.publishedAt)}</small></div>
      {match.status === "candidate" ? <div className="candidate-options"><p>{match.explanation}</p>{match.candidates.map((candidate: any) => <div className="candidate-option" key={candidate.id}><LinkSimple size={18} /><span><strong>{candidate.title}</strong><small>{candidate.explanation}</small></span><button type="button" onClick={() => void onConfirm(match.id, candidate.id, match.version)}>确认关联 <ArrowRight size={16} /></button></div>)}<button className="text-link" type="button" onClick={() => void onCreateExternal(match.id, match.version)}>都不是，作为外部发布记录</button></div> : <div className="candidate-options"><p>没有找到可解释的已有发布记录。</p><button className="text-link" type="button" onClick={() => void onCreateExternal(match.id, match.version)}>创建外部发布记录并关联</button></div>}
    </article>)}
  </section>
}

function formatTime(value?: string | null) {
  if (!value) return "未提供发布时间"
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value))
}
