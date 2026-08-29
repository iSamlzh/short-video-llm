"use client"

import type { ModelOperationStage, ModelOperationState } from "../../hooks/use-model-operation"

type GenerationOperation = "initial" | "change_topic" | "change_expression"

const stageLabels: Record<ModelOperationStage, string> = {
  preparing: "正在读取当前 IP 与账号上下文",
  selecting: "正在选择今天更适合讲的方向",
  writing: "正在生成完整口播稿",
  checking: "正在检查事实、表达与内容边界",
  saving: "正在保存这次生成结果",
}

const operationLabels: Record<GenerationOperation, string> = {
  initial: "准备今天的内容",
  change_topic: "正在换一个选题，当前稿件会继续保留",
  change_expression: "正在换一种讲法，当前稿件会继续保留",
}

type Props = {
  operation: GenerationOperation
  state: ModelOperationState
  detailsVisible: boolean
  error?: string | null
  standalone?: boolean
  onCancel?: () => void
  onRetry?: () => void
}

export function GenerationProgress({ operation, state, detailsVisible, error, standalone = false, onCancel, onRetry }: Props) {
  return <section
    className={`generation-progress ${standalone ? "generation-progress-standalone" : ""} ${error ? "generation-progress-error" : ""}`}
    aria-busy={state.cancellable}
    aria-atomic="true"
    {...(error ? { role: "alert" } : { role: "status", "aria-live": "polite" as const })}
  >
    <div className="generation-progress-copy">
      <p className="generation-progress-operation">{error ? "本次操作没有完成" : operationLabels[operation]}</p>
      <strong className="text-balance">{error || (detailsVisible ? stageLabels[state.stage] : "已收到，正在开始处理…")}</strong>
      {detailsVisible && !error && <span className="tabular-nums">已用时 {state.elapsedSeconds} 秒</span>}
      {error && <span>已完成的步骤和当前稿件均已保留，重新发起会从失败处继续。</span>}
    </div>
    <div className="generation-progress-actions">
      {state.cancellable && onCancel && <button type="button" onClick={onCancel}>取消本次生成</button>}
      {error && onRetry && <button type="button" onClick={onRetry}>{state.retryable ? "从失败处重试" : "重新发起本次创作"}</button>}
    </div>
  </section>
}
