import Database from "better-sqlite3"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { TenantAccessContext } from "../../src/domain/access"
import { openDatabase } from "../../src/lib/db/database"
import { IpOnboardingRepository } from "../../src/lib/db/ip-onboarding-repository"
import { IpOnboardingSessionService } from "../../src/services/ip-onboarding-session-service"

let database: Database.Database
let repository: IpOnboardingRepository
let service: IpOnboardingSessionService

const owner: TenantAccessContext = {
  audience: "tenant",
  userId: "user-a",
  tenantId: "tenant-a",
  membershipId: "membership-a",
  capabilities: [],
  ipIds: [],
  contentAccountIds: [],
}

beforeEach(() => {
  database = openDatabase(":memory:")
  seedScope("tenant-a", "user-a")
  seedScope("tenant-b", "user-b")
  repository = new IpOnboardingRepository(database)
  service = new IpOnboardingSessionService(repository)
})

afterEach(() => database.close())

describe("IpOnboardingSessionService", () => {
  it("创建会话只返回第一道锚点题而不暴露完整问题库", () => {
    const view = service.startSession(owner, {
      displayName: "周姐",
      primaryPlatform: "wechat_channels",
      industryCategory: "health_wellness",
    })

    expect(view).toMatchObject({
      session: { state: "ANSWERING", version: 1 },
      currentQuestion: { dimension: "target_audience" },
      canReview: false,
    })
    expect(view).not.toHaveProperty("questions")
  })

  it("保存答案后返回下一题并可刷新恢复", () => {
    const started = start()
    const updated = service.answerQuestion(owner, {
      sessionId: started.session.id,
      questionId: started.currentQuestion!.id,
      value: "关注父母日常健康的中年子女",
      expectedVersion: started.session.version,
    })
    const restored = service.getActiveSession(owner)

    expect(updated.currentQuestion?.dimension).toBe("audience_questions")
    expect(restored?.currentQuestion?.id).toBe(updated.currentQuestion?.id)
    expect(restored?.answeredSummary).toEqual([
      expect.objectContaining({ questionId: started.currentQuestion!.id, value: "关注父母日常健康的中年子女" }),
    ])
  })

  it("回答第8题达到覆盖后进入回答复核", () => {
    let view = start()
    for (let index = 0; index < 8; index += 1) {
      const question = view.currentQuestion!
      const value = question.options?.[0]?.value ?? `第${index + 1}个真实内容依据`
      view = service.answerQuestion(owner, {
        sessionId: view.session.id,
        questionId: question.id,
        value,
        expectedVersion: view.session.version,
      })
    }

    expect(view).toMatchObject({
      session: { state: "REVIEWING_ANSWERS" },
      currentQuestion: null,
      canReview: true,
    })
    expect(view.coveredDimensions).toHaveLength(8)
  })

  it("修改已答题会使画像草稿失效并重新计算覆盖", () => {
    let view = start()
    for (let index = 0; index < 8; index += 1) {
      const question = view.currentQuestion!
      view = service.answerQuestion(owner, {
        sessionId: view.session.id,
        questionId: question.id,
        value: question.options?.[0]?.value ?? `第${index + 1}个真实内容依据`,
        expectedVersion: view.session.version,
      })
    }
    const preview = repository.savePortraitDraft({
      sessionId: view.session.id,
      tenantId: owner.tenantId,
      userId: owner.userId,
      portraitDraft: { profile: { displayName: "周姐" } },
      expectedVersion: view.session.version,
    })
    const firstAnswer = preview.answers[0]
    const revised = service.reviseAnswer(owner, {
      sessionId: preview.id,
      questionId: firstAnswer.questionId,
      value: "暂时没有",
      expectedVersion: preview.version,
    })

    expect(revised.session.portraitDraft).toBeNull()
    expect(revised.session.state).toBe("ANSWERING")
    expect(revised.currentQuestion).not.toBeNull()
  })

  it("从复核状态生成画像并保存可恢复的草稿版本", async () => {
    let view = start()
    for (let index = 0; index < 8; index += 1) {
      const question = view.currentQuestion!
      view = service.answerQuestion(owner, {
        sessionId: view.session.id,
        questionId: question.id,
        value: question.options?.[0]?.value ?? `第${index + 1}个真实内容依据`,
        expectedVersion: view.session.version,
      })
    }
    const generatingService = new IpOnboardingSessionService(repository, {
      generatePreview: async input => ({
        contentPortrait: { targetAudience: input.answers[0].value },
        profile: { displayName: input.displayName },
        portrait: { name: input.displayName },
        account: { platform: input.primaryPlatform, name: `${input.displayName}内容号` },
      } as any),
    })

    const preview = await generatingService.generatePortraitPreview(owner, {
      sessionId: view.session.id,
      expectedVersion: view.session.version,
    })

    expect(preview.session).toMatchObject({
      state: "PORTRAIT_PREVIEW",
      portraitDraftVersion: 1,
      portraitDraft: { profile: { displayName: "周姐" } },
    })
    expect(generatingService.getSession(owner, view.session.id).session.portraitDraftVersion).toBe(1)
  })

  it("拒绝非当前题、跨租户会话和旧版本写入", () => {
    const started = start()
    expect(() => service.answerQuestion(owner, {
      sessionId: started.session.id,
      questionId: "health-wellness-v1-q30",
      value: "越过当前题",
      expectedVersion: 1,
    })).toThrow("QUESTION_NOT_CURRENT")

    expect(() => service.getSession({ ...owner, tenantId: "tenant-b" }, started.session.id))
      .toThrow("ONBOARDING_SESSION_NOT_FOUND")

    service.answerQuestion(owner, {
      sessionId: started.session.id,
      questionId: started.currentQuestion!.id,
      value: "第一次提交",
      expectedVersion: 1,
    })
    expect(() => service.answerQuestion(owner, {
      sessionId: started.session.id,
      questionId: started.currentQuestion!.id,
      value: "旧页面重复提交",
      expectedVersion: 1,
    })).toThrow("VERSION_CONFLICT")
  })
})

function start() {
  return service.startSession(owner, {
    displayName: "周姐",
    primaryPlatform: "wechat_channels",
    industryCategory: "health_wellness",
  })
}

function seedScope(tenantId: string, userId: string) {
  const now = "2026-08-18T10:00:00.000Z"
  database.prepare(
    "INSERT INTO users (id,email_normalized,display_name,password_hash,audience,status,data_origin,created_at) VALUES (?,?,?,?,?,?,?,?)",
  ).run(userId, `${userId}@example.test`, userId, "hash", "tenant", "active", "formal", now)
  database.prepare(
    "INSERT INTO tenants (id,name,status,data_origin,created_at) VALUES (?,?,?,?,?)",
  ).run(tenantId, tenantId, "active", "formal", now)
}
