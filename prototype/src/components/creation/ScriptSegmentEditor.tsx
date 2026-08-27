"use client"

import { useEffect, useState } from "react"
import { Check, PencilSimple } from "@phosphor-icons/react"
import { scriptSegmentHeading, type ScriptSegment, type ScriptSegmentKind } from "../../domain/creation-contracts"

const kindLabels: Record<ScriptSegmentKind, string> = {
  spoken: "口播",
  shot_instruction: "拍摄提示",
  subtitle_emphasis: "字幕强调",
  compliance_note: "合规备注",
}

export function ScriptSegmentEditor({
  segments,
  canEdit,
  saving = false,
  onSave,
}: {
  segments: ScriptSegment[]
  canEdit: boolean
  saving?: boolean
  onSave?: (segments: ScriptSegment[]) => Promise<void> | void
}) {
  const [draft, setDraft] = useState(segments)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)

  useEffect(() => {
    setDraft(segments)
    setEditingIndex(null)
  }, [segments])

  async function toggle(index: number) {
    if (editingIndex !== index) { setEditingIndex(index); return }
    try {
      await onSave?.(draft)
      setEditingIndex(null)
    } catch {
      return
    }
  }

  return <article className="spoken-document" aria-label="结构化口播稿">
    {draft.map((segment, index) => {
      const editing = editingIndex === index
      const lockedKind = segment.kind === "compliance_note"
      const spokenSegments = draft.filter((item) => item.kind === "spoken")
      const spokenIndex = segment.kind === "spoken"
        ? spokenSegments.findIndex((item) => item.id === segment.id)
        : -1
      const heading = scriptSegmentHeading(segment, spokenIndex, spokenSegments.length)
      return <section className={`spoken-segment segment-kind-${segment.kind}`} key={segment.id}>
        <div className="segment-index" aria-hidden="true">{index + 1}</div>
        <div className="segment-content">
          <h3>{heading}</h3>
          {editing ? <>
            <label className="segment-kind-field">
              <span>第 {index + 1} 段类型</span>
              <select
                aria-label={`第 ${index + 1} 段类型`}
                value={segment.kind}
                disabled={lockedKind}
                onChange={(event) => setDraft((current) => current.map((item, itemIndex) => itemIndex === index
                  ? { ...item, kind: event.target.value as ScriptSegmentKind }
                  : item))}
              >
                {Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            {lockedKind && <small className="segment-kind-help">系统备注类型不可修改</small>}
            <textarea
              autoFocus
              aria-label={`第 ${index + 1} 段`}
              value={segment.text}
              onChange={(event) => setDraft((current) => current.map((item, itemIndex) => itemIndex === index
                ? { ...item, text: event.target.value }
                : item))}
            />
          </> : <p>{segment.text}</p>}
        </div>
        {canEdit && <button
          className={`paragraph-edit-button ${editing ? "is-editing" : ""}`}
          type="button"
          disabled={saving}
          aria-label={editing ? `完成第 ${index + 1} 段编辑` : `编辑第 ${index + 1} 段`}
          onClick={() => void toggle(index)}
        >
          {editing ? <Check size={20} aria-hidden="true" /> : <PencilSimple size={20} aria-hidden="true" />}
        </button>}
      </section>
    })}
  </article>
}
