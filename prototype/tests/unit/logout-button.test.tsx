import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { LogoutButton } from "../../src/components/auth/LogoutButton"

const replace = vi.fn()
const refresh = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh }) }))

describe("LogoutButton", () => {
  beforeEach(() => {
    replace.mockReset()
    refresh.mockReset()
    vi.restoreAllMocks()
  })

  it("只在用户明确点击后通过 POST 注销并返回登录页", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    render(<LogoutButton />)

    expect(fetchMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "退出" }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/auth/logout", { method: "POST" }))
    expect(replace).toHaveBeenCalledWith("/login")
    expect(refresh).toHaveBeenCalled()
  })

  it("注销失败时保留当前页面并提供可感知错误", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }))
    render(<LogoutButton />)
    fireEvent.click(screen.getByRole("button", { name: "退出" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("暂时无法退出，请重试")
    expect(replace).not.toHaveBeenCalled()
  })
})
