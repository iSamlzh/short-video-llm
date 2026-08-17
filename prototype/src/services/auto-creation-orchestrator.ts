import type { IpProfile } from "../domain/models"
import { RunService } from "./run-service"

export class AutoCreationOrchestrator {
  constructor(private readonly runs: RunService) {}

  async createUsableDraft(profile: IpProfile) {
    const run = this.runs.createRun(profile)
    await this.runs.generateAutoDraft(run.id, run.inputVersion)
    return { run: this.runs.getRun(run.id), ...this.runs.getRunView(run.id) }
  }
}
