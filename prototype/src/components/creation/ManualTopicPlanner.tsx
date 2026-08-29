"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"
import { ArrowLeft, ArrowRight, Lightning, SlidersHorizontal } from "@phosphor-icons/react"

export type ManualTopicOption = {
  id: string
  title: string
  angle: string
  decisionBrief?: {
    recommendationSummary?: string
    audienceProblem?: string
  }
}

export type ManualTopicPool = {
  runId: string
  recommendedTopicId: string
  topics: ManualTopicOption[]
}

export function CreationStartPanel({ onAuto, onManual }: {
  onAuto: () => void
  onManual: () => void
}) {
  return <section className="creation-entry-shell" aria-labelledby="creation-entry-heading">
    <header>
      <p>今日创作</p>
      <h1 id="creation-entry-heading">今天想怎么开始？</h1>
      <span>当前 IP、账号画像和已确认复盘会自动参与本次创作。</span>
    </header>
    <div className="creation-entry-actions">
      <section>
        <div><Lightning size={22} weight="fill" aria-hidden="true" /><span>省心模式</span></div>
        <h2>直接生成一篇可用口播稿</h2>
        <p>Agent 先判断三个方向，采用首选方向，并继续生成一篇完整口播稿。</p>
        <button className="primary-button" type="button" onClick={onAuto}>一键生成今日口播稿 <ArrowRight size={18} aria-hidden="true" /></button>
      </section>
      <section>
        <div><SlidersHorizontal size={22} aria-hidden="true" /><span>主动模式</span></div>
        <h2>自己确定今天讲什么</h2>
        <p>可以输入一个想法，也可以先看三个选题方向，选定后再生成单篇口播稿。</p>
        <button className="secondary-button" type="button" onClick={onManual}>手动选择选题方向 <ArrowRight size={18} aria-hidden="true" /></button>
      </section>
    </div>
  </section>
}

export function ManualTopicPlanner({ pool, onGenerateTopics, onGenerateScript, onReset, onCancel, hasExistingDraft }: {
  pool: ManualTopicPool | null
  onGenerateTopics: (topicBrief: string) => void
  onGenerateScript: (runId: string, topicId: string) => void
  onReset: () => void
  onCancel: () => void
  hasExistingDraft: boolean
}) {
  const [topicBrief, setTopicBrief] = useState("")
  const [selectedTopicId, setSelectedTopicId] = useState(pool?.recommendedTopicId ?? "")
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    setSelectedTopicId(pool?.recommendedTopicId ?? "")
    headingRef.current?.focus()
  }, [pool?.runId, pool?.recommendedTopicId])

  function submitBrief(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onGenerateTopics(topicBrief.trim())
  }

  if (!pool) return <section className="manual-topic-shell" aria-labelledby="manual-topic-heading">
    <button className="manual-topic-back" type="button" onClick={onCancel}><ArrowLeft size={17} aria-hidden="true" />{hasExistingDraft ? "返回当前稿件" : "返回一键生成"}</button>
    <header>
      <p>主动创作</p>
      <h1 ref={headingRef} tabIndex={-1} id="manual-topic-heading">自己确定今天讲什么</h1>
      <span>先写下你的内容意图。留空也可以，Agent 会依据当前 IP 给出三个方向，再由你决定。</span>
    </header>
    <form className="manual-topic-form" onSubmit={submitBrief}>
      <label htmlFor="manual-topic-brief">今天想讲的内容 <span>选填</span></label>
      <textarea
        id="manual-topic-brief"
        value={topicBrief}
        onChange={(event) => setTopicBrief(event.target.value)}
        maxLength={500}
        rows={5}
        aria-describedby="manual-topic-help manual-topic-count"
        placeholder="例如：最近很多人问我，刚开始做社区团购应该先选品还是先建群，我想讲讲自己的判断。"
      />
      <div className="manual-topic-form-meta">
        <p id="manual-topic-help">Agent 只会围绕已确认画像和表达边界整理方向，不会补写不存在的经历。</p>
        <span id="manual-topic-count">{topicBrief.length}/500</span>
      </div>
      <button className="primary-button" type="submit">生成 3 个选题方向 <ArrowRight size={18} aria-hidden="true" /></button>
    </form>
  </section>

  return <section className="manual-topic-shell manual-topic-selection" aria-labelledby="manual-topic-selection-heading">
    <button className="manual-topic-back" type="button" onClick={onReset}><ArrowLeft size={17} aria-hidden="true" />重新填写想讲的内容</button>
    <header>
      <p>选择方向</p>
      <h1 ref={headingRef} tabIndex={-1} id="manual-topic-selection-heading">今天具体拍哪一条？</h1>
      <span>方向已经结合当前 IP 和内容结构生成。选定一条后，只会为这条方向生成一篇口播稿。</span>
    </header>
    <fieldset className="manual-topic-options">
      <legend>选择一个选题方向</legend>
      {pool.topics.map((topic, index) => <label key={topic.id} className={selectedTopicId === topic.id ? "is-selected" : ""}>
        <input
          type="radio"
          name="manual-topic"
          value={topic.id}
          checked={selectedTopicId === topic.id}
          onChange={() => setSelectedTopicId(topic.id)}
        />
        <span className="manual-topic-index">0{index + 1}</span>
        <span className="manual-topic-copy">
          <span>{topic.title}{topic.id === pool.recommendedTopicId && <small>Agent 首选</small>}</span>
          <strong>{topic.angle}</strong>
          {topic.decisionBrief?.recommendationSummary && <em>{topic.decisionBrief.recommendationSummary}</em>}
        </span>
      </label>)}
    </fieldset>
    <footer className="manual-topic-actions">
      <button className="primary-button" type="button" disabled={!selectedTopicId} onClick={() => onGenerateScript(pool.runId, selectedTopicId)}>
        按这个方向生成口播稿 <ArrowRight size={18} aria-hidden="true" />
      </button>
      <button className="text-button" type="button" onClick={onCancel}>{hasExistingDraft ? "取消，保留当前稿件" : "暂不生成"}</button>
    </footer>
  </section>
}
