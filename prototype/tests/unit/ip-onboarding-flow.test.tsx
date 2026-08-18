import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { OnboardingRouteView } from "../../src/components/onboarding/OnboardingRouteView"

const push = vi.fn()
const refresh = vi.fn()

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }))

const question = {
  id: "health-wellness-v1-q01",
  slot: "audience_primary",
  dimension: "target_audience",
  prompt: "在健康养生内容里，你最希望哪类人刷到你的视频？",
  answerType: "long_text",
  requiredAnchor: true,
  canAnswerNone: false,
  priority: 100,
  trigger: { kind: "always" },
  outputFields: ["targetAudience"],
  topicSignals: ["audience:primary"],
  status: "active",
  industryCategory: "health_wellness",
  questionSetVersion: "ip-question-bank-v1",
}

const baseSession = {
  id: "session-1",
  displayName: "周姐",
  primaryPlatform: "wechat_channels",
  industryCategory: "health_wellness",
  questionSetVersion: "ip-question-bank-v1",
  version: 1,
  state: "ANSWERING",
  currentQuestionId: question.id,
  answers: [],
  selectionTrace: [],
  portraitDraft: null,
  portraitDraftVersion: 0,
}

const reviewView = {
  session: { ...baseSession, version: 3, state: "REVIEWING_ANSWERS", currentQuestionId: null },
  currentQuestion: null,
  coveredDimensions: ["target_audience"],
  canReview: true,
  answeredSummary: [{
    questionId: question.id,
    question: question.prompt,
    dimension: "target_audience",
    value: "关注父母日常健康的中年子女",
  }],
}

const generatedDraft = {
  contentPortrait: {
    sourceMap: { targetAudience: [question.id] },
    topicPillars: [{ title: "父母日常养护", sourceQuestionIds: [question.id] }],
  },
  portrait: {
    headline: "我理解的周姐：把健康选择讲清楚",
    name: "周姐",
    title: "健康生活内容分享者",
    identity: "有六年健康门店经营经验，擅长用真实问答讲选择方法。",
    authority: "以门店经历和原料资料作为内容依据。",
    audience: "关注父母日常健康的中年子女",
    boundaries: ["不承诺治疗效果"],
    directions: ["父母日常养护"],
    source: "来源于已确认的建档回答",
    verifiedFacts: ["经营健康门店六年"],
    uncertainFact: "暂无需要额外确认的信息",
    account: "视频号｜周姐讲健康选择",
  },
  profile: { displayName: "周姐" },
  account: { platform: "wechat_channels", name: "周姐讲健康选择" },
}

describe("首次IP逐题建档", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    push.mockReset()
    refresh.mockReset()
  })

  it("从基础信息和行业主动选择进入服务端返回的当前题", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(null, 204))
      .mockResolvedValueOnce(response({
        session: baseSession,
        currentQuestion: question,
        coveredDimensions: [],
        canReview: false,
        answeredSummary: [],
      }, 201))
    vi.stubGlobal("fetch", fetchMock)
    render(<OnboardingRouteView />)

    expect(await screen.findByRole("heading", { name: "先确定这个IP要讲什么" })).toBeVisible()
    await userEvent.type(screen.getByRole("textbox", { name: "IP名称" }), "周姐")
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "主要发布平台" }), "wechat_channels")
    await userEvent.click(screen.getByRole("button", { name: "继续选择行业" }))
    await userEvent.click(screen.getByRole("radio", { name: "健康养生" }))
    await userEvent.click(screen.getByRole("button", { name: "开始建立内容画像" }))

    expect(await screen.findByRole("heading", { name: question.prompt })).toBeVisible()
    expect(screen.getByText("已获得 0 项内容依据")).toBeVisible()
    expect(screen.queryByText(/林姐/)).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenLastCalledWith("/api/app/ip-onboarding/sessions", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        displayName: "周姐",
        primaryPlatform: "wechat_channels",
        industryCategory: "health_wellness",
      }),
    }))
  })

  it("回答复核、生成画像并按画像来源返回修改原回答", async () => {
    const previewView = {
      ...reviewView,
      session: { ...reviewView.session, version: 5, state: "PORTRAIT_PREVIEW", portraitDraftVersion: 1, portraitDraft: generatedDraft },
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(reviewView))
      .mockResolvedValueOnce(response(previewView))
      .mockResolvedValueOnce(response({ ...reviewView, session: { ...reviewView.session, version: 7 } }))
    vi.stubGlobal("fetch", fetchMock)
    render(<OnboardingRouteView />)

    expect(await screen.findByRole("heading", { name: "先核对这些内容依据" })).toBeVisible()
    await userEvent.click(screen.getByRole("button", { name: "生成内容画像" }))
    expect(await screen.findByRole("heading", { name: /我理解的周姐/ })).toBeVisible()
    await userEvent.click(screen.getByRole("button", { name: "修改「内容应该服务谁」" }))

    expect(await screen.findByRole("heading", { name: question.prompt })).toBeVisible()
    expect(screen.getByRole("textbox", { name: "你的回答" })).toHaveValue("关注父母日常健康的中年子女")
    await userEvent.clear(screen.getByRole("textbox", { name: "你的回答" }))
    await userEvent.type(screen.getByRole("textbox", { name: "你的回答" }), "关注父母睡眠与精力管理的中年子女")
    await userEvent.click(screen.getByRole("button", { name: "保存修改" }))

    expect(await screen.findByRole("heading", { name: "先核对这些内容依据" })).toBeVisible()
    expect(screen.getByRole("button", { name: "重新生成内容画像" })).toBeVisible()
    expect(fetchMock).toHaveBeenLastCalledWith(
      `/api/app/ip-onboarding/sessions/session-1/answers/${question.id}`,
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ value: "关注父母睡眠与精力管理的中年子女", expectedVersion: 5, mode: "revise" }),
      }),
    )
  })

  it("确认画像后进入今日创作", async () => {
    const previewView = {
      ...reviewView,
      session: { ...reviewView.session, version: 5, state: "PORTRAIT_PREVIEW", portraitDraftVersion: 1, portraitDraft: generatedDraft },
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(previewView))
      .mockResolvedValueOnce(response({ ipId: "ip-zhou", accountId: "account-zhou" }))
    vi.stubGlobal("fetch", fetchMock)
    render(<OnboardingRouteView />)

    await userEvent.click(await screen.findByRole("button", { name: "这个理解准确，开始创作" }))

    expect(fetchMock).toHaveBeenLastCalledWith("/api/app/ip-onboarding/sessions/session-1/confirm", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ portraitDraftVersion: 1 }),
    }))
    await waitFor(() => expect(push).toHaveBeenCalledWith("/app/today"))
  })
})

function response(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}
