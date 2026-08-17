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
] as const

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
