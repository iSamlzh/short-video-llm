import Database from "better-sqlite3"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { AccessContext, TenantAccessContext } from "../../src/domain/access"
import { handleAnswer } from "../../src/app/api/app/ip-onboarding/sessions/[sessionId]/answers/[questionId]/route"
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
})

function jsonRequest(method: string, body: unknown, url = "http://test/api/app/ip-onboarding/sessions") {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}
