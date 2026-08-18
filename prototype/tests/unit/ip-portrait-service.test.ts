import { describe, expect, it } from "vitest"
import type { PortraitGenerationInput } from "../../src/domain/ip-onboarding"
import { FakeLlmAdapter, PrototypeFixtureLlmAdapter } from "../../src/lib/llm/fake"
import { StructuredLlmClient } from "../../src/lib/llm/structured"
import { IpPortraitService } from "../../src/services/ip-portrait-service"

describe("IpPortraitService", () => {
  it("只根据结构化回答生成带来源编号的内容画像", async () => {
    const input = generationInput()
    const adapter = new FakeLlmAdapter([{ json: portraitDraft() }])
    const service = new IpPortraitService(new StructuredLlmClient(adapter))

    const result = await service.generatePreview(input)

    expect(result.contentPortrait.topicPillars[0].sourceQuestionIds).toContain("health-wellness-v1-q01")
    expect(result.contentPortrait.confirmedFacts[0].sourceQuestionIds).toContain("health-wellness-v1-q06")
    expect(adapter.calls).toHaveLength(1)
    expect(adapter.calls[0]).toMatchObject({
      operation: "ip_portrait",
      input: {
        displayName: "周姐",
        industryCategory: "health_wellness",
        questionSetVersion: "ip-question-bank-v1",
      },
    })
    expect(adapter.calls[0].input).not.toHaveProperty("introduction")
  })

  it("拒绝模型引用输入回答之外的问题编号", async () => {
    const invalid = portraitDraft()
    invalid.contentPortrait.topicPillars[0].sourceQuestionIds = ["health-wellness-v1-q99"]
    const service = new IpPortraitService(new StructuredLlmClient(new FakeLlmAdapter([{ json: invalid }])))

    await expect(service.generatePreview(generationInput())).rejects.toThrow("PORTRAIT_SOURCE_INVALID")
  })

  it("测试模型使用当前IP名称且不串入林姐", async () => {
    const adapter = new PrototypeFixtureLlmAdapter()
    const service = new IpPortraitService(new StructuredLlmClient(adapter))

    const result = await service.generatePreview(generationInput())

    expect(JSON.stringify(result)).toContain("周姐")
    expect(JSON.stringify(result)).not.toMatch(/林姐/)
  })
})

function generationInput(): PortraitGenerationInput {
  return {
    displayName: "周姐",
    primaryPlatform: "wechat_channels",
    industryCategory: "health_wellness",
    questionSetVersion: "ip-question-bank-v1",
    answers: [
      answer("q01", "你最希望哪类人刷到？", "target_audience", "关注父母健康的中年子女"),
      answer("q03", "他们最常问什么？", "audience_questions", "怎么为父母选择日常滋补产品"),
      answer("q13", "你有哪些真实素材？", "content_assets", "门店讲解、原料资料和用户提问"),
      answer("q22", "希望观众做什么？", "desired_action", "先关注并继续了解"),
      answer("q24", "哪些承诺不会说？", "boundaries", "不承诺治疗效果"),
      answer("q06", "什么经历能证明你？", "identity_credibility", "经营健康门店六年"),
      answer("q08", "你坚持什么观点？", "core_beliefs", "健康内容要讲清适用边界"),
      answer("q15", "你最自然怎么讲？", "presentation_style", "用顾客问题做问答"),
    ],
  }
}

function answer(
  suffix: string,
  question: string,
  dimension: PortraitGenerationInput["answers"][number]["dimension"],
  value: string,
) {
  return { questionId: `health-wellness-v1-${suffix}`, question, dimension, value }
}

function portraitDraft() {
  const sourceQuestionIds = [
    "health-wellness-v1-q01", "health-wellness-v1-q03", "health-wellness-v1-q13",
    "health-wellness-v1-q22", "health-wellness-v1-q24", "health-wellness-v1-q06",
    "health-wellness-v1-q08", "health-wellness-v1-q15",
  ]
  return {
    contentPortrait: {
      schemaVersion: 1,
      questionSetVersion: "ip-question-bank-v1",
      industryCategory: "health_wellness",
      identityPositioning: "有六年门店经验的健康生活内容分享者",
      credibilitySources: ["六年健康门店经营经历"],
      targetAudience: "关注父母健康的中年子女",
      audienceQuestions: ["怎么为父母选择日常滋补产品"],
      coreBeliefs: ["健康内容要讲清适用边界"],
      contentAssets: ["门店讲解", "原料资料", "用户提问"],
      presentationStyles: ["真实问答"],
      commercialConnections: ["用选择知识自然连接产品"],
      desiredActions: ["关注并继续了解"],
      boundaries: ["不承诺治疗效果"],
      topicPillars: [{
        title: "给父母选日常滋补产品",
        rationale: "来自目标受众的高频问题",
        sourceQuestionIds: [sourceQuestionIds[0], sourceQuestionIds[1]],
      }],
      confirmedFacts: [{ statement: "经营健康门店六年", sourceQuestionIds: [sourceQuestionIds[5]] }],
      uncertainties: [],
      sourceMap: { targetAudience: [sourceQuestionIds[0]], boundaries: [sourceQuestionIds[4]] },
    },
    portrait: {
      headline: "我理解的周姐：把健康选择讲清楚",
      name: "周姐",
      title: "健康生活内容分享者",
      identity: "有六年健康门店经营经验，擅长用真实问答讲选择方法。",
      authority: "以门店经历、原料资料和用户提问为内容依据。",
      audience: "关注父母健康的中年子女",
      boundaries: ["不承诺治疗效果"],
      directions: ["父母日常养护", "滋补产品选择"],
      source: "来源于8条已确认建档回答",
      verifiedFacts: ["经营健康门店六年"],
      uncertainFact: "暂无需要额外确认的信息",
      account: "视频号｜周姐讲健康选择",
    },
    profile: {
      displayName: "周姐",
      experience: "经营健康门店六年，长期积累门店讲解、原料资料和用户提问。",
      expertise: "健康产品选择知识",
      audience: "关注父母健康的中年子女",
      voiceStyle: "真实问答、讲清适用边界",
      boundaries: "不承诺治疗效果",
    },
    account: { platform: "wechat_channels" as const, name: "周姐讲健康选择" },
  }
}
