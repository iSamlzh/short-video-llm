import { describe, expect, it } from "vitest"
import { capabilities } from "../../src/domain/access"
import {
  createExternalPublicationInputSchema,
  recordSystemPublicationInputSchema,
  sampleTierSchema,
} from "../../src/domain/growth-loop-schemas"

describe("真实增长闭环契约", () => {
  it("增加发布记录和复盘确认两个明确能力", () => {
    expect(capabilities).toContain("publication.record")
    expect(capabilities).toContain("review.confirm")
  })

  it("系统发布输入拒绝客户端覆盖锁稿标题", () => {
    expect(() => recordSystemPublicationInputSchema.parse({
      runId: "run-1",
      lockedVersion: 2,
      contentAccountId: "account-1",
      platformVideoId: "wx-100",
      publishedAt: "2026-08-17T08:00:00.000Z",
      title: "客户端伪造标题",
    })).toThrow()
  })

  it("外部发布允许以标题和发布时间建立历史身份", () => {
    expect(createExternalPublicationInputSchema.parse({
      contentAccountId: "account-1",
      title: "历史发布内容",
      publishedAt: "2026-08-10T08:00:00.000Z",
    })).toMatchObject({ title: "历史发布内容" })
  })

  it("样本层级只接受三种稳定状态", () => {
    expect(sampleTierSchema.parse("facts_only")).toBe("facts_only")
    expect(sampleTierSchema.parse("tentative")).toBe("tentative")
    expect(sampleTierSchema.parse("memory_eligible")).toBe("memory_eligible")
    expect(() => sampleTierSchema.parse("viral")).toThrow()
  })
})
