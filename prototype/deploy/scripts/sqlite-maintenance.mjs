#!/usr/bin/env node
import { createHash } from "node:crypto"
import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, join, resolve } from "node:path"
import Database from "better-sqlite3"

const keyTables = [
  "tenants", "users", "ip_profiles", "content_accounts", "creation_run_context", "runs", "locked_scripts",
  "publications", "real_metric_snapshots", "content_review_versions", "tenant_memory_versions", "model_tasks",
]

const [command, ...rawArguments] = process.argv.slice(2)
const argumentsMap = parseArguments(rawArguments)

try {
  if (command === "backup") await backup(argumentsMap)
  else if (command === "restore") await restore(argumentsMap)
  else throw new Error("COMMAND_REQUIRED")
} catch (error) {
  process.stderr.write(`${JSON.stringify({ status: "failed", errorCode: error instanceof Error ? error.message : "SQLITE_MAINTENANCE_FAILED" })}\n`)
  process.exitCode = 1
}

async function backup(input) {
  const sourcePath = absoluteExistingFile(required(input, "database"), "DATABASE")
  const backupDirectory = absoluteDirectory(required(input, "backup-dir"), "BACKUP_DIRECTORY")
  const dailyKeep = positiveInteger(input["daily-keep"], 7)
  const weeklyKeep = positiveInteger(input["weekly-keep"], 4)
  if (resolve(backupDirectory) === resolve(dirname(sourcePath))) throw new Error("BACKUP_DIRECTORY_MUST_BE_SEPARATE")
  const stamp = chinaTimestamp()
  const dailyPath = join(backupDirectory, `daily-${stamp}.sqlite`)
  if (existsSync(dailyPath)) throw new Error("BACKUP_ALREADY_EXISTS")

  const source = new Database(sourcePath, { readonly: true, fileMustExist: true })
  try { await source.backup(dailyPath) } finally { source.close() }
  const dailyManifest = await inspectDatabase(dailyPath)
  writeManifest(dailyPath, dailyManifest)

  let weeklyPath = null
  if (chinaWeekday() === 7 || input["force-weekly"] === "true") {
    weeklyPath = join(backupDirectory, `weekly-${stamp}.sqlite`)
    copyFileSync(dailyPath, weeklyPath)
    writeManifest(weeklyPath, await inspectDatabase(weeklyPath))
  }
  enforceRetention(backupDirectory, "daily-", dailyKeep)
  enforceRetention(backupDirectory, "weekly-", weeklyKeep)
  process.stdout.write(`${JSON.stringify({ status: "completed", dailyBackup: dailyPath, weeklyBackup: weeklyPath, integrity: dailyManifest.integrity })}\n`)
}

async function restore(input) {
  const backupPath = absoluteExistingFile(required(input, "backup"), "BACKUP")
  const targetDirectory = requiredAbsolute(input, "target-dir", "TARGET_DIRECTORY")
  const productionPath = requiredAbsolute(input, "production-db", "PRODUCTION_DATABASE")
  const resolvedTargetDirectory = resolve(targetDirectory)
  if (resolvedTargetDirectory === resolve(dirname(productionPath))) throw new Error("TARGET_DIRECTORY_IS_PRODUCTION_DIRECTORY")
  if (resolvedTargetDirectory === resolve("/")) throw new Error("TARGET_DIRECTORY_TOO_BROAD")
  if (existsSync(targetDirectory) && readdirSync(targetDirectory).length > 0) throw new Error("TARGET_DIRECTORY_NOT_EMPTY")
  mkdirSync(targetDirectory, { recursive: true, mode: 0o750 })
  const targetPath = join(targetDirectory, "restored.sqlite")
  if (resolve(targetPath) === resolve(productionPath) || existsSync(targetPath)) throw new Error("PRODUCTION_OVERWRITE_FORBIDDEN")

  const backupInspection = await inspectDatabase(backupPath)
  const manifestPath = `${backupPath}.manifest.json`
  if (existsSync(manifestPath)) verifyManifest(JSON.parse(readFileSync(manifestPath, "utf8")), backupInspection)
  const source = new Database(backupPath, { readonly: true, fileMustExist: true })
  try { await source.backup(targetPath) } finally { source.close() }
  const restoredInspection = await inspectDatabase(targetPath)
  compareCounts(backupInspection.tableCounts, restoredInspection.tableCounts)
  writeManifest(targetPath, restoredInspection)
  process.stdout.write(`${JSON.stringify({ status: "completed", restoredDatabase: targetPath, integrity: restoredInspection.integrity, schemaVersion: restoredInspection.schemaVersion, tableCounts: restoredInspection.tableCounts })}\n`)
}

