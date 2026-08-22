import { z } from "zod"
import type { ConfirmedCreationMemory } from "./growth-loop"
import type { IpProfile } from "./models"

export const creationDecisionBriefSchema = z.object({
  objective: z.enum(["建立信任", "用户教育", "产品认知", "咨询转化"]),
  whyToday: z.string().trim().min(5),
  audienceProblem: z.string().trim().min(5),
  ipEvidenceRefs: z.array(z.object({
    label: z.string().trim().min(1),
    sourceAnswerId: z.string().trim().min(1),
  })).min(1),
  recentDataStatus: z.enum(["none", "available"]),
  recentDataSummary: z.string().trim().min(3).optional(),
  repetitionRisk: z.enum(["low", "medium", "high"]),
  nextSignal: z.string().trim().min(5),
}).superRefine((value, context) => {
  if (value.recentDataStatus === "none" && value.recentDataSummary !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["recentDataSummary"],
      message: "没有历史表现时不得输出表现摘要",
    })
  }
  if (value.recentDataStatus === "available" && !value.recentDataSummary) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["recentDataSummary"],
      message: "使用历史表现时必须说明参考内容",
    })
  }
})

export type CreationDecisionBrief = z.infer<typeof creationDecisionBriefSchema>
export type CreationEvidenceCatalogItem = {
  label: string
  sourceAnswerId: string
  sourceType: "ip_answer" | "confirmed_memory"
}

export const scriptSegmentKindSchema = z.enum([
  "spoken",
  "shot_instruction",
  "subtitle_emphasis",
  "compliance_note",
])
export const scriptSegmentSchema = z.object({
  id: z.string().trim().min(1),
  kind: scriptSegmentKindSchema,
  text: z.string().trim().min(1),
})
export const scriptSegmentsSchema = z.array(scriptSegmentSchema).min(1).max(40)

export type ScriptSegmentKind = z.infer<typeof scriptSegmentKindSchema>
export type ScriptSegment = z.infer<typeof scriptSegmentSchema>

export function normalizeScriptSegments(input: {
  segments?: unknown
  paragraphs?: string[]
}, idPrefix = "legacy"): ScriptSegment[] {
  const structured = scriptSegmentsSchema.safeParse(input.segments)
  if (structured.success) return structured.data
  return scriptSegmentsSchema.parse((input.paragraphs ?? []).map((text, index) => ({
    id: `${idPrefix}-${index + 1}`,
    kind: "spoken" as const,
    text,
  })))
}

export function estimateSpokenDuration(
  segments: ScriptSegment[],
  charactersPerMinute = 240,
) {
  if (!Number.isFinite(charactersPerMinute) || charactersPerMinute <= 0) throw new Error("INVALID_SPEAKING_RATE")
  const spokenCharacters = segments
    .filter((segment) => segment.kind === "spoken")
    .reduce((total, segment) => total + [...segment.text.replace(/\s/g, "")].length, 0)
  return {
    spokenCharacters,
    estimatedSeconds: spokenCharacters ? Math.ceil(spokenCharacters / charactersPerMinute * 60) : 0,
  }
}

export function spokenSegmentText(segments: ScriptSegment[]) {
  return segments
    .filter((segment) => segment.kind === "spoken")
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join("\n\n")
}

export const DEFAULT_SHOOTING_TIPS = [
  "语速适中，语气真诚；讲到方法步骤时适当停顿。",
  "建议正面机位、半身构图，背景简洁，光线柔和。",
] as const

export function scriptToSegments(script: {
  id: string
  hook: string
  body: string
  callToAction: string
  segments?: unknown
}): ScriptSegment[] {
  const structured = scriptSegmentsSchema.safeParse(script.segments)
  if (structured.success) return structured.data
  const spoken = [
    script.hook,
    ...script.body.split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean),
    script.callToAction,
  ].map((text, index) => ({ id: `${script.id}-spoken-${index + 1}`, kind: "spoken" as const, text }))
  const production = DEFAULT_SHOOTING_TIPS.map((text, index) => ({
    id: `${script.id}-shot-${index + 1}`,
    kind: "shot_instruction" as const,
    text,
  }))
  return scriptSegmentsSchema.parse([...spoken, ...production])
}

