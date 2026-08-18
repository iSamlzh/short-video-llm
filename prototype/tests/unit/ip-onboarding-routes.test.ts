import Database from "better-sqlite3"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { AccessContext, TenantAccessContext } from "../../src/domain/access"
import { handleAnswer } from "../../src/app/api/app/ip-onboarding/sessions/[sessionId]/answers/[questionId]/route"
import { handlePortraitPreview } from "../../src/app/api/app/ip-onboarding/sessions/[sessionId]/portrait-preview/route"
import { handleConfirm } from "../../src/app/api/app/ip-onboarding/sessions/[sessionId]/confirm/route"
import { handleSession } from "../../src/app/api/app/ip-onboarding/sessions/[sessionId]/route"
import { handleSessions } from "../../src/app/api/app/ip-onboarding/sessions/route"
import { openDatabase } from "../../src/lib/db/database"
import { IpOnboardingRepository } from "../../src/lib/db/ip-onboarding-repository"
import { IpOnboardingSessionService } from "../../src/services/ip-onboarding-session-service"

let database: Database.Database
let service: IpOnboardingSessionService

const owner: TenantAccessContext = {
  audience: "tenant", userId: "user-a", tenantId: "tenant-a", membershipId: "membership-a",
  capabilities: [], ipIds: [], contentAccountIds: [],
}

beforeEach(() => {
  database = openDatabase(":memory:")
  const now = "2026-08-18T10:00:00.000Z"
  database.prepare(
    "INSERT INTO users (id,email_normalized,display_name,password_hash,audience,status,data_origin,created_at) VALUES (?,?,?,?,?,?,?,?)",
  ).run("user-a", "user-a@example.test", "用户A", "hash", "tenant", "active", "formal", now)
  database.prepare(
    "INSERT INTO tenants (id,name,status,data_origin,created_at) VALUES (?,?,?,?,?)",
  ).run("tenant-a", "租户A", "active", "formal", now)
  service = new IpOnboardingSessionService(new IpOnboardingRepository(database))
})

afterEach(() => database.close())

describe("IP建档路由", () => {
  it("未认证返回401且平台用户返回403", async () => {
    const request = new Request("http://test/api/app/ip-onboarding/sessions")
    const unauthenticated = await handleSessions(request, null, { sessions: service })
    const platform: AccessContext = { audience: "platform", userId: "platform", platformRole: "platform_admin" }
    const forbidden = await handleSessions(request, platform, { sessions: service })

    expect(unauthenticated.status).toBe(401)
    expect(forbidden.status).toBe(403)
  })

  it("POST创建会话，GET恢复当前会话", async () => {
    const created = await handleSessions(jsonRequest("POST", {
      displayName: "周姐",
      primaryPlatform: "wechat_channels",
      industryCategory: "health_wellness",
    }), owner, { sessions: service })
    const current = await handleSessions(
      new Request("http://test/api/app/ip-onboarding/sessions"), owner, { sessions: service },
    )

    expect(created.status).toBe(201)
    expect(current.status).toBe(200)
    expect(await current.json()).toMatchObject({ currentQuestion: { dimension: "target_audience" } })
  })

  it("不存在活动会话时GET返回204", async () => {
    const response = await handleSessions(
      new Request("http://test/api/app/ip-onboarding/sessions"), owner, { sessions: service },
    )
    expect(response.status).toBe(204)
  })

  it("旧版本答案写入返回409，跨租户会话返回404", async () => {
    const started = service.startSession(owner, {
      displayName: "周姐", primaryPlatform: "wechat_channels", industryCategory: "health_wellness",
    })
    const url = `http://test/api/app/ip-onboarding/sessions/${started.session.id}/answers/${started.currentQuestion!.id}`
    const first = await handleAnswer(jsonRequest("PUT", {
      value: "真实回答", expectedVersion: 1,
    }, url), started.session.id, started.currentQuestion!.id, owner, { sessions: service })
    const conflict = await handleAnswer(jsonRequest("PUT", {
      value: "旧页面回答", expectedVersion: 1,
    }, url), started.session.id, started.currentQuestion!.id, owner, { sessions: service })
    const otherTenant = { ...owner, tenantId: "tenant-b" }
    const missing = await handleSession(
      new Request(`http://test/api/app/ip-onboarding/sessions/${started.session.id}`),
      started.session.id, otherTenant, { sessions: service },
    )

    expect(first.status).toBe(200)
    expect(conflict.status).toBe(409)
    expect(missing.status).toBe(404)
  })

  it("画像预览接口校验版本并返回持久化后的会话", async () => {
    const response = await handlePortraitPreview(
      jsonRequest("POST", { expectedVersion: 17 }),
      "session-1",
      owner,
      {
        sessions: {
          generatePortraitPreview: async (_context: TenantAccessContext, input: { sessionId: string; expectedVersion: number }) => ({
            session: { id: input.sessionId, version: input.expectedVersion + 2, portraitDraftVersion: 1 },
          }),
        } as any,
      },
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      session: { id: "session-1", version: 19, portraitDraftVersion: 1 },
    })
  })

  it("确认接口只接收画像草稿版本并返回创建结果", async () => {
    const response = await handleConfirm(
      jsonRequest("POST", { portraitDraftVersion: 3 }),
      "session-1",
      owner,
      {
        profiles: {
          confirmOnboarding: (_context: TenantAccessContext, input: { sessionId: string; portraitDraftVersion: number }) => ({
            ipId: `ip-for-${input.sessionId}`,
            accountId: `account-v${input.portraitDraftVersion}`,
          }),
        } as any,
      },
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ipId: "ip-for-session-1", accountId: "account-v3" })
  })
})

function jsonRequest(method: string, body: unknown, url = "http://test/api/app/ip-onboarding/sessions") {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}
