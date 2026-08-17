import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import type Database from "better-sqlite3"
import { openDatabase } from "./database"

let singleton: Database.Database | undefined

export function getAppDatabase() {
  if (singleton) return singleton
  const path = resolve(/* turbopackIgnore: true */ process.cwd(), process.env.PROTOTYPE_DB_PATH ?? ".data/prototype.sqlite")
  mkdirSync(dirname(path), { recursive: true })
  singleton = openDatabase(path)
  return singleton
}
