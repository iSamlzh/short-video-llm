import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type Database from "better-sqlite3"
import type { TenantAccessContext } from "../../src/domain/access"
import { openDatabase } from "../../src/lib/db/database"
import { MetricsRepository } from "../../src/lib/db/metrics-repository"
import { MetricImportService } from "../../src/services/metric-import-service"
import { seedDemoData } from "../../src/scripts/demo-data"

describe("MetricImportService", () => {
  let database: Database.Database
  let repository: MetricsRepository
  let service: MetricImportService
  let owner: TenantAccessContext

  beforeEach(async () => {
    database = openDatabase(":memory:")
    await seedDemoData(database, "demo-password")
    repository = new MetricsRepository(database)
    service = new MetricImportService(database, repository)
    owner = {
      audience: "tenant",
      userId: "user-owner",
      tenantId: "tenant-linjie",
      membershipId: "membership-owner",
      capabilities: ["ip.view", "metrics.import"],
      ipIds: ["ip-linjie"],
      contentAccountIds: ["account-linjie-wechat"],
    }
  })

  afterEach(() => database.close())

  it("一行无效时仍持久化有效行和脱敏错误", async () => {
    const result = await service.import(owner, mixedFile())

    expect(result).toMatchObject({ inserted: 1, errors: 1, status: "review_ready", total: 2, unmatched: 1 })
    expect(repository.listSnapshots(result.batchId)).toHaveLength(1)
    expect(repository.listErrors(result.batchId)).toEqual([
      expect.objectContaining({ rowNumber: 3, errorCode: "PLAYS_INVALID" }),
    ])
    expect(repository.listErrors(result.batchId)[0].redactedReference).not.toContain("secret")
  })

  it("相同账号和文件哈希重复导入时返回原批次", async () => {
    const first = await service.import(owner, mixedFile())
    const second = await service.import(owner, mixedFile())

    expect(second.batchId).toBe(first.batchId)
    expect(database.prepare("SELECT COUNT(*) count FROM metric_import_batches").get()).toEqual({ count: 1 })
    expect(repository.listSnapshots(first.batchId)).toHaveLength(1)
  })

  it("同一内容同一采集时间只写一份不可变快照", async () => {
    const duplicateRows = {
      contentAccountId: "account-linjie-wechat",
      filename: "重复.csv",
      mimeType: "text/csv",
      bytes: Buffer.from(
        "作品ID,标题,采集时间,播放量\nwx-1,邻里真实经历,2026-08-17T08:00:00Z,100\nwx-1,邻里真实经历,2026-08-17T08:00:00Z,100",
      ),
    }
    const result = await service.import(owner, duplicateRows)

    expect(result).toMatchObject({ inserted: 1, duplicates: 1 })
    expect(repository.listSnapshots(result.batchId)).toHaveLength(1)
  })

  it("在读取文件内容前拒绝缺少能力或越过账号范围的请求", async () => {
    const parser = vi.fn()
    const guardedService = new MetricImportService(database, repository, parser)
    const file = mixedFile()

    await expect(guardedService.import({ ...owner, capabilities: ["ip.view"] }, file))
      .rejects.toThrow("CAPABILITY_FORBIDDEN")
    await expect(guardedService.import(owner, { ...file, contentAccountId: "account-linjie-douyin" }))
      .rejects.toThrow("ACCOUNT_SCOPE_FORBIDDEN")
    expect(parser).not.toHaveBeenCalled()
  })

  it("解析器致命错误会保留失败批次但不保存上传字节", async () => {
    const file = { ...mixedFile(), filename: "错误.txt", mimeType: "text/plain" }
    await expect(service.import(owner, file)).rejects.toThrow("FILE_TYPE_UNSUPPORTED")

    const batch = database.prepare("SELECT status, filename FROM metric_import_batches").get()
    expect(batch).toEqual({ status: "failed", filename: "错误.txt" })
    expect(database.prepare("PRAGMA table_info(metric_import_batches)").all())
      .not.toContainEqual(expect.objectContaining({ name: "bytes" }))
  })
})

function mixedFile() {
  return {
    contentAccountId: "account-linjie-wechat",
    filename: "真实指标.csv",
    mimeType: "text/csv",
    bytes: Buffer.from(
      "作品ID,标题,发布时间,采集时间,播放量,完播率\nwx-1,邻里真实经历,2026-08-10T08:00:00Z,2026-08-17T08:00:00Z,1200,35%\nsecret,错误行,2026-08-11T08:00:00Z,2026-08-17T08:00:00Z,-1,20%",
    ),
  }
}
