"use client"

import { useEffect, useMemo, useState } from "react"
import {
  Check, CheckCircle, Copy, DownloadSimple, Repeat, ShuffleAngular,
} from "@phosphor-icons/react"
import { PublicationReceipt, type PublicationAccount, type PublicationRecord } from "./PublicationReceipt"
import { CreationDecisionBrief } from "./CreationDecisionBrief"
import { ScriptSegmentEditor } from "./ScriptSegmentEditor"
import { normalizeScriptSegments, spokenSegmentText, type ScriptSegment } from "../../domain/creation-contracts"

type RegenerationIntent = "change_topic" | "change_expression"
type BusyAction = "saving" | "finalizing" | null
type DailyCreationViewProps = {
  draft: any
  regenerating?: boolean
  onRegenerate?: (intent: RegenerationIntent) => void
  onSave?: (segments: ScriptSegment[]) => Promise<void>
  onFinalize?: (input: { segments: ScriptSegment[] }) => Promise<void>
  onDownload?: () => void | Promise<void>
  onCopy?: () => void | Promise<void>
  busyAction?: BusyAction
  publicationAccounts?: PublicationAccount[]
  onSavePublication?: (input: {
    runId: string; lockedVersion: number; contentAccountId: string; identity: string; publishedAt: string
  }) => Promise<PublicationRecord>
  onLoadPublications?: () => Promise<PublicationRecord[]>
}

export function DailyCreationView({
  draft, regenerating = false, onRegenerate, onSave, onFinalize, onDownload, onCopy,
  busyAction = null, publicationAccounts = [], onSavePublication, onLoadPublications,
}: DailyCreationViewProps) {
  const [segments, setSegments] = useState<ScriptSegment[]>(() => draftSegments(draft))
  const [editingLockedDraft, setEditingLockedDraft] = useState(false)
  const [actionNotice, setActionNotice] = useState("")

  useEffect(() => {
    setSegments(draftSegments(draft))
    setEditingLockedDraft(false)
    setActionNotice("")
  }, [draft.runId, draft.revision, draft.segments, draft.paragraphs])

  const scriptText = useMemo(() => spokenSegmentText(segments), [segments])
  const locked = draft.status === "locked"
  const canEdit = !locked || editingLockedDraft
  async function saveSegments(next: ScriptSegment[]) {
    await onSave?.(next)
    setSegments(next)
  }

  async function copyScript() {
    if (onCopy) await onCopy()
    else await navigator.clipboard?.writeText(scriptText)
    setActionNotice("口播正文已复制")
  }

  async function downloadScript() {
    await onDownload?.()
    setActionNotice("已开始下载 DOCX")
  }

  return <div className="creation-studio">
    <nav className="creation-path" aria-label="创作流程">
      <ol>
        <li className={!locked ? "is-current" : "is-complete"}>
          <span aria-hidden="true">1</span><div><strong>今日选题</strong><small>Agent 推荐并给出依据</small></div>
        </li>
        <li className={locked ? "is-current is-complete" : ""}>
          <span aria-hidden="true">{locked ? <Check size={18} weight="bold" /> : "2"}</span><div><strong>口播成稿</strong><small>生成、编辑与定稿</small></div>
        </li>
        <li>
          <span aria-hidden="true">3</span><div><strong>发布复盘</strong><small>发布后回收表现</small></div>
        </li>
      </ol>
    </nav>

    <main className="creation-canvas">
      <header className="creation-decision">
        <p className="creation-kicker">今天建议讲</p>
        {draft.creationTrigger?.triggerType === "review_followup" && draft.memoryInfluence && <p className="sample-tier-note">已依据本账号复盘记忆 v{draft.memoryInfluence.version} 开始新一轮验证</p>}
        <h1>{draft.title}</h1>
        {locked && <p className="finalized-status"><CheckCircle size={18} weight="fill" />{formatFinalizedAt(draft.finalizedAt)}</p>}
        <div className="creation-adjustments">
          <button type="button" disabled={regenerating} onClick={() => onRegenerate?.("change_topic")}><Repeat size={18} />换一个选题</button>
          <span aria-hidden="true" />
          <button type="button" disabled={regenerating} onClick={() => onRegenerate?.("change_expression")}><ShuffleAngular size={18} />换一种讲法</button>
        </div>
        <CreationDecisionBrief brief={draft.decisionBrief ?? fallbackDecisionBrief(draft)} />
      </header>

      <section className="script-workspace" aria-labelledby="script-heading">
        <div className="script-heading-row">
          <div><h2 id="script-heading">口播正文</h2><p>只导出口播内容；拍摄提示不会进入配音文本。</p></div>
          <div className="script-metadata"><span>{draft.duration}</span><span>{draft.wordCount}</span><span>{draft.version}</span></div>
        </div>

        <ScriptSegmentEditor segments={segments} canEdit={canEdit} saving={busyAction === "saving"} onSave={saveSegments} />

        <p className="content-check-status"><CheckCircle size={18} weight="fill" />{
          draft.qualityAdvisory?.requiresReview
              ? `草稿已生成，请人工确认：${draft.qualityAdvisory.reasons?.join("；") || "存在需要确认的表达"}`
              : "首版质量门禁未启用，请在定稿前人工确认事实与表达边界"
        }</p>

        {locked && draft.lockedVersion && <PublicationReceipt
          runId={draft.runId}
          lockedVersion={draft.lockedVersion}
          accounts={publicationAccounts}
          save={onSavePublication ?? (async () => { throw new Error("发布服务尚未连接") })}
          load={onLoadPublications}
        />}
      </section>
    </main>

    <aside className="creation-action-dock" aria-label={locked ? "定稿操作" : "稿件操作"}>
      {locked ? <>
        <button className="download-script-button" type="button" onClick={() => void downloadScript()}><DownloadSimple size={22} />下载口播稿</button>
        <p>默认下载 DOCX，包含口播正文与拍摄提示</p>
        <div className="tertiary-actions">
          <button className="tertiary-action" type="button" onClick={() => void copyScript()}><Copy size={16} aria-hidden="true" />复制文本</button>
          <span aria-hidden="true">·</span>
          <button className="tertiary-action" type="button" onClick={() => setEditingLockedDraft(true)}>返回编辑</button>
        </div>
      </> : <>
        <button className="finalize-script-button" type="button" disabled={busyAction === "finalizing"} onClick={() => void onFinalize?.({ segments: [...segments] }).catch(() => undefined)}>{busyAction === "finalizing" ? "正在确认定稿…" : "确认定稿"}</button>
        <p>人工确认后定稿，即可下载 DOCX；复制文本也会启用</p>
      </>}
      <span className="action-notice" aria-live="polite">{actionNotice}</span>
    </aside>
  </div>
}

