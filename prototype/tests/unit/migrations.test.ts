import { afterEach, describe, expect, it } from "vitest"
import Database from "better-sqlite3"
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

  it("adds script-selection lineage to quality reports and locked scripts", () => {
    database = openDatabase(":memory:")
    const qualityColumns = database.prepare("PRAGMA table_info(quality_reports)").all() as Array<{ name: string }>
    const lockColumns = database.prepare("PRAGMA table_info(locked_scripts)").all() as Array<{ name: string }>

    expect(qualityColumns.map((column) => column.name)).toContain("script_selection_version")
    expect(lockColumns.map((column) => column.name)).toContain("script_selection_version")
    expect(database.prepare(
      "SELECT COUNT(*) count FROM schema_migrations WHERE version = 6",
    ).get()).toEqual({ count: 1 })
  })

  it("applies version 7 exactly once and adds real-growth lineage", () => {
    database = openDatabase(":memory:")
    applyMigrations(database)
    applyMigrations(database)

    expect(database.prepare(
      "SELECT COUNT(*) count FROM schema_migrations WHERE version = 7",
    ).get()).toEqual({ count: 1 })
    expect(database.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'publications'",
    ).get()).toEqual({ name: "publications" })
    expect(database.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'content_review_versions'",
    ).get()).toEqual({ name: "content_review_versions" })
    const columns = database.prepare("PRAGMA table_info(creation_run_context)").all() as Array<{ name: string }>
    expect(columns.map((column) => column.name)).toContain("tenant_memory_version")
    expect(database.pragma("busy_timeout", { simple: true })).toBe(5_000)
  })

  it("does not promote legacy demo metrics into the formal snapshot path", () => {
    database = openDatabase(":memory:")
    expect(database.prepare("SELECT COUNT(*) count FROM real_metric_snapshots").get()).toEqual({ count: 0 })
  })

  it("为每个 IP 的内容账号提供唯一默认账号标记", () => {
    database = openDatabase(":memory:")
    const columns = database.prepare("PRAGMA table_info(content_accounts)").all() as Array<{ name: string }>

    expect(columns.map((column) => column.name)).toContain("is_default")
    expect(database.prepare("SELECT COUNT(*) count FROM schema_migrations WHERE version=12").get()).toEqual({ count: 1 })
  })

  it("版本 13 保存扩展视频指标和平台原始列", () => {
    database = openDatabase(":memory:")
    const columns = database.prepare("PRAGMA table_info(real_metric_snapshots)").all() as Array<{ name: string }>

    expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      "three_second_retention",
      "five_second_retention",
      "average_watch_seconds",
      "profile_visits",
      "followers_gained",
      "raw_columns_json",
    ]))
    expect(database.prepare("SELECT COUNT(*) count FROM schema_migrations WHERE version=13").get()).toEqual({ count: 1 })
  })

  it("应用版本 8 并建立爆款拆解与创作结构谱系", () => {
    database = openDatabase(":memory:")
    applyMigrations(database)

    expect(database.prepare(
      "SELECT COUNT(*) count FROM schema_migrations WHERE version = 8",
    ).get()).toEqual({ count: 1 })
    for (const table of [
      "platform_content_sample_revisions",
      "platform_content_analysis_versions",
      "platform_structure_candidates",
      "platform_candidate_source_links",
      "platform_structure_previews",
      "platform_template_activation_events",
    ]) {
      expect(database.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
      ).get(table)).toEqual({ name: table })
    }
    const columns = database.prepare("PRAGMA table_info(creation_run_context)").all() as Array<{ name: string }>
    expect(columns.map((column) => column.name)).toContain("structure_version_ids_json")
  })

  it("将已执行旧版 008 的存量库补齐审核备注字段", () => {
    database = new Database(":memory:")
    database.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        filename TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE platform_content_analysis_versions (id TEXT PRIMARY KEY);
      CREATE TABLE platform_structure_candidates (id TEXT PRIMARY KEY);
      CREATE TABLE content_accounts (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        ip_profile_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE user_current_context (content_account_id TEXT);
      CREATE TABLE real_metric_snapshots (id TEXT PRIMARY KEY);
    `)
    const markApplied = database.prepare(
      "INSERT INTO schema_migrations (version,filename,applied_at) VALUES (?,?,'2026-08-17T12:00:00.000Z')",
    )
    for (let version = 2; version <= 8; version += 1) markApplied.run(version, `00${version}_legacy.sql`)

    applyMigrations(database)

    const analysisColumns = database.prepare("PRAGMA table_info(platform_content_analysis_versions)").all() as Array<{ name: string }>
    const candidateColumns = database.prepare("PRAGMA table_info(platform_structure_candidates)").all() as Array<{ name: string }>
    expect(analysisColumns.map((column) => column.name)).toContain("review_note")
    expect(candidateColumns.map((column) => column.name)).toContain("review_note")
    expect(database.prepare("SELECT COUNT(*) count FROM schema_migrations WHERE version=9").get()).toEqual({ count: 1 })
  })
})
