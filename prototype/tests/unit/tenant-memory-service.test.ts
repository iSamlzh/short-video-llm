import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type Database from "better-sqlite3"
import type { TenantAccessContext } from "../../src/domain/access"
import { openDatabase } from "../../src/lib/db/database"
import { AccountBaselineService } from "../../src/services/account-baseline-service"
import { TenantMemoryService } from "../../src/services/tenant-memory-service"
import { seedDemoData } from "../../src/scripts/demo-data"
import { ReviewMemoryRepository } from "../../src/lib/db/review-memory-repository"

describe("TenantMemoryService", () => {
  let database: Database.Database
  let service: TenantMemoryService
  let owner: TenantAccessContext

  beforeEach(async () => {
    database = openDatabase(":memory:")
    await seedDemoData(database, "demo-password")
    service = new TenantMemoryService(database)
    owner = {
      audience: "tenant", userId: "user-owner", tenantId: "tenant-linjie", membershipId: "membership-owner",
      capabilities: ["ip.view", "review.confirm"], ipIds: ["ip-linjie"],
      contentAccountIds: ["account-linjie-wechat"],
    }
  })
  afterEach(() => database.close())

  it("要求 review.confirm、至少五条样本和当前未失效复盘", () => {
    const reviewId = seedReview(database, 5, "generated")
    const input = memoryInput(reviewId)
    expect(() => service.confirm({ ...owner, capabilities: ["ip.view"] }, input))
      .toThrow("CAPABILITY_FORBIDDEN")

    clearReviewEvidence(database)
    const tentativeId = seedReview(database, 4, "generated")
    expect(() => service.confirm(owner, memoryInput(tentativeId))).toThrow("MEMORY_SAMPLE_INSUFFICIENT")

    clearReviewEvidence(database)
    const supersededId = seedReview(database, 5, "superseded")
    expect(() => service.confirm(owner, memoryInput(supersededId))).toThrow("REVIEW_SUPERSEDED")
  })

  it("同一复盘和相同编辑内容幂等，并创建不可变版本", () => {
    const reviewId = seedReview(database, 5, "generated")
    const first = service.confirm(owner, memoryInput(reviewId))
    const second = service.confirm(owner, memoryInput(reviewId))

    expect(second.id).toBe(first.id)
    expect(first).toMatchObject({ version: 1, sourceReviewId: reviewId, confirmedByUserId: "user-owner" })
    expect(database.prepare("SELECT status FROM content_review_versions WHERE id=?").get(reviewId))
      .toEqual({ status: "confirmed" })
    expect(database.prepare("SELECT action FROM audit_logs WHERE resource_id=?").get(first.id))
      .toEqual({ action: "review.memory.confirmed" })
    expect(new ReviewMemoryRepository(database).findMemoryByReview(scope(), reviewId))
      .toMatchObject({ id: first.id, version: 1, sourceReviewId: reviewId })
  })

  it("拒绝证据集合已经变化的旧复盘", () => {
    const reviewId = seedReview(database, 5, "generated")
    appendEvidence(database, 6)
    expect(() => service.confirm(owner, memoryInput(reviewId))).toThrow("REVIEW_SUPERSEDED")
  })
})

function memoryInput(reviewId: string) {
  return {
    reviewId,
    keep: ["保留具体人物与真实场景"],
    avoid: ["避免空泛结论"],
    nextContentSignals: ["继续验证邻里冲突场景"],
  }
}

function seedReview(database: Database.Database, count: number, status: "generated" | "superseded") {
  seedEvidence(database, count)
  const baseline = new AccountBaselineService(database).build(scope())
  const id = `memory-review-${count}-${status}`
  database.prepare(`INSERT INTO content_review_versions
    (id,tenant_id,ip_profile_id,content_account_id,version,sample_tier,evidence_cutoff_at,evidence_set_hash,
     payload_json,prompt_version,status,created_by_user_id,created_at)
    VALUES (?,'tenant-linjie','ip-linjie','account-linjie-wechat',1,?,?,?, ?,1,?,'user-owner','2026-08-17T08:00:00Z')`)
    .run(id, baseline.sampleTier, "2026-08-17T08:00:00Z", baseline.evidenceSetHash, JSON.stringify({
      headline: "真实场景内容值得继续验证", observations: [], hypotheses: [],
      keep: ["真实场景"], avoid: ["空泛结论"], nextContentSignals: ["继续验证"],
      evidenceLimits: "当前数据只表达相关性，不能证明平台因果。",
    }), status)
  return id
}

function seedEvidence(database: Database.Database, count: number) {
  database.prepare(`INSERT INTO metric_import_batches
    (id,tenant_id,ip_profile_id,content_account_id,platform,filename,file_sha256,status,total_rows,inserted_rows,
     created_by_user_id,created_at,updated_at)
    VALUES ('memory-batch','tenant-linjie','ip-linjie','account-linjie-wechat','wechat_channels','memory.csv',
      'memory-hash','completed',?,?, 'user-owner','2026-08-17T08:00:00Z','2026-08-17T08:00:00Z')`).run(count, count)
  for (let index = 1; index <= count; index += 1) appendEvidence(database, index)
}

function appendEvidence(database: Database.Database, index: number) {
  const publicationId = `memory-p-${index}`
  const snapshotId = `memory-s-${index}`
  database.prepare(`INSERT INTO publications
    (id,tenant_id,ip_profile_id,content_account_id,platform,source,title,published_at,status,created_by_user_id,created_at)
    VALUES (?,'tenant-linjie','ip-linjie','account-linjie-wechat','wechat_channels','external',?,'2026-08-10T08:00:00Z','active','user-owner','2026-08-17T08:00:00Z')`)
    .run(publicationId, `内容 ${index}`)
  database.prepare(`INSERT INTO real_metric_snapshots
    (id,tenant_id,ip_profile_id,content_account_id,platform,platform_content_key,title,captured_at,plays,is_simulated,
     source_batch_id,source_row_number,created_at)
    VALUES (?,'tenant-linjie','ip-linjie','account-linjie-wechat','wechat_channels',?,?,'2026-08-17T08:00:00Z',?,0,'memory-batch',?,'2026-08-17T08:00:00Z')`)
    .run(snapshotId, `key-${index}`, `内容 ${index}`, index * 100, index + 1)
  database.prepare(`INSERT INTO publication_match_versions
    (id,tenant_id,ip_profile_id,content_account_id,snapshot_id,publication_id,candidate_ids_json,method,status,
     explanation,version,is_current,created_at)
    VALUES (?,'tenant-linjie','ip-linjie','account-linjie-wechat',?,?,'[]','exact_video_id','matched','测试',1,1,'2026-08-17T08:00:00Z')`)
    .run(`memory-match-${index}`, snapshotId, publicationId)
}

function scope() {
  return { tenantId: "tenant-linjie", ipId: "ip-linjie", contentAccountId: "account-linjie-wechat", platform: "wechat_channels" }
}

function clearReviewEvidence(database: Database.Database) {
  database.prepare("DELETE FROM content_review_versions").run()
  database.prepare("DELETE FROM publication_match_versions").run()
  database.prepare("DELETE FROM real_metric_snapshots").run()
  database.prepare("DELETE FROM publications").run()
  database.prepare("DELETE FROM metric_import_batches").run()
}
