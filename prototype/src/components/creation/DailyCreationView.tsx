"use client"

import { useEffect, useMemo, useState } from "react"
import { Check, CheckCircle, ClockCounterClockwise, Copy, PencilSimple, Repeat, ShuffleAngular } from "@phosphor-icons/react"
import { PublicationReceipt, type PublicationAccount, type PublicationRecord } from "./PublicationReceipt"

type RegenerationIntent = "change_topic" | "change_expression"
type BusyAction = "saving" | "finalizing" | null
type DailyCreationViewProps = {
  draft: any
  regenerating?: boolean
  onRegenerate?: (intent: RegenerationIntent) => void
  onSave?: (paragraphs: string[]) => Promise<void>
  onFinalize?: (input: { paragraphs: string[]; copyAfter: boolean }) => Promise<void>
  busyAction?: BusyAction
  publicationAccounts?: PublicationAccount[]
  onSavePublication?: (input: {
    runId: string; lockedVersion: number; contentAccountId: string; identity: string; publishedAt: string
  }) => Promise<PublicationRecord>
  onLoadPublications?: () => Promise<PublicationRecord[]>
}

export function DailyCreationView({
  draft, regenerating = false, onRegenerate, onSave, onFinalize, busyAction = null,
  publicationAccounts = [], onSavePublication, onLoadPublications,
}: DailyCreationViewProps) {
  const [paragraphs, setParagraphs] = useState<string[]>([...draft.paragraphs])
  const [editingAll, setEditingAll] = useState(false)
  const [editingParagraph, setEditingParagraph] = useState<number | null>(null)
  useEffect(() => {
    setParagraphs([...draft.paragraphs])
    setEditingAll(false)
    setEditingParagraph(null)
  }, [draft.runId, draft.revision, draft.paragraphs])
  const scriptText = useMemo(() => paragraphs.join("\n\n"), [paragraphs])
  const locked = draft.status === "locked"
  async function finalize(copyAfter: boolean) {
    if (onFinalize) return onFinalize({ paragraphs: [...paragraphs], copyAfter })
    if (copyAfter) await navigator.clipboard?.writeText(scriptText)
  }
  async function toggleWholeScriptEditing() {
    if (editingAll) {
      try {
        await onSave?.([...paragraphs])
        setEditingAll(false)
      } catch {
        return
      }
    } else {
      setEditingAll(true)
    }
    setEditingParagraph(null)
  }
  async function toggleParagraphEditing(index: number) {
    if (editingParagraph === index) {
      try {
        await onSave?.([...paragraphs])
        setEditingParagraph(null)
      } catch {
        return
      }
      return
    }
    setEditingAll(false)
    setEditingParagraph(index)
  }
  return <div className="document-page daily-creation-view">
    <section className="result-lead">
      <div><p className="eyebrow">{draft.lead}</p><p>我根据你的真实经历、近期账号表现和表达边界，完成了选题、口播稿和发布前检查。</p>{draft.memoryInfluence && <p className="memory-influence-lead">已自动参考上次确认的复盘 · 记忆 v{draft.memoryInfluence.version}</p>}</div>
      <div className="lead-actions"><button className="primary-button" disabled={busyAction === "finalizing"} onClick={() => void finalize(true).catch(() => undefined)}><Copy size={20} />复制并去拍</button><button className="secondary-button" disabled={locked || busyAction === "finalizing"} onClick={() => void finalize(false).catch(() => undefined)}>{locked ? "已确认定稿" : "确认定稿"}</button><div className="text-actions"><button disabled={regenerating} onClick={() => onRegenerate?.("change_topic")}><Repeat size={19} />换选题</button><button disabled={regenerating} onClick={() => onRegenerate?.("change_expression")}><ShuffleAngular size={19} />换个讲法</button><button disabled={busyAction === "saving"} onClick={() => void toggleWholeScriptEditing()}>{editingAll ? <Check size={19} /> : <PencilSimple size={19} />}{editingAll ? "完成整篇编辑" : "编辑这篇"}</button></div></div>
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
            <button className={`paragraph-edit-button ${editingOnlyThisParagraph ? "is-editing" : ""}`} type="button" disabled={busyAction === "saving"} aria-label={editingOnlyThisParagraph ? `完成第 ${index + 1} 段编辑` : `编辑第 ${index + 1} 段`} title={editingOnlyThisParagraph ? "完成本段编辑" : "编辑本段"} onClick={() => void toggleParagraphEditing(index)}>
              {editingOnlyThisParagraph ? <Check size={21} /> : <PencilSimple size={21} weight="light" />}
            </button>
          </section>
        })}
        <p className="document-footnote">温馨提示：口播时语速建议每分钟约 260–280 字，段落之间可停顿 1–2 秒，语气真诚自然即可。</p>
        {locked && draft.lockedVersion && <PublicationReceipt
          runId={draft.runId}
          lockedVersion={draft.lockedVersion}
          accounts={publicationAccounts}
          save={onSavePublication ?? (async () => { throw new Error("发布服务尚未连接") })}
          load={onLoadPublications}
        />}
      </article>
      <aside className="evidence-rail">
        <p className={`evidence-summary ${draft.status === "needs_qa" ? "evidence-pending" : ""}`}><CheckCircle size={22} weight="fill" />{draft.status === "needs_qa" ? "修改已保存 · 定稿前将重新检查" : "已检查：事实可信 · 符合你的表达 · 无收益承诺"}</p>
        {draft.checks.map((check: any) => <section key={check.title}><h3>{check.title}<span className="pass-text">通过</span></h3><p>{check.note}</p></section>)}
        <section><h3>创作依据（摘要）</h3><ul>{draft.evidence.map((item: string) => <li key={item}>{item}</li>)}{draft.memoryInfluence && <li>已参考上次确认的复盘：{draft.memoryInfluence.summary} · 记忆 v{draft.memoryInfluence.version}</li>}</ul><button className="text-link">查看 Agent 的判断依据</button></section>
        <section><h3><ClockCounterClockwise size={20} />版本历史</h3><div className="version-record"><span className="accent-dot" /><span>{draft.version}</span>{draft.lockedVersion ? <span>锁稿 {draft.lockedVersion}</span> : <span>尚未锁稿</span>}</div></section>
        {draft.alternatives?.topics?.length > 1 && <details className="alternative-decisions"><summary>返回查看本次其他选题</summary><ol>{draft.alternatives.topics.map((topic: any) => <li key={topic.id}>{topic.title}</li>)}</ol><p>默认已采用 Agent 推荐项；选择“换选题”会生成一篇新的可用稿。</p></details>}
      </aside>
    </div>
  </div>
}
