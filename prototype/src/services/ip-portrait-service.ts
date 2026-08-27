import { z } from "zod"
import {
  contentPortraitSchema,
  industryCategorySchema,
  portraitDimensionSchema,
  type IpPortraitDraft,
  type PortraitGenerationInput,
} from "../domain/ip-onboarding"
import { ipPortraitDraftSchema } from "../domain/schemas"
import type { StructuredLlmClient } from "../lib/llm/structured"

const portraitGenerationInputSchema = z.object({
  displayName: z.string().trim().min(1).max(60),
  primaryPlatform: z.enum(["wechat_channels", "douyin", "xiaohongshu", "kuaishou", "other"]),
  industryCategory: industryCategorySchema,
  questionSetVersion: z.string().trim().min(1),
  answers: z.array(z.object({
    questionId: z.string().trim().min(1),
    question: z.string().trim().min(1),
    dimension: portraitDimensionSchema,
    value: z.union([z.string().trim().min(1), z.array(z.string().trim().min(1)).min(1)]),
  })).min(8).max(10),
}).strict()

const portraitModelOutputSchema = z.object({
  contentPortrait: contentPortraitSchema,
})

function sourceIds(contentPortrait: z.infer<typeof contentPortraitSchema>): string[] {
  return [
    ...contentPortrait.topicPillars.flatMap(item => item.sourceQuestionIds),
    ...contentPortrait.confirmedFacts.flatMap(item => item.sourceQuestionIds),
    ...contentPortrait.uncertainties.flatMap(item => item.relatedQuestionIds),
    ...Object.values(contentPortrait.sourceMap).flat(),
  ]
}

export class IpPortraitService {
  constructor(private readonly llm: StructuredLlmClient) {}

  async generatePreview(rawInput: PortraitGenerationInput): Promise<IpPortraitDraft> {
    const input = portraitGenerationInputSchema.parse(rawInput)
    const generated = await this.llm.generateStructured(
      "ip_portrait",
      input,
      portraitModelOutputSchema,
    )
    const contentPortrait = generated.contentPortrait
    const allowedQuestionIds = new Set(input.answers.map(answer => answer.questionId))
    const hasInvalidSource = sourceIds(contentPortrait)
      .some(questionId => !allowedQuestionIds.has(questionId))
    if (
      hasInvalidSource
      || contentPortrait.questionSetVersion !== input.questionSetVersion
      || contentPortrait.industryCategory !== input.industryCategory
    ) {
      throw Object.assign(new Error("PORTRAIT_SOURCE_INVALID"), { code: "PORTRAIT_SOURCE_INVALID" })
    }

    return ipPortraitDraftSchema.parse(projectPortraitDraft(input, contentPortrait))
  }
}

function projectPortraitDraft(
  input: PortraitGenerationInput,
  contentPortrait: z.infer<typeof contentPortraitSchema>,
) {
  const displayName = input.displayName
  const identity = atLeast(contentPortrait.identityPositioning, "真实经验内容分享者", 2)
  const audience = atLeast(contentPortrait.targetAudience, "需要相关经验的人", 2)
  const facts = contentPortrait.confirmedFacts.map(item => item.statement).filter(Boolean).slice(0, 8)
  const credibility = unique([
    ...contentPortrait.credibilitySources,
    ...facts,
  ])
  const directions = contentPortrait.topicPillars.map(item => atLeast(item.title, "内容方向", 2)).slice(0, 5)
  const boundaries = contentPortrait.boundaries.filter(item => item.trim().length >= 2).slice(0, 6)
  const accountName = `${displayName}讲${directions[0] ?? "真实经验"}`
  const source = `画像仅依据本次 ${input.answers.length} 条已确认建档回答整理，未补充外部事实。`
  const authority = atLeast(credibility.join("；"), "当前依据已确认的建档回答形成内容判断。", 5)
  const experience = atLeast(
    unique([...contentPortrait.credibilitySources, ...contentPortrait.contentAssets, ...facts]).join("；"),
    source,
    10,
  )
  const safeBoundaries = boundaries.length > 0 ? boundaries : ["不补充回答中未确认的事实"]
  const verifiedFacts = facts.length > 0 ? facts : [`已完成 ${input.answers.length} 条建档回答`]
  const uncertainty = contentPortrait.uncertainties.map(item => item.statement).filter(Boolean).join("；")

  return {
    contentPortrait,
    portrait: {
      headline: `我理解的${displayName}：${identity}`,
      name: displayName,
      title: identity,
      identity: atLeast(`${identity}，主要面向${audience}。`, source, 10),
      authority,
      audience,
      boundaries: safeBoundaries,
      directions,
      source,
      verifiedFacts,
      uncertainFact: atLeast(uncertainty, "当前没有模型标记的待确认事项", 2),
      account: `${platformLabel(input.primaryPlatform)}｜${accountName}`,
    },
    profile: {
      displayName,
      experience,
      expertise: identity,
      audience,
      voiceStyle: atLeast(contentPortrait.presentationStyles.join("、"), "真实、清晰", 2),
      boundaries: safeBoundaries.join("；"),
      industryCategory: input.industryCategory,
      contentPortrait,
    },
    account: { platform: input.primaryPlatform, name: accountName },
  }
}

function unique(values: string[]) {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))]
}

function atLeast(value: string, fallback: string, minimum: number) {
  return value.trim().length >= minimum ? value.trim() : fallback
}

function platformLabel(platform: PortraitGenerationInput["primaryPlatform"]) {
  return {
    wechat_channels: "视频号",
    douyin: "抖音",
    xiaohongshu: "小红书",
    kuaishou: "快手",
    other: "内容账号",
  }[platform]
}
