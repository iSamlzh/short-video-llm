import Database from "better-sqlite3"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { QUESTION_SET_VERSION } from "../../src/domain/ip-onboarding"
import { openDatabase } from "../../src/lib/db/database"
import { IpOnboardingRepository } from "../../src/lib/db/ip-onboarding-repository"

let database: Database.Database
let repository: IpOnboardingRepository

const now = "2026-08-18T10:00:00.000Z"

beforeEach(() => {
  database = openDatabase(":memory:")
  seedScope("tenant-a", "user-a")
  seedScope("tenant-b", "user-b")
  repository = new IpOnboardingRepository(database)
})

afterEach(() => database.close())

describe("IpOnboardingRepository", () => {
  it("创建会话后可按租户与用户恢复", () => {
    const session = createSession()

    expect(repository.requireScoped(session.id, "tenant-a", "user-a")).toMatchObject({
      id: session.id,
      displayName: "周姐",
      questionSetVersion: QUESTION_SET_VERSION,
      currentQuestionId: "health-wellness-v1-q01",
      state: "ANSWERING",
      version: 1,
    })
    expect(repository.getActiveForUser("tenant-a", "user-a")?.id).toBe(session.id)
  })

  it("跨租户或跨用户读取统一返回不存在", () => {
    const session = createSession()

    expect(() => repository.requireScoped(session.id, "tenant-b", "user-a"))
      .toThrow("ONBOARDING_SESSION_NOT_FOUND")
    expect(() => repository.requireScoped(session.id, "tenant-a", "user-b"))
      .toThrow("ONBOARDING_SESSION_NOT_FOUND")
  })

  it("保存答案时递增版本并支持同题覆盖", () => {
    const session = createSession()
    const first = repository.saveAnswer({
      sessionId: session.id,
      tenantId: "tenant-a",
      userId: "user-a",
      questionId: "health-wellness-v1-q01",
      value: "关注父母健康的中年子女",
      signals: ["audience:family-caregiver"],
      answeredAt: now,
      expectedVersion: 1,
    })
    const revised = repository.saveAnswer({
      sessionId: session.id,
      tenantId: "tenant-a",
      userId: "user-a",
      questionId: "health-wellness-v1-q01",
      value: "关注父母日常养护的35至50岁子女",
      signals: ["audience:family-caregiver"],
      answeredAt: "2026-08-18T10:01:00.000Z",
      expectedVersion: 2,
    })

    expect(first.version).toBe(2)
    expect(revised.version).toBe(3)
    expect(revised.answers).toEqual([expect.objectContaining({
      questionId: "health-wellness-v1-q01",
      value: "关注父母日常养护的35至50岁子女",
      questionSetVersion: QUESTION_SET_VERSION,
    })])
  })

  it("拒绝旧版本覆盖较新的答案", () => {
    const session = createSession()
    repository.saveAnswer({
      sessionId: session.id,
      tenantId: "tenant-a",
      userId: "user-a",
      questionId: "health-wellness-v1-q01",
      value: "第一版回答",
      signals: [],
      answeredAt: now,
      expectedVersion: 1,
    })

    expect(() => repository.saveAnswer({
      sessionId: session.id,
      tenantId: "tenant-a",
      userId: "user-a",
      questionId: "health-wellness-v1-q01",
      value: "旧页面提交的回答",
      signals: [],
      answeredAt: now,
      expectedVersion: 1,
    })).toThrow("VERSION_CONFLICT")
  })

  it("保存下一题与选择轨迹供刷新后恢复", () => {
    const session = createSession()
    const updated = repository.updateProgress({
      sessionId: session.id,
      tenantId: "tenant-a",
      userId: "user-a",
      state: "ANSWERING",
      currentQuestionId: "health-wellness-v1-q03",
      selectionTrace: [
        { questionId: "health-wellness-v1-q01", reason: "anchor:target_audience" },
        { questionId: "health-wellness-v1-q03", reason: "anchor:audience_questions" },
      ],
      expectedVersion: 1,
      updatedAt: now,
    })

    expect(updated).toMatchObject({
      version: 2,
      currentQuestionId: "health-wellness-v1-q03",
      selectionTrace: [{ questionId: "health-wellness-v1-q01" }, { questionId: "health-wellness-v1-q03" }],
    })
  })

  it("保存画像草稿并递增独立草稿版本", () => {
    const session = createSession()
    const updated = repository.savePortraitDraft({
      sessionId: session.id,
      tenantId: "tenant-a",
      userId: "user-a",
      portraitDraft: { profile: { displayName: "周姐" } },
      expectedVersion: 1,
      updatedAt: now,
    })

    expect(updated).toMatchObject({
      state: "PORTRAIT_PREVIEW",
      version: 2,
      portraitDraftVersion: 1,
      portraitDraft: { profile: { displayName: "周姐" } },
    })
  })

  it("迁移只执行一次并建立作用域索引", () => {
    const migration = database.prepare(
      "SELECT COUNT(*) count FROM schema_migrations WHERE version = 10",
    ).get()
    const indexes = database.prepare("PRAGMA index_list(ip_onboarding_sessions)").all() as Array<{ name: string }>

    expect(migration).toEqual({ count: 1 })
    expect(indexes.map(index => index.name)).toContain("idx_ip_onboarding_scope")
  })
})

function createSession() {
  return repository.create({
    tenantId: "tenant-a",
    creatorUserId: "user-a",
    displayName: "周姐",
    primaryPlatform: "wechat_channels",
    industryCategory: "health_wellness",
    questionSetVersion: QUESTION_SET_VERSION,
    firstQuestionId: "health-wellness-v1-q01",
    createdAt: now,
  })
}

function seedScope(tenantId: string, userId: string) {
  database.prepare(
    "INSERT INTO users (id,email_normalized,display_name,password_hash,audience,status,data_origin,created_at) VALUES (?,?,?,?,?,?,?,?)",
  ).run(userId, `${userId}@example.test`, userId, "hash", "tenant", "active", "formal", now)
  database.prepare(
    "INSERT INTO tenants (id,name,status,data_origin,created_at) VALUES (?,?,?,?,?)",
  ).run(tenantId, tenantId, "active", "formal", now)
}
