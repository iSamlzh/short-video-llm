import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { WorkspaceContextSwitcher } from "../../src/components/shell/WorkspaceContextSwitcher"
import type { WorkspaceContext } from "../../src/services/workspace-context-service"

const refresh = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))

const initial: WorkspaceContext = {
  team: { id: "tenant-linjie", label: "林姐内容团队" },
  ip: { id: "ip-linjie", label: "林姐" },
  account: { id: "account-linjie-wechat", label: "视频号｜林姐说团购" },
  teams: [{ id: "tenant-linjie", label: "林姐内容团队" }],
  ips: [{ id: "ip-linjie", label: "林姐" }, { id: "ip-wangjie", label: "王姐" }],
  accounts: [
    { id: "account-linjie-wechat", label: "视频号｜林姐说团购" },
    { id: "account-linjie-douyin", label: "抖音｜林姐聊团购" },
  ],
}

describe("工作上下文切换器", () => {
  beforeEach(() => {
    refresh.mockReset()
    HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute("open", "") }
    HTMLDialogElement.prototype.close = function close() { this.removeAttribute("open") }
  })

  it("用一个明确入口展示当前 IP 和账号", () => {
    render(<WorkspaceContextSwitcher initialContext={initial} />)

    expect(screen.getByRole("button", { name: /切换当前 IP 和账号.*林姐.*视频号/ })).toBeVisible()
    expect(screen.getByText("林姐内容团队")).toBeVisible()
    expect(screen.queryByRole("button", { name: /当前团队/ })).not.toBeInTheDocument()
  })

  it("选择其他 IP 后更新当前上下文并刷新页面数据", async () => {
    const switched: WorkspaceContext = {
      ...initial,
      ip: { id: "ip-wangjie", label: "王姐" },
      account: { id: "account-wangjie-douyin", label: "抖音｜王姐本地生活" },
      accounts: [{ id: "account-wangjie-douyin", label: "抖音｜王姐本地生活" }],
    }
    const switchContext = vi.fn().mockResolvedValue(switched)
    render(<WorkspaceContextSwitcher initialContext={initial} switchContext={switchContext} />)

    const trigger = screen.getByRole("button", { name: /切换当前 IP 和账号/ })
    await userEvent.click(trigger)
    await userEvent.click(screen.getByRole("button", { name: "切换到 IP：王姐" }))

    expect(switchContext).toHaveBeenCalledWith({ ipId: "ip-wangjie" })
    await waitFor(() => expect(screen.getByRole("button", { name: /王姐.*抖音/ })).toBeVisible())
    expect(refresh).toHaveBeenCalledOnce()
    expect(trigger).toHaveFocus()
  })

  it("Escape 关闭弹层并把焦点还给触发器", async () => {
    render(<WorkspaceContextSwitcher initialContext={initial} />)
    const trigger = screen.getByRole("button", { name: /切换当前 IP 和账号/ })
    await userEvent.click(trigger)
    const dialog = screen.getByRole("dialog", { name: "切换工作上下文" })

    fireEvent(dialog, new Event("cancel", { cancelable: true }))

    await waitFor(() => expect(dialog).not.toHaveAttribute("open"))
    expect(trigger).toHaveFocus()
  })

  it("失败信息显示在切换操作附近且保留当前上下文", async () => {
    const switchContext = vi.fn().mockRejectedValue(new Error("无权切换到这个工作空间"))
    render(<WorkspaceContextSwitcher initialContext={initial} switchContext={switchContext} />)

    await userEvent.click(screen.getByRole("button", { name: /切换当前 IP 和账号/ }))
    await userEvent.click(screen.getByRole("button", { name: "切换到 IP：王姐" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("无权切换到这个工作空间")
    expect(screen.getByRole("dialog")).toHaveAttribute("open")
    expect(screen.getByRole("button", { name: /林姐.*视频号/ })).toBeVisible()
  })

  it("提供独立的新增 IP 入口", async () => {
    render(<WorkspaceContextSwitcher initialContext={initial} />)
    await userEvent.click(screen.getByRole("button", { name: /切换当前 IP 和账号/ }))

    expect(screen.getByRole("link", { name: "新增 IP" })).toHaveAttribute("href", "/app/setup/ip")
  })
})
