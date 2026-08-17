import { afterEach, describe, expect, it } from "vitest"
import type Database from "better-sqlite3"
import { openDatabase } from "../../src/lib/db/database"
import { clearDemoData, seedDemoData, seedE2ERealPublications } from "../../src/scripts/demo-data"

let database: Database.Database | undefined

afterEach(() => database?.close())

describe("demo data lifecycle", () => {
  it("seeds the default team idempotently", async () => {
    database = openDatabase(":memory:")
    await seedDemoData(database, "demo-password")
    await seedDemoData(database, "demo-password")

    expect(database.prepare("SELECT COUNT(*) count FROM users WHERE data_origin = 'demo'").get()).toEqual({ count: 4 })
    expect(database.prepare("SELECT COUNT(*) count FROM tenants WHERE data_origin = 'demo'").get()).toEqual({ count: 1 })
    expect(database.prepare("SELECT COUNT(*) count FROM ip_profiles WHERE data_origin = 'demo'").get()).toEqual({ count: 2 })
    const ownerCapabilities = database.prepare(
      "SELECT capability FROM membership_capabilities WHERE membership_id = 'membership-owner' ORDER BY capability",
    ).all() as Array<{ capability: string }>
    const operatorCapabilities = database.prepare(
      "SELECT capability FROM membership_capabilities WHERE membership_id = 'membership-operator' ORDER BY capability",
    ).all() as Array<{ capability: string }>
    const reviewerCapabilities = database.prepare(
      "SELECT capability FROM membership_capabilities WHERE membership_id = 'membership-reviewer' ORDER BY capability",
    ).all() as Array<{ capability: string }>

    expect(ownerCapabilities).toContainEqual({ capability: "publication.record" })
    expect(ownerCapabilities).toContainEqual({ capability: "review.confirm" })
    expect(operatorCapabilities).toContainEqual({ capability: "publication.record" })
    expect(reviewerCapabilities).toContainEqual({ capability: "review.generate" })
    expect(reviewerCapabilities).not.toContainEqual({ capability: "review.confirm" })
  })

  it("clears demo rows without deleting formal rows", async () => {
    database = openDatabase(":memory:")
    await seedDemoData(database, "demo-password")
    const now = "2026-08-17T10:00:00.000Z"
    database.prepare("INSERT INTO users (id,email_normalized,display_name,password_hash,audience,status,data_origin,created_at) VALUES (?,?,?,?,?,?,?,?)")
      .run("user-formal", "formal@example.test", "正式用户", "hash", "tenant", "active", "formal", now)

    clearDemoData(database, true)

    expect(database.prepare("SELECT COUNT(*) count FROM users WHERE data_origin = 'demo'").get()).toEqual({ count: 0 })
    expect(database.prepare("SELECT COUNT(*) count FROM users WHERE id = 'user-formal'").get()).toEqual({ count: 1 })
  })

  it("refuses to clear when the explicit guard is false", async () => {
    database = openDatabase(":memory:")
    await seedDemoData(database, "demo-password")
    expect(() => clearDemoData(database!, false)).toThrowError("DEMO_CLEAR_NOT_ALLOWED")
  })

  it("only seeds formally shaped E2E publications behind the double test guard", async () => {
    database = openDatabase(":memory:")
    await seedDemoData(database, "demo-password")

    expect(() => seedE2ERealPublications(database!, false)).toThrowError("E2E_FIXTURE_NOT_ALLOWED")
    seedE2ERealPublications(database, true)
    seedE2ERealPublications(database, true)

    expect(database.prepare("SELECT COUNT(*) count FROM publications WHERE id LIKE 'e2e-publication-%'").get())
      .toEqual({ count: 4 })
    expect(database.prepare("SELECT COUNT(*) count FROM publications WHERE id LIKE 'e2e-publication-%' AND source='external' AND status='active'").get())
      .toEqual({ count: 4 })
  })

  it("clears version 7 demo-scope rows without touching unrelated formal users", async () => {
    database = openDatabase(":memory:")
    await seedDemoData(database, "demo-password")
    seedE2ERealPublications(database, true)
    const now = "2026-08-17T10:00:00.000Z"
    database.prepare("INSERT INTO users (id,email_normalized,display_name,password_hash,audience,status,data_origin,created_at) VALUES (?,?,?,?,?,?,?,?)")
      .run("user-formal-v7", "formal-v7@example.test", "正式用户", "hash", "tenant", "active", "formal", now)

    clearDemoData(database, true)

    expect(database.prepare("SELECT COUNT(*) count FROM publications WHERE id LIKE 'e2e-publication-%'").get())
      .toEqual({ count: 0 })
    expect(database.prepare("SELECT COUNT(*) count FROM users WHERE id='user-formal-v7'").get()).toEqual({ count: 1 })
  })
})
