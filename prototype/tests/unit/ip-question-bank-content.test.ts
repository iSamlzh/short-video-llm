import { describe, expect, it } from "vitest"
import { INDUSTRY_CATEGORIES, PORTRAIT_DIMENSIONS, QUESTION_SET_VERSION } from "../../src/domain/ip-onboarding"
import { getQuestionSet, listIndustryCategories } from "../../src/ip-question-bank"

describe("v1行业问题内容", () => {
  for (const industry of INDUSTRY_CATEGORIES) {
    it(`${industry}提供至少30道可用题并覆盖全部画像维度`, () => {
      const set = getQuestionSet(QUESTION_SET_VERSION, industry)
      const active = set.questions.filter(question => question.status === "active")

      expect(active.length).toBeGreaterThanOrEqual(30)
      expect(new Set(active.map(question => question.id)).size).toBe(active.length)
      expect(new Set(active.map(question => question.slot)).size).toBe(30)
      expect(new Set(active.map(question => question.prompt)).size).toBe(active.length)
      expect(active.every(question => question.prompt.length >= 8)).toBe(true)
      expect(active.every(question => (question.prompt.match(/？/g) ?? []).length === 1)).toBe(true)
      expect(active.every(question => question.outputFields.length > 0 && question.topicSignals.length > 0)).toBe(true)

      for (const dimension of PORTRAIT_DIMENSIONS) {
        expect(active.some(question => question.dimension === dimension), `缺少维度：${dimension}`).toBe(true)
      }
    })
  }

  it("行业选择列表只公开名称和值，不公开内部问题", () => {
    const options = listIndustryCategories()
    expect(options).toHaveLength(10)
    expect(options[0]).toEqual({ value: "health_wellness", label: "健康养生" })
    expect(options.every(option => !("questions" in option))).toBe(true)
  })

  it("拒绝读取不存在的问题库版本", () => {
    expect(() => getQuestionSet("ip-question-bank-v0", "health_wellness")).toThrow("QUESTION_SET_VERSION_UNAVAILABLE")
  })
})
