import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { TenantMasthead } from "../../src/components/shell/TenantMasthead"
import { PlatformMasthead } from "../../src/components/shell/PlatformMasthead"

describe("editorial app mastheads", () => {
  it("exposes only the three customer tasks and current context", () => {
    render(<TenantMasthead context={{
      teamName: "林姐内容团队",
      ipName: "林姐",
      accountName: "视频号",
      userName: "林姐",
    }} />)

    expect(screen.getByRole("navigation", { name: "主要任务" })).toBeVisible()
    expect(screen.getByRole("link", { name: "今日创作" })).toHaveAttribute("href", "/app/today")
    expect(screen.getByRole("link", { name: "复盘与优化" })).toHaveAttribute("href", "/app/review")
    expect(screen.getByRole("link", { name: "团队" })).toHaveAttribute("href", "/app/team")
    expect(screen.queryByText("平台内容大脑")).not.toBeInTheDocument()
  })

  it("marks the platform masthead as an internal security domain", () => {
    render(<PlatformMasthead operatorName="陈默" />)
    expect(screen.getByText("内部安全域")).toBeVisible()
    expect(screen.queryByRole("link", { name: "今日创作" })).not.toBeInTheDocument()
  })
})
