import { topicBatchSchema } from "../domain/schemas"
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
}
