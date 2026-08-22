import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { LoginForm } from "../../src/components/auth/LoginForm"
import LoginPage from "../../src/app/login/page"

const push = vi.fn()
const refresh = vi.fn()

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  useRouter: () => ({ push, refresh }),
}))

vi.mock("@/lib/auth/request-access", () => ({
  resolveCurrentAccess: vi.fn().mockResolvedValue(null),
}))

describe("生产安全登录页", () => {
  beforeEach(() => {
    push.mockReset()
    refresh.mockReset()
    vi.stubGlobal("fetch", vi.fn())
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it("生产环境不显示或预填任何演示账号与密码", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("PROTOTYPE_DEMO_CONTROLS", "true")

    render(await LoginPage())

    expect(screen.getByLabelText("邮箱")).toHaveValue("")
    expect(screen.getByLabelText("密码")).toHaveValue("")
    expect(screen.queryByText(/example\.test|demo-password|其他开发角色/)).not.toBeInTheDocument()
  })

  it("显式开启开发演示时才展示并预填测试凭据", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("PROTOTYPE_DEMO_CONTROLS", "true")

    render(await LoginPage())

    expect(screen.getByLabelText("邮箱")).toHaveValue("firsttime@example.test")
    expect(screen.getByLabelText("密码")).toHaveValue("demo-password")
    expect(screen.getByText("其他开发角色")).toBeVisible()
  })

  it("登录失败时在密码字段附近说明错误并恢复提交", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ message: "账号或密码不正确" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    }))
    render(<LoginForm />)

    await userEvent.type(screen.getByLabelText("邮箱"), "owner@example.test")
    await userEvent.type(screen.getByLabelText("密码"), "wrong-password")
    await userEvent.click(screen.getByRole("button", { name: "进入内容工作台" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("账号或密码不正确")
    expect(screen.getByLabelText("密码")).toHaveAttribute("aria-invalid", "true")
    expect(screen.getByRole("button", { name: "进入内容工作台" })).toBeEnabled()
  })

  it("网络错误不会卡住登录按钮，并给出可恢复提示", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"))
    render(<LoginForm />)

    await userEvent.type(screen.getByLabelText("邮箱"), "owner@example.test")
    await userEvent.type(screen.getByLabelText("密码"), "demo-password")
    await userEvent.click(screen.getByRole("button", { name: "进入内容工作台" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("暂时无法连接登录服务，请稍后重试")
    expect(screen.getByRole("button", { name: "进入内容工作台" })).toBeEnabled()
  })

  it("请求未完成时不会重复提交", async () => {
    let resolveLogin!: (response: Response) => void
    vi.mocked(fetch).mockReturnValue(new Promise((resolve) => { resolveLogin = resolve }))
    render(<LoginForm defaultEmail="owner@example.test" defaultPassword="demo-password" />)

    await userEvent.click(screen.getByRole("button", { name: "进入内容工作台" }))
    expect(screen.getByRole("button", { name: "正在进入…" })).toBeDisabled()
    await userEvent.click(screen.getByRole("button", { name: "正在进入…" }))
    expect(fetch).toHaveBeenCalledTimes(1)

    resolveLogin(new Response(JSON.stringify({ audience: "tenant" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }))
    await waitFor(() => expect(push).toHaveBeenCalledWith("/app/today"))
  })
})
