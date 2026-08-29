import { createHash, randomUUID } from "node:crypto"
import { contentReviewSchema, qualityReportSchema, scriptCandidateSchema, scriptRevisionParagraphsSchema, singleScriptModelOutputSchema, topicBatchModelOutputSchema, topicBatchSchema, type ScriptCandidate, type TopicDirectionCandidate } from "../domain/schemas"
import { transition } from "../domain/state-machine"
import type { IpProfile } from "../domain/models"
import type { ConfirmedCreationMemory } from "../domain/growth-loop"
import { PrototypeRepository } from "../lib/db/repository"
import { StructuredLlmClient } from "../lib/llm/structured"
import { prototypePreset } from "../presets"
import { simulateMetrics, type SimulationScenario } from "../lib/simulation/metric-simulator"
import type { TemplatePackage } from "../domain/content-brain"
import { buildCreationEvidenceCatalog, createFallbackCreationDecisionBrief, creationDecisionBriefSchema, estimateSpokenDuration, groundCreationDecisionBrief, scriptSegmentsSchema, scriptToSegments, type CreationEvidenceCatalogItem, type ScriptSegment } from "../domain/creation-contracts"
import { normalizeStructureNodes } from "../domain/content-brain"

export type TemplateRetrievalQuery = { ipTags: string[]; audience: string; goal: string }
type StructureProvider = (query: TemplateRetrievalQuery) => TemplatePackage[]
type ModelStructure = {
  structureId: string
  structureName: string
  nodes: TemplatePackage["nodes"]
  qualityRules: string[]
  riskRules: string[]
}

const prototypeTemplatePackage: TemplatePackage = {
  templateVersionId: "prototype-default-v1",
  templateId: "prototype-default",
  name: "原型默认结构",
  applicability: { ipTags: [], audiences: [], goals: [] },
  nodes: prototypePreset.structures.map((instruction, index) => ({ kind: `step-${index + 1}`, instruction, required: true })),
  qualityRules: ["符合当前 IP 的真实经历与表达边界"],
  riskRules: ["不得虚构案例或承诺收益"],
}

function buildGroundedDecisionBrief(
  item: TopicDirectionCandidate,
  evidenceCatalog: CreationEvidenceCatalogItem[],
  structures: ModelStructure[],
  memory?: ConfirmedCreationMemory,
) {
  const grounded = groundCreationDecisionBrief(item.decisionBrief, evidenceCatalog, memory)
  const structure = structures.find((candidate) => candidate.structureId === item.structureId) ?? structures[0]
  const topicOpportunity = grounded.topicOpportunity
    ?? `${item.angle}，直接回应“${item.audienceTension}”这个具体顾虑。`
  const structureReason = grounded.structureChoice?.structureId === structure.structureId
    ? grounded.structureChoice.reason
    : `这条内容需要用“${structure.nodes.map((node) => node.instruction).join(" → ")}”把真实经历转成受众能理解的判断。`

  const portraitFitSummary = (grounded.portraitFitSummary
    ?? grounded.ipEvidenceRefs.map((reference) => reference.relevance).filter(Boolean).join("；"))
    || "画像显示该 IP 具备与当前选题相关的真实经历，适合输出有事实基础的判断。"

  return creationDecisionBriefSchema.parse({
    ...grounded,
    portraitFitSummary,
    recommendationSummary: grounded.recommendationSummary
      ?? `结合当前 IP 的真实经历与表达定位，建议今天讲“${item.title}”，回应受众“${item.audienceTension}”的顾虑。`,
    topicOpportunity,
    ipEvidenceRefs: grounded.ipEvidenceRefs.map((reference) => ({
      ...reference,
      relevance: reference.relevance
        ?? `这条已确认信息能为“${item.title}”提供可信的第一手讲述依据。`,
    })),
    structureChoice: {
      structureId: structure.structureId,
      structureName: structure.structureName,
      reason: structureReason,
    },
  })
}

export class RunService {
  constructor(
    private readonly repository: PrototypeRepository,
    private readonly llm: StructuredLlmClient,
    private readonly structureProvider: StructureProvider = () => [prototypeTemplatePackage],
  ) {}

