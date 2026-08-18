import Database from "better-sqlite3"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { TenantAccessContext } from "../../src/domain/access"
import { QUESTION_SET_VERSION } from "../../src/domain/ip-onboarding"
import { openDatabase } from "../../src/lib/db/database"
import { IpOnboardingRepository } from "../../src/lib/db/ip-onboarding-repository"
import { IpProfileService } from "../../src/services/ip-profile-service"

let database: Database.Database
let repository: IpOnboardingRepository
let service: IpProfileService

const now = "2026-08-18T10:00:00.000Z"
const context: TenantAccessContext = {
  audience: "tenant",
  userId: "user-a",
  tenantId: "tenant-a",
  membershipId: "membership-a",
  capabilities: ["content.create"],
  ipIds: [],
  contentAccountIds: [],
}

beforeEach(() => {
  database = openDatabase(":memory:")
  seedAccess()
  repository = new IpOnboardingRepository(database)
  service = new IpProfileService(database)
})

afterEach(() => database.close())

describe("IP建档确认", () => {
  it("没有画像草稿或草稿版本过期时拒绝确认", () => {
    const session = createSession()
    expect(() => service.confirmOnboarding(context, {
      sessionId: session.id,
      portraitDraftVersion: 0,
    })).toThrow("PORTRAIT_DRAFT_REQUIRED")

    const preview = saveDraft(session.id, session.version)
    expect(() => service.confirmOnboarding(context, {
      sessionId: preview.id,
      portraitDraftVersion: 2,
    })).toThrow("PORTRAIT_DRAFT_VERSION_CONFLICT")
  })

  it("成功确认同时写入IP、账号、成员范围、当前上下文和会话状态", () => {
    const session = createSession()
    const preview = saveDraft(session.id, session.version)

    const result = service.confirmOnboarding(context, {
      sessionId: preview.id,
      portraitDraftVersion: 1,
    })

    expect(result).toMatchObject({
      profile: { displayName: "周姐", industryCategory: "health_wellness" },
    })
    expect(database.prepare("SELECT COUNT(*) count FROM ip_profiles WHERE id=?").get(result.ipId)).toEqual({ count: 1 })
    expect(database.prepare("SELECT COUNT(*) count FROM content_accounts WHERE id=?").get(result.accountId)).toEqual({ count: 1 })
    expect(database.prepare("SELECT COUNT(*) count FROM membership_ip_scopes WHERE membership_id=? AND ip_profile_id=?").get(context.membershipId, result.ipId)).toEqual({ count: 1 })
    expect(database.prepare("SELECT COUNT(*) count FROM membership_account_scopes WHERE membership_id=? AND content_account_id=?").get(context.membershipId, result.accountId)).toEqual({ count: 1 })
    expect(database.prepare("SELECT ip_profile_id,content_account_id FROM user_current_context WHERE user_id=? AND tenant_id=?").get(context.userId, context.tenantId))
      .toEqual({ ip_profile_id: result.ipId, content_account_id: result.accountId })
    expect(database.prepare("SELECT state FROM ip_onboarding_sessions WHERE id=?").get(preview.id)).toEqual({ state: "CONFIRMED" })
  })

  it("事务中间失败后不留下任何部分创建数据", () => {
    const session = createSession()
    const preview = saveDraft(session.id, session.version)
    database.exec(`CREATE TRIGGER reject_account_scope BEFORE INSERT ON membership_account_scopes
      BEGIN SELECT RAISE(ABORT, 'forced rollback'); END;`)

    expect(() => service.confirmOnboarding(context, {
      sessionId: preview.id,
      portraitDraftVersion: 1,
    })).toThrow("forced rollback")

    expect(database.prepare("SELECT COUNT(*) count FROM ip_profiles").get()).toEqual({ count: 0 })
    expect(database.prepare("SELECT COUNT(*) count FROM content_accounts").get()).toEqual({ count: 0 })
    expect(database.prepare("SELECT COUNT(*) count FROM membership_ip_scopes").get()).toEqual({ count: 0 })
    expect(database.prepare("SELECT state FROM ip_onboarding_sessions WHERE id=?").get(preview.id)).toEqual({ state: "PORTRAIT_PREVIEW" })
  })
})

