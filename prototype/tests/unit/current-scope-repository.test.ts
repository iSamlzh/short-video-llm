import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type Database from "better-sqlite3"
import { CurrentScopeRepository } from "../../src/lib/db/current-scope-repository"
import { openDatabase } from "../../src/lib/db/database"
import { seedDemoData } from "../../src/scripts/demo-data"
import type { TenantAccessContext } from "../../src/domain/access"

describe("CurrentScopeRepository", () => {
  let database: Database.Database
  let owner: TenantAccessContext

  beforeEach(async () => {
    database = openDatabase(":memory:")
    await seedDemoData(database, "demo-password")
    owner = {
      audience: "tenant",
      userId: "user-owner",
      tenantId: "tenant-linjie",
      membershipId: "membership-owner",
      capabilities: ["ip.view"],
      ipIds: ["ip-linjie", "ip-wangjie"],
      contentAccountIds: ["account-linjie-wechat", "account-linjie-douyin", "account-wangjie-douyin"],
    }
  })

  afterEach(() => database.close())

  it("返回当前租户、IP、账号和平台的精确作用域", () => {
    expect(new CurrentScopeRepository(database).get(owner)).toEqual({
      tenantId: "tenant-linjie",
      ipId: "ip-linjie",
      contentAccountId: "account-linjie-wechat",
      platform: "wechat_channels",
    })
  })

  it("拒绝能力不足或账号不在授权范围的当前上下文", () => {
    const repository = new CurrentScopeRepository(database)
    expect(() => repository.get({ ...owner, capabilities: [] })).toThrow("CAPABILITY_FORBIDDEN")
    expect(() => repository.get({ ...owner, contentAccountIds: [] })).toThrow("ACCOUNT_SCOPE_FORBIDDEN")
  })
})
