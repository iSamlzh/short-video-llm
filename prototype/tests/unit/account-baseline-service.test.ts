import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type Database from "better-sqlite3"
import { openDatabase } from "../../src/lib/db/database"
import { AccountBaselineService } from "../../src/services/account-baseline-service"
import { seedDemoData } from "../../src/scripts/demo-data"

describe("AccountBaselineService", () => {
  let database: Database.Database
  let service: AccountBaselineService

  beforeEach(async () => {
    database = openDatabase(":memory:")
    await seedDemoData(database, "demo-password")
    service = new AccountBaselineService(database)
  })
  afterEach(() => database.close())

  it.each([[2, "facts_only"], [3, "tentative"], [4, "tentative"], [5, "memory_eligible"]] as const)(
    "%i 条独立发布得到 %s 层级",
    (count, tier) => {
      seedEvidence(database, count)
      expect(service.build(scope()).sampleTier).toBe(tier)
    },
  )

  it("横向复盘只取每条发布的最新快照，同时保留完整历史", () => {
    seedEvidence(database, 1, true)
    const baseline = service.build(scope())

    expect(baseline.latestSnapshots).toHaveLength(1)
    expect(baseline.latestSnapshots[0].capturedAt).toBe("2026-08-17T09:00:00.000Z")
    expect(baseline.history).toHaveLength(2)
    expect(baseline.medians.plays).toBe(200)
    expect(baseline.evidenceSetHash).toMatch(/^[a-f0-9]{64}$/)
  })
})

function scope() {
  return { tenantId: "tenant-linjie", ipId: "ip-linjie", contentAccountId: "account-linjie-wechat", platform: "wechat_channels" }
}

function seedEvidence(database: Database.Database, count: number, addSecondSnapshot = false) {
  const now = "2026-08-17T08:00:00.000Z"
  database.prepare(`INSERT INTO metric_import_batches
    (id,tenant_id,ip_profile_id,content_account_id,platform,filename,file_sha256,status,total_rows,
     inserted_rows,created_by_user_id,created_at,updated_at)
    VALUES ('baseline-batch','tenant-linjie','ip-linjie','account-linjie-wechat','wechat_channels',
      'metrics.csv','baseline-hash','review_ready',?,?, 'user-owner',?,?)`).run(
    count + (addSecondSnapshot ? 1 : 0), count + (addSecondSnapshot ? 1 : 0), now, now,
  )
  for (let index = 1; index <= count; index += 1) {
    const publicationId = `baseline-p-${index}`
    const snapshotId = `baseline-s-${index}`
    insertPublication(database, publicationId, `内容 ${index}`, now)
    insertSnapshot(database, snapshotId, publicationId, index * 100, now, index + 1)
  }
  if (addSecondSnapshot) insertSnapshot(
    database, "baseline-s-1-new", "baseline-p-1", 200, "2026-08-17T09:00:00.000Z", count + 2,
  )
}

function insertPublication(database: Database.Database, id: string, title: string, now: string) {
  database.prepare(`INSERT INTO publications
    (id,tenant_id,ip_profile_id,content_account_id,platform,source,title,published_at,status,created_by_user_id,created_at)
    VALUES (?,'tenant-linjie','ip-linjie','account-linjie-wechat','wechat_channels','external',?,?,'active','user-owner',?)`)
    .run(id, title, now, now)
}

function insertSnapshot(database: Database.Database, id: string, publicationId: string, plays: number, capturedAt: string, row: number) {
  database.prepare(`INSERT INTO real_metric_snapshots
    (id,tenant_id,ip_profile_id,content_account_id,platform,platform_content_key,title,published_at,captured_at,
     plays,likes,comments,shares,is_simulated,source_batch_id,source_row_number,created_at)
    VALUES (?,'tenant-linjie','ip-linjie','account-linjie-wechat','wechat_channels',?,?,?, ?,?,?,?, ?,0,'baseline-batch',?,?)`)
    .run(id, `key-${id}`, `内容 ${publicationId}`, "2026-08-10T08:00:00.000Z", capturedAt, plays, 10, 2, 1, row, capturedAt)
  database.prepare(`INSERT INTO publication_match_versions
    (id,tenant_id,ip_profile_id,content_account_id,snapshot_id,publication_id,candidate_ids_json,method,status,
     explanation,version,is_current,created_at)
    VALUES (?,'tenant-linjie','ip-linjie','account-linjie-wechat',?,?,'[]','exact_video_id','matched','测试匹配',1,1,?)`)
    .run(`match-${id}`, id, publicationId, capturedAt)
}
