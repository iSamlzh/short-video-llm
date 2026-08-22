import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type Database from "better-sqlite3"
import type { TenantAccessContext } from "../../src/domain/access"
import { openDatabase } from "../../src/lib/db/database"
import { FakeLlmAdapter } from "../../src/lib/llm/fake"
import { StructuredLlmClient } from "../../src/lib/llm/structured"
import { ReviewService } from "../../src/services/review-service"
import { seedDemoData } from "../../src/scripts/demo-data"

describe("ReviewService", () => {
  let database: Database.Database
  let adapter: FakeLlmAdapter
  let service: ReviewService
  let owner: TenantAccessContext

  beforeEach(async () => {
    database = openDatabase(":memory:")
    await seedDemoData(database, "demo-password")
    adapter = new FakeLlmAdapter()
    service = new ReviewService(database, new StructuredLlmClient(adapter))
    owner = {
      audience: "tenant", userId: "user-owner", tenantId: "tenant-linjie", membershipId: "membership-owner",
      capabilities: ["ip.view", "review.view", "review.generate"],
      ipIds: ["ip-linjie"], contentAccountIds: ["account-linjie-wechat"],
    }
  })
  afterEach(() => database.close())

  it("facts_only 层级不调用模型", async () => {
    seedReviewEvidence(database, 2)
    const review = await service.generateCurrent(owner, "account-linjie-wechat")
    expect(review.sampleTier).toBe("facts_only")
    expect(adapter.calls).toHaveLength(0)
    expect(review.payload.evidenceLimits).toContain("不能证明因果")
  })

  it("按四段输出可核验指标，缺口明确，下一轮建议引用真实指标和稿件版本", async () => {
    seedReviewEvidence(database, 2)
    database.prepare(`UPDATE publications SET source='system',run_id='run-evidence',
      locked_script_version=3,locked_script_selection_version=2 WHERE id='review-p-1'`).run()

    const review = await service.generateCurrent(owner, "account-linjie-wechat")
    const hook = review.payload.structureEvidence.find((item: any) => item.segment === "hook")
    const body = review.payload.structureEvidence.find((item: any) => item.segment === "body")

    expect(review.sampleTier).toBe("facts_only")
    expect(review.payload.hypotheses).toEqual([])
    expect(hook).toMatchObject({ status: "missing" })
    expect(hook!.missingFields).toEqual(expect.arrayContaining(["3秒留存率", "5秒留存率"]))
    expect(body).toMatchObject({ status: "partial" })
    expect(body!.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "完播率", value: 0.3, evidenceSnapshotIds: ["review-s-1"] }),
    ]))
    expect(review.payload.nextContentSignals.join(" ")).toContain("稿件 v3")
    expect(review.payload.nextContentSignals.join(" ")).toContain("完播率 30.0%")
  })

  it("拒绝模型引用服务端输入之外的证据 ID，并保留失败检查点", async () => {
    seedReviewEvidence(database, 3)
    adapter.enqueue({ json: reviewFixture(["invented"]) })
    await expect(service.generateCurrent(owner, "account-linjie-wechat"))
      .rejects.toMatchObject({ code: "MODEL_EVIDENCE_INVALID" })
    expect(database.prepare("SELECT status,last_error_code FROM review_generation_checkpoints").get())
      .toEqual({ status: "failed", last_error_code: "MODEL_EVIDENCE_INVALID" })
  })

  it("相同证据集合复用已有复盘和检查点，不重复调用模型", async () => {
    seedReviewEvidence(database, 3)
    adapter.enqueue({ json: reviewFixture(["review-s-1"]) })
    const first = await service.generateCurrent(owner, "account-linjie-wechat")
    const second = await service.generateCurrent(owner, "account-linjie-wechat")
    expect(second.id).toBe(first.id)
    expect(adapter.calls.filter((call) => call.operation === "real_review")).toHaveLength(1)
  })

  it("新证据产生不可变新版本，并使未确认旧复盘失效", async () => {
    seedReviewEvidence(database, 3)
    adapter.enqueue({ json: reviewFixture(["review-s-1"]) })
    const first = await service.generateCurrent(owner, "account-linjie-wechat")
    appendReviewEvidence(database, 4)
    adapter.enqueue({ json: reviewFixture(["review-s-1"]) })
    const second = await service.generateCurrent(owner, "account-linjie-wechat")
    const history = service.getHistory(owner, "account-linjie-wechat")
    expect(history.map((item) => item.id)).toEqual([second.id, first.id])
    expect(history.map((item) => item.status)).toEqual(["generated", "superseded"])
  })
})

function reviewFixture(evidenceSnapshotIds: string[]) {
  return {
    headline: "真实场景内容值得继续验证",
    observations: [{ text: "当前样本中真实场景内容表现更稳定", evidenceSnapshotIds }],
    hypotheses: [{
      text: "具体人物可能提升理解速度", confidence: "low",
      evidenceFor: evidenceSnapshotIds, evidenceAgainst: [],
    }],
    keep: ["具体人物与真实场景"], avoid: ["空泛结论"],
    nextContentSignals: ["继续验证真实场景"],
    evidenceLimits: "样本仅能说明当前账号内相关性，不能证明平台因果。",
  }
}

function seedReviewEvidence(database: Database.Database, count: number) {
  const now = "2026-08-17T08:00:00.000Z"
  database.prepare(`INSERT INTO metric_import_batches
    (id,tenant_id,ip_profile_id,content_account_id,platform,filename,file_sha256,status,total_rows,inserted_rows,
     created_by_user_id,created_at,updated_at)
    VALUES ('review-batch','tenant-linjie','ip-linjie','account-linjie-wechat','wechat_channels','review.csv',
      'review-hash','review_ready',?,?, 'user-owner',?,?)`).run(count, count, now, now)
  for (let index = 1; index <= count; index += 1) appendReviewEvidence(database, index)
}

function appendReviewEvidence(database: Database.Database, index: number) {
  const publicationId = `review-p-${index}`
  const snapshotId = `review-s-${index}`
  const time = `2026-08-${String(10 + index).padStart(2, "0")}T08:00:00.000Z`
  database.prepare(`INSERT INTO publications
    (id,tenant_id,ip_profile_id,content_account_id,platform,source,title,published_at,status,created_by_user_id,created_at)
    VALUES (?,'tenant-linjie','ip-linjie','account-linjie-wechat','wechat_channels','external',?,?,'active','user-owner',?)`)
    .run(publicationId, `真实场景 ${index}`, time, time)
  database.prepare(`INSERT INTO real_metric_snapshots
    (id,tenant_id,ip_profile_id,content_account_id,platform,platform_content_key,title,published_at,captured_at,
     plays,completion_rate,likes,comments,shares,is_simulated,source_batch_id,source_row_number,created_at)
    VALUES (?,'tenant-linjie','ip-linjie','account-linjie-wechat','wechat_channels',?,?,?, ?,?,?,?,?,?,0,'review-batch',?,?)`)
    .run(snapshotId, `key-${snapshotId}`, `真实场景 ${index}`, time, time, index * 100, 0.3, 10, 2, 1, index + 1, time)
  database.prepare(`INSERT INTO publication_match_versions
    (id,tenant_id,ip_profile_id,content_account_id,snapshot_id,publication_id,candidate_ids_json,method,status,
     explanation,version,is_current,created_at)
    VALUES (?,'tenant-linjie','ip-linjie','account-linjie-wechat',?,?,'[]','exact_video_id','matched','测试匹配',1,1,?)`)
    .run(`review-match-${index}`, snapshotId, publicationId, time)
}