function fallbackDecisionBrief(draft: any) {
  return {
    objective: "建立信任" as const,
    whyToday: "当前选题与这个 IP 已确认的经历和受众问题直接相关。",
    audienceProblem: "受众需要一个来自真实经历、可以理解并采用的判断。",
    ipEvidenceRefs: (draft.evidence?.length ? draft.evidence : ["当前 IP 的已确认画像"]).map((label: string, index: number) => ({ label, sourceAnswerId: `legacy-profile:${index}` })),
    recentDataStatus: draft.memoryInfluence ? "available" as const : "none" as const,
    ...(draft.memoryInfluence ? { recentDataSummary: `已参考确认复盘：${draft.memoryInfluence.summary} · 记忆 v${draft.memoryInfluence.version}` } : {}),
    repetitionRisk: "low" as const,
    nextSignal: "发布后观察完播率，以及评论中出现的真实问题。",
  }
}

function formatFinalizedAt(value?: string | null) {
  if (!value) return "已定稿"
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(value))
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ""
  return `已定稿 · ${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`
}

function draftSegments(draft: any): ScriptSegment[] {
  const base = normalizeScriptSegments({ segments: draft.segments, paragraphs: draft.paragraphs }, "draft")
  if (draft.segments || !draft.shootingTips?.length) return base
  return [
    ...base,
    ...draft.shootingTips.map((text: string, index: number) => ({
      id: `draft-shot-${index + 1}`,
      kind: "shot_instruction" as const,
      text,
    })),
  ]
}
