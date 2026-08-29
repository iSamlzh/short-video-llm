import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type Database from "better-sqlite3"
import { openDatabase } from "../../src/lib/db/database"
import { clearOperationalAlertState } from "../../src/lib/operational-alert"
import { seedDemoData } from "../../src/scripts/demo-data"
import { OperationalHealthService } from "../../src/services/operational-health-service"
import { LATEST_MIGRATION_VERSION } from "../../src/lib/db/migrations"

describe("OperationalHealthService", () => {
  let database: Database.Database

  beforeEach(async () => {
    database = openDatabase(":memory:")
    await seedDemoData(database, "demo-password")
    clearOperationalAlertState()
  })

  afterEach(() => { if (database.open) database.close(); vi.restoreAllMocks() })

  it("存活检查不依赖数据库且只返回非敏感运行信息", () => {
    const result = new OperationalHealthService(null, { APP_VERSION: "v1.0.0" }, {
      uptime: () => 12.9,
      now: () => new Date("2026-08-27T00:00:00.000Z"),
    }).live()

    expect(result).toEqual({
      status: "ok",
      service: "content-growth-agent",
      version: "v1.0.0",
      uptimeSeconds: 12,
      checkedAt: "2026-08-27T00:00:00.000Z",
    })
    expect(JSON.stringify(result)).not.toMatch(/database|key|session|user/i)
  })

  it("配置、写锁、Migration 和磁盘均正常时就绪", () => {
    const result = readyService(database).ready()

    expect(result.status).toBe("ready")
    expect(result.checks.database.ok).toBe(true)
    expect(result.checks.migration).toMatchObject({ ok: true, current: LATEST_MIGRATION_VERSION, expected: LATEST_MIGRATION_VERSION })
    expect(result.checks.disk).toMatchObject({ ok: true, freeMegabytes: 4096 })
    expect(result.checks.contentStructures).toMatchObject({ ok: true, usableGeneralCount: expect.any(Number) })
    expect(result.checks.model.state).toBe("no_calls")
  })

  it("Migration 缺失或磁盘不足时返回未就绪并形成脱敏告警", () => {
    database.prepare("DELETE FROM schema_migrations WHERE version=?").run(LATEST_MIGRATION_VERSION)
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const result = readyService(database, 128).ready()

    expect(result.status).toBe("not_ready")
    expect(result.checks.migration.ok).toBe(false)
    expect(result.checks.disk.ok).toBe(false)
    expect(error.mock.calls.flat().join(" ")).toMatch(/readiness_migration_incomplete.*readiness_disk_low/s)
    expect(error.mock.calls.flat().join(" ")).not.toContain("prototype.sqlite")
  })

  it("连续模型失败只标记降级，不把应用错误判为未就绪", () => {
    const now = "2026-08-27T01:00:00.000Z"
    for (let index = 1; index <= 3; index += 1) {
      database.prepare(`INSERT INTO model_tasks
        (id,tenant_id,scope_type,scope_id,actor_user_id,operation,idempotency_key,status,error_code,request_started_at,request_finished_at,created_at,updated_at)
        VALUES (?,'tenant-linjie','tenant','tenant-linjie','user-owner','creation.script',?,'failed','MODEL_CONNECTION_FAILED',?,?,?,?)`)
        .run(`failed-${index}`, `failed-key-${index}`, now, now, now, now)
    }
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const result = readyService(database).ready()

    expect(result.status).toBe("ready")
    expect(result.checks.model).toMatchObject({ state: "degraded", consecutiveFailures: 3, lastErrorCode: "MODEL_CONNECTION_FAILED" })
    expect(error).toHaveBeenCalledWith(expect.stringContaining("model_consecutive_failures"))
  })

  it("没有节点完整的通用结构时返回未就绪", () => {
    database.prepare("UPDATE platform_template_versions SET status='inactive' WHERE is_general=1").run()
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined)

    const result = readyService(database).ready()

    expect(result.status).toBe("not_ready")
    expect(result.checks.contentStructures).toEqual({ ok: false, activeGeneralCount: 0, usableGeneralCount: 0 })
    expect(error).toHaveBeenCalledWith(expect.stringContaining("readiness_content_structure_missing"))
  })

  it("生产配置不返回模型密钥、数据库路径或用户数据", () => {
    const result = new OperationalHealthService(database, {
      APP_ENV: "production",
      NODE_ENV: "production",
      PROTOTYPE_DB_PATH: "C:\\srv\\content-agent\\production.sqlite",
      LLM_BASE_URL: "http://insecure.example.test/v1",
      LLM_API_KEY: "super-secret-key",
      LLM_MODEL: "model-name",
      ALLOW_LIVE_MODEL: "false",
    }, { diskStats: () => ({ bavail: 4096, bsize: 1024 * 1024 }) }).ready()
    const serialized = JSON.stringify(result)

    expect(result.status).toBe("not_ready")
    expect(result.checks.configuration.issues).toEqual(expect.arrayContaining(["LIVE_MODEL_REQUIRED", "LLM_HTTPS_ENDPOINT_REQUIRED", "DEMO_DATA_FORBIDDEN"]))
    expect(serialized).not.toContain("super-secret-key")
    expect(serialized).not.toContain("content-agent\\production.sqlite")
    expect(serialized).not.toContain("owner@example.test")
  })
})

function readyService(database: Database.Database, freeMegabytes = 4096) {
  return new OperationalHealthService(database, {
    APP_ENV: "development",
    PROTOTYPE_DB_PATH: "C:\\work\\prototype.sqlite",
    HEALTH_MODEL_FAILURE_THRESHOLD: "3",
    DISK_MIN_FREE_MB: "1024",
  }, { diskStats: () => ({ bavail: freeMegabytes, bsize: 1024 * 1024 }) })
}
