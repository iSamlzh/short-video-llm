import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type Database from "better-sqlite3"
import { openDatabase } from "../../src/lib/db/database"
import { seedDemoData } from "../../src/scripts/demo-data"
import { PublicationRepository } from "../../src/lib/db/publication-repository"
import { PublicationService } from "../../src/services/publication-service"
import type { TenantAccessContext } from "../../src/domain/access"

const publishedAt = "2026-08-17T08:00:00.000Z"

describe("PublicationService", () => {
  let database: Database.Database
  let service: PublicationService
  let repository: PublicationRepository
  let owner: TenantAccessContext
  let operator: TenantAccessContext

  beforeEach(async () => {
    database = openDatabase(":memory:")
    await seedDemoData(database, "demo-password")
    seedLockedScript(database)
    repository = new PublicationRepository(database)
    service = new PublicationService(database, repository)
    owner = tenantContext("user-owner", "membership-owner", [
      "ip.view", "publication.record", "metrics.import",
    ], ["ip-linjie", "ip-wangjie"], [
      "account-linjie-wechat", "account-linjie-douyin", "account-wangjie-douyin",
    ])
    operator = tenantContext("user-operator", "membership-operator", [
      "ip.view", "publication.record",
    ], ["ip-linjie"], ["account-linjie-wechat"])
  })

  afterEach(() => database.close())

  it("从精确锁稿版本读取标题且不接受客户端标题", () => {
    const publication = service.recordSystem(owner, {
      runId: "run-locked",
      lockedVersion: 2,
      contentAccountId: "account-linjie-wechat",
      platformVideoId: "wx-100",
      publishedAt,
    })

    expect(publication).toMatchObject({
      source: "system",
      title: "锁稿第二版标题",
      lockedVersion: 2,
      lockedSelectionVersion: 3,
      platform: "wechat_channels",
    })
  })

  it("相同账号和作品 ID 的重复请求返回同一记录", () => {
    const input = {
      runId: "run-locked",
      lockedVersion: 2,
      contentAccountId: "account-linjie-wechat",
      platformVideoId: "wx-100",
      publishedAt,
    }
    const first = service.recordSystem(owner, input)
    const second = service.recordSystem(owner, input)
    expect(second.id).toBe(first.id)
    expect(database.prepare("SELECT COUNT(*) count FROM publications").get()).toEqual({ count: 1 })
  })

  it("允许同一锁稿发布到同一 IP 下的两个已授权账号", () => {
    const wechat = service.recordSystem(owner, {
      runId: "run-locked", lockedVersion: 2, contentAccountId: "account-linjie-wechat",
      platformVideoId: "same-platform-id", publishedAt,
    })
    const douyin = service.recordSystem(owner, {
      runId: "run-locked", lockedVersion: 2, contentAccountId: "account-linjie-douyin",
      platformVideoId: "same-platform-id", publishedAt,
    })
    expect(douyin.id).not.toBe(wechat.id)
    expect(douyin.platform).toBe("douyin")
  })

  it("拒绝缺少能力、越过账号范围或越过 Run IP 的系统发布", () => {
    const input = {
      runId: "run-locked", lockedVersion: 2, contentAccountId: "account-linjie-wechat",
      platformVideoId: "wx-100", publishedAt,
    }
    expect(() => service.recordSystem({ ...operator, capabilities: ["ip.view"] }, input))
      .toThrow("CAPABILITY_FORBIDDEN")
    expect(() => service.recordSystem(operator, { ...input, contentAccountId: "account-linjie-douyin" }))
      .toThrow("ACCOUNT_SCOPE_FORBIDDEN")
    expect(() => service.recordSystem(owner, { ...input, contentAccountId: "account-wangjie-douyin" }))
      .toThrow("RUN_NOT_FOUND")
  })

  it("以标题和发布时间建立外部记录后可补充作品 ID", () => {
    const external = service.createExternal(owner, {
      contentAccountId: "account-linjie-wechat",
      title: "历史发布内容",
      publishedAt: "2026-08-10T08:00:00.000Z",
    })
    const supplemented = service.supplementIdentity(owner, external.id, {
      platformVideoId: "wx-history-1",
    })
    expect(supplemented).toMatchObject({
      id: external.id,
      source: "external",
      platformVideoId: "wx-history-1",
    })
  })

  it("规范化 URL 以保证带追踪参数的请求幂等", () => {
    const first = service.createExternal(owner, {
      contentAccountId: "account-linjie-wechat",
      title: "外部内容",
      videoUrl: "https://EXAMPLE.test/video/1/?utm_source=test",
      publishedAt,
    })
    const second = service.createExternal(owner, {
      contentAccountId: "account-linjie-wechat",
      title: "外部内容",
      videoUrl: "https://example.test/video/1",
      publishedAt,
    })
    expect(second.id).toBe(first.id)
  })

  it("停用记录后将其排除在有效匹配之外并保留审计", () => {
    const publication = service.recordSystem(owner, {
      runId: "run-locked", lockedVersion: 2, contentAccountId: "account-linjie-wechat",
      platformVideoId: "wx-100", publishedAt,
    })
    service.disable(owner, publication.id, "平台作品已删除")
    expect(repository.findActiveByVideoId({
      tenantId: "tenant-linjie", ipId: "ip-linjie",
      contentAccountId: "account-linjie-wechat", platform: "wechat_channels",
    }, "wx-100")).toBeNull()
    expect(database.prepare(
      "SELECT action FROM audit_logs WHERE resource_id = ? ORDER BY created_at DESC LIMIT 1",
    ).get(publication.id)).toEqual({ action: "publication.disabled" })
  })
})

function tenantContext(
  userId: string,
  membershipId: string,
  capabilities: TenantAccessContext["capabilities"],
  ipIds: string[],
  contentAccountIds: string[],
): TenantAccessContext {
  return {
    audience: "tenant", userId, tenantId: "tenant-linjie", membershipId,
    capabilities, ipIds, contentAccountIds,
  }
}

function seedLockedScript(database: Database.Database) {
  const createdAt = "2026-08-17T07:00:00.000Z"
  database.prepare(`INSERT INTO runs
    (id,state,input_version,schema_version,ip_profile_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?)`).run(
    "run-locked", "LOCKED", 1, 1,
    JSON.stringify({
      displayName: "林姐", experience: "七年社区团购运营经验",
      expertise: "社区团购", audience: "本地家庭用户", voiceStyle: "温和直接", boundaries: "不承诺收益",
    }), createdAt, createdAt,
  )
  database.prepare(`INSERT INTO creation_run_context
    (run_id,tenant_id,actor_user_id,ip_profile_id,content_account_id,business_date,created_at)
    VALUES (?,?,?,?,?,?,?)`).run(
    "run-locked", "tenant-linjie", "user-owner", "ip-linjie",
    "account-linjie-wechat", "2026-08-17", createdAt,
  )
  const payload = JSON.stringify({
    id: "script-v2", topicDirectionId: "topic-1", title: "锁稿第二版标题",
    hook: "这是锁稿开场内容。", body: "这是足够长度的锁稿正文，用于验证发布记录必须读取服务端锁稿标题，而不能接受客户端覆盖。",
    callToAction: "欢迎分享你的真实经历。", estimatedSeconds: 60,
  })
  database.prepare(`INSERT INTO locked_scripts
    (run_id,version,schema_version,sha256,payload_json,created_at,script_selection_version)
    VALUES (?,?,?,?,?,?,?)`).run("run-locked", 2, 1, "sha-v2", payload, createdAt, 3)
}
