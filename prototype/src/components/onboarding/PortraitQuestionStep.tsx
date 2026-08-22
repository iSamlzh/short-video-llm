import { FormEvent, useEffect, useState } from "react"
import type { PortraitQuestion } from "../../domain/ip-onboarding"

export function PortraitQuestionStep({ question, initialValue = "", answeredCount, busy, isRevision = false, onCancel, onSubmit }: {
  question: Pick<PortraitQuestion, "id" | "prompt" | "answerType" | "options" | "helpText">
  initialValue?: string | string[]
  answeredCount: number
  busy: boolean
  isRevision?: boolean
  onCancel?(): void
  onSubmit(value: string | string[]): void
}) {
  const [value, setValue] = useState<string | string[]>(initialValue)
  useEffect(() => setValue(initialValue), [question.id, initialValue])
  const selectedValues = Array.isArray(value) ? value : []
  const valid = Array.isArray(value) ? value.length > 0 : value.trim().length > 0
  function submit(event: FormEvent) { event.preventDefault(); if (valid) onSubmit(value) }

  return <form className="onboarding-sheet question-step" onSubmit={submit}>
    <div className="question-progress"><span>内容画像建档</span><strong>已获得 {answeredCount} 项内容依据</strong></div>
    <h1>{question.prompt}</h1>
    {question.helpText && <p className="question-help">{question.helpText}</p>}
    {question.options?.length ? <fieldset className="answer-options"><legend className="sr-only">选择回答</legend>
      {question.options.map(option => {
        const checked = question.answerType === "multi_choice" ? selectedValues.includes(option.value) : value === option.value
        return <label key={option.value} className={checked ? "answer-option is-selected" : "answer-option"}>
          <input type={question.answerType === "multi_choice" ? "checkbox" : "radio"} checked={checked} onChange={() => {
            if (question.answerType !== "multi_choice") setValue(option.value)
            else setValue(checked ? selectedValues.filter(item => item !== option.value) : [...selectedValues, option.value])
          }} />
          <span>{option.label}</span>
        </label>
      })}
    </fieldset> : <textarea aria-label="你的回答" value={Array.isArray(value) ? value.join("、") : value} onChange={event => setValue(event.target.value)} placeholder="请写下能帮助 Agent 判断内容方向的真实信息" autoFocus />}
    {(!valid || busy) && <span className="sr-only" id="portrait-submit-hint">{busy ? "正在保存回答" : "请先选择或填写回答"}</span>}
    <div className="onboarding-actions">{onCancel && <button type="button" className="text-button" onClick={onCancel}>取消修改</button>}<button className="primary-button" type="submit" disabled={!valid || busy} aria-describedby={!valid || busy ? "portrait-submit-hint" : undefined}>{busy ? "正在保存…" : isRevision ? "保存修改" : "保存并继续"}</button></div>
  </form>
}
