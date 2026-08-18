import { z } from "zod"
import type { TenantAccessContext } from "../domain/access"
import {
  industryCategorySchema,
  type IndustryQuestionSet,
  type OnboardingSessionView,
  type PortraitQuestion,
  type QuestionAnswer,
} from "../domain/ip-onboarding"
import { getQuestionSet } from "../ip-question-bank"
import type { IpOnboardingRepository } from "../lib/db/ip-onboarding-repository"
import { buildSelectionTrace, selectNextQuestion } from "./ip-question-selector"

export const startOnboardingSessionInputSchema = z.object({
  displayName: z.string().trim().min(1).max(60),
  primaryPlatform: z.enum(["wechat_channels", "douyin", "xiaohongshu", "kuaishou", "other"]),
  industryCategory: industryCategorySchema,
}).strict()

export const onboardingAnswerInputSchema = z.object({
  value: z.union([z.string(), z.array(z.string())]),
  expectedVersion: z.number().int().positive(),
  mode: z.enum(["answer", "revise"]).optional(),
}).strict()

type StartInput = z.infer<typeof startOnboardingSessionInputSchema>
type AnswerInput = z.infer<typeof onboardingAnswerInputSchema> & {
  sessionId: string
  questionId: string
}

function codedError(code: string): Error {
  return Object.assign(new Error(code), { code })
}

function validateAnswer(question: PortraitQuestion, value: QuestionAnswer["value"]): void {
  if (question.answerType === "multi_choice") {
    if (!Array.isArray(value) || value.length === 0) throw codedError("ANSWER_INVALID")
  } else if (Array.isArray(value) || !value.trim()) {
    throw codedError("ANSWER_INVALID")
  }

  if (question.options) {
    const allowed = new Set(question.options.map(option => option.value))
    const selected = Array.isArray(value) ? value : [value]
    if (selected.some(item => !allowed.has(item))) throw codedError("ANSWER_INVALID")
  }
}

function answerSignals(question: PortraitQuestion, value: QuestionAnswer["value"]): string[] {
  const selected = new Set(Array.isArray(value) ? value : [value])
  const optionSignals = question.options
    ?.filter(option => selected.has(option.value))
    .flatMap(option => option.signals) ?? []
  return [...new Set([...question.topicSignals, ...optionSignals])]
}

export class IpOnboardingSessionService {
  constructor(private readonly repository: IpOnboardingRepository) {}

  startSession(context: TenantAccessContext, rawInput: StartInput): OnboardingSessionView {
    const input = startOnboardingSessionInputSchema.parse(rawInput)
    const active = this.repository.getActiveForUser(context.tenantId, context.userId)
    if (active) throw codedError("ONBOARDING_SESSION_ACTIVE")
    const questionSet = getQuestionSet("ip-question-bank-v1", input.industryCategory)
    const selected = selectNextQuestion({ questionSet, answers: [] })
    if (!selected.question) throw codedError("QUESTION_SET_VERSION_UNAVAILABLE")
    const session = this.repository.create({
      tenantId: context.tenantId,
      creatorUserId: context.userId,
      displayName: input.displayName,
      primaryPlatform: input.primaryPlatform,
      industryCategory: input.industryCategory,
      questionSetVersion: questionSet.version,
      firstQuestionId: selected.question.id,
    })
    return this.buildView(session)
  }

  getActiveSession(context: TenantAccessContext): OnboardingSessionView | null {
    const session = this.repository.getActiveForUser(context.tenantId, context.userId)
    return session ? this.buildView(session) : null
  }

  getSession(context: TenantAccessContext, sessionId: string): OnboardingSessionView {
    return this.buildView(this.repository.requireScoped(sessionId, context.tenantId, context.userId))
  }

  answerQuestion(context: TenantAccessContext, rawInput: AnswerInput): OnboardingSessionView {
    const parsed = onboardingAnswerInputSchema.parse({
      value: rawInput.value,
      expectedVersion: rawInput.expectedVersion,
      mode: rawInput.mode,
    })
    const input = { ...parsed, sessionId: rawInput.sessionId, questionId: rawInput.questionId }
    const session = this.repository.requireScoped(input.sessionId, context.tenantId, context.userId)
    if (session.version !== input.expectedVersion) throw codedError("VERSION_CONFLICT")
    if (session.state !== "ANSWERING") throw codedError("QUESTION_NOT_CURRENT")
    if (session.currentQuestionId !== input.questionId) throw codedError("QUESTION_NOT_CURRENT")
    return this.persistAnswer(context, session, input)
  }

