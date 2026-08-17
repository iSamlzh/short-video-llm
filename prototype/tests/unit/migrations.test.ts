import { afterEach, describe, expect, it } from "vitest"
import type Database from "better-sqlite3"
import { openDatabase } from "../../src/lib/db/database"
import { applyMigrations } from "../../src/lib/db/migrations"

let database: Database.Database | undefined

afterEach(() => database?.close())

describe("database migrations", () => {
  it("applies the tenant-access migration exactly once", () => {
    database = openDatabase(":memory:")
    applyMigrations(database)
    applyMigrations(database)

    expect(database.prepare(
      "SELECT COUNT(*) count FROM schema_migrations WHERE version = 2",
    ).get()).toEqual({ count: 1 })
  })

  it("enforces one current context for each user and tenant", () => {
    database = openDatabase(":memory:")
    const now = "2026-08-17T10:00:00.000Z"
    database.prepare("INSERT INTO users (id,email_normalized,display_name,password_hash,audience,status,data_origin,created_at) VALUES (?,?,?,?,?,?,?,?)")
      .run("user-1", "owner@example.test", "林姐", "hash", "tenant", "active", "demo", now)
    database.prepare("INSERT INTO tenants (id,name,status,data_origin,created_at) VALUES (?,?,?,?,?)")
      .run("tenant-1", "林姐内容团队", "active", "demo", now)
    database.prepare("INSERT INTO user_current_context (user_id,tenant_id,ip_profile_id,content_account_id,updated_at) VALUES (?,?,?,?,?)")
      .run("user-1", "tenant-1", null, null, now)

    expect(() => database!.prepare("INSERT INTO user_current_context (user_id,tenant_id,ip_profile_id,content_account_id,updated_at) VALUES (?,?,?,?,?)")
      .run("user-1", "tenant-1", null, null, now)).toThrow()
  })
})