  createRun(input: IpProfile) { return this.repository.createRun(input) }
  createRunWithTopicPool(input: IpProfile, topicsInput: TopicDirectionCandidate[]) {
    const run = this.repository.createRun(input)
    const topics = topicBatchSchema.parse(topicsInput)
    this.repository.setState(run.id, transition(run.state, "GENERATE_TOPICS"))
    const batch = this.repository.saveTopicBatch(run.id, run.inputVersion, topics, `${run.id}:copied-topics:${run.inputVersion}`)
    this.repository.setState(run.id, transition("GENERATING_TOPICS", "TOPICS_GENERATED"))
    return { run: this.repository.requireRun(run.id), batch }
  }
  getRun(runId: string) { return this.repository.requireRun(runId) }
  getRunView(runId: string) {
    return {
      ...this.repository.requireRun(runId),
      topicBatch: this.repository.getTopicBatch(runId),
      topicSelection: this.repository.getCurrentTopicSelection(runId),
      scriptBatch: this.repository.getScriptBatch(runId),
      scriptSelection: this.repository.getCurrentScriptSelection(runId),
      qualityReport: this.repository.getLatestQualityReport(runId),
      lockedScript: this.repository.getLatestLockedScript(runId),
      metricSnapshot: this.repository.getLatestMetricSnapshot(runId),
      review: this.repository.getLatestReview(runId),
      stepErrors: this.repository.listStepErrors(runId),
    }
  }

  async generateTopics(runId: string, inputVersion: number, tenantMemory?: ConfirmedCreationMemory) {
    const run = this.repository.requireVersion(runId, inputVersion)
    const structureContext = this.resolveStructureContext(run.ipProfile)
    const evidenceCatalog = buildCreationEvidenceCatalog(run.ipProfile, tenantMemory)
    const existing = this.repository.getTopicBatch(runId)
    if (existing?.inputVersion === inputVersion && run.state === "WAITING_TOPIC_SELECTION") return existing
    this.repository.setState(runId, transition(run.state, "GENERATE_TOPICS"))
    try {
      const items = await this.llm.generateStructured("topics", {
        ipProfile: run.ipProfile,
        goal: prototypePreset.goal,
        structures: structureContext.modelStructures,
        evidenceCatalog,
        presetVersion: prototypePreset.version,
        ...(tenantMemory ? { tenantMemory } : {}),
      }, topicBatchModelOutputSchema)
      const groundedItems = items.map((item) => ({
        ...item,
        decisionBrief: buildGroundedDecisionBrief(item, evidenceCatalog, structureContext.modelStructures, tenantMemory),
      }))
      const batch = this.repository.saveTopicBatch(runId, inputVersion, groundedItems, `${runId}:topics:${inputVersion}`)
      this.repository.setState(runId, transition("GENERATING_TOPICS", "TOPICS_GENERATED"))
      return batch
    } catch (error) {
      this.repository.setState(runId, "READY_FOR_TOPICS")
      this.recordFailure(runId, error, "READY_FOR_TOPICS")
      throw error
    }
  }

  async generateTopicDraft(
    runId: string,
    inputVersion: number,
    topicsInput: TopicDirectionCandidate[],
    selectedTopicId: string,
    adjustment: { intent: "change_topic" | "change_expression"; previousScript?: Pick<ScriptCandidate, "title" | "body"> },
    tenantMemory?: ConfirmedCreationMemory,
  ) {
    const run = this.repository.requireVersion(runId, inputVersion)
    const structureContext = this.resolveStructureContext(run.ipProfile)
    const evidenceCatalog = buildCreationEvidenceCatalog(run.ipProfile, tenantMemory)
    const topics = topicBatchSchema.parse(topicsInput.map((item) => ({
      ...item,
      decisionBrief: buildGroundedDecisionBrief(
        {
          ...item,
          decisionBrief: item.decisionBrief ?? createFallbackCreationDecisionBrief(evidenceCatalog, tenantMemory),
        },
        evidenceCatalog,
        structureContext.modelStructures,
        tenantMemory,
      ),
    })))
    if (!topics.some((item) => item.id === selectedTopicId)) throw new Error("TOPIC_SELECTION_INVALID")
    this.repository.setState(runId, transition(run.state, "GENERATE_TOPICS"))
    try {
      const topicBatch = this.repository.saveTopicBatch(runId, inputVersion, topics, `${runId}:adjust:topics:${inputVersion}`)
      this.repository.setState(runId, transition("GENERATING_TOPICS", "TOPICS_GENERATED"))
      this.selectTopic(runId, topicBatch.version, selectedTopicId)
      const scripts = await this.generateScripts(runId, inputVersion, tenantMemory, adjustment)
      const selectedScript = scripts.items[0]
      if (!selectedScript) throw new Error("NO_SCRIPT_GENERATED")
      this.selectScript(runId, scripts.version, selectedScript.id)
      return { ...this.getRunView(runId), structureVersionIds: structureContext.structureVersionIds }
    } catch (error) {
      if (this.repository.requireRun(runId).state === "GENERATING_TOPICS") this.repository.setState(runId, "READY_FOR_TOPICS")
      this.recordFailure(runId, error, this.repository.requireRun(runId).state)
      throw error
    }
  }

