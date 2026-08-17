import Database from "better-sqlite3"
import { describe, expect, it } from "vitest"
import { MetricsReviewService } from "../../src/services/metrics-review-service"

describe("MetricsReviewService", () => {
  it("imports valid CSV rows, deduplicates, and produces evidence-bounded findings", () => {
    const database = new Database(":memory:")
    database.exec(`CREATE TABLE imported_content_metrics (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, ip_profile_id TEXT NOT NULL, content_account_id TEXT NOT NULL,
      content_title TEXT NOT NULL, published_at TEXT, plays INTEGER NOT NULL, completion_rate REAL NOT NULL,
      likes INTEGER NOT NULL, comments INTEGER NOT NULL, shares INTEGER NOT NULL, negative_feedback INTEGER NOT NULL,
      source_hash TEXT NOT NULL, data_origin TEXT NOT NULL, created_at TEXT NOT NULL,
      UNIQUE(tenant_id, content_account_id, source_hash)
    )`)
    const service = new MetricsReviewService(database)
    const csv = `title,plays,completion_rate,likes,comments,shares,negative_feedback\n楼道里的邻里约定,12000,0.51,420,80,72,2\n泛泛谈努力,3000,0.18,30,4,2,16`
    const scope = { tenantId: "tenant-1", ipId: "ip-1", accountId: "account-1", dataOrigin: "formal" as const }
    expect(service.importCsv(scope, csv).inserted).toBe(2)
    expect(service.importCsv(scope, csv).duplicates).toBe(2)
    const brief = service.buildBrief(scope)
    expect(brief.lead).toContain("最值得保留")
    expect(brief.evidence[0].metrics.join(" ")).toContain("真实导入")
    expect(brief.evidenceLimits).toContain("相关性")
    database.close()
  })
})
