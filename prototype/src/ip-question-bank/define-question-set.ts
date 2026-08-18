import {
  PORTRAIT_DIMENSIONS,
  industryQuestionSetSchema,
  portraitQuestionInputSchema,
  type IndustryCategory,
  type IndustryQuestionSet,
  type PortraitDimension,
  type PortraitQuestionInput,
} from "../domain/ip-onboarding"

export function defineQuestion(input: PortraitQuestionInput): PortraitQuestionInput {
  return portraitQuestionInputSchema.parse(input)
}

function freezeSet(set: IndustryQuestionSet): IndustryQuestionSet {
  const questions = set.questions.map(question => Object.freeze({
    ...question,
    options: question.options?.map(option => Object.freeze({ ...option, signals: Object.freeze([...option.signals]) })),
    outputFields: Object.freeze([...question.outputFields]),
    topicSignals: Object.freeze([...question.topicSignals]),
  }))
  return Object.freeze({ ...set, questions: Object.freeze(questions) }) as IndustryQuestionSet
}

export function assertQuestionSetIntegrity(set: IndustryQuestionSet): void {
  const active = set.questions.filter(question => question.status === "active")
  if (active.length < 30) throw new Error("QUESTION_SET_REQUIRES_30_ACTIVE_QUESTIONS")

  const ids = new Set<string>()
  const slots = new Set<string>()
  for (const question of active) {
    if (ids.has(question.id)) throw new Error(`QUESTION_ID_DUPLICATED:${question.id}`)
    if (slots.has(question.slot)) throw new Error(`QUESTION_SLOT_DUPLICATED:${question.slot}`)
    ids.add(question.id)
    slots.add(question.slot)
    if (question.outputFields.length === 0 || question.topicSignals.length === 0) {
      throw new Error("QUESTION_OUTPUT_MAPPING_REQUIRED")
    }
    if ((question.answerType === "single_choice" || question.answerType === "multi_choice") && (question.options?.length ?? 0) < 2) {
      throw new Error(`QUESTION_OPTIONS_REQUIRED:${question.id}`)
    }
  }

  const covered = new Set<PortraitDimension>(active.map(question => question.dimension))
  for (const dimension of PORTRAIT_DIMENSIONS) {
    if (!covered.has(dimension)) throw new Error(`QUESTION_DIMENSION_COVERAGE_REQUIRED:${dimension}`)
  }

  const anchorDimensions: PortraitDimension[] = ["target_audience", "audience_questions", "content_assets", "desired_action"]
  for (const dimension of anchorDimensions) {
    if (!active.some(question => question.requiredAnchor && question.dimension === dimension)) {
      throw new Error(`QUESTION_ANCHOR_REQUIRED:${dimension}`)
    }
  }
}

export function defineQuestionSet(input: {
  version: string
  industryCategory: IndustryCategory
  questions: PortraitQuestionInput[]
}): IndustryQuestionSet {
  const set = industryQuestionSetSchema.parse({
    version: input.version,
    industryCategory: input.industryCategory,
    questions: input.questions.map(question => ({
      ...question,
      industryCategory: input.industryCategory,
      questionSetVersion: input.version,
    })),
  })
  assertQuestionSetIntegrity(set)
  return freezeSet(set)
}
