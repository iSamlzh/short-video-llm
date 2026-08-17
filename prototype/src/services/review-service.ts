import { randomUUID } from "node:crypto"
import type Database from "better-sqlite3"
import type { TenantAccessContext } from "../domain/access"
import type { GrowthScope, RealContentReview } from "../domain/growth-loop"
import { realContentReviewSchema } from "../domain/growth-loop-schemas"
import { requireTenantCapability } from "../lib/auth/guards"
import { MetricsRepository } from "../lib/db/metrics-repository"
import { ReviewMemoryRepository } from "../lib/db/review-memory-repository"
import type { TokenUsage } from "../lib/llm/adapter"
import { StructuredLlmClient } from "../lib/llm/structured"
import { AccountBaselineService, type BaselineSnapshot } from "./account-baseline-service"

const PROMPT_VERSION = 1

export class ReviewService {
  private readonly baselines: AccountBaselineService
  private readonly metrics: MetricsRepository
  private readonly reviews: ReviewMemoryRepository

  constructor(
    private readonly database: Database.Database,
    private readonly llm: StructuredLlmClient,
    baselines = new AccountBaselineService(database),
    metrics = new MetricsRepository(database),
    reviews = new ReviewMemoryRepository(database),
  ) {
    this.baselines = baselines
    this.metrics = metrics
    this.reviews = reviews
  }

  async generateCurrent(context: TenantAccessContext, contentAccountId: string) {
    const scope = this.requireScope(context, contentAccountId, "review.generate")
    const baseline = this.baselines.build(scope)
    if (baseline.latestSnapshots.some((item) => item.isSimulated)) throw codedError("REAL_METRICS_REQUIRED")
    const existing = this.reviews.findReviewByEvidenceHash(scope, baseline.evidenceSetHash)
    if (existing) return existing
    const now = new Date().toISOString()
    this.reviews.startCheckpoint({ id: randomUUID(), scope, evidenceSetHash: baseline.evidenceSetHash, now })

    try {
      let payload: RealContentReview
      let model: string | null = null
      let usage: TokenUsage | undefined
      if (baseline.sampleTier === "facts_only") {
        payload = factsOnlyReview(baseline.latestSnapshots)
      } else {
        const result = await this.llm.generateStructuredResult("real_review", {
          sampleTier: baseline.sampleTier,
          evidenceWhitelist: baseline.latestSnapshots.map((item) => item.snapshotId),
          evidence: baseline.latestSnapshots,
          medians: baseline.medians,
          ranges: baseline.ranges,
          missingFields: baseline.missingFields,
          ipBoundaries: this.ipBoundaries(scope),
        }, realContentReviewSchema)
        payload = result.data
        model = result.model
        usage = result.usage
        validateEvidence(payload, baseline.latestSnapshots)
      }

      const createdAt = new Date().toISOString()
      const persist = this.database.transaction(() => {
        this.reviews.supersedeGenerated(scope, baseline.evidenceSetHash)
        const review = this.reviews.insertReview({
          id: randomUUID(), scope, version: this.reviews.nextVersion(scope), sampleTier: baseline.sampleTier,
          evidenceCutoffAt: latestCutoff(baseline.latestSnapshots, createdAt), evidenceSetHash: baseline.evidenceSetHash,
          payload, model, promptVersion: PROMPT_VERSION, usage, userId: context.userId, now: createdAt,
        })
        this.persistEvidence(review.id, payload, baseline.latestSnapshots, createdAt)
        this.reviews.completeCheckpoint(scope, baseline.evidenceSetHash, review.id, createdAt)
        this.metrics.completeReviewReadyBatches(scope, createdAt)
        return review
      })
      return persist()
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error ? String(error.code) : "REVIEW_GENERATION_FAILED"
      this.reviews.failCheckpoint(scope, baseline.evidenceSetHash, code, new Date().toISOString())
      throw error
    }
  }

