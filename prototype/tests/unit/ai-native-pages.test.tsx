import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { IpOnboardingView } from "../../src/components/onboarding/IpOnboardingView"
import { DailyCreationView } from "../../src/components/creation/DailyCreationView"
import { ReviewBriefView } from "../../src/components/review/ReviewBriefView"
import { TeamDelegationView } from "../../src/components/team/TeamDelegationView"
import { ContentBrainView } from "../../src/components/platform/ContentBrainView"
import { demoProductData } from "../../src/presets/product-demo"

describe("approved AI-native page hierarchy", () => {
  it("confirms an AI portrait instead of showing a long onboarding form", async () => {
    const confirm = vi.fn()
    render(<IpOnboardingView portrait={demoProductData.portrait} onConfirm={confirm} />)

    expect(screen.getByRole("heading", { name: /我理解的林姐/ })).toBeVisible()
    expect(screen.queryAllByRole("textbox")).toHaveLength(1)
    await userEvent.click(screen.getByRole("button", { name: "这个理解准确，开始创作" }))
    expect(confirm).toHaveBeenCalledOnce()
  })

  it("shows one usable script before optional adjustments", () => {
    render(<DailyCreationView draft={demoProductData.draft} />)

    expect(screen.getByText("林姐，今天这篇可以直接拍")).toBeVisible()
    expect(screen.getByRole("heading", { name: "真正难的不是找货，是让邻居愿意一直信你" })).toBeVisible()
    expect(screen.getByRole("button", { name: "复制并去拍" })).toBeVisible()
    expect(screen.queryByText("选择今天的口播稿")).not.toBeInTheDocument()
    expect(screen.queryByText("模拟发布表现")).not.toBeInTheDocument()
  })

  it("sends different intents for changing the topic and changing the expression", async () => {
    const regenerate = vi.fn()
    render(<DailyCreationView draft={demoProductData.draft} onRegenerate={regenerate} />)

    await userEvent.click(screen.getByRole("button", { name: "换选题" }))
    expect(regenerate).toHaveBeenLastCalledWith("change_topic")
    await userEvent.click(screen.getByRole("button", { name: "换个讲法" }))
    expect(regenerate).toHaveBeenLastCalledWith("change_expression")
  })

  it("replaces the visible script paragraphs when a changed-topic draft arrives", () => {
    const { rerender } = render(<DailyCreationView draft={demoProductData.draft} />)
    const changed = { ...demoProductData.draft, runId: "run-2", title: "换题后的标题", paragraphs: ["这是换题后的新正文。"] }

    rerender(<DailyCreationView draft={changed} />)

    expect(screen.getByText("这是换题后的新正文。")).toBeVisible()
    expect(screen.queryByText(demoProductData.draft.paragraphs[0])).not.toBeInTheDocument()
  })

  it("edits one script paragraph without opening the other paragraphs", async () => {
    render(<DailyCreationView draft={demoProductData.draft} />)

    const editSecondParagraph = screen.getByRole("button", { name: "编辑第 2 段" })
    expect(editSecondParagraph).toBeEnabled()
    await userEvent.click(editSecondParagraph)

    const secondParagraph = screen.getByRole("textbox", { name: "第 2 段" })
    expect(secondParagraph).toBeVisible()
    expect(screen.queryByRole("textbox", { name: "第 1 段" })).not.toBeInTheDocument()

    await userEvent.clear(secondParagraph)
    await userEvent.type(secondParagraph, "这是单独修改后的第二段。")
    await userEvent.click(screen.getByRole("button", { name: "完成第 2 段编辑" }))

    expect(screen.getByText("这是单独修改后的第二段。")).toBeVisible()
    expect(screen.queryByRole("textbox", { name: "第 2 段" })).not.toBeInTheDocument()
  })

  it("saves all paragraphs before closing one paragraph editor", async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    render(<DailyCreationView draft={demoProductData.draft} onSave={save} />)

    await userEvent.click(screen.getByRole("button", { name: "编辑第 2 段" }))
    const secondParagraph = screen.getByRole("textbox", { name: "第 2 段" })
    await userEvent.clear(secondParagraph)
    await userEvent.type(secondParagraph, "持久化后的第二段")
    await userEvent.click(screen.getByRole("button", { name: "完成第 2 段编辑" }))

    expect(save).toHaveBeenCalledWith([
      demoProductData.draft.paragraphs[0],
      "持久化后的第二段",
      ...demoProductData.draft.paragraphs.slice(2),
    ])
    expect(screen.queryByRole("textbox", { name: "第 2 段" })).not.toBeInTheDocument()
  })

  it("keeps edited text open when saving fails", async () => {
    const save = vi.fn().mockRejectedValue(new Error("保存失败"))
    render(<DailyCreationView draft={demoProductData.draft} onSave={save} />)

    await userEvent.click(screen.getByRole("button", { name: "编辑第 2 段" }))
    await userEvent.click(screen.getByRole("button", { name: "完成第 2 段编辑" }))

    expect(screen.getByRole("textbox", { name: "第 2 段" })).toBeVisible()
  })

  it("finalizes the visible paragraphs before copying", async () => {
    const finalize = vi.fn().mockResolvedValue(undefined)
    render(<DailyCreationView draft={demoProductData.draft} onFinalize={finalize} />)

    await userEvent.click(screen.getByRole("button", { name: "复制并去拍" }))

    expect(finalize).toHaveBeenCalledWith({ paragraphs: [...demoProductData.draft.paragraphs], copyAfter: true })
  })

  it("uses server status for the locked label", () => {
    render(<DailyCreationView draft={{ ...demoProductData.draft, status: "locked", lockedVersion: 1 }} />)

    expect(screen.getByRole("button", { name: "已确认定稿" })).toBeDisabled()
  })

  it("keeps account review conclusions tenant-private", () => {
    render(<ReviewBriefView brief={demoProductData.review} />)

    expect(screen.getByText("林姐视频号本周最值得保留的是：真实邻里场景")).toBeVisible()
    expect(screen.getByRole("button", { name: "确认并形成创作记忆" })).toBeVisible()
    expect(screen.getByText(/不会改动系统模板或通用策略/)).toBeVisible()
  })

  it("explains a natural-language team delegation before confirming it", () => {
    render(<TeamDelegationView delegation={demoProductData.delegation} />)

    expect(screen.getByText("我已把你的安排整理成一份可执行的分工")).toBeVisible()
    expect(screen.getByText(/让小周负责林姐视频号的日常选题/)).toBeVisible()
    expect(screen.getByText("没有扩大到其他 IP 或账号")).toBeVisible()
    expect(screen.getByRole("button", { name: "确认并邀请小周" })).toBeVisible()
  })

  it("keeps the platform structure ledger separate from customer content", () => {
    render(<ContentBrainView ledger={demoProductData.contentBrain} />)

    expect(screen.getByText("现有 24 个已启用结构覆盖首期创作，3 个结构需要本周复核")).toBeVisible()
    expect(screen.getByRole("button", { name: "处理 3 个复核提案" })).toBeVisible()
    expect(screen.getByText(/租户私有内容未参与/)).toBeVisible()
    expect(screen.queryByText("林姐说团购")).not.toBeInTheDocument()
  })
})