  selectTopic(runId: string, batchVersion: number, topicId: string) {
    const run = this.repository.requireRun(runId)
    const selection = this.repository.selectTopic(runId, batchVersion, topicId)
    if (run.state === "WAITING_TOPIC_SELECTION") {
      this.repository.setState(runId, transition(run.state, "SELECT_TOPIC"))
    }
    return selection
  }

  async selectTopicAndGenerateScripts(runId: string, batchVersion: number, topicId: string, inputVersion: number) {
    this.selectTopic(runId, batchVersion, topicId)
    return this.generateScripts(runId, inputVersion)
  }

  async generateScripts(
    runId: string,
    inputVersion: number,
    tenantMemory?: ConfirmedCreationMemory,
    adjustment?: { intent: "change_topic" | "change_expression"; previousScript?: Pick<ScriptCandidate, "title" | "body"> },
  ) {
    const run = this.repository.requireVersion(runId, inputVersion)
    const existing = this.repository.getScriptBatch(runId)
    if (existing?.inputVersion === inputVersion && run.state === "WAITING_SCRIPT_SELECTION") return existing
    const selection = this.repository.getCurrentTopicSelection(runId)
    if (!selection) throw new Error("TOPIC_SELECTION_REQUIRED")
    const topic = this.repository.getTopicBatch(runId, selection.batchVersion)?.items.find(item => item.id === selection.topicId)
    if (!topic) throw new Error("TOPIC_SELECTION_STALE")
    const structureContext = this.resolveStructureContext(run.ipProfile)
    const selectedStructureIndex = Math.max(0, structureContext.modelStructures.findIndex((item) => item.structureId === topic.structureId))
    const selectedStructure = structureContext.modelStructures[selectedStructureIndex]
    this.repository.setState(runId, transition(run.state, "GENERATE_SCRIPTS"))
    try {
      const generated = await this.llm.generateStructured("scripts", {
        ipProfile: run.ipProfile, goal: prototypePreset.goal, selectedTopic: topic,
        structures: structureContext.modelStructures,
        instruction: "一次只生成一篇可以直接拍摄的完整口播稿",
        ...(adjustment ? { adjustment } : {}),
        ...(tenantMemory ? { tenantMemory } : {}),
      }, singleScriptModelOutputSchema)
      const id = randomUUID()
      const segments = scriptToSegments({
        id,
        hook: generated.hook,
        body: generated.body,
        callToAction: generated.callToAction,
      }, selectedStructure.nodes, { sourceTemplateVersionId: structureContext.structureVersionIds[selectedStructureIndex] })
      const estimatedSeconds = Math.max(15, Math.min(300, estimateSpokenDuration(segments).estimatedSeconds))
      const item = scriptCandidateSchema.parse({
        ...generated,
        id,
        topicDirectionId: selection.topicId,
        estimatedSeconds,
        segments,
      })
      const batch = this.repository.saveScriptBatch(runId, inputVersion, [item], `${runId}:scripts:${inputVersion}:${selection.version}`)
      this.repository.setState(runId, transition("GENERATING_SCRIPTS", "SCRIPTS_GENERATED"))
      return batch
    } catch (error) {
      this.repository.setState(runId, "READY_FOR_SCRIPTS")
      this.recordFailure(runId, error, "READY_FOR_SCRIPTS")
      throw error
    }
  }

  selectScript(runId: string, batchVersion: number, scriptId: string) {
    const run = this.repository.requireRun(runId)
    const selection = this.repository.selectScript(runId, batchVersion, scriptId)
    this.repository.setState(runId, transition(run.state, "SELECT_SCRIPT"))
    return selection
  }

  async runQa(runId: string, inputVersion: number) {
    const run = this.repository.requireVersion(runId, inputVersion)
    const script = this.repository.getSelectedScript(runId)
    if (!script) throw new Error("SCRIPT_SELECTION_REQUIRED")
    const selection = this.repository.getCurrentScriptSelection(runId)
    if (!selection) throw new Error("SCRIPT_SELECTION_REQUIRED")
    this.repository.setState(runId, transition(run.state, "RUN_QA"))
    try {
      const report = await this.llm.generateStructured("qa", {
        ipProfile: run.ipProfile, goal: prototypePreset.goal, selectedScript: script,
        instruction: "只检查，不改写",
      }, qualityReportSchema)
      const saved = this.repository.saveQualityReport(runId, report, selection.version)
      this.repository.setState(runId, transition("RUNNING_QA", "QA_COMPLETED"))
      return saved
    } catch (error) {
      this.repository.setState(runId, "READY_FOR_QA")
      this.recordFailure(runId, error, "READY_FOR_QA")
      throw error
    }
  }

