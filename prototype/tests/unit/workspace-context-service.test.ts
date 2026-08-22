import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type Database from "better-sqlite3"
import { openDatabase } from "../../src/lib/db/database"
import { seedDemoData } from "../../src/scripts/demo-data"
import { AccessRepository } from "../../src/lib/db/access-repository"
import { WorkspaceContextService } from "../../src/services/workspace-context-service"

describe("工作上下文服务", () => {
  let database: Database.Database

  beforeEach(async () => {
    database = openDatabase(":memory:")
    await seedDemoData(database, "demo-password")
  })

  afterEach(() => database.close())

  it("只返回当前用户获授权的团队、IP 和当前 IP 账号", () => {
    const context = new WorkspaceContextService(database).get("user-operator")

    expect(context.team).toEqual({ id: "tenant-linjie", label: "林姐内容团队" })
    expect(context.ip).toEqual({ id: "ip-linjie", label: "林姐" })
    expect(context.account).toEqual({ id: "account-linjie-wechat", label: "视频号｜林姐说团购" })
    expect(context.ips).toEqual([{ id: "ip-linjie", label: "林姐" }])
    expect(context.accounts).toEqual([{ id: "account-linjie-wechat", label: "视频号｜林姐说团购" }])
  })

  it("切换 IP 时原子选择该 IP 的默认授权账号并持久化", () => {
    const service = new WorkspaceContextService(database)

    const context = service.switch("user-owner", { ipId: "ip-wangjie" })

    expect(context.ip).toEqual({ id: "ip-wangjie", label: "王姐" })
    expect(context.account).toEqual({ id: "account-wangjie-douyin", label: "抖音｜王姐本地生活" })
    expect(database.prepare(`SELECT ip_profile_id,content_account_id FROM user_current_context
      WHERE user_id='user-owner' AND tenant_id='tenant-linjie'`).get()).toEqual({
      ip_profile_id: "ip-wangjie",
      content_account_id: "account-wangjie-douyin",
    })

    const restored = service.switch("user-owner", { ipId: "ip-linjie" })
    expect(restored.account).toEqual({ id: "account-linjie-wechat", label: "视频号｜林姐说团购" })
  })

  it("拒绝切换到用户未获授权的 IP 或账号", () => {
    const service = new WorkspaceContextService(database)

    expect(() => service.switch("user-operator", { ipId: "ip-wangjie" })).toThrow("FORBIDDEN_CONTEXT")
    expect(() => service.switch("user-operator", { accountId: "account-linjie-douyin" })).toThrow("FORBIDDEN_CONTEXT")
  })

  it("切换团队后访问上下文解析使用新团队且保留原团队历史上下文", () => {
    seedSecondTeam(database)
    const service = new WorkspaceContextService(database)

    const context = service.switch("user-owner", { teamId: "tenant-second" })

    expect(context.team).toEqual({ id: "tenant-second", label: "第二内容团队" })
    expect(context.ip).toEqual({ id: "ip-second", label: "陈姐" })
    expect(context.account).toEqual({ id: "account-second", label: "视频号｜陈姐说生活" })
    expect(new AccessRepository(database).resolveTenant("user-owner")?.tenantId).toBe("tenant-second")
    expect(database.prepare(`SELECT ip_profile_id FROM user_current_context
      WHERE user_id='user-owner' AND tenant_id='tenant-linjie'`).get()).toEqual({ ip_profile_id: "ip-linjie" })
  })
})

function seedSecondTeam(database: Database.Database) {
  const now = "2026-08-18T10:00:00.000Z"
  database.prepare("INSERT INTO tenants (id,name,status,data_origin,created_at) VALUES (?,?,?,?,?)")
    .run("tenant-second", "第二内容团队", "active", "demo", now)
  database.prepare(`INSERT INTO memberships
    (id,tenant_id,user_id,role_key,status,data_origin,created_at) VALUES (?,?,?,?,?,?,?)`)
    .run("membership-second", "tenant-second", "user-owner", "owner", "active", "demo", now)
  database.prepare(`INSERT INTO ip_profiles
    (id,tenant_id,display_name,profile_json,status,data_origin,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run("ip-second", "tenant-second", "陈姐", "{}", "active", "demo", now, now)
  database.prepare(`INSERT INTO content_accounts
    (id,tenant_id,ip_profile_id,platform,account_name,status,data_origin,created_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run("account-second", "tenant-second", "ip-second", "wechat_channels", "陈姐说生活", "active", "demo", now)
  database.prepare("INSERT INTO membership_ip_scopes (membership_id,ip_profile_id) VALUES (?,?)")
    .run("membership-second", "ip-second")
  database.prepare("INSERT INTO membership_account_scopes (membership_id,content_account_id) VALUES (?,?)")
    .run("membership-second", "account-second")
}
