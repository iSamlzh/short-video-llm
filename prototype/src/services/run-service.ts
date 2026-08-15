import { contentReviewSchema, qualityReportSchema, scriptBatchSchema, topicBatchSchema } from "../domain/schemas"
import { transition } from "../domain/state-machine"
import type { IpProfile } from "../domain/models"
import { PrototypeRepository } from "../lib/db/repository"
import { StructuredLlmClient } from "../lib/llm/structured"
import { prototypePreset } from "../presets"
import { simulateMetrics, type SimulationScenario } from "../lib/simulation/metric-simulator"

export class RunService {
  constructor(private readonly repository: PrototypeRepository, private readonly llm: StructuredLlmClient) {}

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
    const existing = this.repository.getTopicBatch(runId)
    if (existing?.inputVersion === inputVersion && run.state === "WAITING_TOPIC_SELECTION") return existing
    this.repository.setState(runId, transition(run.state, "GENERATE_TOPICS"))
    try {
      const items = await this.llm.generateStructured("topics", {
        ipProfile: run.ipProfile,
        goal: prototypePreset.goal,
        structures: prototypePreset.structures,
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

  selectTopic(runId: string, batchVersion: number, topicId: string) {
    const run = this.repository.requireRun(runId)
    const selection = this.repository.selectTopic(runId, batchVersion, topicId)
    if (run.state === "WAITING_TOPIC_SELECTION") {
      this.repository.setState(runId, transition(run.state, "SELECT_TOPIC"))
    }
    return selection
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
    this.repository.setState(runId, transition(run.state, "RUN_QA"))
    try {
      const report = await this.llm.generateStructured("qa", {
        ipProfile: run.ipProfile, goal: prototypePreset.goal, selectedScript: script,
        instruction: "只检查，不改写",
      }, qualityReportSchema)
      const saved = this.repository.saveQualityReport(runId, report)
      this.repository.setState(runId, transition("RUNNING_QA", "QA_COMPLETED"))
      return saved
    } catch (error) {
      this.repository.setState(runId, "READY_FOR_QA")
      this.recordFailure(runId, error, "READY_FOR_QA")
      throw error
    }
  }

  lockScript(runId: string) {
    const run = this.repository.requireRun(runId)
    const report = this.repository.getLatestQualityReport(runId)
    if (!report?.hardGatePassed) throw new Error("QA_HARD_GATE_BLOCKED")
    const locked = this.repository.lockSelectedScript(runId)
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
}
