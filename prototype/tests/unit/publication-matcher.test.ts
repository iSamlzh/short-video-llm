import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type Database from "better-sqlite3"
import type { TenantAccessContext } from "../../src/domain/access"
import type { Publication } from "../../src/domain/growth-loop"
import { openDatabase } from "../../src/lib/db/database"
import { MetricsRepository } from "../../src/lib/db/metrics-repository"
import { PublicationRepository } from "../../src/lib/db/publication-repository"
import { PublicationMatcher } from "../../src/services/publication-matcher"
import { PublicationService } from "../../src/services/publication-service"
import { seedDemoData } from "../../src/scripts/demo-data"

describe("PublicationMatcher", () => {
  let database: Database.Database
  let metrics: MetricsRepository
  let publications: PublicationRepository
  let matcher: PublicationMatcher
  let owner: TenantAccessContext

  beforeEach(async () => {
    database = openDatabase(":memory:")
    await seedDemoData(database, "demo-password")
    metrics = new MetricsRepository(database)
    publications = new PublicationRepository(database)
    matcher = new PublicationMatcher(database, metrics, publications, new PublicationService(database, publications))
    owner = {
      audience: "tenant",
      userId: "user-owner",
      tenantId: "tenant-linjie",
      membershipId: "membership-owner",
      capabilities: ["ip.view", "metrics.import"],
      ipIds: ["ip-linjie"],
      contentAccountIds: ["account-linjie-wechat"],
    }
  })

  afterEach(() => database.close())

  it("按作品 ID、URL、±7 天内唯一精确标题的顺序匹配", () => {
    const candidates = [
      publication({ id: "p-id", platformVideoId: "wx-1", title: "另一个标题" }),
      publication({ id: "p-url", videoUrl: "https://example.test/v/2", normalizedVideoUrl: "https://example.test/v/2", title: "链接稿" }),
      publication({ id: "p-title", title: "楼道里的邻里约定", publishedAt: "2026-08-10T08:00:00Z" }),
    ]

    expect(matcher.decide(snapshot({ platformVideoId: "wx-1" }), candidates).method).toBe("exact_video_id")
    expect(matcher.decide(snapshot({ videoUrl: "https://example.test/v/2?utm_source=x", normalizedVideoUrl: "https://example.test/v/2" }), candidates).method).toBe("exact_url")
    expect(matcher.decide(snapshot({ title: "楼道里的邻里约定", publishedAt: "2026-08-17T08:00:00Z" }), candidates))
      .toMatchObject({ status: "matched", method: "exact_title_time", publicationId: "p-title" })
  })

  it("两个精确标题候选永远不会自动绑定", () => {
    const row = snapshot({ title: "《楼道里的邻里约定》", publishedAt: "2026-08-10T08:00:00Z" })
    const candidates = [
      publication({ id: "p-1", title: "楼道里的邻里约定", publishedAt: "2026-08-08T08:00:00Z" }),
      publication({ id: "p-2", title: "楼道里的邻里约定！", publishedAt: "2026-08-12T08:00:00Z" }),
    ]

    expect(matcher.decide(row, candidates)).toMatchObject({
      status: "candidate",
      method: "exact_title_time",
      candidateIds: ["p-1", "p-2"],
    })
  })

  it("相似度只产生最多三个可解释的人工候选", () => {
    const row = snapshot({ title: "楼道邻里之间的一份约定", publishedAt: "2026-08-10T08:00:00Z" })
    const candidates = [
      publication({ id: "p-1", title: "楼道邻里之间的约定", publishedAt: "2026-08-08T08:00:00Z" }),
      publication({ id: "p-2", title: "楼道邻里的一份约定", publishedAt: "2026-08-09T08:00:00Z" }),
      publication({ id: "p-3", title: "楼道邻里之间一份约定", publishedAt: "2026-08-11T08:00:00Z" }),
      publication({ id: "p-4", title: "楼道邻里之间约定", publishedAt: "2026-08-12T08:00:00Z" }),
    ]

    const decision = matcher.decide(row, candidates)
    expect(decision).toMatchObject({ status: "candidate", method: "similarity_candidate" })
    expect(decision.candidateIds).toHaveLength(3)
    expect(decision.explanation).toContain("Dice")
  })

  it("持久化自动匹配并用 expectedVersion 防止过期人工确认", () => {
    const scope = scopeForWechat()
    const batchId = seedBatch(database)
    const candidate = publications.insert({
      id: "p-candidate", scope, source: "external", runId: null, lockedVersion: null,
      lockedSelectionVersion: null, title: "楼道邻里之间的约定", platformVideoId: null,
      videoUrl: null, normalizedVideoUrl: null, publishedAt: "2026-08-10T08:00:00Z",
      createdByUserId: "user-owner", createdAt: "2026-08-17T08:00:00Z",
    })
    seedSnapshot(database, batchId, { title: "楼道邻里之间的一份约定" })

    const result = matcher.matchBatch(owner, batchId)
    expect(result).toMatchObject({ candidates: 1, unmatched: 0 })
    const current = metrics.listCurrentMatches(batchId)[0]
    const confirmed = matcher.confirmCandidate(owner, current.id, candidate.id, current.version)
    expect(confirmed).toMatchObject({ status: "matched", method: "manual_existing", version: 2 })
    expect(() => matcher.confirmCandidate(owner, confirmed.id, candidate.id, 1))
      .toThrow("MATCH_VERSION_CONFLICT")
    expect(database.prepare(
      "SELECT action FROM audit_logs WHERE resource_id=? ORDER BY created_at DESC LIMIT 1",
    ).get(confirmed.id)).toEqual({ action: "metrics.match.confirmed" })
  })

  it("未匹配快照可创建外部发布记录，并审计为人工外部关联", () => {
    const batchId = seedBatch(database)
    seedSnapshot(database, batchId, {
      title: "历史外部内容",
      platformVideoId: "wx-external-1",
      publishedAt: "2026-08-01T08:00:00Z",
    })
    matcher.matchBatch(owner, batchId)
    const current = metrics.listCurrentMatches(batchId)[0]
    const resolved = matcher.rejectCandidateAndCreateExternal(owner, current.id, current.version)

    expect(resolved).toMatchObject({ status: "matched", method: "manual_external_created", version: 2 })
    expect(publications.findActiveByVideoId(scopeForWechat(), "wx-external-1")).toBeTruthy()
    expect(database.prepare(
      "SELECT action FROM audit_logs WHERE resource_id=? AND action='metrics.match.external_created'",
    ).get(resolved.id)).toBeTruthy()
  })
})