  reviseAnswer(context: TenantAccessContext, rawInput: AnswerInput): OnboardingSessionView {
    const parsed = onboardingAnswerInputSchema.parse({
      value: rawInput.value,
      expectedVersion: rawInput.expectedVersion,
      mode: rawInput.mode,
    })
    const input = { ...parsed, sessionId: rawInput.sessionId, questionId: rawInput.questionId }
    const session = this.repository.requireScoped(input.sessionId, context.tenantId, context.userId)
    if (session.version !== input.expectedVersion) throw codedError("VERSION_CONFLICT")
    if (!session.answers.some(answer => answer.questionId === input.questionId)) throw codedError("ANSWER_NOT_FOUND")
    return this.persistAnswer(context, session, input)
  }

  reviewAnswers(context: TenantAccessContext, sessionId: string): OnboardingSessionView {
    const session = this.repository.requireScoped(sessionId, context.tenantId, context.userId)
    const questionSet = this.requireQuestionSet(session.questionSetVersion, session.industryCategory)
    const selection = selectNextQuestion({ questionSet, answers: session.answers })
    if (!selection.canReview) throw codedError("ONBOARDING_COVERAGE_INCOMPLETE")
    if (session.state === "REVIEWING_ANSWERS") return this.buildView(session)
    const updated = this.repository.updateProgress({
      sessionId: session.id,
      tenantId: context.tenantId,
      userId: context.userId,
      state: "REVIEWING_ANSWERS",
      currentQuestionId: null,
      selectionTrace: buildSelectionTrace({ questionSet, answers: session.answers }),
      expectedVersion: session.version,
    })
    return this.buildView(updated)
  }

  private persistAnswer(
    context: TenantAccessContext,
    session: ReturnType<IpOnboardingRepository["requireScoped"]>,
    input: AnswerInput,
  ): OnboardingSessionView {
    const questionSet = this.requireQuestionSet(session.questionSetVersion, session.industryCategory)
    const question = questionSet.questions.find(item => item.id === input.questionId)
    if (!question) throw codedError("QUESTION_NOT_CURRENT")
    validateAnswer(question, input.value)
    const answered = this.repository.saveAnswer({
      sessionId: session.id,
      tenantId: context.tenantId,
      userId: context.userId,
      questionId: question.id,
      value: input.value,
      signals: answerSignals(question, input.value),
      expectedVersion: input.expectedVersion,
    })
    const selection = selectNextQuestion({ questionSet, answers: answered.answers })
    const progress = this.repository.updateProgress({
      sessionId: session.id,
      tenantId: context.tenantId,
      userId: context.userId,
      state: selection.canReview ? "REVIEWING_ANSWERS" : "ANSWERING",
      currentQuestionId: selection.question?.id ?? null,
      selectionTrace: buildSelectionTrace({ questionSet, answers: answered.answers }),
      expectedVersion: answered.version,
    })
    return this.buildView(progress)
  }

  private requireQuestionSet(version: string, industryCategory: Parameters<typeof getQuestionSet>[1]): IndustryQuestionSet {
    try {
      return getQuestionSet(version, industryCategory)
    } catch {
      throw codedError("QUESTION_SET_VERSION_UNAVAILABLE")
    }
  }

  private buildView(session: ReturnType<IpOnboardingRepository["requireScoped"]>): OnboardingSessionView {
    const questionSet = this.requireQuestionSet(session.questionSetVersion, session.industryCategory)
    const questionsById = new Map(questionSet.questions.map(question => [question.id, question]))
    const selection = selectNextQuestion({ questionSet, answers: session.answers })
    const currentQuestion = session.currentQuestionId
      ? questionsById.get(session.currentQuestionId) ?? null
      : null
    return {
      session,
      currentQuestion,
      coveredDimensions: selection.coverage.coveredDimensions,
      canReview: selection.canReview,
      answeredSummary: session.answers.map(answer => {
        const question = questionsById.get(answer.questionId)
        if (!question) throw codedError("QUESTION_SET_VERSION_UNAVAILABLE")
        return {
          questionId: answer.questionId,
          question: question.prompt,
          dimension: question.dimension,
          value: answer.value,
        }
      }),
    }
  }
}