async function inspectDatabase(path) {
  const database = new Database(path, { readonly: true, fileMustExist: true })
  try {
    const integrityRows = database.pragma("integrity_check")
    const integrity = integrityRows.length === 1 && integrityRows[0].integrity_check === "ok" ? "ok" : "failed"
    if (integrity !== "ok") throw new Error("SQLITE_INTEGRITY_CHECK_FAILED")
    const tables = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name))
    const tableCounts = {}
    for (const table of keyTables) {
      if (tables.has(table)) tableCounts[table] = Number(database.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count)
    }
    const schemaVersion = tables.has("schema_migrations")
      ? Number(database.prepare("SELECT COALESCE(MAX(version),0) version FROM schema_migrations").get().version) : 0
    return { integrity, schemaVersion, tableCounts, sha256: await sha256(path), sizeBytes: statSync(path).size }
  } finally { database.close() }
}

function verifyManifest(expected, actual) {
  if (expected.integrity !== "ok" || expected.sha256 !== actual.sha256 || Number(expected.schemaVersion) !== actual.schemaVersion) {
    throw new Error("BACKUP_MANIFEST_MISMATCH")
  }
  compareCounts(expected.tableCounts ?? {}, actual.tableCounts)
}

function compareCounts(expected, actual) {
  for (const [table, count] of Object.entries(expected)) {
    if (Number(actual[table]) !== Number(count)) throw new Error(`TABLE_COUNT_MISMATCH_${table.toUpperCase()}`)
  }
}

function writeManifest(databasePath, inspection) {
  writeFileSync(`${databasePath}.manifest.json`, `${JSON.stringify({ ...inspection, createdAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o640 })
}

function enforceRetention(directory, prefix, keep) {
  const files = readdirSync(directory).filter((name) => name.startsWith(prefix) && name.endsWith(".sqlite")).sort().reverse()
  for (const name of files.slice(keep)) {
    const databasePath = join(directory, name)
    rmSync(databasePath)
    const manifestPath = `${databasePath}.manifest.json`
    if (existsSync(manifestPath)) rmSync(manifestPath)
  }
}

function parseArguments(items) {
  const parsed = {}
  for (let index = 0; index < items.length; index += 2) {
    const key = items[index]
    const value = items[index + 1]
    if (!key?.startsWith("--") || value === undefined) throw new Error("ARGUMENTS_INVALID")
    parsed[key.slice(2)] = value
  }
  return parsed
}

function required(input, key) { if (!input[key]) throw new Error(`${key.toUpperCase().replaceAll("-", "_")}_REQUIRED`); return input[key] }
function requiredAbsolute(input, key, label) { const value = required(input, key); if (!isAbsolute(value)) throw new Error(`${label}_MUST_BE_ABSOLUTE`); return resolve(value) }
function absoluteExistingFile(value, label) { if (!isAbsolute(value)) throw new Error(`${label}_MUST_BE_ABSOLUTE`); if (!existsSync(value) || !statSync(value).isFile()) throw new Error(`${label}_NOT_FOUND`); return resolve(value) }
function absoluteDirectory(value, label) { if (!isAbsolute(value)) throw new Error(`${label}_MUST_BE_ABSOLUTE`); mkdirSync(value, { recursive: true, mode: 0o750 }); return resolve(value) }
function positiveInteger(value, fallback) { const number = Number(value); return Number.isInteger(number) && number > 0 ? number : fallback }
async function sha256(path) { const hash = createHash("sha256"); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest("hex") }
function chinaWeekday() { const value = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", weekday: "short" }).format(new Date()); return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(value) + 1 }
function chinaTimestamp() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts().map((part) => [part.type, part.value]))
  return `${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}${parts.second}`
}
