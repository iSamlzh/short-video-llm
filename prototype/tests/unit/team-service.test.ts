import { afterEach, describe, expect, it } from "vitest"
import type Database from "better-sqlite3"
import { openDatabase } from "../../src/lib/db/database"
import type { AccessContext } from "../../src/domain/access"
import { TeamService } from "../../src/services/team-service"
import { LocalIdentityProvider } from "../../src/lib/auth/local-identity-provider"
import { IdentityRepository } from "../../src/lib/db/identity-repository"
import { SessionRepository } from "../../src/lib/auth/session"

let database: Database.Database | undefined

afterEach(() => database?.close())

function seedTeam(db: Database.Database) {
  const now = "2026-08-17T10:00:00.000Z"
  db.prepare("INSERT INTO users (id,email_normalized,display_name,password_hash,audience,status,data_origin,created_at) VALUES (?,?,?,?,?,?,?,?)")
    .run("user-owner", "owner@example.test", "林姐", "hash", "tenant", "active", "demo", now)
  db.prepare("INSERT INTO users (id,email_normalized,display_name,password_hash,audience,status,data_origin,created_at) VALUES (?,?,?,?,?,?,?,?)")
    .run("user-operator", "operator@example.test", "小周", "hash", "tenant", "active", "demo", now)
  db.prepare("INSERT INTO tenants (id,name,status,data_origin,created_at) VALUES (?,?,?,?,?)")
    .run("tenant-linjie", "林姐内容团队", "active", "demo", now)
  db.prepare("INSERT INTO memberships (id,tenant_id,user_id,role_key,status,data_origin,created_at) VALUES (?,?,?,?,?,?,?)")
    .run("membership-owner", "tenant-linjie", "user-owner", "owner", "active", "demo", now)
  db.prepare("INSERT INTO memberships (id,tenant_id,user_id,role_key,status,data_origin,created_at) VALUES (?,?,?,?,?,?,?)")
    .run("membership-operator", "tenant-linjie", "user-operator", "operator", "active", "demo", now)
  db.prepare("INSERT INTO ip_profiles (id,tenant_id,display_name,profile_json,status,data_origin,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
    .run("ip-linjie", "tenant-linjie", "林姐", "{}", "active", "demo", now, now)
  db.prepare("INSERT INTO content_accounts (id,tenant_id,ip_profile_id,platform,account_name,status,data_origin,created_at) VALUES (?,?,?,?,?,?,?,?)")
    .run("account-linjie-wechat", "tenant-linjie", "ip-linjie", "wechat_channels", "林姐说团购", "active", "demo", now)
}

const ownerContext: AccessContext = {
  audience: "tenant",
  userId: "user-owner",
  tenantId: "tenant-linjie",
  membershipId: "membership-owner",
  capabilities: [
    "ip.view", "content.create", "content.edit", "content.lock",
    "metrics.import", "review.generate", "review.view", "team.manage",
  ],
  ipIds: ["ip-linjie"],
  contentAccountIds: ["account-linjie-wechat"],
}

describe("team access service", () => {
  it("assigns the operator to exactly the confirmed capabilities and scopes", () => {
    database = openDatabase(":memory:")
    seedTeam(database)
    const service = new TeamService(database)

    service.updateAccess(ownerContext, "membership-operator", {
      roleKey: "operator",
      capabilities: ["ip.view", "content.create", "content.edit", "review.view"],
      ipIds: ["ip-linjie"],
      contentAccountIds: ["account-linjie-wechat"],
    })

    expect(service.getMemberAccess("membership-operator")).toEqual({
      roleKey: "operator",
      capabilities: ["content.create", "content.edit", "ip.view", "review.view"],
      ipIds: ["ip-linjie"],
      contentAccountIds: ["account-linjie-wechat"],
    })
  })

  it("does not allow an actor to grant a capability they do not have", () => {
    database = openDatabase(":memory:")
    seedTeam(database)
    const service = new TeamService(database)
    const delegatedManager: AccessContext = {
      ...ownerContext,
      userId: "user-operator",
      membershipId: "membership-operator",
      capabilities: ["team.manage", "content.create"],
    }

    expect(() => service.updateAccess(delegatedManager, "membership-owner", {
      roleKey: "operator",
      capabilities: ["team.manage", "content.lock"],
      ipIds: ["ip-linjie"],
      contentAccountIds: ["account-linjie-wechat"],
    })).toThrowError("CANNOT_GRANT_CAPABILITY")
  })

  it("keeps an existing current IP and otherwise selects the first accessible one", () => {
    database = openDatabase(":memory:")
    seedTeam(database)
    const service = new TeamService(database)

    expect(service.ensureCurrentContext("user-operator", "tenant-linjie", ["ip-linjie"], ["account-linjie-wechat"]))
      .toEqual({ ipProfileId: "ip-linjie", contentAccountId: "account-linjie-wechat" })
    expect(service.ensureCurrentContext(
      "user-operator",
      "tenant-linjie",
      ["ip-other", "ip-linjie"],
      ["account-other", "account-linjie-wechat"],
    ))
      .toEqual({ ipProfileId: "ip-linjie", contentAccountId: "account-linjie-wechat" })
  })

  it("creates a real scoped member with a one-time temporary password", async () => {
    database = openDatabase(":memory:")
    seedTeam(database)
    const service = new TeamService(database)
    const created = await service.createMember(ownerContext, {
      email: "new-operator@example.test", displayName: "新运营", roleKey: "operator",
      ipIds: ["ip-linjie"], contentAccountIds: ["account-linjie-wechat"],
    })

    const identity = await new LocalIdentityProvider(new IdentityRepository(database))
      .authenticate("new-operator@example.test", created.temporaryPassword)
    expect(identity.mustChangePassword).toBe(true)
    expect(service.getMemberAccess(created.membershipId)).toMatchObject({
      roleKey: "operator", ipIds: ["ip-linjie"], contentAccountIds: ["account-linjie-wechat"],
    })
    expect(database.prepare("SELECT action FROM audit_logs WHERE resource_id=?").get(created.membershipId))
      .toEqual({ action: "team.member.created" })
  })

  it("revokes active sessions when a member is disabled", () => {
    database = openDatabase(":memory:")
    seedTeam(database)
    const sessions = new SessionRepository(database)
    const token = sessions.create("user-operator", "tenant")

    new TeamService(database).setStatus(ownerContext, "membership-operator", "disabled")

    expect(sessions.resolve(token)).toBeNull()
    expect(database.prepare("SELECT status FROM memberships WHERE id='membership-operator'").get()).toEqual({ status: "disabled" })
  })
})
