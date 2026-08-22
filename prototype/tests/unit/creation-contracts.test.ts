import { describe, expect, it } from "vitest"
import {
  buildCreationEvidenceCatalog,
  creationDecisionBriefSchema,
  groundCreationDecisionBrief,
} from "../../src/domain/creation-contracts"

const groundedBrief = {
  objective: "建立信任" as const,
  whyToday: "当前受众最需要先理解长期信任，而不是只看一次成交。",
  audienceProblem: "想做本地生意，但不知道怎样让邻居持续信任。",
  ipEvidenceRefs: [{ label: "七年社区团购经历", sourceAnswerId: "answer-experience" }],
  recentDataStatus: "none" as const,
  repetitionRisk: "low" as const,
  nextSignal: "发布后重点观察完播率和真实咨询问题。",
}

describe("创作决策合同", () => {
  it("没有复盘数据时拒绝携带近期表现摘要", () => {
    expect(creationDecisionBriefSchema.safeParse({
      ...groundedBrief,
      recentDataSummary: "近期真实经历内容互动更高",
    }).success).toBe(false)
  })

  it("只把画像中的已确认回答和已确认私有记忆加入证据目录", () => {
    const catalog = buildCreationEvidenceCatalog({
      displayName: "林姐",
      experience: "七年社区团购经历，长期负责社区选品和用户服务",
      expertise: "社区团购运营",
      audience: "想做本地生意的宝妈和小店主",
      voiceStyle: "真诚直接",
      boundaries: "不承诺收益",
      contentPortrait: {
        confirmedFacts: [{ statement: "七年社区团购经历", sourceQuestionIds: ["answer-experience"] }],
        sourceMap: { targetAudience: ["answer-audience"] },
        targetAudience: "想做本地生意的宝妈和小店主",
      },
    } as any, {
      version: 3,
      keep: ["保留真实邻里场景"],
      avoid: ["泛泛讲道理"],
      nextContentSignals: ["开头更快进入冲突"],
    })

    expect(catalog).toContainEqual({ label: "七年社区团购经历", sourceAnswerId: "answer-experience", sourceType: "ip_answer" })
    expect(catalog).toContainEqual({ label: "保留真实邻里场景", sourceAnswerId: "memory:v3:keep:0", sourceType: "confirmed_memory" })
    expect(catalog.some((item) => item.sourceAnswerId.includes("uncertain"))).toBe(false)
  })

  it("拒绝模型引用当前证据目录之外的回答", () => {
    expect(() => groundCreationDecisionBrief(groundedBrief, [
      { label: "目标受众", sourceAnswerId: "answer-audience", sourceType: "ip_answer" },
    ], null)).toThrow("DECISION_EVIDENCE_INVALID")
  })

  it("没有确认复盘时强制降级为未使用历史表现", () => {
    const result = groundCreationDecisionBrief({
      ...groundedBrief,
      recentDataStatus: "available",
      recentDataSummary: "模型声称近期表现更好",
    }, [{ label: "七年社区团购经历", sourceAnswerId: "answer-experience", sourceType: "ip_answer" }], null)

    expect(result.recentDataStatus).toBe("none")
    expect(result).not.toHaveProperty("recentDataSummary")
  })
})
