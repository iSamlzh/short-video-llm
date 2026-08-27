import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type Database from "better-sqlite3"
import type { TenantAccessContext } from "../../src/domain/access"
import { openDatabase } from "../../src/lib/db/database"
import { seedDemoData } from "../../src/scripts/demo-data"
import { IpAccountManagementService } from "../../src/services/ip-account-management-service"

describe("IP 与内容账号管理", () => {
  let database: Database.Database
  let service: IpAccountManagementService
  const owner: TenantAccessContext = {
    audience: "tenant", userId: "user-owner", tenantId: "tenant-linjie", membershipId: "membership-owner",
    capabilities: ["ip.manage"], ipIds: ["ip-linjie", "ip-wangjie"],
    contentAccountIds: ["account-linjie-wechat", "account-linjie-douyin", "account-wangjie-douyin"],
  }

  beforeEach(async () => {
    database = openDatabase(":memory:")
    await seedDemoData(database, "demo-password")
    service = new IpAccountManagementService(database)
  })
  afterEach(() => database.close())

  it("校准画像时创建新版本并保留旧版本内容", () => {
    const before = service.list(owner).ips.find(ip => ip.id === "ip-linjie")!
    const oldProfile = JSON.stringify(before.profile)
    service.updateProfile(owner, "ip-linjie", {
      expectedVersion: before.version,
      displayName: "林姐健康生活",
      profile: { ...before.profile, expertise: "社区健康生活方式分享" },
      changeSummary: "调整内容方向",
    })

    const versions = database.prepare("SELECT version,profile_json FROM ip_profile_versions WHERE ip_profile_id='ip-linjie' ORDER BY version").all() as Array<{ version: number; profile_json: string }>
    expect(versions).toHaveLength(2)
    expect(versions[0].profile_json).toBe(oldProfile)
    expect(JSON.parse(versions[1].profile_json).expertise).toBe("社区健康生活方式分享")
  })

  it("新增多平台账号、切换默认账号并在停用后自动选择替代账号", () => {
    const created = service.createAccount(owner, "ip-linjie", { platform: "xiaohongshu", accountName: "林姐健康笔记" })
    service.setDefaultAccount(owner, created.id)
    expect(database.prepare("SELECT is_default FROM content_accounts WHERE id=?").get(created.id)).toEqual({ is_default: 1 })

    service.setAccountStatus(owner, created.id, "disabled")
    expect(database.prepare("SELECT COUNT(*) count FROM content_accounts WHERE ip_profile_id='ip-linjie' AND status='active' AND is_default=1").get()).toEqual({ count: 1 })
  })

  it("归档当前 IP 后把用户上下文迁移到仍可访问的活跃 IP", () => {
    service.setIpStatus(owner, "ip-linjie", "disabled")
    expect(database.prepare("SELECT ip_profile_id FROM user_current_context WHERE user_id='user-owner'").get()).toEqual({ ip_profile_id: "ip-wangjie" })
    service.setIpStatus(owner, "ip-linjie", "active")
    expect(database.prepare("SELECT status FROM ip_profiles WHERE id='ip-linjie'").get()).toEqual({ status: "active" })
  })

  it("没有 IP 管理能力的成员不能进入管理服务", () => {
    expect(() => service.list({ ...owner, userId: "user-operator", membershipId: "membership-operator", capabilities: [] }))
      .toThrow("CAPABILITY_FORBIDDEN")
  })
})
