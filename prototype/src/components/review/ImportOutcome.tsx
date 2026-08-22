"use client"

import { CheckCircle, WarningCircle } from "@phosphor-icons/react"
import { MatchResolutionList } from "./MatchResolutionList"

export function ImportOutcome({ result, onConfirm, onCreateExternal, onConfirmHighConfidence }: {
  result: any
  onConfirm?: (matchId: string, publicationId: string, version: number) => Promise<void>
  onCreateExternal?: (matchId: string, version: number) => Promise<void>
  onConfirmHighConfidence?: (items: Array<{ matchId: string; publicationId: string; version: number }>) => Promise<void>
}) {
  const matches = result.matches ?? []
  const highConfidenceSelections = matches.flatMap((match: any) => {
    if (match.status !== "candidate") return []
    const high = (match.candidates ?? []).filter((candidate: any) => candidate.confidence === "high")
    return high.length === 1 ? [{ matchId: match.id, publicationId: high[0].id, version: match.version }] : []
  })
  const matched = result.matched ?? matches.filter((item: any) => item.status === "matched").length
  const errorCount = result.errorCount ?? (Array.isArray(result.errors) ? result.errors.length : result.errors ?? 0)
  return <section className="import-outcome document-page" aria-labelledby="import-outcome-title">
    <div className="import-outcome-lead"><CheckCircle size={25} weight="fill" /><div><p className="eyebrow">真实数据已接住</p><h2 id="import-outcome-title">已处理 {result.total} 条，{matched} 条已关联</h2><p>{result.candidates ?? 0} 条待确认 · {result.unmatched ?? 0} 条未匹配 · {result.duplicates ?? 0} 条重复 · {errorCount} 条格式错误。可用数据已经继续复盘，不必先处理完异常。</p></div></div>
    {highConfidenceSelections.length > 0 && onConfirmHighConfidence && <div className="bulk-match-action">
      <p>Agent 找到 {highConfidenceSelections.length} 条唯一高置信候选；仍需你确认后才会关联。</p>
      <button className="secondary-button" type="button" onClick={() => void onConfirmHighConfidence(highConfidenceSelections)}>
        批量确认 {highConfidenceSelections.length} 条高置信候选
      </button>
    </div>}
    <MatchResolutionList matches={matches} onConfirm={onConfirm} onCreateExternal={onCreateExternal} />
    {(errorCount > 0 || result.duplicates > 0) && <details className="import-secondary-details"><summary><WarningCircle size={17} />查看重复和格式错误</summary><p>重复行已自动跳过；格式错误不会影响其他有效数据。</p><ul>{(result.errors ?? []).map((error: any) => <li key={`${error.rowNumber}-${error.errorCode}`}>{error.redactedReference}：{error.message}</li>)}</ul></details>}
  </section>
}
