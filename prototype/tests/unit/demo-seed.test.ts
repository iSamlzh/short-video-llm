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

    expect(database.prepare("SELECT COUNT(*) count FROM users WHERE data_origin = 'demo'").get()).toEqual({ count: 5 })
    expect(database.prepare("SELECT COUNT(*) count FROM tenants WHERE data_origin = 'demo'").get()).toEqual({ count: 2 })
    expect(database.prepare("SELECT COUNT(*) count FROM ip_profiles WHERE data_origin = 'demo'").get()).toEqual({ count: 2 })
    expect(database.prepare("SELECT COUNT(*) count FROM user_current_context WHERE user_id = 'user-firsttime'").get()).toEqual({ count: 0 })
    expect(database.prepare("SELECT tenant_id,role_key FROM memberships WHERE user_id = 'user-firsttime'").get())
      .toEqual({ tenant_id: "tenant-firsttime", role_key: "owner" })
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
    expect(database.prepare("SELECT platform_role FROM users WHERE id='user-platform'").get())
      .toEqual({ platform_role: "platform_admin" })
    expect(demoContentBrainCounts(database)).toEqual({
      samples: 3,
      revisions: 3,
      analyses: 3,
      candidates: 1,
      sourceLinks: 1,
      previews: 1,
      templates: 3,
    })
  })

  it("clears demo rows without deleting formal rows", async () => {
    database = openDatabase(":memory:")
    await seedDemoData(database, "demo-password")
    const now = "2026-08-17T10:00:00.000Z"
    database.prepare("INSERT INTO users (id,email_normalized,display_name,password_hash,audience,status,data_origin,created_at) VALUES (?,?,?,?,?,?,?,?)")
      .run("user-formal", "formal@example.test", "正式用户", "hash", "tenant", "active", "formal", now)
    database.prepare(`INSERT INTO platform_content_samples
      (id,title,source_platform,source_text,rights_note,status,data_origin,created_by_user_id,created_at,current_revision_version,workflow_status,updated_at)
      VALUES ('sample-formal','正式样本','douyin','正式样本文本','已授权','pending','formal','user-formal',?,1,'draft',?)`).run(now, now)
    database.prepare(`INSERT INTO platform_content_sample_revisions
      (id,sample_id,version,transcript,content_hash,created_by_user_id,created_at)
      VALUES ('sample-formal-revision-1','sample-formal',1,'正式样本文本','formal-hash','user-formal',?)`).run(now)
    database.prepare(`INSERT INTO platform_template_versions
      (id,template_id,version,name,payload_json,status,is_general,data_origin,created_by_user_id,created_at)
      VALUES ('template-formal-v1','template-formal',1,'正式结构','{}','active',1,'formal','user-formal',?)`).run(now)

    clearDemoData(database, true)

    expect(database.prepare("SELECT COUNT(*) count FROM users WHERE data_origin = 'demo'").get()).toEqual({ count: 0 })
    expect(database.prepare("SELECT COUNT(*) count FROM users WHERE id = 'user-formal'").get()).toEqual({ count: 1 })
    expect(database.prepare("SELECT COUNT(*) count FROM platform_content_samples WHERE id='sample-formal'").get()).toEqual({ count: 1 })
    expect(database.prepare("SELECT COUNT(*) count FROM platform_content_sample_revisions WHERE id='sample-formal-revision-1'").get()).toEqual({ count: 1 })
    expect(database.prepare("SELECT COUNT(*) count FROM platform_template_versions WHERE id='template-formal-v1'").get()).toEqual({ count: 1 })
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

function demoContentBrainCounts(database: Database.Database) {
  const count = (table: string, where = "") => (database.prepare(`SELECT COUNT(*) count FROM ${table} ${where}`).get() as { count: number }).count
  return {
    samples: count("platform_content_samples", "WHERE data_origin='demo'"),
    revisions: count("platform_content_sample_revisions", "WHERE sample_id IN (SELECT id FROM platform_content_samples WHERE data_origin='demo')"),
    analyses: count("platform_content_analysis_versions", "WHERE sample_id IN (SELECT id FROM platform_content_samples WHERE data_origin='demo')"),
    candidates: count("platform_structure_candidates", "WHERE data_origin='demo'"),
    sourceLinks: count("platform_candidate_source_links", "WHERE candidate_id IN (SELECT id FROM platform_structure_candidates WHERE data_origin='demo')"),
    previews: count("platform_structure_previews", "WHERE candidate_id IN (SELECT id FROM platform_structure_candidates WHERE data_origin='demo')"),
    templates: count("platform_template_versions", "WHERE data_origin='demo'"),
  }
}
