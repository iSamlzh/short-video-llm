import type Database from "better-sqlite3"
import type { TenantAccessContext } from "../domain/access"
import { ipProfileSchema } from "../domain/schemas"
import { requireTenantCapability } from "../lib/auth/guards"
import { CreationLineageRepository } from "../lib/db/creation-lineage-repository"
import { presentCreationDraft } from "./creation-presenter"
import { AutoCreationOrchestrator } from "./auto-creation-orchestrator"
import { RunService } from "./run-service"
import { CreationContextProvider } from "./creation-context-provider"
import type { ScriptSegment } from "../domain/creation-contracts"

type CurrentRow = { ip_profile_id: string; content_account_id: string | null; platform: string | null; profile_json: string }

export class CreationAppService {
  private readonly lineage: CreationLineageRepository
  private readonly creationContext: CreationContextProvider

  constructor(
    private readonly database: Database.Database,
    private readonly runs: RunService,
    private readonly orchestrator: AutoCreationOrchestrator,
  ) {
    this.lineage = new CreationLineageRepository(database)
    this.creationContext = new CreationContextProvider(database)
  }

  getCurrent(context: TenantAccessContext, businessDate = chinaBusinessDate()) {
    const current = this.currentContext(context)
    const lineage = this.lineage.current(context.tenantId, current.ipId, current.accountId, businessDate)
    if (!lineage) return null
    return this.presentWithLineage(
      this.runs.getRunView(lineage.runId),
      this.memoryFor(current, lineage.tenantMemoryVersion),
      lineage.structureVersionIds,
    )
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
    const tenantMemory = this.currentMemory(current)
    const result = await this.orchestrator.createUsableDraft(current.profile, adjustment, tenantMemory ?? undefined)
    this.lineage.attach({
      runId: result.run.id,
      tenantId: context.tenantId,
      actorUserId: context.userId,
      ipId: current.ipId,
      accountId: current.accountId,
      businessDate,
      tenantMemoryVersion: tenantMemory?.version ?? null,
      structureVersionIds: result.structureVersionIds,
    })
    return this.presentWithLineage(result, tenantMemory, result.structureVersionIds)
  }

  getRun(context: TenantAccessContext, runId: string) {
    requireTenantCapability(context, "content.create")
    if (!this.lineage.canAccess(runId, context)) throw new Error("RUN_NOT_FOUND")
    return this.presentRun(runId)
  }

  getLockedExport(context: TenantAccessContext, runId: string) {
    requireTenantCapability(context, "content.create")
    if (!this.lineage.canAccess(runId, context)) throw new Error("RUN_NOT_FOUND")
    const draft = this.presentRun(runId)
    if (draft.status !== "locked") throw new Error("LOCKED_SCRIPT_REQUIRED")
    return {
      title: draft.title,
      segments: draft.segments,
    }
  }

  saveDraft(
    context: TenantAccessContext,
    runId: string,
    input: { expectedRevision: number; segments?: ScriptSegment[]; paragraphs?: string[] },
  ) {
    requireTenantCapability(context, "content.edit")
    if (!this.lineage.canAccess(runId, context)) throw new Error("RUN_NOT_FOUND")
    const result = this.runs.saveScriptRevision(runId, input.expectedRevision, input.segments ?? input.paragraphs ?? [])
    return { ...this.presentRun(runId, result.runView), saved: result.saved }
  }

  async finalize(
    context: TenantAccessContext,
    runId: string,
    input: { expectedRevision: number; segments?: ScriptSegment[]; paragraphs?: string[] },
  ) {
    requireTenantCapability(context, "content.edit")
    if (!this.lineage.canAccess(runId, context)) throw new Error("RUN_NOT_FOUND")
    this.runs.saveScriptRevision(runId, input.expectedRevision, input.segments ?? input.paragraphs ?? [])
    let run = this.runs.getRun(runId)
    if (run.state === "READY_FOR_QA") {
      await this.runs.runQa(runId, run.inputVersion)
      run = this.runs.getRun(runId)
    }
    if (run.state !== "WAITING_LOCK_CONFIRMATION" && run.state !== "LOCKED") {
      throw new Error("DRAFT_NOT_READY_TO_FINALIZE")
    }
    this.runs.lockScript(runId)
    return this.presentRun(runId)
  }

  private currentContext(context: TenantAccessContext) {
    const row = this.database.prepare(`SELECT c.ip_profile_id, c.content_account_id, a.platform, i.profile_json
      FROM user_current_context c JOIN ip_profiles i ON i.id = c.ip_profile_id
      LEFT JOIN content_accounts a ON a.id=c.content_account_id AND a.tenant_id=c.tenant_id
      WHERE c.user_id = ? AND c.tenant_id = ? AND i.status = 'active'`)
      .get(context.userId, context.tenantId) as CurrentRow | undefined
    if (!row) throw Object.assign(new Error("CURRENT_IP_REQUIRED"), { code: "CURRENT_IP_REQUIRED" })
    requireTenantCapability(context, "content.create", {
      ipId: row.ip_profile_id,
      contentAccountId: row.content_account_id ?? undefined,
    })
    return {
      tenantId: context.tenantId,
      ipId: row.ip_profile_id,
      accountId: row.content_account_id,
      platform: row.platform,
      profile: ipProfileSchema.parse(JSON.parse(row.profile_json)),
    }
  }

  private currentMemory(current: { tenantId: string; ipId: string; accountId: string | null; platform: string | null }) {
    if (!current.accountId || !current.platform) return null
    return this.creationContext.getCurrent({
      tenantId: current.tenantId,
      ipId: current.ipId,
      contentAccountId: current.accountId,
      platform: current.platform,
    })
  }

  private memoryFor(
    current: { tenantId: string; ipId: string; accountId: string | null; platform: string | null },
    version: number | null,
  ) {
    if (!version || !current.accountId || !current.platform) return null
    return this.creationContext.getVersion({
      tenantId: current.tenantId,
      ipId: current.ipId,
      contentAccountId: current.accountId,
      platform: current.platform,
    }, version)
  }

  private memoryForRun(runId: string) {
    const lineage = this.lineage.get(runId)
    if (!lineage?.tenantMemoryVersion || !lineage.accountId) return null
    const row = this.database.prepare("SELECT platform FROM content_accounts WHERE id=? AND tenant_id=?")
      .get(lineage.accountId, lineage.tenantId) as { platform: string } | undefined
    if (!row) return null
    return this.creationContext.getVersion({
      tenantId: lineage.tenantId, ipId: lineage.ipId,
      contentAccountId: lineage.accountId, platform: row.platform,
    }, lineage.tenantMemoryVersion)
  }

  private presentRun(runId: string, runView = this.runs.getRunView(runId)) {
    const lineage = this.lineage.get(runId)
    if (!lineage) throw new Error("RUN_NOT_FOUND")
    return this.presentWithLineage(runView, this.memoryForRun(runId), lineage.structureVersionIds)
  }

  private presentWithLineage(
    runView: Parameters<typeof presentCreationDraft>[0],
    memory: Parameters<typeof presentCreationDraft>[1],
    structureVersionIds: string[],
  ) {
    return {
      ...presentCreationDraft(runView, memory),
      structureVersionIds,
      structureInfluence: "已结合平台审核通过的内容结构",
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
