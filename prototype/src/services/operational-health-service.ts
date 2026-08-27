import { statfsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import type Database from "better-sqlite3"
import { LATEST_MIGRATION_VERSION } from "../lib/db/migrations"
import { operationalAlert } from "../lib/operational-alert"
import { validateRuntimeEnvironment } from "../lib/runtime-environment-validation"
import { resolveAppEnvironment, type RuntimeEnvironment } from "../lib/runtime-features"

type DiskStats = { bavail: number | bigint; bsize: number | bigint }
type HealthDependencies = {
  diskStats?: (path: string) => DiskStats
  now?: () => Date
  uptime?: () => number
}

export class OperationalHealthService {
  private readonly diskStats: (path: string) => DiskStats
  private readonly now: () => Date
  private readonly uptime: () => number

  constructor(
    private readonly database: Database.Database | null,
    private readonly environment: RuntimeEnvironment = process.env,
    dependencies: HealthDependencies = {},
  ) {
    this.diskStats = dependencies.diskStats ?? ((path) => statfsSync(path))
    this.now = dependencies.now ?? (() => new Date())
    this.uptime = dependencies.uptime ?? (() => process.uptime())
  }

  live() {
    return {
      status: "ok" as const,
      service: "content-growth-agent",
      version: this.environment.APP_VERSION?.trim() || "development",
      uptimeSeconds: Math.max(0, Math.floor(this.uptime())),
      checkedAt: this.now().toISOString(),
    }
  }

  ready() {
    const configuration = this.configurationCheck()
    const database = this.databaseCheck()
    const migration = this.migrationCheck()
    const disk = this.diskCheck()
    const model = this.modelCheck()
    const ready = configuration.ok && database.ok && migration.ok && disk.ok
    if (!configuration.ok) operationalAlert("readiness_configuration_failed", { issueCount: configuration.issues.length })
    if (!database.ok) operationalAlert("readiness_database_write_failed", { errorCode: database.errorCode })
    if (!migration.ok) operationalAlert("readiness_migration_incomplete", { current: migration.current, expected: migration.expected })
    if (!disk.ok) operationalAlert("readiness_disk_low", { freeMegabytes: disk.freeMegabytes, requiredMegabytes: disk.requiredMegabytes })
    if (model.consecutiveFailures >= model.failureThreshold) operationalAlert("model_consecutive_failures", {
      consecutiveFailures: model.consecutiveFailures,
      lastErrorCode: model.lastErrorCode,
    })
    return {
      status: ready ? "ready" as const : "not_ready" as const,
      checkedAt: this.now().toISOString(),
      checks: { configuration, database, migration, disk, model },
    }
  }

  private configurationCheck() {
    const issues: string[] = []
    try { validateRuntimeEnvironment(this.environment) }
    catch (error) {
      const details = (error as { details?: unknown }).details
      issues.push(...(Array.isArray(details) ? details.filter((item): item is string => typeof item === "string") : ["RUNTIME_CONFIGURATION_INVALID"]))
    }
    if (resolveAppEnvironment(this.environment) === "production") {
      if (this.environment.ALLOW_LIVE_MODEL !== "true") issues.push("LIVE_MODEL_REQUIRED")
      if (!isHttpsUrl(this.environment.LLM_BASE_URL)) issues.push("LLM_HTTPS_ENDPOINT_REQUIRED")
      if (!this.environment.LLM_API_KEY?.trim()) issues.push("LLM_API_KEY_REQUIRED")
      if (!this.environment.LLM_MODEL?.trim()) issues.push("LLM_MODEL_REQUIRED")
      if (this.demoDataCount() > 0) issues.push("DEMO_DATA_FORBIDDEN")
    }
    return {
      ok: issues.length === 0,
      environment: resolveAppEnvironment(this.environment),
      issues: [...new Set(issues)],
    }
  }

  private databaseCheck() {
    if (!this.database) return { ok: false, errorCode: "DATABASE_UNAVAILABLE" }
    try {
      this.database.exec("BEGIN IMMEDIATE; ROLLBACK")
      return { ok: true, errorCode: null }
    } catch {
      try { if (this.database.inTransaction) this.database.exec("ROLLBACK") } catch { /* 保留原始失败 */ }
      return { ok: false, errorCode: "DATABASE_NOT_WRITABLE" }
    }
  }

  private migrationCheck() {
    if (!this.database) return { ok: false, current: 0, expected: LATEST_MIGRATION_VERSION }
    try {
      const row = this.database.prepare("SELECT COALESCE(MAX(version),0) current FROM schema_migrations").get() as { current: number }
      const current = Number(row.current)
      return { ok: current === LATEST_MIGRATION_VERSION, current, expected: LATEST_MIGRATION_VERSION }
    } catch { return { ok: false, current: 0, expected: LATEST_MIGRATION_VERSION } }
  }

  private diskCheck() {
    const requiredMegabytes = positiveInteger(this.environment.DISK_MIN_FREE_MB, 1024)
    try {
      const databasePath = this.environment.PROTOTYPE_DB_PATH
      if (!databasePath) return { ok: false, freeMegabytes: 0, requiredMegabytes }
      const stats = this.diskStats(dirname(resolve(databasePath)))
      const freeMegabytes = Math.floor(Number(stats.bavail) * Number(stats.bsize) / 1024 / 1024)
      return { ok: freeMegabytes >= requiredMegabytes, freeMegabytes, requiredMegabytes }
    } catch { return { ok: false, freeMegabytes: 0, requiredMegabytes } }
  }

  private modelCheck() {
    const failureThreshold = positiveInteger(this.environment.HEALTH_MODEL_FAILURE_THRESHOLD, 3)
    if (!this.database) return { state: "no_calls" as const, lastStatus: null, lastErrorCode: null, consecutiveFailures: 0, failureThreshold, lastFinishedAt: null }
    try {
      const rows = this.database.prepare(`SELECT status,error_code,request_finished_at FROM model_tasks
        WHERE status!='running' ORDER BY COALESCE(request_finished_at,updated_at) DESC LIMIT ?`)
        .all(Math.max(10, failureThreshold)) as Array<{ status: string; error_code: string | null; request_finished_at: string | null }>
      const consecutiveFailures = rows.findIndex((item) => item.status === "succeeded")
      const failures = rows.length === 0 ? 0 : consecutiveFailures === -1 ? rows.length : consecutiveFailures
      const latest = rows[0]
      return {
        state: !latest ? "no_calls" as const : failures >= failureThreshold ? "degraded" as const : failures > 0 ? "warning" as const : "ok" as const,
        lastStatus: latest?.status ?? null,
        lastErrorCode: latest?.error_code ?? null,
        consecutiveFailures: failures,
        failureThreshold,
        lastFinishedAt: latest?.request_finished_at ?? null,
      }
    } catch {
      return { state: "unknown" as const, lastStatus: null, lastErrorCode: null, consecutiveFailures: 0, failureThreshold, lastFinishedAt: null }
    }
  }

  private demoDataCount() {
    if (!this.database) return 0
    try { return Number((this.database.prepare("SELECT COUNT(*) count FROM users WHERE data_origin='demo'").get() as { count: number }).count) }
    catch { return 0 }
  }
}

function isHttpsUrl(value: string | undefined) {
  try { return Boolean(value && new URL(value).protocol === "https:") }
  catch { return false }
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}