  saveScriptRevision(runId: string, expectedRevision: number, input: string[] | ScriptSegment[]) {
    const run = this.repository.requireRun(runId)
    const currentSelection = this.repository.getCurrentScriptSelection(runId)
    const currentScript = this.repository.getSelectedScript(runId)
    if (!currentSelection || !currentScript) throw new Error("SCRIPT_SELECTION_REQUIRED")

    const currentSegments = scriptToSegments(currentScript)
    const legacyParagraphs = typeof input[0] === "string" ? scriptRevisionParagraphsSchema.parse(input) : null
    const submittedSegments = legacyParagraphs
      ? [
        ...scriptToSegments({
        ...currentScript,
        segments: undefined,
        hook: legacyParagraphs[0],
        body: legacyParagraphs.slice(1, -1).join("\n\n"),
        callToAction: legacyParagraphs.at(-1)!,
      }).filter((segment) => segment.kind === "spoken"),
        ...currentSegments.filter((segment) => segment.kind !== "spoken"),
      ]
      : scriptSegmentsSchema.parse(input)
    const currentById = new Map(currentSegments.map((segment) => [segment.id, segment]))
    const currentSpoken = currentSegments.filter((segment) => segment.kind === "spoken")
    let spokenIndex = 0
    const segments = submittedSegments.map((segment) => {
      const source = currentById.get(segment.id)
        ?? (segment.kind === "spoken" && legacyParagraphs ? currentSpoken[spokenIndex++] : undefined)
      if (!source) {
        const { sourceTemplateVersionId: _template, sourceNodeKey: _node, sourceSegmentIds: _sources, ...safe } = segment
        return { ...safe, origin: "user_added" as const }
      }
      return {
        ...segment,
        origin: source.origin ?? "legacy" as const,
        ...(source.sourceTemplateVersionId ? { sourceTemplateVersionId: source.sourceTemplateVersionId } : {}),
        ...(source.sourceNodeKey ? { sourceNodeKey: source.sourceNodeKey } : {}),
        ...(source.sourceSegmentIds?.length ? { sourceSegmentIds: source.sourceSegmentIds } : {}),
        ...(segment.id !== source.id ? {
          sourceSegmentIds: [...new Set([...(source.sourceSegmentIds ?? []), source.id])],
        } : {}),
      }
    })
    const spoken = segments.filter((segment) => segment.kind === "spoken")
    if (spoken.length < 3) throw new Error("SCRIPT_SPOKEN_SEGMENTS_INVALID")

    const hook = spoken[0].text
    const body = spoken.slice(1, -1).map((segment) => segment.text).join("\n\n")
    const callToAction = spoken.at(-1)!.text
    const comparable = (items: ScriptSegment[]) => items.map(({ kind, text }) => ({ kind, text }))
    const unchanged = JSON.stringify(comparable(segments)) === JSON.stringify(comparable(currentSegments))
    if (unchanged) {
      return { saved: false, revision: currentSelection.version, runView: this.getRunView(runId) }
    }
    if (currentSelection.version !== expectedRevision) throw new Error("SCRIPT_VERSION_CONFLICT")

    const edited: ScriptCandidate = {
      ...currentScript,
      id: randomUUID(),
      hook,
      body,
      callToAction,
      segments,
      estimatedSeconds: Math.max(15, estimateSpokenDuration(segments).estimatedSeconds),
    }
    const contentHash = createHash("sha256").update(JSON.stringify(edited)).digest("hex")
    const batch = this.repository.saveScriptBatch(
      runId,
      run.inputVersion,
      [edited],
      `${runId}:manual:${currentSelection.version}:${contentHash}`,
    )
    const selection = this.repository.selectScript(runId, batch.version, edited.id)
    this.repository.setState(runId, transition(run.state, "SAVE_SCRIPT_REVISION"))
    return { saved: true, revision: selection.version, runView: this.getRunView(runId) }
  }

  lockScript(runId: string) {
    const run = this.repository.requireRun(runId)
    const selection = this.repository.getCurrentScriptSelection(runId)
    if (!selection) throw new Error("SCRIPT_SELECTION_REQUIRED")
    const existing = this.repository.getLockedScriptForSelection(runId, selection.version)
    if (existing) return existing
    const locked = this.repository.lockSelectedScript(runId, selection.version)
    this.repository.setState(runId, transition(run.state, "LOCK"))
    return locked
  }

