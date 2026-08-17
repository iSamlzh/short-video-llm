import { afterEach, describe, expect, it } from "vitest"
import type Database from "better-sqlite3"
import { openDatabase } from "../../src/lib/db/database"
import { AccessRepository } from "../../src/lib/db/access-repository"
import { AccessService } from "../../src/services/access-service"

let database: Database.Database | undefined

afterEach(() => database?.close())

function seedTenantAccess(db: Database.Database) {
  const now = "2026-08-17T10:00:00.000Z"
  db.prepare("INSERT INTO users (id,email_normalized,display_name,password_hash,audience,status,data_origin,created_at) VALUES (?,?,?,?,?,?,?,?)")
    .run("user-operator", "operator@example.test", "小周", "hash", "tenant", "active", "demo", now)
  db.prepare("INSERT INTO tenants (id,name,status,data_origin,created_at) VALUES (?,?,?,?,?)")
    .run("tenant-linjie", "林姐内容团队", "active", "demo", now)
  db.prepare("INSERT INTO memberships (id,tenant_id,user_id,role_key,status,data_origin,created_at) VALUES (?,?,?,?,?,?,?)")
    .run("membership-operator", "tenant-linjie", "user-operator", "operator", "active", "demo", now)
  db.prepare("INSERT INTO membership_capabilities (membership_id,capability) VALUES (?,?)")
    .run("membership-operator", "content.create")
  db.prepare("INSERT INTO ip_profiles (id,tenant_id,display_name,profile_json,status,data_origin,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
    .run("ip-linjie", "tenant-linjie", "林姐", "{}", "active", "demo", now, now)
  db.prepare("INSERT INTO content_accounts (id,tenant_id,ip_profile_id,platform,account_name,status,data_origin,created_at) VALUES (?,?,?,?,?,?,?,?)")
    .run("account-linjie-wechat", "tenant-linjie", "ip-linjie", "wechat_channels", "林姐说团购", "active", "demo", now)
  db.prepare("INSERT INTO membership_ip_scopes (membership_id,ip_profile_id) VALUES (?,?)")
    .run("membership-operator", "ip-linjie")
  db.prepare("INSERT INTO membership_account_scopes (membership_id,content_account_id) VALUES (?,?)")
    .run("membership-operator", "account-linjie-wechat")
}

describe("access context resolution", () => {
  it("resolves capabilities and resource scopes from the active membership", () => {
    database = openDatabase(":memory:")
    seedTenantAccess(database)
    const service = new AccessService(new AccessRepository(database))

    expect(service.resolve("user-operator", "tenant")).toEqual({
      audience: "tenant",
      userId: "user-operator",
      tenantId: "tenant-linjie",
      membershipId: "membership-operator",
      capabilities: ["content.create"],
      ipIds: ["ip-linjie"],
      contentAccountIds: ["account-linjie-wechat"],
    })
  })

  it("does not resolve a disabled membership", () => {
    database = openDatabase(":memory:")
    seedTenantAccess(database)
    database.prepare("UPDATE memberships SET status = 'disabled'").run()
    const service = new AccessService(new AccessRepository(database))

    expect(() => service.resolve("user-operator", "tenant")).toThrowError("ACTIVE_MEMBERSHIP_REQUIRED")
  })
})
