import type Database from "better-sqlite3"
import type { TenantAccessContext } from "../domain/access"
import { ipProfileSchema } from "../domain/schemas"
import { requireTenantCapability } from "../lib/auth/guards"
import { CreationLineageRepository } from "../lib/db/creation-lineage-repository"
import { presentCreationDraft } from "./creation-presenter"
import { AutoCreationOrchestrator } from "./auto-creation-orchestrator"
import { RunService } from "./run-service"

type CurrentRow = { ip_profile_id: string; content_account_id: string | null; profile_json: string }

export class CreationAppService {
  private readonly lineage: CreationLineageRepository

  constructor(
    private readonly database: Database.Database,
    private readonly runs: RunService,
    private readonly orchestrator: AutoCreationOrchestrator,
  ) {
    this.lineage = new CreationLineageRepository(database)
  }

  getCurrent(context: TenantAccessContext, businessDate = chinaBusinessDate()) {
    const current = this.currentContext(context)
    const lineage = this.lineage.current(context.tenantId, current.ipId, current.accountId, businessDate)
    if (!lineage) return null
    return presentCreationDraft(this.runs.getRunView(lineage.runId))
  }

  async create(context: TenantAccessContext, options: { intent?: "initial" | "change_topic" | "change_expression"; fromRunId?: string } = {}, businessDate = chinaBusinessDate()) {
    requireTenantCapability(context, "content.create")
    const current = this.currentContext(context)
    let adjustment
    if (options.intent === "change_topic" || options.intent === "change_expression") {
      if (!options.fromRunId || !this.lineage.canAccess(options.fromRunId, context)) throw new Error("PREVIOUS_RUN_NOT_FOUND")
      const previous = this.runs.getRunView(options.fromRunId)
      const previousScript = previous.scriptBatch?.items.find((item) => item.id === previous.scriptSelection?.scriptId)
      if (!previous.topicBatch || !previous.topicSelection || !previousScript) throw new Error("PREVIOUS_RUN_INCOMPLETE")
      adjustment = {
        intent: options.intent,
        topics: previous.topicBatch.items,
        selectedTopicId: previous.topicSelection.topicId,
        previousScript: {
          title: previousScript.title,
          body: previousScript.body,
        },
      }
    }
    const result = await this.orchestrator.createUsableDraft(current.profile, adjustment)
    this.lineage.attach({
      runId: result.run.id,
      tenantId: context.tenantId,
      actorUserId: context.userId,
      ipId: current.ipId,
      accountId: current.accountId,
      businessDate,
    })
    return presentCreationDraft(result)
  }

  getRun(context: TenantAccessContext, runId: string) {
    requireTenantCapability(context, "content.create")
    if (!this.lineage.canAccess(runId, context)) throw new Error("RUN_NOT_FOUND")
    return presentCreationDraft(this.runs.getRunView(runId))
  }

  saveDraft(
    context: TenantAccessContext,
    runId: string,
    input: { expectedRevision: number; paragraphs: string[] },
  ) {
    requireTenantCapability(context, "content.edit")
    if (!this.lineage.canAccess(runId, context)) throw new Error("RUN_NOT_FOUND")
    const result = this.runs.saveScriptRevision(runId, input.expectedRevision, input.paragraphs)
    return { ...presentCreationDraft(result.runView), saved: result.saved }
  }

  async finalize(
    context: TenantAccessContext,
    runId: string,
    input: { expectedRevision: number; paragraphs: string[] },
  ) {
    requireTenantCapability(context, "content.edit")
    if (!this.lineage.canAccess(runId, context)) throw new Error("RUN_NOT_FOUND")
    this.runs.saveScriptRevision(runId, input.expectedRevision, input.paragraphs)
    let run = this.runs.getRun(runId)
    if (run.state === "READY_FOR_QA") {
      await this.runs.runQa(runId, run.inputVersion)
      run = this.runs.getRun(runId)
    }
    if (run.state !== "WAITING_LOCK_CONFIRMATION" && run.state !== "LOCKED") {
      throw new Error("DRAFT_NOT_READY_TO_FINALIZE")
    }
    this.runs.lockScript(runId)
    return presentCreationDraft(this.runs.getRunView(runId))
  }

  private currentContext(context: TenantAccessContext) {
    const row = this.database.prepare(`SELECT c.ip_profile_id, c.content_account_id, i.profile_json
      FROM user_current_context c JOIN ip_profiles i ON i.id = c.ip_profile_id
      WHERE c.user_id = ? AND c.tenant_id = ? AND i.status = 'active'`)
      .get(context.userId, context.tenantId) as CurrentRow | undefined
    if (!row) throw Object.assign(new Error("CURRENT_IP_REQUIRED"), { code: "CURRENT_IP_REQUIRED" })
    requireTenantCapability(context, "content.create", {
      ipId: row.ip_profile_id,
      contentAccountId: row.content_account_id ?? undefined,
    })
    return {
      ipId: row.ip_profile_id,
      accountId: row.content_account_id,
      profile: ipProfileSchema.parse(JSON.parse(row.profile_json)),
    }
  }
}

export function chinaBusinessDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date)
}
