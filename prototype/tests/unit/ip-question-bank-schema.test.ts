import { describe, expect, it } from "vitest"
import {
  PORTRAIT_DIMENSIONS,
  QUESTION_SLOTS,
  QUESTION_SET_VERSION,
  type PortraitDimension,
  type PortraitQuestionInput,
} from "../../src/domain/ip-onboarding"
import { defineQuestionSet } from "../../src/ip-question-bank/define-question-set"

const anchorDimensions = new Set<PortraitDimension>([
  "target_audience",
  "audience_questions",
  "content_assets",
  "desired_action",
])

function validQuestions(): PortraitQuestionInput[] {
  return Array.from({ length: 30 }, (_, index) => {
    const dimension = PORTRAIT_DIMENSIONS[index % PORTRAIT_DIMENSIONS.length]
    return {
      id: `health-wellness-v1-q${String(index + 1).padStart(2, "0")}`,
      slot: QUESTION_SLOTS[index],
      dimension,
      prompt: `这是第${index + 1}道用于建立内容画像的问题吗？`,
      answerType: "short_text",
      requiredAnchor: anchorDimensions.has(dimension) && index < 10,
      canAnswerNone: false,
      priority: 100 - index,
      trigger: { kind: "always" },
      outputFields: [`contentPortrait.${dimension}`],
      topicSignals: [`signal:${dimension}`],
      status: "active",
    }
  })
}

describe("IP问题包契约", () => {
  it("拒绝少于30道已启用问题的行业包", () => {
    expect(() => defineQuestionSet({
      version: QUESTION_SET_VERSION,
      industryCategory: "health_wellness",
      questions: validQuestions().slice(0, 29),
    })).toThrow("QUESTION_SET_REQUIRES_30_ACTIVE_QUESTIONS")
  })

  it("拒绝没有画像字段或选题信号映射的问题", () => {
    const questions = validQuestions()
    questions[0] = { ...questions[0], outputFields: [], topicSignals: [] }

    expect(() => defineQuestionSet({
      version: QUESTION_SET_VERSION,
      industryCategory: "health_wellness",
      questions,
    })).toThrow("QUESTION_OUTPUT_MAPPING_REQUIRED")
  })

  it("拒绝没有覆盖全部画像维度的问题包", () => {
    const questions = validQuestions().map(question => ({
      ...question,
      dimension: question.dimension === "boundaries" ? "topic_pillars" as const : question.dimension,
    }))

    expect(() => defineQuestionSet({
      version: QUESTION_SET_VERSION,
      industryCategory: "health_wellness",
      questions,
    })).toThrow("QUESTION_DIMENSION_COVERAGE_REQUIRED:boundaries")
  })

  it("为问题补齐行业和问题库版本并返回不可变数据", () => {
    const set = defineQuestionSet({
      version: QUESTION_SET_VERSION,
      industryCategory: "health_wellness",
      questions: validQuestions(),
    })

    expect(set.questions).toHaveLength(30)
    expect(set.questions[0]).toMatchObject({
      industryCategory: "health_wellness",
      questionSetVersion: QUESTION_SET_VERSION,
    })
    expect(Object.isFrozen(set)).toBe(true)
    expect(Object.isFrozen(set.questions)).toBe(true)
  })
})
