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
    if (existing) return this.withSampleCount(existing)
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
        payload = { ...result.data, structureEvidence: result.data.structureEvidence ?? [] }
        model = result.model
        usage = result.usage
        validateEvidence(payload, baseline.latestSnapshots)
      }
      payload = enrichWithMetricEvidence(payload, baseline.latestSnapshots)

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
        return this.withSampleCount(review)
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
    const review = this.reviews.getCurrent(scope)
    return review ? this.withSampleCount(review) : null
  }

  getHistory(context: TenantAccessContext, contentAccountId: string) {
    const scope = this.requireScope(context, contentAccountId, "review.view")
    return this.reviews.getHistory(scope).map((review) => this.withSampleCount(review))
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
    snapshots.forEach((snapshot) => this.reviews.insertEvidenceLink({
      id: randomUUID(), reviewId, publicationId: snapshot.publicationId,
      snapshotId: snapshot.snapshotId, purpose: "baseline", now,
    }))
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

  private withSampleCount<T extends { id: string }>(review: T) {
    return { ...review, sampleCount: this.reviews.countEvidencePublications(review.id) }
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
    structureEvidence: [],
  }
}

type MetricSpec = {
  key: keyof BaselineSnapshot["metrics"]
  label: string
  format: "count" | "rate" | "seconds"
}

const structureSpecs: Array<{
  segment: "hook" | "body" | "ending" | "conversion"
  label: "钩子" | "主体" | "结尾" | "转化"
  fields: MetricSpec[]
  missingInterpretation: string
  partialInterpretation: string
  supportedInterpretation: string
  nextAction: string
}> = [
  {
    segment: "hook", label: "钩子",
    fields: [
      { key: "threeSecondRetention", label: "3秒留存率", format: "rate" },
      { key: "fiveSecondRetention", label: "5秒留存率", format: "rate" },
    ],
    missingInterpretation: "缺少开头留存数据，不能判断钩子是否接住用户。",
    partialInterpretation: "只有部分开头留存证据，暂不能判断完整钩子表现。",
    supportedInterpretation: "开头留存已有真实指标支持，但仍不能单独证明文案因果。",
    nextAction: "下一次导出同时保留 3 秒和 5 秒留存，用同类选题继续验证。",
  },
  {
    segment: "body", label: "主体",
    fields: [
      { key: "averageWatchSeconds", label: "平均观看时长", format: "seconds" },
      { key: "completionRate", label: "完播率", format: "rate" },
    ],
    missingInterpretation: "缺少观看深度数据，不能判断主体节奏。",
    partialInterpretation: "只能判断部分观看深度，不能定位主体具体掉点。",
    supportedInterpretation: "观看深度已有真实指标支持，但没有逐秒曲线，不能定位具体掉点。",
    nextAction: "保持其他变量不变，只验证一次主体信息密度调整。",
  },
  {
    segment: "ending", label: "结尾",
    fields: [
      { key: "completionRate", label: "完播率", format: "rate" },
      { key: "saves", label: "收藏", format: "count" },
      { key: "shares", label: "分享", format: "count" },
    ],
    missingInterpretation: "缺少结尾行为数据，不能判断收束与行动引导。",
    partialInterpretation: "只有部分结尾行为证据，不能把结果归因于收束文案。",
    supportedInterpretation: "结尾行为已有真实指标支持，但仍需同类内容对照验证。",
    nextAction: "下一条只调整结尾行动提示，并继续采集收藏和分享。",
  },
  {
    segment: "conversion", label: "转化",
    fields: [
      { key: "profileVisits", label: "主页访问", format: "count" },
      { key: "followersGained", label: "新增关注", format: "count" },
      { key: "inquiries", label: "咨询", format: "count" },
    ],
    missingInterpretation: "缺少转化数据，不能判断内容是否带来后续行动。",
    partialInterpretation: "只有部分转化证据，不能形成完整转化链路结论。",
    supportedInterpretation: "转化链路已有真实指标支持，但仍不能排除账号和流量来源影响。",
    nextAction: "继续采集主页访问、新增关注和咨询，验证同一行动引导。",
  },
]

function enrichWithMetricEvidence(payload: RealContentReview, snapshots: BaselineSnapshot[]): RealContentReview {
  const structureEvidence = structureSpecs.map((spec) => {
    const metrics = spec.fields.flatMap((field) => {
      const snapshot = snapshots.find((item) => item.metrics[field.key] !== null)
      const value = snapshot?.metrics[field.key]
      return snapshot && value !== null && value !== undefined ? [{
        label: field.label, value, format: field.format, evidenceSnapshotIds: [snapshot.snapshotId],
      }] : []
    })
    const missingFields = spec.fields.filter((field) => !metrics.some((metric) => metric.label === field.label)).map((field) => field.label)
    const status = metrics.length === 0 ? "missing" as const
      : missingFields.length ? "partial" as const : "supported" as const
    return {
      segment: spec.segment, label: spec.label, status, metrics, missingFields,
      interpretation: status === "missing" ? spec.missingInterpretation
        : status === "partial" ? spec.partialInterpretation : spec.supportedInterpretation,
      nextAction: spec.nextAction,
    }
  })
  const metricSignal = evidenceBasedNextSignal(snapshots)
  return {
    ...payload,
    structureEvidence,
    nextContentSignals: metricSignal
      ? [metricSignal, ...payload.nextContentSignals.filter((item) => item !== metricSignal)]
      : payload.nextContentSignals,
  }
}

function evidenceBasedNextSignal(snapshots: BaselineSnapshot[]) {
  const snapshot = snapshots.find((item) => item.lockedScriptVersion !== null) ?? snapshots[0]
  if (!snapshot) return null
  const version = snapshot.lockedScriptVersion === null ? "外部发布记录（未关联系统稿版本）" : `稿件 v${snapshot.lockedScriptVersion}`
  if (snapshot.metrics.completionRate !== null) {
    return `下一条以《${snapshot.title}》${version} 的完播率 ${(snapshot.metrics.completionRate * 100).toFixed(1)}% 为基线，只验证一个内容结构变量，不形成长期因果结论。`
  }
  if (snapshot.metrics.plays !== null) {
    return `下一条以《${snapshot.title}》${version} 的播放量 ${snapshot.metrics.plays} 为事实基线，只验证一个内容结构变量，不形成长期因果结论。`
  }
  return `下一条沿用《${snapshot.title}》${version}，补齐观看和转化指标后再判断结构效果。`
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
