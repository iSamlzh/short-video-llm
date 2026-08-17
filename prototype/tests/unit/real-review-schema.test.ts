import { describe, expect, it } from "vitest"
import { realContentReviewSchema } from "../../src/domain/schemas"

describe("realContentReviewSchema", () => {
  it("接受证据边界明确的结构化复盘并拒绝额外字段", () => {
    const valid = {
      headline: "真实场景内容更值得继续验证",
      observations: [{ text: "样本 s-1 的播放量高于当前账号中位数", evidenceSnapshotIds: ["s-1"] }],
      hypotheses: [{
        text: "具体人物可能帮助用户更快理解内容",
        confidence: "low",
        evidenceFor: ["s-1"],
        evidenceAgainst: [],
      }],
      keep: ["具体人物与真实场景"],
      avoid: ["脱离证据的因果断言"],
      nextContentSignals: ["继续验证同类场景"],
      evidenceLimits: "当前样本只显示相关性，不能证明平台分发因果。",
    }
    expect(realContentReviewSchema.parse(valid)).toEqual(valid)
    expect(() => realContentReviewSchema.parse({ ...valid, hiddenReasoning: "不应接收" })).toThrow()
  })
})
