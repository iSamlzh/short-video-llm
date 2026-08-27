import { beforeEach, describe, expect, it } from "vitest"
import type Database from "better-sqlite3"
import { openDatabase } from "../../src/lib/db/database"
import { seedDemoData } from "../../src/scripts/demo-data"
import { AccessRepository } from "../../src/lib/db/access-repository"
import { AccessService } from "../../src/services/access-service"
import { ContentHistoryService } from "../../src/services/content-history-service"

describe("ContentHistoryService", () => {
  let database: Database.Database
  let owner: ReturnType<AccessService["resolve"]>
  let reviewer: ReturnType<AccessService["resolve"]>

  beforeEach(async () => {
    database = openDatabase(":memory:")
    await seedDemoData(database, "demo-password")
    const access = new AccessService(new AccessRepository(database))
    owner = access.resolve("user-owner", "tenant")
    reviewer = access.resolve("user-reviewer", "tenant")
  })

  it("分页读取千条记录，并能按标题和阶段筛选", () => {
    if (owner.audience !== "tenant") throw new Error("TENANT_CONTEXT_REQUIRED")
    const insert = database.transaction(() => {
      for (let index = 1; index <= 1005; index += 1) {
        insertHistoryRun(database, `history-${index}`, "ip-wangjie", "account-wangjie-douyin", index)
      }
    })
    insert()
    const service = new ContentHistoryService(database)

    const first = service.list(owner, { page: 1, pageSize: 100 })
    const last = service.list(owner, { page: 11, pageSize: 100 })
    const exact = service.list(owner, { keyword: "口播稿 1005", status: "locked" })

    expect(first.total).toBe(1005)
    expect(first.items).toHaveLength(100)
    expect(last.items).toHaveLength(5)
    expect(exact.items.map((item) => item.runId)).toEqual(["history-1005"])
  })

  it("按成员历史授权隔离记录，并在 IP 归档后仍保留可读历史", () => {
    if (owner.audience !== "tenant" || reviewer.audience !== "tenant") throw new Error("TENANT_CONTEXT_REQUIRED")
    const tenantOwner = owner
    const tenantReviewer = reviewer
    insertHistoryRun(database, "history-private", "ip-wangjie", "account-wangjie-douyin", 1)
    const service = new ContentHistoryService(database)

    expect(service.list(tenantReviewer).items).toEqual([])
    expect(() => service.detail(tenantReviewer, "history-private")).toThrow("CONTENT_HISTORY_NOT_FOUND")

    database.prepare("UPDATE ip_profiles SET status='disabled' WHERE id='ip-wangjie'").run()
    const archived = service.detail(tenantOwner, "history-private")
    expect(archived.ipName).toBe("王姐")
    expect(archived.profileSnapshot?.displayName).toBe("王姐")
  })

  it("详情返回不可变画像、结构、文稿修订和定稿谱系", () => {
    if (owner.audience !== "tenant") throw new Error("TENANT_CONTEXT_REQUIRED")
    insertHistoryRun(database, "history-lineage", "ip-wangjie", "account-wangjie-douyin", 2)
    database.prepare("UPDATE ip_profiles SET display_name='改名后的王姐',version=version+1 WHERE id='ip-wangjie'").run()

    const detail = new ContentHistoryService(database).detail(owner, "history-lineage")

    expect(detail.profileSnapshot?.displayName).toBe("王姐")
    expect(detail.lineage.profileVersion).toBe(1)
    expect(detail.lineage.structureVersions[0]).toMatchObject({ id: "template-trust-v1", name: "真实场景—认知转折—行动方法" })
    expect(detail.revisions).toHaveLength(1)
    expect(detail.revisions[0]).toMatchObject({ revision: 1, locked: true, lockedVersion: 1 })
    expect(detail.canRecreate).toBe(true)
    expect(detail.canDownload).toBe(true)
  })
})

function insertHistoryRun(database: Database.Database, runId: string, ipId: string, accountId: string, index: number) {
  const profile = JSON.parse((database.prepare("SELECT profile_json FROM ip_profiles WHERE id=?").get(ipId) as { profile_json: string }).profile_json)
  const createdAt = new Date(Date.UTC(2026, 6, 1, 0, 0, index % 60)).toISOString()
  const topicId = `${runId}-topic`
  const scriptId = `${runId}-script`
  const script = {
    id: scriptId,
    topicDirectionId: topicId,
    title: `口播稿 ${index}`,
    hook: "你以为社区团购只看价格，其实不是。",
    body: "我在一线做了很多年，真正影响复购的是信任、履约和售后。今天把我实际使用的判断方法讲清楚。",
    callToAction: "把你的具体问题留在评论区。",
    estimatedSeconds: 45,
  }
  database.prepare(`INSERT INTO runs (id,state,input_version,schema_version,ip_profile_json,created_at,updated_at)
    VALUES (?,'LOCKED',1,1,?,?,?)`).run(runId, JSON.stringify(profile), createdAt, createdAt)
  database.prepare(`INSERT INTO creation_run_context
    (run_id,tenant_id,actor_user_id,ip_profile_id,ip_profile_version,content_account_id,business_date,created_at,
     tenant_memory_version,structure_version_ids_json,trigger_type,source_review_id)
    VALUES (?,'tenant-linjie','user-owner',?,?,?,'2026-07-01',?,NULL,'["template-trust-v1"]','manual',NULL)`)
    .run(runId, ipId, 1, accountId, createdAt)
  database.prepare(`INSERT INTO topic_batches (run_id,version,input_version,schema_version,payload_json,superseded,created_at)
    VALUES (?,1,1,1,?,0,?)`).run(runId, JSON.stringify([{ id: topicId, title: `选题方向 ${index}` }]), createdAt)
  database.prepare(`INSERT INTO topic_selections (run_id,version,batch_version,item_id,is_current,schema_version,created_at)
    VALUES (?,1,1,?,1,1,?)`).run(runId, topicId, createdAt)
  database.prepare(`INSERT INTO script_batches (run_id,version,input_version,schema_version,payload_json,superseded,created_at)
    VALUES (?,1,1,1,?,0,?)`).run(runId, JSON.stringify([script]), createdAt)
  database.prepare(`INSERT INTO script_selections (run_id,version,batch_version,item_id,is_current,schema_version,created_at)
    VALUES (?,1,1,?,1,1,?)`).run(runId, scriptId, createdAt)
  database.prepare(`INSERT INTO locked_scripts (run_id,version,schema_version,sha256,payload_json,created_at,script_selection_version)
    VALUES (?,1,1,?, ?,?,1)`).run(runId, `sha-${index}`, JSON.stringify(script), createdAt)
}