  simulatePublication(runId: string, requestedScenario: SimulationScenario = "normal") {
    const run = this.repository.requireRun(runId)
    const locked = this.repository.getLatestLockedScript(runId)
    const report = this.repository.getLatestQualityReport(runId)
    if (!locked || !report) throw new Error("LOCKED_SCRIPT_REQUIRED")
    this.repository.setState(runId, transition(run.state, "SIMULATE_PUBLICATION"))
    const scenario = process.env.PROTOTYPE_DEMO_CONTROLS === "true" ? requestedScenario : "normal"
    const snapshot = simulateMetrics({ runId, lockedScriptVersion: locked.version, scores: report.scores }, scenario)
    const saved = this.repository.saveMetricSnapshot(runId, snapshot)
    this.repository.setState(runId, transition("SIMULATING_PUBLICATION", "PUBLICATION_SIMULATED"))
    return saved
  }

  async generateReview(runId: string, metricVersion: number) {
    const run = this.repository.requireRun(runId)
    const metricSnapshot = this.repository.getLatestMetricSnapshot(runId)
    const topicSelection = this.repository.getCurrentTopicSelection(runId)
    const lockedScript = this.repository.getLatestLockedScript(runId)
    const qualityReport = this.repository.getLatestQualityReport(runId)
    if (!metricSnapshot || metricSnapshot.version !== metricVersion || !topicSelection || !lockedScript || !qualityReport) {
      throw new Error("REVIEW_LINEAGE_INCOMPLETE")
    }
    this.repository.setState(runId, transition(run.state, "GENERATE_REVIEW"))
    try {
      const review = await this.llm.generateStructured("review", {
        ipProfile: run.ipProfile, goal: prototypePreset.goal, topicSelection,
        lockedScript, qualityReport, metricSnapshot,
        instruction: "指标为模拟数据，不得推断真实平台因果",
      }, contentReviewSchema)
      if (review.claimsRealCausation !== false) throw new Error("REVIEW_CAUSALITY_VIOLATION")
      const saved = this.repository.saveReview(runId, review)
      this.repository.setState(runId, transition("REVIEWING", "REVIEW_COMPLETED"))
      return saved
    } catch (error) {
      this.repository.setState(runId, "WAITING_REVIEW")
      this.recordFailure(runId, error, "WAITING_REVIEW")
      throw error
    }
  }

  private recordFailure(runId: string, error: unknown, retryFromState: Parameters<PrototypeRepository["recordStepError"]>[1]["retryFromState"]) {
    const value = error as { code?: string; message?: string }
    this.repository.recordStepError(runId, {
      code: value.code ?? value.message ?? "UNKNOWN_ERROR",
      message: value.message ?? "操作失败",
      retryFromState,
    })
  }

  getStructureVersionIds(profile: IpProfile) {
    return this.resolveStructureContext(profile).structureVersionIds
  }

  getSelectedStructureLineage(runId: string, structureVersionIds?: string[]) {
    const run = this.repository.requireRun(runId)
    const selection = this.repository.getCurrentTopicSelection(runId)
    const topic = selection
      ? this.repository.getTopicBatch(runId, selection.batchVersion)?.items.find((item) => item.id === selection.topicId)
      : null
    const versionIds = structureVersionIds ?? this.getStructureVersionIds(run.ipProfile)
    const match = topic?.structureId.match(/^structure-(\d+)$/)
    const selectedIndex = match ? Number(match[1]) - 1 : -1
    const primaryStructureVersionId = selectedIndex >= 0 ? versionIds[selectedIndex] ?? null : null
    return {
      primaryStructureVersionId,
      supportingStructureVersionIds: primaryStructureVersionId
        ? versionIds.filter((id) => id !== primaryStructureVersionId)
        : versionIds,
    }
  }

  private resolveStructureContext(profile: IpProfile) {
    const packages = this.structureProvider({
      ipTags: [profile.expertise],
      audience: profile.audience,
      goal: prototypePreset.goal.name,
    })
    if (!packages.length) {
      throw Object.assign(new Error("平台尚未启用可用的内容结构"), { code: "NO_ACTIVE_TEMPLATE" })
    }
    return {
      structureVersionIds: packages.map((item) => item.templateVersionId),
      modelStructures: packages.map((item, index) => ({
        structureId: `structure-${index + 1}`,
        structureName: `推荐表达结构 ${index + 1}`,
        nodes: normalizeStructureNodes(item.nodes),
        qualityRules: item.qualityRules,
        riskRules: item.riskRules,
      })),
    }
  }
}
