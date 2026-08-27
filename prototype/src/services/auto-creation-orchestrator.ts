import type { IpProfile } from "../domain/models"
import type { ScriptCandidate, TopicDirectionCandidate } from "../domain/schemas"
import type { ConfirmedCreationMemory } from "../domain/growth-loop"
import { RunService } from "./run-service"

export type CreationAdjustment = {
  intent: "change_topic" | "change_expression"
  topics: TopicDirectionCandidate[]
  selectedTopicId: string
  previousScript?: Pick<ScriptCandidate, "title" | "body">
}

export class AutoCreationOrchestrator {
  constructor(private readonly runs: RunService) {}

  async createUsableDraft(profile: IpProfile, adjustment?: CreationAdjustment, tenantMemory?: ConfirmedCreationMemory) {
    const run = this.runs.createRun(profile)
    let structureVersionIds: string[]
    if (adjustment) {
      const currentIndex = adjustment.topics.findIndex((item) => item.id === adjustment.selectedTopicId)
      if (currentIndex < 0) throw new Error("PREVIOUS_TOPIC_NOT_FOUND")
      if (adjustment.intent === "change_topic" && adjustment.topics.length < 2) throw new Error("NO_ALTERNATIVE_TOPIC")
      const selectedTopic = adjustment.intent === "change_topic"
        ? adjustment.topics[(currentIndex + 1) % adjustment.topics.length]
        : adjustment.topics[currentIndex]
      const generated = await this.runs.generateTopicDraft(run.id, run.inputVersion, adjustment.topics, selectedTopic.id, {
        intent: adjustment.intent,
        previousScript: adjustment.previousScript,
      }, tenantMemory)
      structureVersionIds = generated.structureVersionIds
    } else {
      const topics = await this.runs.generateTopics(run.id, run.inputVersion, tenantMemory)
      const selectedTopic = topics.items[0]
      if (!selectedTopic) throw new Error("NO_TOPIC_GENERATED")
      this.runs.selectTopic(run.id, topics.version, selectedTopic.id)

      const scripts = await this.runs.generateScripts(run.id, run.inputVersion, tenantMemory)
      const selectedScript = scripts.items[0]
      if (!selectedScript) throw new Error("NO_SCRIPT_GENERATED")
      this.runs.selectScript(run.id, scripts.version, selectedScript.id)
      structureVersionIds = this.runs.getStructureVersionIds(profile)
    }
    return { run: this.runs.getRun(run.id), ...this.runs.getRunView(run.id), structureVersionIds }
  }
}
