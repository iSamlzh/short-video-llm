import { scriptBatchSchema, topicBatchSchema } from "../domain/schemas"
import { transition } from "../domain/state-machine"
import type { IpProfile } from "../domain/models"
import { PrototypeRepository } from "../lib/db/repository"
import { StructuredLlmClient } from "../lib/llm/structured"
import { prototypePreset } from "../presets"

export class RunService {
  constructor(private readonly repository: PrototypeRepository, private readonly llm: StructuredLlmClient) {}

  createRun(input: IpProfile) { return this.repository.createRun(input) }
  getRun(runId: string) { return this.repository.requireRun(runId) }

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
      }, topicBatchSchema)
      const batch = this.repository.saveTopicBatch(runId, inputVersion, items, `${runId}:topics:${inputVersion}`)
      this.repository.setState(runId, transition("GENERATING_TOPICS", "TOPICS_GENERATED"))
      return batch
    } catch (error) {
      this.repository.setState(runId, "READY_FOR_TOPICS")
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
      }, scriptBatchSchema)
      if (items.some(item => item.topicDirectionId !== selection.topicId)) throw new Error("SCRIPT_DIRECTION_MISMATCH")
      const batch = this.repository.saveScriptBatch(runId, inputVersion, items, `${runId}:scripts:${inputVersion}:${selection.version}`)
      this.repository.setState(runId, transition("GENERATING_SCRIPTS", "SCRIPTS_GENERATED"))
      return batch
    } catch (error) {
      this.repository.setState(runId, "READY_FOR_SCRIPTS")
      throw error
    }
  }

  selectScript(runId: string, batchVersion: number, scriptId: string) {
    const run = this.repository.requireRun(runId)
    const selection = this.repository.selectScript(runId, batchVersion, scriptId)
    this.repository.setState(runId, transition(run.state, "SELECT_SCRIPT"))
    return selection
  }
}