function createSession() {
  return repository.create({
    tenantId: context.tenantId,
    creatorUserId: context.userId,
    displayName: "周姐",
    primaryPlatform: "wechat_channels",
    industryCategory: "health_wellness",
    questionSetVersion: QUESTION_SET_VERSION,
    firstQuestionId: "health-wellness-v1-q01",
    createdAt: now,
  })
}

function saveDraft(sessionId: string, expectedVersion: number) {
  return repository.savePortraitDraft({
    sessionId,
    tenantId: context.tenantId,
    userId: context.userId,
    portraitDraft: portraitDraft(),
    expectedVersion,
    updatedAt: now,
  })
}

function portraitDraft() {
  const sourceQuestionId = "health-wellness-v1-q01"
  const contentPortrait = {
    schemaVersion: 1,
    questionSetVersion: QUESTION_SET_VERSION,
    industryCategory: "health_wellness" as const,
    identityPositioning: "有六年门店经验的健康生活内容分享者",
    credibilitySources: ["六年健康门店经营经历"],
    targetAudience: "关注父母健康的中年子女",
    audienceQuestions: ["怎么为父母选择日常滋补产品"],
    coreBeliefs: ["健康内容要讲清适用边界"],
    contentAssets: ["门店讲解和原料资料"],
    presentationStyles: ["真实问答"],
    commercialConnections: ["用选择知识自然连接产品"],
    desiredActions: ["关注并继续了解"],
    boundaries: ["不承诺治疗效果"],
    topicPillars: [{ title: "父母日常养护", rationale: "受众高频问题", sourceQuestionIds: [sourceQuestionId] }],
    confirmedFacts: [{ statement: "经营健康门店六年", sourceQuestionIds: [sourceQuestionId] }],
    uncertainties: [],
    sourceMap: { targetAudience: [sourceQuestionId] },
  }
  return {
    contentPortrait,
    profile: {
      displayName: "周姐",
      experience: "经营健康门店六年，长期积累门店讲解和原料资料。",
      expertise: "健康产品选择知识",
      audience: "关注父母健康的中年子女",
      voiceStyle: "真实问答、讲清适用边界",
      boundaries: "不承诺治疗效果",
      industryCategory: "health_wellness",
      contentPortrait,
    },
    portrait: {
      headline: "我理解的周姐：把健康选择讲清楚",
      name: "周姐",
      title: "健康生活内容分享者",
      identity: "有六年健康门店经营经验，擅长用真实问答讲选择方法。",
      authority: "以门店经历和原料资料作为内容依据。",
      audience: "关注父母健康的中年子女",
      boundaries: ["不承诺治疗效果"],
      directions: ["父母日常养护"],
      source: "来源于已确认建档回答",
      verifiedFacts: ["经营健康门店六年"],
      uncertainFact: "暂无需要额外确认的信息",
      account: "视频号｜周姐讲健康选择",
    },
    account: { platform: "wechat_channels", name: "周姐讲健康选择" },
  }
}

function seedAccess() {
  database.prepare(
    "INSERT INTO users (id,email_normalized,display_name,password_hash,audience,status,data_origin,created_at) VALUES (?,?,?,?,?,?,?,?)",
  ).run(context.userId, "user-a@example.test", "用户A", "hash", "tenant", "active", "formal", now)
  database.prepare(
    "INSERT INTO tenants (id,name,status,data_origin,created_at) VALUES (?,?,?,?,?)",
  ).run(context.tenantId, "租户A", "active", "formal", now)
  database.prepare(
    "INSERT INTO memberships (id,tenant_id,user_id,role_key,status,data_origin,created_at) VALUES (?,?,?,?,?,?,?)",
  ).run(context.membershipId, context.tenantId, context.userId, "owner", "active", "formal", now)
}
