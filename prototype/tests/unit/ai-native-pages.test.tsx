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
