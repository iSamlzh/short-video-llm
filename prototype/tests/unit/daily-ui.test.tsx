import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { CurrentIpContext } from "../../src/components/CurrentIpContext"
import { DailyProgress } from "../../src/components/DailyProgress"
import { ScriptCandidateList } from "../../src/components/ScriptCandidateList"
import { TopicDirectionList } from "../../src/components/TopicDirectionList"

const profile = {
  displayName: "林姐",
  experience: "五年社区零售与团购运营经历，服务过十二个小区",
  expertise: "社区团购选品与团长运营",
  audience: "想做本地生意的宝妈和小店主",
  voiceStyle: "直白、温和、喜欢讲真实案例",
  boundaries: "不承诺收入，不虚构成功案例",
}

describe("daily creation UI", () => {
  it("shows the current IP as persistent context", () => {
    render(<CurrentIpContext profile={profile} />)
    expect(screen.getByRole("button", { name: "当前 IP 林姐" })).toBeVisible()
  })

  it("maps internal state to four user-facing creation stages", () => {
    render(<DailyProgress state="WAITING_SCRIPT_SELECTION" />)
    expect(screen.getByText("确定选题")).toBeVisible()
    expect(screen.getByText("选择口播稿")).toHaveAttribute("aria-current", "step")
    expect(screen.getByText("质量检查")).toBeVisible()
    expect(screen.getByText("定稿交接")).toBeVisible()
  })

  it("selects a topic from a vertical decision list", async () => {
    const onSelect = vi.fn()
    const items = [{ id: "topic-1", title: "真正难的不是找货", angle: "从真实售后经历切入建立信任", ipFitEvidence: ["五年社区运营"] }]
    render(<TopicDirectionList items={items} pending={false} onSelect={onSelect} />)
    await userEvent.click(screen.getByRole("button", { name: "选择这个方向" }))
    expect(onSelect).toHaveBeenCalledWith(items[0])
  })

  it("chooses one script before confirming it", async () => {
    const onConfirm = vi.fn()
    const items = Array.from({ length: 3 }, (_, index) => ({
      id: `script-${index + 1}`,
      title: `口播稿 ${index + 1}`,
      hook: `开场 ${index + 1}`,
      body: `这是第 ${index + 1} 篇完整口播稿正文。`,
      estimatedSeconds: 60,
    }))
    render(<ScriptCandidateList items={items} pending={false} onConfirm={onConfirm} />)
    await userEvent.click(screen.getByRole("radio", { name: /口播稿 2/ }))
    await userEvent.click(screen.getByRole("button", { name: "选择这版并进入质检" }))
    expect(onConfirm).toHaveBeenCalledWith(items[1])
  })
})
