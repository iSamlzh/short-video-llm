import {
  PORTRAIT_DIMENSIONS,
  type IndustryQuestionSet,
  type PortraitDimension,
  type PortraitQuestion,
  type QuestionAnswer,
} from "../domain/ip-onboarding"

const MINIMUM_QUESTION_COUNT = 8
const MAXIMUM_QUESTION_COUNT = 10
const CORE_DIMENSIONS = new Set<PortraitDimension>([
  "target_audience",
  "audience_questions",
  "content_assets",
  "boundaries",
])

const emptyAnswerValues = new Set(["", "暂时没有", "没有", "无", "none"])

export type PortraitCoverageReason =
  | "collecting"
  | "coverage_complete"
  | "question_limit_reached"

export type PortraitCoverage = {
  answeredCount: number
  coveredDimensions: PortraitDimension[]
  missingDimensions: PortraitDimension[]
  complete: boolean
  reason: PortraitCoverageReason
}

export type QuestionSelectionTraceEntry = {
  questionId: string
  reason: string
}

type SelectNextQuestionInput = {
  questionSet: IndustryQuestionSet
  answers: QuestionAnswer[]
}

function hasMeaningfulValue(value: QuestionAnswer["value"]): boolean {
  if (Array.isArray(value)) {
    return value.some(item => !emptyAnswerValues.has(item.trim().toLowerCase()))
  }
  return !emptyAnswerValues.has(value.trim().toLowerCase())
}

function validateAnswers(questionSet: IndustryQuestionSet, answers: QuestionAnswer[]): void {
  const questionIds = new Set(questionSet.questions.map(question => question.id))
  const answeredIds = new Set<string>()

  for (const answer of answers) {
    if (answer.questionSetVersion !== questionSet.version || !questionIds.has(answer.questionId)) {
      throw new Error(`QUESTION_ANSWER_NOT_IN_SET:${answer.questionId}`)
    }
    if (answeredIds.has(answer.questionId)) {
      throw new Error(`QUESTION_ANSWER_DUPLICATED:${answer.questionId}`)
    }
    answeredIds.add(answer.questionId)
  }
}

function buildCoverage(questionSet: IndustryQuestionSet, answers: QuestionAnswer[]): PortraitCoverage {
  const questionsById = new Map(questionSet.questions.map(question => [question.id, question]))
  const covered = new Set<PortraitDimension>()

  for (const answer of answers) {
    if (!hasMeaningfulValue(answer.value)) continue
    const question = questionsById.get(answer.questionId)
    if (question) covered.add(question.dimension)
  }

  const coveredDimensions = PORTRAIT_DIMENSIONS.filter(dimension => covered.has(dimension))
  const missingDimensions = PORTRAIT_DIMENSIONS.filter(dimension => !covered.has(dimension))
  const complete = answers.length >= MINIMUM_QUESTION_COUNT
    && coveredDimensions.length >= MINIMUM_QUESTION_COUNT
    && [...CORE_DIMENSIONS].every(dimension => covered.has(dimension))

  return {
    answeredCount: answers.length,
    coveredDimensions,
    missingDimensions,
    complete,
    reason: complete
      ? "coverage_complete"
      : answers.length >= MAXIMUM_QUESTION_COUNT
        ? "question_limit_reached"
        : "collecting",
  }
}

function isEligible(question: PortraitQuestion, signals: Set<string>): boolean {
  if (question.status !== "active") return false
  if (question.trigger.kind === "always") return true
  return question.trigger.signals.some(signal => signals.has(signal))
}

function compareQuestionIds(left: PortraitQuestion, right: PortraitQuestion): number {
  return left.id.localeCompare(right.id)
}

function selectCandidate(
  questionSet: IndustryQuestionSet,
  answers: QuestionAnswer[],
  coverage: PortraitCoverage,
): PortraitQuestion | null {
  const answeredIds = new Set(answers.map(answer => answer.questionId))
  const signals = new Set(answers.flatMap(answer => answer.signals))
  const eligible = questionSet.questions.filter(question =>
    !answeredIds.has(question.id) && isEligible(question, signals),
  )

  const unansweredAnchors = eligible.filter(question => question.requiredAnchor)
  if (unansweredAnchors.length > 0) {
    return unansweredAnchors.sort((left, right) =>
      right.priority - left.priority || compareQuestionIds(left, right),
    )[0]
  }

  const missing = new Set(coverage.missingDimensions)
  const score = (question: PortraitQuestion): number => {
    const triggerSignals = question.trigger.kind === "answer_signal" ? question.trigger.signals : []
    return (missing.has(question.dimension) ? 10_000 : 0)
      + (question.dimension === "boundaries" && missing.has("boundaries") ? 5_000 : 0)
      + question.priority * 10
      + triggerSignals.filter(signal => signals.has(signal)).length * 100
  }

  return eligible.sort((left, right) =>
    score(right) - score(left) || compareQuestionIds(left, right),
  )[0] ?? null
}

export function selectNextQuestion(input: SelectNextQuestionInput): {
  question: PortraitQuestion | null
  coverage: PortraitCoverage
  canReview: boolean
} {
  validateAnswers(input.questionSet, input.answers)
  const coverage = buildCoverage(input.questionSet, input.answers)
  const canReview = coverage.complete || input.answers.length >= MAXIMUM_QUESTION_COUNT

  return {
    question: canReview ? null : selectCandidate(input.questionSet, input.answers, coverage),
    coverage,
    canReview,
  }
}

export function buildSelectionTrace(input: SelectNextQuestionInput): QuestionSelectionTraceEntry[] {
  validateAnswers(input.questionSet, input.answers)
  const questionsById = new Map(input.questionSet.questions.map(question => [question.id, question]))

  return input.answers.map((answer, index) => {
    const question = questionsById.get(answer.questionId)
    return {
      questionId: answer.questionId,
      reason: question?.requiredAnchor
        ? `anchor:${question.dimension}`
        : `coverage:${question?.dimension ?? "unknown"}:position:${index + 1}`,
    }
  })
}
