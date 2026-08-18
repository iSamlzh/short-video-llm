import { describe, expect, it } from "vitest"
import {
  QUESTION_SET_VERSION,
  type IndustryQuestionSet,
  type PortraitQuestion,
  type PortraitQuestionInput,
  type QuestionAnswer,
} from "../../src/domain/ip-onboarding"
import { defineQuestionSet } from "../../src/ip-question-bank/define-question-set"
import { healthWellnessV1 } from "../../src/ip-question-bank/sets/health-wellness"
import { selectNextQuestion } from "../../src/services/ip-question-selector"

const answeredAt = "2026-08-18T10:00:00.000Z"

function answer(question: PortraitQuestion, value: string | string[] = "这是能够形成内容判断的真实回答", signals: string[] = []): QuestionAnswer {
  return {
    questionId: question.id,
    questionSetVersion: QUESTION_SET_VERSION,
    value,
    signals,
    answeredAt,
  }
}

function answerUntilReview(set: IndustryQuestionSet, value: string) {
  const answers: QuestionAnswer[] = []
  for (let index = 0; index < 10; index += 1) {
    const result = selectNextQuestion({ questionSet: set, answers })
    if (!result.question) return { answers, result }
    answers.push(answer(result.question, value))
  }
  return { answers, result: selectNextQuestion({ questionSet: set, answers }) }
}

function mutableQuestions(set: IndustryQuestionSet): PortraitQuestionInput[] {
  return set.questions.map(({ industryCategory: _industry, questionSetVersion: _version, ...question }) => ({
    ...question,
    options: question.options?.map(option => ({ ...option, signals: [...option.signals] })),
    outputFields: [...question.outputFields],
    topicSignals: [...question.topicSignals],
  }))
}

describe("IP问题选择器", () => {
  it("前四题固定覆盖受众、用户问题、真实素材和内容目标", () => {
    const answers: QuestionAnswer[] = []
    const dimensions: string[] = []

    for (let index = 0; index < 4; index += 1) {
      const result = selectNextQuestion({ questionSet: healthWellnessV1, answers })
      expect(result.question).not.toBeNull()
      dimensions.push(result.question!.dimension)
      answers.push(answer(result.question!))
    }

    expect(dimensions).toEqual([
      "target_audience",
      "audience_questions",
      "content_assets",
      "desired_action",
    ])
  })

  it("信息覆盖充分时回答第8题后结束", () => {
    const { answers, result } = answerUntilReview(healthWellnessV1, "这是能够形成内容判断的真实回答")

    expect(answers).toHaveLength(8)
    expect(result.question).toBeNull()
    expect(result.canReview).toBe(true)
    expect(result.coverage.coveredDimensions).toHaveLength(8)
    expect(result.coverage.reason).toBe("coverage_complete")
  })

  it("回答缺少有效信息时继续到第10题并标记覆盖不足", () => {
    const { answers, result } = answerUntilReview(healthWellnessV1, "暂时没有")

    expect(answers).toHaveLength(10)
    expect(result.question).toBeNull()
    expect(result.canReview).toBe(true)
    expect(result.coverage.complete).toBe(false)
    expect(result.coverage.reason).toBe("question_limit_reached")
  })

  it("条件题只在已有回答包含所需信号时参与选择", () => {
    const questions = mutableQuestions(healthWellnessV1)
    const conditionalIndex = questions.findIndex(question => question.slot === "forbidden_promises")
    questions[conditionalIndex] = {
      ...questions[conditionalIndex],
      trigger: { kind: "answer_signal", signals: ["needs:boundary"] },
    }
    const set = defineQuestionSet({
      version: QUESTION_SET_VERSION,
      industryCategory: "health_wellness",
      questions,
    })
    const anchors: QuestionAnswer[] = []
    for (let index = 0; index < 4; index += 1) {
      const current = selectNextQuestion({ questionSet: set, answers: anchors }).question!
      anchors.push(answer(current))
    }

    const withoutSignal = selectNextQuestion({ questionSet: set, answers: anchors })
    const withSignal = selectNextQuestion({
      questionSet: set,
      answers: anchors.map((item, index) => index === 0 ? { ...item, signals: ["needs:boundary"] } : item),
    })

    expect(withoutSignal.question?.slot).not.toBe("forbidden_promises")
    expect(withSignal.question?.slot).toBe("forbidden_promises")
  })

  it("相同问题包和回答重复执行100次得到同一道下一题", () => {
    const answers: QuestionAnswer[] = []
    for (let index = 0; index < 4; index += 1) {
      const current = selectNextQuestion({ questionSet: healthWellnessV1, answers }).question!
      answers.push(answer(current))
    }

    const ids = new Set(Array.from({ length: 100 }, () =>
      selectNextQuestion({ questionSet: healthWellnessV1, answers }).question?.id,
    ))
    expect(ids).toEqual(new Set(["health-wellness-v1-q24"]))
  })
})