  getCurrent(context: TenantAccessContext, contentAccountId: string) {
    const scope = this.requireScope(context, contentAccountId, "review.view")
    return this.reviews.getCurrent(scope)
  }

  getHistory(context: TenantAccessContext, contentAccountId: string) {
    const scope = this.requireScope(context, contentAccountId, "review.view")
    return this.reviews.getHistory(scope)
  }

  private requireScope(
    context: TenantAccessContext,
    contentAccountId: string,
    capability: "review.generate" | "review.view",
  ) {
    const scope = this.metrics.accountScope(context.tenantId, contentAccountId)
    if (!scope) throw new Error("ACCOUNT_SCOPE_FORBIDDEN")
    requireTenantCapability(context, capability, { ipId: scope.ipId, contentAccountId: scope.contentAccountId })
    return scope
  }

  private ipBoundaries(scope: GrowthScope) {
    const row = this.database.prepare("SELECT profile_json FROM ip_profiles WHERE id=? AND tenant_id=?")
      .get(scope.ipId, scope.tenantId) as { profile_json: string } | undefined
    if (!row) return ""
    const profile = JSON.parse(row.profile_json) as { boundaries?: unknown }
    return typeof profile.boundaries === "string" ? profile.boundaries : ""
  }

  private persistEvidence(reviewId: string, payload: RealContentReview, snapshots: BaselineSnapshot[], now: string) {
    const byId = new Map(snapshots.map((item) => [item.snapshotId, item]))
    const links = new Map<string, "observation" | "hypothesis_for" | "hypothesis_against">()
    payload.observations.forEach((item) => item.evidenceSnapshotIds.forEach((id) => links.set(`observation:${id}`, "observation")))
    payload.hypotheses.forEach((item) => {
      item.evidenceFor.forEach((id) => links.set(`hypothesis_for:${id}`, "hypothesis_for"))
      item.evidenceAgainst.forEach((id) => links.set(`hypothesis_against:${id}`, "hypothesis_against"))
    })
    links.forEach((purpose, key) => {
      const snapshotId = key.slice(key.indexOf(":") + 1)
      const snapshot = byId.get(snapshotId)
      if (!snapshot) return
      this.reviews.insertEvidenceLink({
        id: randomUUID(), reviewId, publicationId: snapshot.publicationId, snapshotId, purpose, now,
      })
    })
  }
}

function factsOnlyReview(snapshots: BaselineSnapshot[]): RealContentReview {
  return {
    headline: snapshots.length ? `当前 ${snapshots.length} 条真实内容先看事实` : "当前还没有可复盘的真实内容",
    observations: snapshots.map((item) => ({
      text: `${item.title}：播放 ${item.metrics.plays ?? "未提供"}，完播率 ${item.metrics.completionRate ?? "未提供"}`,
      evidenceSnapshotIds: [item.snapshotId],
    })),
    hypotheses: [], keep: [], avoid: ["在样本不足时形成长期结论"],
    nextContentSignals: ["继续积累同账号真实发布数据"],
    evidenceLimits: "当前只有 0–2 条独立发布，只能陈述单条事实，不能证明因果或形成长期记忆。",
  }
}

function validateEvidence(payload: RealContentReview, snapshots: BaselineSnapshot[]) {
  const allowed = new Set(snapshots.map((item) => item.snapshotId))
  const referenced = [
    ...payload.observations.flatMap((item) => item.evidenceSnapshotIds),
    ...payload.hypotheses.flatMap((item) => [...item.evidenceFor, ...item.evidenceAgainst]),
  ]
  if (referenced.some((id) => !allowed.has(id))) throw codedError("MODEL_EVIDENCE_INVALID")
}

function latestCutoff(snapshots: BaselineSnapshot[], fallback: string) {
  return snapshots.map((item) => item.capturedAt).sort().at(-1) ?? fallback
}

function codedError(code: string) { return Object.assign(new Error(code), { code, retryable: false }) }