function scopeForWechat() {
  return {
    tenantId: "tenant-linjie", ipId: "ip-linjie",
    contentAccountId: "account-linjie-wechat", platform: "wechat_channels",
  }
}

function publication(overrides: Partial<Publication>): Publication {
  return {
    ...scopeForWechat(), id: "publication", source: "external", runId: null,
    lockedVersion: null, lockedSelectionVersion: null, title: "楼道里的邻里约定",
    platformVideoId: null, videoUrl: null, normalizedVideoUrl: null,
    publishedAt: "2026-08-10T08:00:00Z", status: "active",
    createdByUserId: "user-owner", createdAt: "2026-08-17T08:00:00Z", ...overrides,
  }
}

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    id: "snapshot", ...scopeForWechat(), platformContentKey: "key", platformVideoId: null,
    videoUrl: null, normalizedVideoUrl: null, title: "楼道里的邻里约定",
    publishedAt: "2026-08-10T08:00:00Z", capturedAt: "2026-08-17T08:00:00Z",
    sourceBatchId: "batch", sourceRowNumber: 2, ...overrides,
  }
}

function seedBatch(database: Database.Database) {
  database.prepare(`INSERT INTO metric_import_batches
    (id,tenant_id,ip_profile_id,content_account_id,platform,filename,file_sha256,status,
     total_rows,inserted_rows,created_by_user_id,created_at,updated_at)
    VALUES ('batch-match','tenant-linjie','ip-linjie','account-linjie-wechat','wechat_channels',
      'metrics.csv','hash-match','parsed',1,1,'user-owner','2026-08-17T08:00:00Z','2026-08-17T08:00:00Z')`).run()
  return "batch-match"
}

function seedSnapshot(database: Database.Database, batchId: string, overrides: Record<string, unknown>) {
  const row = { title: "没有候选的内容", platformVideoId: null, publishedAt: "2026-08-10T08:00:00Z", ...overrides }
  database.prepare(`INSERT INTO real_metric_snapshots
    (id,tenant_id,ip_profile_id,content_account_id,platform,platform_content_key,platform_video_id,
     title,published_at,captured_at,plays,is_simulated,source_batch_id,source_row_number,created_at)
    VALUES ('snapshot-match','tenant-linjie','ip-linjie','account-linjie-wechat','wechat_channels',
      'snapshot-key',?,?,?,?,100,0,?,?,?)`).run(
    row.platformVideoId, row.title, row.publishedAt, "2026-08-17T08:00:00Z",
    batchId, 2, "2026-08-17T08:00:00Z",
  )
}
