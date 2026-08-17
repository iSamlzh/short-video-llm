import { createHash, randomUUID } from "node:crypto"
import type Database from "better-sqlite3"
import type { TenantAccessContext } from "../domain/access"
import type { GrowthScope } from "../domain/growth-loop"
import { confirmMemoryInputSchema, type ConfirmMemoryInput } from "../domain/growth-loop-schemas"
import { requireTenantCapability } from "../lib/auth/guards"
import { ReviewMemoryRepository } from "../lib/db/review-memory-repository"
import { AccountBaselineService } from "./account-baseline-service"

export class TenantMemoryService {
  private readonly reviews: ReviewMemoryRepository
  private readonly baselines: AccountBaselineService

  constructor(private readonly database: Database.Database) {
    this.reviews = new ReviewMemoryRepository(database)
    this.baselines = new AccountBaselineService(database)
  }

  confirm(context: TenantAccessContext, rawInput: ConfirmMemoryInput) {
    const input = confirmMemoryInputSchema.parse(rawInput)
    const scope = this.reviewScope(context.tenantId, input.reviewId)
    requireTenantCapability(context, "review.confirm", { ipId: scope.ipId, contentAccountId: scope.contentAccountId })
    const review = this.reviews.requireReview(scope, input.reviewId)
    const payload = {
      keep: input.keep,
      avoid: input.avoid,
      nextContentSignals: input.nextContentSignals,
      evidenceLimits: review.payload.evidenceLimits,
    }
    const contentHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex")
    const existing = this.reviews.findMemoryByReviewHash(review.id, contentHash)
    if (existing) return existing
    if (review.sampleTier !== "memory_eligible") throw new Error("MEMORY_SAMPLE_INSUFFICIENT")
    if (review.status !== "generated") throw new Error("REVIEW_SUPERSEDED")
    const baseline = this.baselines.build(scope)
    if (baseline.evidenceSetHash !== review.evidenceSetHash) throw new Error("REVIEW_SUPERSEDED")

    const now = new Date().toISOString()
    const persist = this.database.transaction(() => {
      const memory = this.reviews.insertMemory({
        id: randomUUID(), scope, version: this.reviews.nextMemoryVersion(scope), sourceReviewId: review.id,
        contentHash, payload, userId: context.userId, now,
      })
      this.reviews.markReviewConfirmed(scope, review.id)
      this.database.prepare(`INSERT INTO audit_logs
        (id,tenant_id,actor_user_id,action,resource_type,resource_id,detail_json,created_at)
        VALUES (?,?,?,?,?,?,?,?)`).run(
        randomUUID(), context.tenantId, context.userId, "review.memory.confirmed", "tenant_memory",
        memory.id, JSON.stringify({ reviewId: review.id, version: memory.version, contentAccountId: scope.contentAccountId }), now,
      )
      return memory
    })
    return persist()
  }

  private reviewScope(tenantId: string, reviewId: string): GrowthScope {
    const row = this.database.prepare(`SELECT r.tenant_id,r.ip_profile_id,r.content_account_id,a.platform
      FROM content_review_versions r JOIN content_accounts a ON a.id=r.content_account_id
      WHERE r.id=? AND r.tenant_id=?`).get(reviewId, tenantId) as {
        tenant_id: string; ip_profile_id: string; content_account_id: string; platform: string
      } | undefined
    if (!row) throw new Error("REVIEW_NOT_FOUND")
    return {
      tenantId: row.tenant_id, ipId: row.ip_profile_id,
      contentAccountId: row.content_account_id, platform: row.platform,
    }
  }
}
