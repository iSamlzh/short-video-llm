import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import type Database from "better-sqlite3"

const migrations = [
  {
    version: 2,
    filename: "002_tenant_access.sql",
  },
  {
    version: 3,
    filename: "003_product_loop.sql",
  },
  {
    version: 4,
    filename: "004_platform_content_brain.sql",
  },
  {
    version: 5,
    filename: "005_real_metrics_review.sql",
  },
  {
    version: 6,
    filename: "006_script_revision_lineage.sql",
  },
  {
    version: 7,
    filename: "007_real_publication_review_memory.sql",
  },
  {
    version: 8,
    filename: "008_content_brain_breakdown.sql",
  },
  {
    version: 9,
    filename: "009_content_brain_review_notes.sql",
  },
  {
    version: 10,
    filename: "010_ip_onboarding_sessions.sql",
  },
  {
    version: 11,
    filename: "011_user_current_tenant.sql",
  },
  {
    version: 12,
    filename: "012_content_account_default.sql",
  },
  {
    version: 13,
    filename: "013_extended_metric_evidence.sql",
  },
  {
    version: 14,
    filename: "014_review_followup_lineage.sql",
  },
  {
    version: 15,
    filename: "015_model_tasks.sql",
  },
  {
    version: 16,
    filename: "016_team_accounts.sql",
  },
  {
    version: 17,
    filename: "017_ip_account_management.sql",
  },
  {
    version: 18,
    filename: "018_model_task_request_trace.sql",
  },
  {
    version: 19,
    filename: "019_model_task_scopes.sql",
  },
  {
    version: 20,
    filename: "020_agent_jobs.sql",
  },
] as const

export const LATEST_MIGRATION_VERSION = migrations.at(-1)!.version

export function applyMigrations(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      filename TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `)

  for (const migration of migrations) {
    const exists = database.prepare("SELECT 1 FROM schema_migrations WHERE version = ?").get(migration.version)
    if (exists) continue
    const sql = readFileSync(resolve(process.cwd(), "src/lib/db/migrations", migration.filename), "utf8")
    database.transaction(() => {
      database.exec(sql)
      database.prepare("INSERT INTO schema_migrations (version,filename,applied_at) VALUES (?,?,?)")
        .run(migration.version, migration.filename, new Date().toISOString())
    })()
  }
}
