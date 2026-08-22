import { estimateSpokenDuration, scriptToSegments, type CreationDecisionBrief, type ScriptSegment } from "../domain/creation-contracts"
import type { ConfirmedCreationMemory } from "../domain/growth-loop"

type RunView = {
  run?: { id?: string; state?: string }
  id?: string
  ipProfile?: { displayName?: string }
  topicBatch?: { items?: Array<{ id: string; title: string; ipFitEvidence?: string[]; decisionBrief?: CreationDecisionBrief }> } | null
  topicSelection?: { topicId: string } | null
  scriptBatch?: {
    version: number
    items: Array<{ id: string; title: string; hook: string; body: string; callToAction: string; estimatedSeconds: number; segments?: ScriptSegment[] }>
  } | null
  scriptSelection?: { version: number; batchVersion: number; scriptId: string } | null
  lockedScript?: {
    version: number
    scriptSelectionVersion: number | null
    script: { id: string; title: string; hook: string; body: string; callToAction: string; estimatedSeconds: number; segments?: ScriptSegment[] }
    createdAt?: string
  } | null
  qualityReport?: {
    scriptSelectionVersion: number | null
    scores: { hook: number; ipFit: number; credibility: number; structure: number; callToAction: number }
    suggestions?: string[]
  } | null
}

export function presentCreationDraft(view: RunView, memory?: ConfirmedCreationMemory | null) {
  const selection = view.scriptSelection
  const script = view.scriptBatch?.items.find((item) => item.id === selection?.scriptId)
  if (!selection || !script) throw new Error("SCRIPT_SELECTION_REQUIRED")
  const qualityMatches = view.qualityReport?.scriptSelectionVersion === selection.version
  const lockedMatches = view.lockedScript?.scriptSelectionVersion === selection.version
  const status = lockedMatches ? "locked" : qualityMatches ? "ready_to_confirm" : "needs_qa"
  const topic = view.topicBatch?.items?.find((item) => item.id === view.topicSelection?.topicId)
  const segments = scriptToSegments(script)
  const spokenSegments = segments.filter((segment) => segment.kind === "spoken")
  const productionSegments = segments.filter((segment) => segment.kind === "shot_instruction" || segment.kind === "subtitle_emphasis")
  const spokenMetrics = estimateSpokenDuration(segments)
  const score = qualityMatches ? view.qualityReport?.scores : undefined
  const checks = score ? [
    { title: "事实可信", note: `可信度 ${score.credibility}，基于当前 IP 的已确认经历，未发现虚构案例。` },
    { title: "符合你的表达", note: `匹配度 ${score.ipFit}，已遵守当前 IP 的说话方式与内容边界。` },
    { title: "无收益承诺", note: `结构分 ${score.structure}，未出现收益保证、绝对化用语或诱导表达。` },
  ] : []
  return {
    runId: view.run?.id ?? view.id,
    lead: status === "locked"
      ? `${view.ipProfile?.displayName ?? "当前 IP"}，这篇已经定稿`
      : status === "needs_qa"
        ? "修改已保存，定稿前需要重新检查"
        : `${view.ipProfile?.displayName ?? "当前 IP"}，今天这篇可以直接拍`,
    title: script.title,
    duration: `约 ${spokenMetrics.estimatedSeconds} 秒`,
    wordCount: `约 ${spokenMetrics.spokenCharacters} 字`,
    version: `v${selection.version} · ${status === "locked" ? "已定稿" : status === "needs_qa" ? "待检查" : "待确认"}`,
    revision: selection.version,
    status,
    lockedVersion: view.lockedScript?.version ?? null,
    finalizedAt: lockedMatches ? view.lockedScript?.createdAt ?? null : null,
    segments,
    paragraphs: spokenSegments.map((segment) => segment.text),
    shootingTips: productionSegments.map((segment) => segment.text),
    checks,
    decisionBrief: topic?.decisionBrief ?? legacyDecisionBrief(topic?.ipFitEvidence, memory),
    evidence: [
      ...(topic?.ipFitEvidence?.length ? topic.ipFitEvidence : ["当前 IP 的已确认画像"]),
      "表达边界：不夸大、不承诺、不贬低竞品",
      "选题方向：真实经历与长期信任",
    ],
    alternatives: {
      topics: view.topicBatch?.items?.map((item) => ({ id: item.id, title: item.title })) ?? [],
    },
    memoryInfluence: memory ? {
      version: memory.version,
      summary: [...memory.keep.slice(0, 1), ...memory.nextContentSignals.slice(0, 1)].join("；"),
    } : null,
  }
}

function legacyDecisionBrief(evidence: string[] | undefined, memory?: ConfirmedCreationMemory | null): CreationDecisionBrief {
  return {
    objective: "建立信任",
    whyToday: "当前选题与这个 IP 已确认的经历和受众问题直接相关。",
    audienceProblem: "受众需要一个来自真实经历、可以理解并采用的判断。",
    ipEvidenceRefs: (evidence?.length ? evidence : ["当前 IP 的已确认画像"]).map((label, index) => ({
      label,
      sourceAnswerId: `legacy-profile:${index}`,
    })),
    recentDataStatus: memory ? "available" : "none",
    ...(memory ? { recentDataSummary: `已参考确认复盘：${memory.keep[0] ?? memory.nextContentSignals[0] ?? "已确认结论"}` } : {}),
    repetitionRisk: "low",
    nextSignal: "发布后观察完播率，以及评论中出现的真实问题。",
  }
}
