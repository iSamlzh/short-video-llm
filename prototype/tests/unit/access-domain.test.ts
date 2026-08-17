import { describe, expect, it } from "vitest"
import { accessContextSchema } from "../../src/domain/access-schemas"
import { requirePlatformOperator, requireTenantCapability } from "../../src/lib/auth/guards"
import type { AccessContext } from "../../src/domain/access"

const tenantContext: AccessContext = {
  audience: "tenant",
  userId: "user-owner",
  tenantId: "tenant-linjie",
  membershipId: "membership-owner",
  capabilities: ["content.create", "review.view"],
  ipIds: ["ip-linjie"],
  contentAccountIds: ["account-linjie-wechat"],
}

describe("access contracts", () => {
  it("rejects a tenant context without a tenant id", () => {
    expect(() => accessContextSchema.parse({
      audience: "tenant",
      userId: "user-owner",
      membershipId: "membership-owner",
      capabilities: ["content.create"],
      ipIds: [],
      contentAccountIds: [],
    })).toThrow()
  })

  it("requires both capability and assigned account scope", () => {
    expect(() => requireTenantCapability(tenantContext, "review.view", {
      contentAccountId: "account-other",
    })).toThrowError("ACCOUNT_SCOPE_FORBIDDEN")
  })

  it("never treats a tenant owner as a platform operator", () => {
    expect(() => requirePlatformOperator({
      ...tenantContext,
      capabilities: [
        "ip.view", "content.create", "content.edit", "content.lock",
        "metrics.import", "review.generate", "review.view", "team.manage",
      ],
    })).toThrowError("PLATFORM_AUDIENCE_REQUIRED")
  })

  it("accepts a platform operator without tenant fields", () => {
    expect(accessContextSchema.parse({
      audience: "platform",
      userId: "user-platform",
      platformRole: "platform_operator",
    })).toEqual({
      audience: "platform",
      userId: "user-platform",
      platformRole: "platform_operator",
    })
  })

  it("accepts the new scoped business capabilities", () => {
    expect(accessContextSchema.parse({
      ...tenantContext,
      capabilities: ["publication.record", "review.confirm"],
    })).toMatchObject({ capabilities: ["publication.record", "review.confirm"] })
  })
})
