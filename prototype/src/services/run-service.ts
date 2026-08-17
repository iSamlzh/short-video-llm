import { createHash, randomUUID } from "node:crypto"
import { autoDraftSchema, contentReviewSchema, qualityReportSchema, scriptBatchSchema, scriptRevisionParagraphsSchema, topicBatchSchema, topicDraftSchema, type ScriptCandidate, type TopicDirectionCandidate } from "../domain/schemas"
import { transition } from "../domain/state-machine"
import type { IpProfile } from "../domain/models"
import type { ConfirmedCreationMemory } from "../domain/growth-loop"
import { PrototypeRepository } from "../lib/db/repository"
import { StructuredLlmClient } from "../lib/llm/structured"
import { prototypePreset } from "../presets"
import { simulateMetrics, type SimulationScenario } from "../lib/simulation/metric-simulator"
import type { TemplatePackage } from "../domain/content-brain"

export type TemplateRetrievalQuery = { ipTags: string[]; audience: string; goal: string }
type StructureProvider = (query: TemplateRetrievalQuery) => TemplatePackage[]

const prototypeTemplatePackage: TemplatePackage = {
  templateVersionId: "prototype-default-v1",
  templateId: "prototype-default",
  name: "原型默认结构",
  applicability: { ipTags: [], audiences: [], goals: [] },
  nodes: prototypePreset.structures.map((instruction, index) => ({ kind: `step-${index + 1}`, instruction, required: true })),
  qualityRules: ["符合当前 IP 的真实经历与表达边界"],
  riskRules: ["不得虚构案例或承诺收益"],
}

export class RunService {
  constructor(
    private readonly repository: PrototypeRepository,
    private readonly llm: StructuredLlmClient,
    private readonly structureProvider: StructureProvider = () => [prototypeTemplatePackage],
  ) {}

  createRun(input: IpProfile) { return this.repository.createRun(input) }
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

  async generateTopics(runId: string, inputVersion: number) {
    const run = this.repository.requireVersion(runId, inputVersion)
    const structureContext = this.resolveStructureContext(run.ipProfile)
    const existing = this.repository.getTopicBatch(runId)
    if (existing?.inputVersion === inputVersion && run.state === "WAITING_TOPIC_SELECTION") return existing
    this.repository.setState(runId, transition(run.state, "GENERATE_TOPICS"))
    try {
      const items = await this.llm.generateStructured("topics", {
        ipProfile: run.ipProfile,
        goal: prototypePreset.goal,
        structures: structureContext.modelStructures,
        presetVersion: prototypePreset.version,
      }, topicBatchSchema, "array")
      const batch = this.repository.saveTopicBatch(runId, inputVersion, items, `${runId}:topics:${inputVersion}`)
      this.repository.setState(runId, transition("GENERATING_TOPICS", "TOPICS_GENERATED"))
      return batch
    } catch (error) {
      this.repository.setState(runId, "READY_FOR_TOPICS")
      this.recordFailure(runId, error, "READY_FOR_TOPICS")
      throw error
    }
  }

