"use client"

import { useEffect, useMemo, useState } from "react"
import { Check, CheckCircle, ClockCounterClockwise, Copy, PencilSimple, Repeat, ShuffleAngular } from "@phosphor-icons/react"

type RegenerationIntent = "change_topic" | "change_expression"

export function DailyCreationView({ draft, regenerating = false, onRegenerate }: { draft: any; regenerating?: boolean; onRegenerate?: (intent: RegenerationIntent) => void }) {
  const [paragraphs, setParagraphs] = useState<string[]>([...draft.paragraphs])
  const [editingAll, setEditingAll] = useState(false)
  const [editingParagraph, setEditingParagraph] = useState<number | null>(null)
  const [locked, setLocked] = useState(false)
  useEffect(() => {
    setParagraphs([...draft.paragraphs])
    setEditingAll(false)
    setEditingParagraph(null)
    setLocked(false)
  }, [draft.runId, draft.paragraphs])
  const scriptText = useMemo(() => paragraphs.join("\n\n"), [paragraphs])
  async function copyScript() { await navigator.clipboard?.writeText(scriptText) }
  function toggleWholeScriptEditing() {
    setEditingAll((current) => !current)
    setEditingParagraph(null)
  }
  function toggleParagraphEditing(index: number) {
    setEditingAll(false)
    setEditingParagraph((current) => current === index ? null : index)
  }
  return <div className="document-page daily-creation-view">
    <section className="result-lead">
      <div><p className="eyebrow">{draft.lead}</p><p>我根据你的真实经历、近期账号表现和表达边界，完成了选题、口播稿和发布前检查。</p></div>
      <div className="lead-actions"><button className="primary-button" onClick={copyScript}><Copy size={20} />复制并去拍</button><button className="secondary-button" onClick={() => setLocked(true)}>{locked ? "已确认定稿" : "确认定稿"}</button><div className="text-actions"><button disabled={regenerating} onClick={() => onRegenerate?.("change_topic")}><Repeat size={19} />换选题</button><button disabled={regenerating} onClick={() => onRegenerate?.("change_expression")}><ShuffleAngular size={19} />换个讲法</button><button onClick={toggleWholeScriptEditing}>{editingAll ? <Check size={19} /> : <PencilSimple size={19} />}{editingAll ? "完成整篇编辑" : "编辑这篇"}</button></div></div>
    </section>
    <div className="document-grid">
      <article className="primary-document script-document">
        <h1>{draft.title}</h1>
        <div className="document-meta"><span>{draft.duration}</span><span>{draft.wordCount}</span><span>适合视频号竖屏</span><span>2026 年 8 月 17 日</span><span className="version-label">{draft.version}</span></div>
        {paragraphs.map((paragraph, index) => {
          const editingThisParagraph = editingAll || editingParagraph === index
          const editingOnlyThisParagraph = editingParagraph === index
          return <section className="script-paragraph" key={index}>
            {editingThisParagraph ? <textarea aria-label={`第 ${index + 1} 段`} value={paragraph} onChange={(event) => setParagraphs((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} /> : <p>{paragraph}</p>}
            <button className={`paragraph-edit-button ${editingOnlyThisParagraph ? "is-editing" : ""}`} type="button" aria-label={editingOnlyThisParagraph ? `完成第 ${index + 1} 段编辑` : `编辑第 ${index + 1} 段`} title={editingOnlyThisParagraph ? "完成本段编辑" : "编辑本段"} onClick={() => toggleParagraphEditing(index)}>
              {editingOnlyThisParagraph ? <Check size={21} /> : <PencilSimple size={21} weight="light" />}
            </button>
          </section>
        })}
        <p className="document-footnote">温馨提示：口播时语速建议每分钟约 260–280 字，段落之间可停顿 1–2 秒，语气真诚自然即可。</p>
      </article>
      <aside className="evidence-rail">
        <p className="evidence-summary"><CheckCircle size={22} weight="fill" />已检查：事实可信 · 符合你的表达 · 无收益承诺</p>
        {draft.checks.map((check: any) => <section key={check.title}><h3>{check.title}<span className="pass-text">通过</span></h3><p>{check.note}</p></section>)}
        <section><h3>创作依据（摘要）</h3><ul>{draft.evidence.map((item: string) => <li key={item}>{item}</li>)}</ul><button className="text-link">查看 Agent 的判断依据</button></section>
        <section><h3><ClockCounterClockwise size={20} />版本历史</h3><div className="version-record"><span className="accent-dot" />{draft.version}<span>2026-08-17 10:15</span></div></section>
        {draft.alternatives?.topics?.length > 1 && <details className="alternative-decisions"><summary>返回查看本次其他选题</summary><ol>{draft.alternatives.topics.map((topic: any) => <li key={topic.id}>{topic.title}</li>)}</ol><p>默认已采用 Agent 推荐项；选择“换选题”会生成一篇新的可用稿。</p></details>}
      </aside>
    </div>
  </div>
}
