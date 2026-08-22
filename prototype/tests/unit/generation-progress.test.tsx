import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { GenerationProgress } from "../../src/components/creation/GenerationProgress"

describe("GenerationProgress", () => {
  it("明确播报当前阶段、耗时和取消动作", async () => {
    const cancel = vi.fn()
    render(<GenerationProgress
      operation="change_topic"
      state={{ stage: "writing", elapsedSeconds: 8, cancellable: true, retryable: false }}
      detailsVisible
      onCancel={cancel}
    />)

    expect(screen.getByRole("status")).toHaveTextContent("正在生成完整口播稿")
    expect(screen.getByText("已用时 8 秒")).toHaveClass("tabular-nums")
    await userEvent.click(screen.getByRole("button", { name: "取消本次生成" }))
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it("失败时在原操作位置提供重试", async () => {
    const retry = vi.fn()
    render(<GenerationProgress
      operation="change_expression"
      state={{ stage: "writing", elapsedSeconds: 4, cancellable: false, retryable: true }}
      detailsVisible
      error="模型连接失败"
      onRetry={retry}
    />)

    expect(screen.getByRole("alert")).toHaveTextContent("模型连接失败")
    await userEvent.click(screen.getByRole("button", { name: "重试本次操作" }))
    expect(retry).toHaveBeenCalledTimes(1)
  })
})
