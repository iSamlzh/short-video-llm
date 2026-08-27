import { z } from "zod"
import type { ConfirmedCreationMemory } from "./growth-loop"
import type { IpProfile } from "./models"

export const creationDecisionBriefSchema = z.object({
  recommendationSummary: z.string().trim().min(8).optional(),
  portraitFitSummary: z.string().trim().min(8).optional(),
  objective: z.enum(["建立信任", "用户教育", "产品认知", "咨询转化"]),
  whyToday: z.string().trim().min(5),
  audienceProblem: z.string().trim().min(5),
  topicOpportunity: z.string().trim().min(5).optional(),
  ipEvidenceRefs: z.array(z.object({
    label: z.string().trim().min(1),
    sourceAnswerId: z.string().trim().min(1),
    relevance: z.string().trim().min(5).optional(),
  })).min(1),
  structureChoice: z.object({
    structureId: z.string().trim().min(1),
    structureName: z.string().trim().min(1),
    reason: z.string().trim().min(5),
  }).optional(),
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
  heading: z.string().trim().min(2).max(20).optional(),
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

const STRUCTURE_HEADING_ALIASES: Array<[RegExp, string]> = [
  [/identity[-_ ]?contrast|身份反差/i, "身份反差"],
  [/failure|失败|踩坑/i, "失败经历"],
  [/myth|误区|错误认知/i, "误区纠正"],
  [/case|案例|场景/i, "真实场景"],
  [/turn|转折|反转/i, "认知转折"],
  [/method|step|方法|步骤|动作/i, "方法拆解"],
  [/insight|经验|提炼|认知/i, "经验提炼"],
  [/proof|evidence|事实|依据/i, "事实回应"],
  [/value|价值|原则|边界/i, "价值收束"],
  [/question|疑问|问题|痛点|冲突/i, "问题冲突"],
  [/hook|opening|开场/i, "开场钩子"],
  [/cta|行动引导|咨询引导/i, "行动引导"],
]

function structureNodeHeading(node: { kind?: string; instruction?: string }) {
  const source = `${node.kind ?? ""} ${node.instruction ?? ""}`
  const explicit = node.instruction?.match(/^([^：:]{2,10})[：:]/)?.[1]?.trim()
  if (explicit) return explicit
  return STRUCTURE_HEADING_ALIASES.find(([pattern]) => pattern.test(source))?.[1] ?? "结构展开"
}

function fallbackSpokenHeading(index: number, total: number) {
  if (index === 0) return "开场钩子"
  if (index === total - 1) return "行动引导"
  const bodyHeadings = total >= 5
    ? ["问题展开", "真实经历", "方法总结"]
    : total === 4
      ? ["问题展开", "方法总结"]
      : ["核心内容"]
  return bodyHeadings[Math.min(index - 1, bodyHeadings.length - 1)]
}

export function scriptSegmentHeading(segment: ScriptSegment, spokenIndex: number, spokenTotal: number) {
  if (segment.heading) return segment.heading
  if (segment.kind === "spoken") return fallbackSpokenHeading(spokenIndex, spokenTotal)
  return {
    shot_instruction: "拍摄提示",
    subtitle_emphasis: "字幕强调",
    compliance_note: "合规备注",
  }[segment.kind]
}

export function scriptToSegments(script: {
  id: string
  hook: string
  body: string
  callToAction: string
  segments?: unknown
}, structureNodes: Array<{ kind?: string; instruction?: string }> = []): ScriptSegment[] {
  const structured = scriptSegmentsSchema.safeParse(script.segments)
  if (structured.success) return structured.data
  const spokenTexts = [
    script.hook,
    ...script.body.split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean),
    script.callToAction,
  ]
  const bodyCount = Math.max(0, spokenTexts.length - 2)
  const structureHeadings = structureNodes.map(structureNodeHeading)
  const headings = [
    structureHeadings[0] ?? "开场钩子",
    ...Array.from({ length: bodyCount }, (_, index) => structureHeadings[index + 1]
      ?? fallbackSpokenHeading(index + 1, spokenTexts.length)),
    "行动引导",
  ]
  const spoken = spokenTexts.map((text, index) => ({
    id: `${script.id}-spoken-${index + 1}`,
    kind: "spoken" as const,
    heading: headings[index],
    text,
  }))
  const production = DEFAULT_SHOOTING_TIPS.map((text, index) => ({
    id: `${script.id}-shot-${index + 1}`,
    kind: "shot_instruction" as const,
    heading: "拍摄提示",
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
    recommendationSummary: "这个 IP 适合用真实经历回答受众当前最需要建立的信任判断。",
    portraitFitSummary: "画像显示该 IP 具备真实的一线经历，适合输出有事实基础的判断型内容。",
    objective: "建立信任",
    whyToday: "当前选题与这个 IP 已确认的经历和受众问题直接相关。",
    audienceProblem: "受众需要一个来自真实经历、可以理解并采用的判断。",
    topicOpportunity: "从已确认的真实经历切入，把抽象观点转成受众今天可以采用的判断。",
    ipEvidenceRefs: [{
      label: evidence.label,
      sourceAnswerId: evidence.sourceAnswerId,
      relevance: "这条已确认信息能为当前选题提供可信的第一手讲述视角。",
    }],
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
    ...(reference.relevance ? { relevance: reference.relevance } : {}),
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
