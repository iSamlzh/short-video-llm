import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { TenantMasthead } from "../../src/components/shell/TenantMasthead"
import { PlatformMasthead } from "../../src/components/shell/PlatformMasthead"

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

describe("editorial app mastheads", () => {
  it("exposes only the three customer tasks and current context", () => {
    render(<TenantMasthead context={{
      team: { id: "tenant-linjie", label: "林姐内容团队" },
      ip: { id: "ip-linjie", label: "林姐" },
      account: { id: "account-linjie-wechat", label: "视频号｜林姐说团购" },
      teams: [{ id: "tenant-linjie", label: "林姐内容团队" }],
      ips: [{ id: "ip-linjie", label: "林姐" }],
      accounts: [{ id: "account-linjie-wechat", label: "视频号｜林姐说团购" }],
    }} userName="林姐" />)

    expect(screen.getByRole("navigation", { name: "主要任务" })).toBeVisible()
    expect(screen.getByRole("link", { name: "今日创作" })).toHaveAttribute("href", "/app/today")
    expect(screen.getByRole("link", { name: "复盘与优化" })).toHaveAttribute("href", "/app/review")
    expect(screen.getByRole("link", { name: "团队" })).toHaveAttribute("href", "/app/team")
    expect(screen.getByRole("button", { name: /切换当前 IP 和账号/ })).toBeVisible()
    expect(screen.getByRole("button", { name: "退出" })).toBeVisible()
    expect(screen.queryByRole("link", { name: "退出" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /当前团队|当前账号/ })).not.toBeInTheDocument()
    expect(screen.queryByText("平台内容大脑")).not.toBeInTheDocument()
  })

  it("marks the platform masthead as an internal security domain", () => {
    render(<PlatformMasthead operatorName="陈默" />)
    expect(screen.getByText("内部安全域")).toBeVisible()
    expect(screen.queryByRole("link", { name: "今日创作" })).not.toBeInTheDocument()
  })
})
