import { z } from "zod"

export const INDUSTRY_CATEGORIES = [
  "health_wellness",
  "beauty_skincare",
  "maternal_parenting",
  "food_fresh",
  "home_living",
  "fashion_style",
  "local_store",
  "education_knowledge",
  "business_services",
  "other",
] as const

export const PORTRAIT_DIMENSIONS = [
  "identity_credibility",
  "target_audience",
  "audience_questions",
  "core_beliefs",
  "content_assets",
  "presentation_style",
  "commercial_connection",
  "desired_action",
  "boundaries",
  "topic_pillars",
] as const

export const QUESTION_SLOTS = [
  "audience_primary",
  "audience_stage",
  "audience_urgent_problem",
  "audience_misconception",
  "audience_decision_concern",
  "credibility_experience",
  "professional_judgement",
  "distinct_belief",
  "repeat_principle",
  "failure_story",
  "success_process",
  "work_scene",
  "existing_assets",
  "question_sources",
  "natural_narrative",
  "preferred_structure",
  "opening_style",
  "persona_impression",
  "product_connection",
  "service_connection",
  "non_sales_content",
  "desired_action",
  "undesired_action",
  "forbidden_promises",
  "private_boundaries",
  "misunderstood_expression",
  "month_one_topics",
  "series_topics",
  "new_direction",
  "missing_evidence",
] as const

export const QUESTION_SET_VERSION = "ip-question-bank-v1"

export const industryCategorySchema = z.enum(INDUSTRY_CATEGORIES)
export const portraitDimensionSchema = z.enum(PORTRAIT_DIMENSIONS)
export const questionSlotSchema = z.enum(QUESTION_SLOTS)

export const questionTriggerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("always") }),
  z.object({ kind: z.literal("answer_signal"), signals: z.array(z.string().trim().min(1)).min(1) }),
])

export const portraitQuestionOptionSchema = z.object({
  value: z.string().trim().min(1),
  label: z.string().trim().min(1),
  signals: z.array(z.string().trim().min(1)),
})

export const portraitQuestionInputSchema = z.object({
  id: z.string().trim().min(1),
  slot: questionSlotSchema,
  dimension: portraitDimensionSchema,
  prompt: z.string().trim().min(8),
  helpText: z.string().trim().min(1).optional(),
  answerType: z.enum(["single_choice", "multi_choice", "short_text", "long_text"]),
  options: z.array(portraitQuestionOptionSchema).optional(),
  requiredAnchor: z.boolean(),
  canAnswerNone: z.boolean(),
  priority: z.number().int().min(0).max(100),
  trigger: questionTriggerSchema,
  outputFields: z.array(z.string().trim().min(1)),
  topicSignals: z.array(z.string().trim().min(1)),
  status: z.enum(["draft", "active", "retired"]),
})

export const portraitQuestionSchema = portraitQuestionInputSchema.extend({
  industryCategory: industryCategorySchema,
  questionSetVersion: z.string().trim().min(1),
})

export const industryQuestionSetSchema = z.object({
  version: z.string().trim().min(1),
  industryCategory: industryCategorySchema,
  questions: z.array(portraitQuestionSchema),
})

export const contentPortraitSchema = z.object({
  schemaVersion: z.number().int().positive(),
  questionSetVersion: z.string().trim().min(1),
  industryCategory: industryCategorySchema,
  identityPositioning: z.string().trim().min(1),
  credibilitySources: z.array(z.string().trim().min(1)),
  targetAudience: z.string().trim().min(1),
  audienceQuestions: z.array(z.string().trim().min(1)),
  coreBeliefs: z.array(z.string().trim().min(1)),
  contentAssets: z.array(z.string().trim().min(1)),
  presentationStyles: z.array(z.string().trim().min(1)),
  commercialConnections: z.array(z.string().trim().min(1)),
  desiredActions: z.array(z.string().trim().min(1)),
  boundaries: z.array(z.string().trim().min(1)),
  topicPillars: z.array(z.object({
    title: z.string().trim().min(1),
    rationale: z.string().trim().min(1),
    sourceQuestionIds: z.array(z.string().trim().min(1)).min(1),
  })).min(1).max(5),
  confirmedFacts: z.array(z.object({
    statement: z.string().trim().min(1),
    sourceQuestionIds: z.array(z.string().trim().min(1)).min(1),
  })),
  uncertainties: z.array(z.object({
    statement: z.string().trim().min(1),
    relatedQuestionIds: z.array(z.string().trim().min(1)).min(1),
  })),
  sourceMap: z.record(z.string(), z.array(z.string().trim().min(1))),
})

