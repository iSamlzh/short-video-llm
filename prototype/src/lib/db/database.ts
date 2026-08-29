import Database from "better-sqlite3"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { applyMigrations } from "./migrations"

export function openDatabase(path: string) {
  const database = new Database(path)
  database.pragma("busy_timeout = 5000")
  database.pragma("journal_mode = WAL")
  database.pragma("synchronous = NORMAL")
  database.pragma("foreign_keys = ON")
  const schema = readFileSync(resolve(process.cwd(), "src/lib/db/schema.sql"), "utf8")
  database.exec(schema)
  applyMigrations(database)
  return database
}
