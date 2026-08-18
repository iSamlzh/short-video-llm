import { z } from "zod"
import {
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

function sourceIds(draft: z.infer<typeof ipPortraitDraftSchema>): string[] {
  return [
    ...draft.contentPortrait.topicPillars.flatMap(item => item.sourceQuestionIds),
    ...draft.contentPortrait.confirmedFacts.flatMap(item => item.sourceQuestionIds),
    ...draft.contentPortrait.uncertainties.flatMap(item => item.relatedQuestionIds),
    ...Object.values(draft.contentPortrait.sourceMap).flat(),
  ]
}

export class IpPortraitService {
  constructor(private readonly llm: StructuredLlmClient) {}

  async generatePreview(rawInput: PortraitGenerationInput): Promise<IpPortraitDraft> {
    const input = portraitGenerationInputSchema.parse(rawInput)
    const draft = await this.llm.generateStructured(
      "ip_portrait",
      input,
      ipPortraitDraftSchema,
    )
    const allowedQuestionIds = new Set(input.answers.map(answer => answer.questionId))
    const hasInvalidSource = sourceIds(draft).some(questionId => !allowedQuestionIds.has(questionId))
    if (
      hasInvalidSource
      || draft.contentPortrait.questionSetVersion !== input.questionSetVersion
      || draft.contentPortrait.industryCategory !== input.industryCategory
    ) {
      throw Object.assign(new Error("PORTRAIT_SOURCE_INVALID"), { code: "PORTRAIT_SOURCE_INVALID" })
    }

    const displayName = input.displayName
    const modelNames = [...new Set([draft.profile.displayName, draft.portrait.name].filter(Boolean))]
    const replaceModelName = (value: string) => modelNames.reduce(
      (current, modelName) => current.replaceAll(modelName, displayName),
      value,
    )
    const headlineBody = draft.portrait.headline.replace(/^我理解的[^：:]+[：:]\s*/, "") || draft.portrait.title
    const contentPortrait = draft.contentPortrait

    return {
      ...draft,
      contentPortrait,
      portrait: {
        ...draft.portrait,
        headline: `我理解的${displayName}：${headlineBody}`,
        name: displayName,
        account: replaceModelName(draft.portrait.account),
      },
      profile: {
        ...draft.profile,
        displayName,
        industryCategory: input.industryCategory,
        contentPortrait,
      },
      account: {
        platform: input.primaryPlatform,
        name: replaceModelName(draft.account.name),
      },
    }
  }
}
