import { describe, expect, it, vi } from "vitest"
import type { AccessContext, TenantAccessContext } from "../../src/domain/access"
import { handlePublications } from "../../src/app/api/app/publications/route"
import { handleMetrics } from "../../src/app/api/app/metrics/[...segments]/route"
import { handleReviews } from "../../src/app/api/app/reviews/[...segments]/route"

const owner: TenantAccessContext = {
  audience: "tenant", userId: "user-owner", tenantId: "tenant-1", membershipId: "membership-1",
  capabilities: ["ip.view", "publication.record", "metrics.import", "review.view", "review.generate", "review.confirm"],
  ipIds: ["ip-1"], contentAccountIds: ["account-1"],
}

describe("真实增长闭环路由", () => {
  it("未授权指标导入在读取 multipart body 前返回 403", async () => {
    let bodyRead = false
    const request = {
      method: "POST",
      formData: async () => { bodyRead = true; return new FormData() },
    } as unknown as Request
    const reviewer = { ...owner, capabilities: ["ip.view", "review.view"] } as TenantAccessContext

    const response = await handleMetrics(request, ["imports"], reviewer, metricsDeps())
    expect(response.status).toBe(403)
    expect(bodyRead).toBe(false)
  })

  it("发布接口拒绝未知字段，客户端不能覆盖锁稿标题", async () => {
    const request = jsonRequest("POST", {
      runId: "run-1", lockedVersion: 1, contentAccountId: "account-1",
      platformVideoId: "wx-1", publishedAt: "2026-08-17T08:00:00Z",
      clientTitle: "不能覆盖锁稿",
    })
    const response = await handlePublications(request, owner, publicationDeps())
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ errorCode: "PUBLICATION_INPUT_INVALID" })
  })

  it("过期匹配确认和过期复盘确认都返回 409", async () => {
    const metrics = metricsDeps()
    metrics.matcher.confirmCandidate = vi.fn(() => { throw new Error("MATCH_VERSION_CONFLICT") })
    const matchResponse = await handleMetrics(
      jsonRequest("POST", { publicationId: "publication-1", expectedVersion: 1 }),
      ["matches", "match-1", "confirm"], owner, metrics,
    )
    expect(matchResponse.status).toBe(409)

    const reviews = reviewDeps()
    reviews.memory.confirm = vi.fn(() => { throw new Error("REVIEW_SUPERSEDED") })
    const reviewResponse = await handleReviews(
      jsonRequest("POST", {
        keep: ["保留真实场景"], avoid: ["避免空泛结论"], nextContentSignals: ["继续验证同类场景"],
      }),
      ["review-1", "confirm"], owner, reviews,
    )
    expect(reviewResponse.status).toBe(409)
  })

  it("平台用户不能读取租户复盘端点", async () => {
    const platform: AccessContext = { audience: "platform", userId: "platform-user", platformRole: "platform_admin" }
    const response = await handleReviews(new Request("http://test/current"), ["current"], platform, reviewDeps())
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ errorCode: "TENANT_AUDIENCE_REQUIRED" })
  })
})

function jsonRequest(method: string, body: unknown) {
  return new Request("http://test/api", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function publicationDeps() {
  return {
    publications: {
      recordSystem: vi.fn(),
      getByCurrentLock: vi.fn(() => []),
    },
  } as any
}

function metricsDeps() {
  return {
    currentScope: { get: vi.fn(() => ({ tenantId: "tenant-1", ipId: "ip-1", contentAccountId: "account-1", platform: "wechat_channels" })) },
    imports: { import: vi.fn(), getResult: vi.fn() },
    matcher: { confirmCandidate: vi.fn(), rejectCandidateAndCreateExternal: vi.fn() },
  } as any
}

function reviewDeps() {
  return {
    reviews: { getCurrent: vi.fn(), generateCurrent: vi.fn() },
    memory: { confirm: vi.fn() },
  } as any
}
