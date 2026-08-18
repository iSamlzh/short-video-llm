import type { PortraitDimension } from "../../domain/ip-onboarding"

export type AnswerSummary = { questionId: string; question: string; dimension: PortraitDimension; value: string | string[] }

export function OnboardingAnswerReview({ answers, busy, stale, onEdit, onGenerate }: {
  answers: AnswerSummary[]
  busy: boolean
  stale: boolean
  onEdit(answer: AnswerSummary): void
  onGenerate(): void
}) {
  return <section className="onboarding-sheet answer-review">
    <p className="onboarding-kicker">回答复核</p>
    <h1>先核对这些内容依据</h1>
    <p className="onboarding-intro-copy">画像只从以下回答生成。哪里不准确，先改原回答，再让 Agent 重新理解。</p>
    <div className="answer-ledger">{answers.map((answer, index) => <article key={answer.questionId}>
      <span>{String(index + 1).padStart(2, "0")}</span><div><h2>{answer.question}</h2><p>{Array.isArray(answer.value) ? answer.value.join("、") : answer.value}</p></div>
      <button type="button" onClick={() => onEdit(answer)}>修改</button>
    </article>)}</div>
    <div className="onboarding-actions"><p>{stale ? "原回答已更新，需要重新生成画像。" : `共 ${answers.length} 项已确认内容依据`}</p><button className="primary-button" type="button" disabled={busy} onClick={onGenerate}>{busy ? "Agent 正在整理画像…" : stale ? "重新生成内容画像" : "生成内容画像"}</button></div>
  </section>
}