export const questionAnswerSchema = z.object({
  questionId: z.string().trim().min(1),
  questionSetVersion: z.string().trim().min(1),
  value: z.union([z.string(), z.array(z.string())]),
  signals: z.array(z.string()),
  answeredAt: z.string().datetime(),
})

export const onboardingSessionStateSchema = z.enum([
  "BASIC_INFO",
  "INDUSTRY_SELECTED",
  "ANSWERING",
  "REVIEWING_ANSWERS",
  "GENERATING_PORTRAIT",
  "PORTRAIT_PREVIEW",
  "GENERATION_FAILED",
  "CONFIRMED",
  "EXPIRED",
])

export const onboardingSessionSchema = z.object({
  id: z.string().trim().min(1),
  tenantId: z.string().trim().min(1),
  creatorUserId: z.string().trim().min(1),
  displayName: z.string().trim().min(1),
  primaryPlatform: z.enum(["wechat_channels", "douyin", "xiaohongshu", "kuaishou", "other"]),
  industryCategory: industryCategorySchema,
  questionSetVersion: z.string().trim().min(1),
  state: onboardingSessionStateSchema,
  version: z.number().int().positive(),
  currentQuestionId: z.string().trim().min(1).nullable(),
  answers: z.array(questionAnswerSchema),
  selectionTrace: z.array(z.object({
    questionId: z.string().trim().min(1),
    reason: z.string().trim().min(1),
  })),
  portraitDraft: z.unknown().nullable(),
  portraitDraftVersion: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  confirmedAt: z.string().datetime().nullable(),
})

export type IndustryCategory = z.infer<typeof industryCategorySchema>
export type PortraitDimension = z.infer<typeof portraitDimensionSchema>
export type QuestionSlot = z.infer<typeof questionSlotSchema>
export type QuestionTrigger = z.infer<typeof questionTriggerSchema>
export type PortraitQuestionInput = z.infer<typeof portraitQuestionInputSchema>
export type PortraitQuestion = z.infer<typeof portraitQuestionSchema>
export type IndustryQuestionSet = z.infer<typeof industryQuestionSetSchema>
export type ContentPortrait = z.infer<typeof contentPortraitSchema>
export type QuestionAnswer = z.infer<typeof questionAnswerSchema>
export type IpOnboardingSession = z.infer<typeof onboardingSessionSchema>

export type PortraitGenerationInput = {
  displayName: string
  primaryPlatform: IpOnboardingSession["primaryPlatform"]
  industryCategory: IndustryCategory
  questionSetVersion: string
  answers: Array<{
    questionId: string
    question: string
    dimension: PortraitDimension
    value: string | string[]
  }>
}

export type IpPortraitDraft = {
  contentPortrait: ContentPortrait
  profile: Record<string, unknown>
  portrait: Record<string, unknown>
  account: { platform: IpOnboardingSession["primaryPlatform"]; name: string }
}

export type OnboardingSessionView = {
  session: IpOnboardingSession
  currentQuestion: PortraitQuestion | null
  coveredDimensions: PortraitDimension[]
  canReview: boolean
  answeredSummary: Array<{
    questionId: string
    question: string
    dimension: PortraitDimension
    value: string | string[]
  }>
}
