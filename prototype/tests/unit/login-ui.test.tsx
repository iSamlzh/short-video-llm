import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { LoginForm } from "../../src/components/auth/LoginForm"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

describe("开发验证登录页", () => {
  it("可以预填首次使用账号以便从 IP 初始化开始验收", () => {
    render(<LoginForm defaultEmail="firsttime@example.test" />)

    expect(screen.getByLabelText("邮箱")).toHaveValue("firsttime@example.test")
    expect(screen.getByLabelText("密码")).toHaveValue("demo-password")
  })
})
