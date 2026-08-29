import type Database from "better-sqlite3"
import type { TenantAccessContext } from "../domain/access"
import { ipProfileSchema } from "../domain/schemas"
import { requireTenantCapability } from "../lib/auth/guards"
import { CreationLineageRepository } from "../lib/db/creation-lineage-repository"
import { ReviewMemoryRepository, toConfirmedCreationMemory } from "../lib/db/review-memory-repository"
import { presentCreationDraft } from "./creation-presenter"
import { AutoCreationOrchestrator } from "./auto-creation-orchestrator"
import { RunService } from "./run-service"
import { CreationContextProvider } from "./creation-context-provider"
import type { ScriptSegment } from "../domain/creation-contracts"
import type { TopicDirectionCandidate } from "../domain/schemas"

type CurrentRow = { ip_profile_id: string; content_account_id: string | null; platform: string | null; profile_json: string; profile_version: number }

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
    const candidates = this.lineage.listCurrentScope(context.tenantId, current.ipId, current.accountId, businessDate)
    for (const lineage of candidates) {
      let view
      try {
        view = this.runs.getRunView(lineage.runId)
      } catch {
        continue
      }
      if (!view.scriptSelection) continue
      return this.presentWithLineage(
        view,
        this.memoryFor(current, lineage.tenantMemoryVersion),
        lineage.structureVersionIds,
        { triggerType: lineage.triggerType, sourceReviewId: lineage.sourceReviewId },
      )
    }
    return null
  }

  async ensureTopicPool(context: TenantAccessContext, businessDate = chinaBusinessDate()) {
    requireTenantCapability(context, "content.create")
    const current = this.currentContext(context)
    const existing = this.lineage.current(context.tenantId, current.ipId, current.accountId, businessDate)
    if (existing) {
      const view = this.runs.getRunView(existing.runId)
      if (view.topicBatch?.items.length) return this.presentTopicPool(existing.runId, view.topicBatch.items)
    }

    const run = this.runs.createRun(current.profile)
    const tenantMemory = this.currentMemory(current)
    const topics = await this.runs.generateTopics(run.id, run.inputVersion, tenantMemory ?? undefined)
    this.lineage.attach({
      runId: run.id,
      tenantId: context.tenantId,
      actorUserId: context.userId,
      ipId: current.ipId,
      ipProfileVersion: current.profileVersion,
      accountId: current.accountId,
      businessDate,
      tenantMemoryVersion: tenantMemory?.version ?? null,
      structureVersionIds: this.runs.getStructureVersionIds(current.profile),
    })
    return this.presentTopicPool(run.id, topics.items)
  }

  async prepareTopicPool(
    context: TenantAccessContext,
    options: {
      intent?: "initial" | "change_topic" | "change_expression"
      fromRunId?: string
      mode?: "auto" | "manual"
      topicBrief?: string
    },
    businessDate = chinaBusinessDate(),
  ) {
    if (options.mode === "manual") {
      requireTenantCapability(context, "content.create")
      const current = this.currentContext(context)
      const tenantMemory = this.currentMemory(current)
      const run = this.runs.createRun(current.profile)
      const topics = await this.runs.generateTopics(run.id, run.inputVersion, tenantMemory ?? undefined, {
        userTopicBrief: options.topicBrief,
      })
      this.lineage.attach({
        runId: run.id,
        tenantId: context.tenantId,
        actorUserId: context.userId,
        ipId: current.ipId,
        ipProfileVersion: current.profileVersion,
        accountId: current.accountId,
        businessDate,
        tenantMemoryVersion: tenantMemory?.version ?? null,
        structureVersionIds: this.runs.getStructureVersionIds(current.profile),
      })
      return this.presentTopicPool(run.id, topics.items)
    }
    if (!options.intent || options.intent === "initial") return this.ensureTopicPool(context, businessDate)
    requireTenantCapability(context, "content.create")
    if (!options.fromRunId || !this.lineage.canAccess(options.fromRunId, context)) throw new Error("PREVIOUS_RUN_NOT_FOUND")
    const previous = this.runs.getRunView(options.fromRunId)
    if (!previous.topicBatch || !previous.topicSelection) throw new Error("PREVIOUS_RUN_INCOMPLETE")
    const currentIndex = previous.topicBatch.items.findIndex(item => item.id === previous.topicSelection?.topicId)
    if (currentIndex < 0) throw new Error("PREVIOUS_TOPIC_NOT_FOUND")
    if (options.intent === "change_topic" && previous.topicBatch.items.length < 2) throw new Error("NO_ALTERNATIVE_TOPIC")
    const recommended = options.intent === "change_topic"
      ? previous.topicBatch.items[(currentIndex + 1) % previous.topicBatch.items.length]
      : previous.topicBatch.items[currentIndex]
    const current = this.currentContext(context)
    const orderedTopics = [recommended, ...previous.topicBatch.items.filter(item => item.id !== recommended.id)]
    const prepared = this.runs.createRunWithTopicPool(current.profile, orderedTopics)
    const tenantMemory = this.currentMemory(current)
    this.lineage.attach({
      runId: prepared.run.id,
      tenantId: context.tenantId,
      actorUserId: context.userId,
      ipId: current.ipId,
      ipProfileVersion: current.profileVersion,
      accountId: current.accountId,
      businessDate,
      tenantMemoryVersion: tenantMemory?.version ?? null,
      structureVersionIds: this.runs.getStructureVersionIds(current.profile),
    })
    return this.presentTopicPool(prepared.run.id, prepared.batch.items, recommended.id)
  }

  async createScriptFromTopic(context: TenantAccessContext, input: {
    runId: string
    topicId: string
    intent?: "initial" | "change_topic" | "change_expression"
    fromRunId?: string
  }) {
    requireTenantCapability(context, "content.create")
    if (!this.lineage.canAccess(input.runId, context)) throw new Error("RUN_NOT_FOUND")
    const lineage = this.lineage.get(input.runId)
    if (!lineage) throw new Error("RUN_NOT_FOUND")
    const run = this.runs.getRun(input.runId)
    const view = this.runs.getRunView(input.runId)
    const topicBatch = view.topicBatch
    if (!topicBatch?.items.some((item) => item.id === input.topicId)) throw new Error("TOPIC_SELECTION_INVALID")
    if (view.scriptSelection && view.topicSelection?.topicId === input.topicId) return this.presentRun(input.runId, view)
    if (run.state === "WAITING_TOPIC_SELECTION") {
      this.runs.selectTopic(input.runId, topicBatch.version, input.topicId)
    } else if (run.state !== "READY_FOR_SCRIPTS" || view.topicSelection?.topicId !== input.topicId) {
      throw new Error("TOPIC_POOL_NOT_READY")
    }
    this.lineage.assignStructures(
      input.runId,
      this.runs.getSelectedStructureLineage(input.runId, lineage.structureVersionIds),
    )
    const current = this.currentContext(context)
    const memory = this.memoryFor(current, lineage.tenantMemoryVersion)
    let adjustment
    if (input.intent === "change_topic" || input.intent === "change_expression") {
      if (!input.fromRunId || !this.lineage.canAccess(input.fromRunId, context)) throw new Error("PREVIOUS_RUN_NOT_FOUND")
      const previous = this.runs.getRunView(input.fromRunId)
      const previousScript = previous.scriptBatch?.items.find(item => item.id === previous.scriptSelection?.scriptId)
      if (!previousScript) throw new Error("PREVIOUS_RUN_INCOMPLETE")
      adjustment = {
        intent: input.intent,
        previousScript: { title: previousScript.title, body: previousScript.body },
      }
    }
    const scripts = await this.runs.generateScripts(input.runId, run.inputVersion, memory ?? undefined, adjustment)
    const script = scripts.items[0]
    if (!script) throw new Error("NO_SCRIPT_GENERATED")
    this.runs.selectScript(input.runId, scripts.version, script.id)
    return this.presentRun(input.runId)
  }

  getTopicPool(context: TenantAccessContext, runId: string) {
    requireTenantCapability(context, "content.create")
    if (!this.lineage.canAccess(runId, context)) throw new Error("RUN_NOT_FOUND")
    const topics = this.runs.getRunView(runId).topicBatch?.items
    if (!topics?.length) throw new Error("TOPIC_POOL_NOT_READY")
    return this.presentTopicPool(runId, topics)
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
    const selectedStructures = this.runs.getSelectedStructureLineage(result.run.id, result.structureVersionIds)
    this.lineage.attach({
      runId: result.run.id,
      tenantId: context.tenantId,
      actorUserId: context.userId,
      ipId: current.ipId,
      ipProfileVersion: current.profileVersion,
      accountId: current.accountId,
      businessDate,
      tenantMemoryVersion: tenantMemory?.version ?? null,
      structureVersionIds: result.structureVersionIds,
      ...selectedStructures,
    })
    return this.presentWithLineage(result, tenantMemory, result.structureVersionIds)
  }

  async createNextRound(
    context: TenantAccessContext,
    input: { sourceReviewId: string; expectedMemoryVersion: number },
    businessDate = chinaBusinessDate(),
  ) {
    requireTenantCapability(context, "content.create")
    const current = this.currentContext(context)
    if (!current.accountId || !current.platform) throw new Error("CONTENT_ACCOUNT_REQUIRED")
    const scope = {
      tenantId: current.tenantId,
      ipId: current.ipId,
      contentAccountId: current.accountId,
      platform: current.platform,
    }
    const memories = new ReviewMemoryRepository(this.database)
    const review = memories.requireReview(scope, input.sourceReviewId)
    if (review.status !== "confirmed") throw new Error("REVIEW_NOT_CONFIRMED")
    const memory = memories.requireMemory(scope, input.expectedMemoryVersion)
    if (memory.sourceReviewId !== review.id) throw new Error("MEMORY_REVIEW_MISMATCH")
    const currentMemory = memories.getCurrentMemory(scope)
    if (!currentMemory || currentMemory.version !== memory.version) throw new Error("MEMORY_VERSION_STALE")

    const creationMemory = toConfirmedCreationMemory(memory)
    const run = this.runs.createRun(current.profile)
    const topics = await this.runs.generateTopics(run.id, run.inputVersion, creationMemory)
    this.lineage.attach({
      runId: run.id,
      tenantId: context.tenantId,
      actorUserId: context.userId,
      ipId: current.ipId,
      ipProfileVersion: current.profileVersion,
      accountId: current.accountId,
      businessDate,
      tenantMemoryVersion: memory.version,
      structureVersionIds: this.runs.getStructureVersionIds(current.profile),
      triggerType: "review_followup",
      sourceReviewId: review.id,
    })
    return this.presentTopicPool(run.id, topics.items)
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
    requireTenantCapability(context, "content.lock")
    if (!this.lineage.canAccess(runId, context)) throw new Error("RUN_NOT_FOUND")
    this.runs.saveScriptRevision(runId, input.expectedRevision, input.segments ?? input.paragraphs ?? [])
    let run = this.runs.getRun(runId)
    if (run.state !== "READY_FOR_QA" && run.state !== "WAITING_LOCK_CONFIRMATION" && run.state !== "LOCKED") {
      throw new Error("DRAFT_NOT_READY_TO_FINALIZE")
    }
    this.runs.lockScript(runId)
    return this.presentRun(runId)
  }

  private currentContext(context: TenantAccessContext) {
    const row = this.database.prepare(`SELECT c.ip_profile_id, c.content_account_id, a.platform, i.profile_json, i.version profile_version
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
      profileVersion: row.profile_version,
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
    return this.presentWithLineage(runView, this.memoryForRun(runId), lineage.structureVersionIds, {
      triggerType: lineage.triggerType,
      sourceReviewId: lineage.sourceReviewId,
    })
  }

  private presentTopicPool(runId: string, topics: TopicDirectionCandidate[], recommendedTopicId?: string) {
    const recommended = topics.find(item => item.id === recommendedTopicId) ?? topics[0]
    if (!recommended) throw new Error("NO_TOPIC_GENERATED")
    return {
      runId,
      recommendedTopicId: recommended.id,
      topics: topics.map((topic) => ({
        id: topic.id,
        title: topic.title,
        angle: topic.angle,
        decisionBrief: topic.decisionBrief,
      })),
    }
  }

  private presentWithLineage(
    runView: Parameters<typeof presentCreationDraft>[0],
    memory: Parameters<typeof presentCreationDraft>[1],
    structureVersionIds: string[],
    lineage: { triggerType: "manual" | "review_followup"; sourceReviewId: string | null } = {
      triggerType: "manual",
      sourceReviewId: null,
    },
  ) {
    return {
      ...presentCreationDraft(runView, memory),
      structureVersionIds,
      structureInfluence: "已结合平台审核通过的内容结构",
      creationTrigger: lineage,
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