export function createFallbackCreationDecisionBrief(
  catalog: CreationEvidenceCatalogItem[],
  memory?: ConfirmedCreationMemory | null,
): CreationDecisionBrief {
  const evidence = catalog.find((item) => item.sourceType === "ip_answer") ?? catalog[0]
  if (!evidence) throw new Error("DECISION_EVIDENCE_CATALOG_EMPTY")
  return {
    objective: "建立信任",
    whyToday: "当前选题与这个 IP 已确认的经历和受众问题直接相关。",
    audienceProblem: "受众需要一个来自真实经历、可以理解并采用的判断。",
    ipEvidenceRefs: [{ label: evidence.label, sourceAnswerId: evidence.sourceAnswerId }],
    recentDataStatus: memory ? "available" : "none",
    ...(memory ? { recentDataSummary: `已参考确认复盘：${memory.keep[0] ?? memory.nextContentSignals[0] ?? "已确认结论"}` } : {}),
    repetitionRisk: "low",
    nextSignal: "发布后观察完播率，以及评论中出现的真实问题。",
  }
}

export function buildCreationEvidenceCatalog(
  profile: IpProfile,
  memory?: ConfirmedCreationMemory | null,
): CreationEvidenceCatalogItem[] {
  const items: CreationEvidenceCatalogItem[] = []
  const add = (item: CreationEvidenceCatalogItem) => {
    if (item.label.trim() && !items.some((candidate) => candidate.sourceAnswerId === item.sourceAnswerId)) items.push(item)
  }
  const portrait = profile.contentPortrait

  portrait?.confirmedFacts?.forEach((fact) => {
    fact.sourceQuestionIds.forEach((sourceAnswerId) => add({ label: fact.statement, sourceAnswerId, sourceType: "ip_answer" }))
  })
  if (portrait?.targetAudience) {
    portrait.sourceMap.targetAudience?.forEach((sourceAnswerId) => add({
      label: portrait.targetAudience,
      sourceAnswerId,
      sourceType: "ip_answer",
    }))
  }
  portrait?.topicPillars?.forEach((pillar) => {
    pillar.sourceQuestionIds.forEach((sourceAnswerId) => add({
      label: `${pillar.title}：${pillar.rationale}`,
      sourceAnswerId,
      sourceType: "ip_answer",
    }))
  })

  ;([
    [profile.experience, "profile:experience"],
    [profile.expertise, "profile:expertise"],
    [profile.audience, "profile:audience"],
    [profile.boundaries, "profile:boundaries"],
  ] as const).forEach(([label, sourceAnswerId]) => add({ label, sourceAnswerId, sourceType: "ip_answer" }))

  if (memory) {
    memory.keep.forEach((label, index) => add({ label, sourceAnswerId: `memory:v${memory.version}:keep:${index}`, sourceType: "confirmed_memory" }))
    memory.avoid.forEach((label, index) => add({ label, sourceAnswerId: `memory:v${memory.version}:avoid:${index}`, sourceType: "confirmed_memory" }))
    memory.nextContentSignals.forEach((label, index) => add({ label, sourceAnswerId: `memory:v${memory.version}:next:${index}`, sourceType: "confirmed_memory" }))
  }
  return items
}

export function groundCreationDecisionBrief(
  input: unknown,
  catalog: CreationEvidenceCatalogItem[],
  memory?: ConfirmedCreationMemory | null,
): CreationDecisionBrief {
  const parsed = creationDecisionBriefSchema.parse(input)
  const allowed = new Map(catalog.map((item) => [item.sourceAnswerId, item]))
  if (parsed.ipEvidenceRefs.some((reference) => !allowed.has(reference.sourceAnswerId))) {
    throw Object.assign(new Error("DECISION_EVIDENCE_INVALID"), { code: "DECISION_EVIDENCE_INVALID" })
  }

  const ipEvidenceRefs = parsed.ipEvidenceRefs.map((reference) => ({
    label: allowed.get(reference.sourceAnswerId)!.label,
    sourceAnswerId: reference.sourceAnswerId,
  }))
  if (!memory) {
    const { recentDataSummary: _ignored, ...brief } = parsed
    return creationDecisionBriefSchema.parse({ ...brief, ipEvidenceRefs, recentDataStatus: "none" })
  }
  const summaryBase = parsed.recentDataSummary
    ?? `已参考确认复盘：${memory.keep[0] ?? memory.nextContentSignals[0] ?? "已确认的账号复盘结论"}`
  const summary = summaryBase.includes(`记忆 v${memory.version}`)
    ? summaryBase : `${summaryBase} · 记忆 v${memory.version}`
  return creationDecisionBriefSchema.parse({
    ...parsed,
    ipEvidenceRefs,
    recentDataStatus: "available",
    recentDataSummary: summary,
  })
}
