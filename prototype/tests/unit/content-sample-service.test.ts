import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type Database from "better-sqlite3"
import type { PlatformAccessContext, TenantAccessContext } from "../../src/domain/access"
import { openDatabase } from "../../src/lib/db/database"
import { ContentBrainRepository } from "../../src/lib/db/content-brain-repository"
import { ContentSampleService } from "../../src/services/content-sample-service"

describe("ContentSampleService", () => {
  let database: Database.Database
  let service: ContentSampleService
  const platform: PlatformAccessContext = {
    audience: "platform", userId: "platform-user", platformRole: "platform_operator",
  }

  beforeEach(() => {
    database = openDatabase(":memory:")
    service = new ContentSampleService(new ContentBrainRepository(database))
  })

  afterEach(() => database.close())

  it("规范化相同正文后返回已有样本", () => {
    const first = service.createFromText(platform, sampleInput())
    const second = service.createFromText(platform, {
      ...sampleInput(),
      transcript: `  ${sampleInput().transcript.replaceAll("，", "，  ")}  `,
    })

    expect(first.duplicate).toBe(false)
    expect(second).toEqual(expect.objectContaining({ sampleId: first.sampleId, duplicate: true }))
    expect(database.prepare("SELECT COUNT(*) count FROM platform_content_samples").get()).toEqual({ count: 1 })
  })

  it("租户身份在写入前被拒绝", () => {
    const tenant: TenantAccessContext = {
      audience: "tenant", userId: "tenant-user", tenantId: "tenant-1", membershipId: "membership-1",
      capabilities: [], ipIds: [], contentAccountIds: [],
    }

    expect(() => service.createFromText(tenant, sampleInput())).toThrow("PLATFORM_AUDIENCE_REQUIRED")
    expect(database.prepare("SELECT COUNT(*) count FROM platform_content_samples").get()).toEqual({ count: 0 })
  })
})

function sampleInput() {
  return {
    title: "一次售后让我重新理解团长",
    sourcePlatform: "wechat_channels",
    sourceUrl: "https://example.test/video/1",
    authorReference: "团长样本 A",
    transcript: "这是一次真实的售后经历，客户提出问题后，我先核验事实，再承担责任并给出处理结果。",
    rightsNote: "已授权用于内部分析",
  }
}
