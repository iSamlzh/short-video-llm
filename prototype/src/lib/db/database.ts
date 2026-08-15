import Database from "better-sqlite3"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

export function openDatabase(path: string) {
  const database = new Database(path)
  const schema = readFileSync(resolve(process.cwd(), "src/lib/db/schema.sql"), "utf8")
  database.exec(schema)
  return database
}
