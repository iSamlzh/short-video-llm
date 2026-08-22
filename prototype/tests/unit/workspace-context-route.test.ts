import { describe, expect, it, vi } from "vitest"
import type { AccessContext } from "../../src/domain/access"
import { handleWorkspaceContext } from "../../src/app/api/app/context/route"

const tenant: AccessContext = {
  audience: "tenant",
  userId: "user-owner",
  tenantId: "tenant-linjie",
  membershipId: "membership-owner",
  capabilities: ["ip.view"],
  ipIds: ["ip-linjie"],
  contentAccountIds: ["account-linjie-wechat"],
}

describe("工作上下文 API", () => {
  it("未登录和平台账号不能读取租户上下文", async () => {
    const request = new Request("http://test/api/app/context")
    const service = { get: vi.fn(), switch: vi.fn() } as any
    const platform: AccessContext = { audience: "platform", userId: "platform", platformRole: "platform_admin" }

    expect((await handleWorkspaceContext(request, null, service)).status).toBe(401)
    expect((await handleWorkspaceContext(request, platform, service)).status).toBe(403)
  })

  it("切换请求只使用已认证用户身份，不接受客户端 userId", async () => {
    const switchContext = vi.fn().mockReturnValue({ team: { id: "tenant-linjie", label: "林姐内容团队" } })
    const request = new Request("http://test/api/app/context", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ipId: "ip-linjie", userId: "user-other" }),
    })

    const response = await handleWorkspaceContext(request, tenant, { get: vi.fn(), switch: switchContext } as any)

    expect(response.status).toBe(200)
    expect(switchContext).toHaveBeenCalledWith("user-owner", { ipId: "ip-linjie" })
  })

  it("越权上下文返回稳定的 403 错误码", async () => {
    const request = new Request("http://test/api/app/context", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ipId: "ip-other" }),
    })
    const service = { get: vi.fn(), switch: vi.fn(() => { throw Object.assign(new Error("FORBIDDEN_CONTEXT"), { status: 403, code: "FORBIDDEN_CONTEXT" }) }) }

    const response = await handleWorkspaceContext(request, tenant, service as any)

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ errorCode: "FORBIDDEN_CONTEXT", message: "无权切换到这个工作空间" })
  })
})