  async generateAutoDraft(runId: string, inputVersion: number, tenantMemory?: ConfirmedCreationMemory) {
    const run = this.repository.requireVersion(runId, inputVersion)
    const structureContext = this.resolveStructureContext(run.ipProfile)
    this.repository.setState(runId, transition(run.state, "GENERATE_TOPICS"))
    try {
      const result = await this.llm.generateStructured("auto_draft", {
        ipProfile: run.ipProfile,
        goal: prototypePreset.goal,
        structures: structureContext.modelStructures,
        presetVersion: prototypePreset.version,
        ...(tenantMemory ? { tenantMemory } : {}),
      }, autoDraftSchema)
      const topic = result.topics.find((item) => item.id === result.selectedTopicId)
      if (!topic) throw new Error("AUTO_TOPIC_SELECTION_INVALID")
      if (result.scripts.some((item) => item.topicDirectionId !== topic.id)) throw new Error("SCRIPT_DIRECTION_MISMATCH")
      const script = result.scripts.find((item) => item.id === result.selectedScriptId)
      if (!script) throw new Error("AUTO_SCRIPT_SELECTION_INVALID")

      const topics = this.repository.saveTopicBatch(runId, inputVersion, result.topics, `${runId}:auto:topics:${inputVersion}`)
      this.repository.setState(runId, transition("GENERATING_TOPICS", "TOPICS_GENERATED"))
      this.selectTopic(runId, topics.version, topic.id)
      this.repository.setState(runId, transition("READY_FOR_SCRIPTS", "GENERATE_SCRIPTS"))
      const scripts = this.repository.saveScriptBatch(runId, inputVersion, result.scripts, `${runId}:auto:scripts:${inputVersion}`)
      this.repository.setState(runId, transition("GENERATING_SCRIPTS", "SCRIPTS_GENERATED"))
      const selection = this.selectScript(runId, scripts.version, script.id)
      this.repository.setState(runId, transition("READY_FOR_QA", "RUN_QA"))
      this.repository.saveQualityReport(runId, result.qualityReport, selection.version)
      this.repository.setState(runId, transition("RUNNING_QA", "QA_COMPLETED"))
      if (!result.qualityReport.hardGatePassed) throw Object.assign(new Error("DRAFT_NEEDS_ATTENTION"), { code: "DRAFT_NEEDS_ATTENTION", retryable: true })
      return { ...this.getRunView(runId), structureVersionIds: structureContext.structureVersionIds }
    } catch (error) {
      const current = this.repository.requireRun(runId)
      if (current.state === "GENERATING_TOPICS") this.repository.setState(runId, "READY_FOR_TOPICS")
      this.recordFailure(runId, error, this.repository.requireRun(runId).state)
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
    const topics = topicBatchSchema.parse(topicsInput)
    const selectedTopic = topics.find((item) => item.id === selectedTopicId)
    if (!selectedTopic) throw new Error("TOPIC_SELECTION_INVALID")
    this.repository.setState(runId, transition(run.state, "GENERATE_TOPICS"))
    try {
      const result = await this.llm.generateStructured("topic_draft", {
        ipProfile: run.ipProfile,
        goal: prototypePreset.goal,
        selectedTopic,
        adjustment,
        structures: structureContext.modelStructures,
        ...(tenantMemory ? { tenantMemory } : {}),
      }, topicDraftSchema)
      if (result.scripts.some((item) => item.topicDirectionId !== selectedTopic.id)) throw new Error("SCRIPT_DIRECTION_MISMATCH")
      const selectedScript = result.scripts.find((item) => item.id === result.selectedScriptId)
      if (!selectedScript) throw new Error("AUTO_SCRIPT_SELECTION_INVALID")

      const topicBatch = this.repository.saveTopicBatch(runId, inputVersion, topics, `${runId}:adjust:topics:${inputVersion}`)
      this.repository.setState(runId, transition("GENERATING_TOPICS", "TOPICS_GENERATED"))
      this.selectTopic(runId, topicBatch.version, selectedTopic.id)
      this.repository.setState(runId, transition("READY_FOR_SCRIPTS", "GENERATE_SCRIPTS"))
      const scripts = this.repository.saveScriptBatch(runId, inputVersion, result.scripts, `${runId}:adjust:scripts:${inputVersion}`)
      this.repository.setState(runId, transition("GENERATING_SCRIPTS", "SCRIPTS_GENERATED"))
      const selection = this.selectScript(runId, scripts.version, selectedScript.id)
      this.repository.setState(runId, transition("READY_FOR_QA", "RUN_QA"))
      this.repository.saveQualityReport(runId, result.qualityReport, selection.version)
      this.repository.setState(runId, transition("RUNNING_QA", "QA_COMPLETED"))
      if (!result.qualityReport.hardGatePassed) throw Object.assign(new Error("DRAFT_NEEDS_ATTENTION"), { code: "DRAFT_NEEDS_ATTENTION", retryable: true })
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

  async generateScripts(runId: string, inputVersion: number) {
    const run = this.repository.requireVersion(runId, inputVersion)
    const existing = this.repository.getScriptBatch(runId)
    if (existing?.inputVersion === inputVersion && run.state === "WAITING_SCRIPT_SELECTION") return existing
    const selection = this.repository.getCurrentTopicSelection(runId)
    if (!selection) throw new Error("TOPIC_SELECTION_REQUIRED")
    const topic = this.repository.getTopicBatch(runId, selection.batchVersion)?.items.find(item => item.id === selection.topicId)
    if (!topic) throw new Error("TOPIC_SELECTION_STALE")
    this.repository.setState(runId, transition(run.state, "GENERATE_SCRIPTS"))
    try {
      const items = await this.llm.generateStructured("scripts", {
        ipProfile: run.ipProfile, goal: prototypePreset.goal, selectedTopic: topic,
        instruction: "围绕这个唯一方向生成恰好三篇完整文案",
      }, scriptBatchSchema, "array")
      if (items.some(item => item.topicDirectionId !== selection.topicId)) throw new Error("SCRIPT_DIRECTION_MISMATCH")
      const batch = this.repository.saveScriptBatch(runId, inputVersion, items, `${runId}:scripts:${inputVersion}:${selection.version}`)
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

  saveScriptRevision(runId: string, expectedRevision: number, paragraphsInput: string[]) {
    const run = this.repository.requireRun(runId)
    const paragraphs = scriptRevisionParagraphsSchema.parse(paragraphsInput)
    const currentSelection = this.repository.getCurrentScriptSelection(runId)
    const currentScript = this.repository.getSelectedScript(runId)
    if (!currentSelection || !currentScript) throw new Error("SCRIPT_SELECTION_REQUIRED")

    const hook = paragraphs[0]
    const body = paragraphs.slice(1, -1).join("\n\n")
    const callToAction = paragraphs.at(-1)!
    const unchanged = hook === currentScript.hook
      && body === currentScript.body.trim()
      && callToAction === currentScript.callToAction
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
      estimatedSeconds: Math.max(15, Math.ceil([hook, body, callToAction].join("").length / 4.5)),
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
    const report = this.repository.getLatestQualityReport(runId)
    const selection = this.repository.getCurrentScriptSelection(runId)
    if (!selection) throw new Error("SCRIPT_SELECTION_REQUIRED")
    if (!report || report.scriptSelectionVersion !== selection.version) throw new Error("QA_RESULT_STALE")
    if (!report.hardGatePassed) throw new Error("QA_HARD_GATE_BLOCKED")
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
      modelStructures: packages.map((item) => ({
        nodes: item.nodes,
        qualityRules: item.qualityRules,
        riskRules: item.riskRules,
      })),
    }
  }
}
