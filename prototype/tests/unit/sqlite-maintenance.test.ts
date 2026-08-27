import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { openDatabase } from "../../src/lib/db/database"
import { seedDemoData } from "../../src/scripts/demo-data"
import { LATEST_MIGRATION_VERSION } from "../../src/lib/db/migrations"

const maintenance = resolve("deploy/scripts/sqlite-maintenance.mjs")

describe("SQLite 在线备份与隔离恢复", () => {
  it("生成带完整性清单的在线备份并在隔离目录恢复关键表行数", async () => {
    const root = mkdtempSync(join(tmpdir(), "content-agent-backup-"))
    const databasePath = join(root, "production.sqlite")
    const backupDirectory = join(root, "backups")
    const restoreDirectory = join(root, "restore-drill")
    const database = openDatabase(databasePath)
    await seedDemoData(database, "demo-password")
    database.close()

    const backupOutput = run("backup", "--database", databasePath, "--backup-dir", backupDirectory,
      "--daily-keep", "7", "--weekly-keep", "4", "--force-weekly", "true")
    const dailyPath = backupOutput.dailyBackup as string
    expect(backupOutput).toMatchObject({ status: "completed", integrity: "ok" })
    expect(readdirSync(backupDirectory).filter((name) => name.endsWith(".sqlite"))).toHaveLength(2)
    const manifest = JSON.parse(readFileSync(`${dailyPath}.manifest.json`, "utf8"))
    expect(manifest).toMatchObject({ integrity: "ok", schemaVersion: LATEST_MIGRATION_VERSION })
    expect(manifest.tableCounts.users).toBeGreaterThan(0)

    const restoreOutput = run("restore", "--backup", dailyPath, "--target-dir", restoreDirectory,
      "--production-db", databasePath)
    expect(restoreOutput).toMatchObject({ status: "completed", integrity: "ok", schemaVersion: LATEST_MIGRATION_VERSION })
    expect(restoreOutput.tableCounts).toEqual(manifest.tableCounts)
  })

  it("拒绝恢复到生产数据库目录或非空目录", async () => {
    const root = mkdtempSync(join(tmpdir(), "content-agent-restore-guard-"))
    const databasePath = join(root, "production.sqlite")
    const backupDirectory = join(root, "backups")
    const database = openDatabase(databasePath)
    await seedDemoData(database, "demo-password")
    database.close()
    const dailyPath = run("backup", "--database", databasePath, "--backup-dir", backupDirectory,
      "--force-weekly", "false").dailyBackup as string

    expect(() => run("restore", "--backup", dailyPath, "--target-dir", root, "--production-db", databasePath))
      .toThrow(/TARGET_DIRECTORY_IS_PRODUCTION_DIRECTORY/)
    const nonEmpty = join(root, "non-empty")
    mkdirSync(nonEmpty)
    writeFileSync(join(nonEmpty, "keep.txt"), "不可覆盖")
    expect(() => run("restore", "--backup", dailyPath, "--target-dir", nonEmpty, "--production-db", databasePath))
      .toThrow(/TARGET_DIRECTORY_NOT_EMPTY/)
  })
})

function run(...args: string[]) {
  const output = execFileSync(process.execPath, [maintenance, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  return JSON.parse(output)
}
