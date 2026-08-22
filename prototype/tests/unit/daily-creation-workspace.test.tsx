import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { DailyCreationWorkspace } from "../../src/components/creation/DailyCreationWorkspace"
import { demoProductData } from "../../src/presets/product-demo"

describe("DailyCreationWorkspace 结构化导出", () => {
  it("复制锁定稿时只复制 spoken 段落", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
    const lockedDraft = {
      ...demoProductData.draft,
      status: "locked",
      lockedVersion: 1,
      segments: [
        { id: "spoken-1", kind: "spoken", text: "第一段口播" },
        { id: "shot-1", kind: "shot_instruction", text: "镜头推近" },
        { id: "spoken-2", kind: "spoken", text: "第二段口播" },
      ],
    }
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(lockedDraft), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch

    render(<DailyCreationWorkspace />)
    await userEvent.click(await screen.findByRole("button", { name: "复制文本" }))

    expect(writeText).toHaveBeenCalledWith("第一段口播\n\n第二段口播")
  })

  it("换选题等待和取消期间保留当前稿件", async () => {
    let regenerationSignal: AbortSignal | undefined
    const currentDraft = { ...demoProductData.draft, title: "原来的可用选题" }
    global.fetch = vi.fn((input, init) => {
      if (String(input).endsWith("/current")) {
        return Promise.resolve(new Response(JSON.stringify(currentDraft), {
          status: 200, headers: { "content-type": "application/json" },
        }))
      }
      regenerationSignal = init?.signal ?? undefined
      return new Promise<Response>((_resolve, reject) => {
        regenerationSignal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))
      })
    }) as typeof fetch

    render(<DailyCreationWorkspace />)
    expect(await screen.findByRole("heading", { name: "原来的可用选题" })).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "换一个选题" }))

    expect(screen.getByRole("heading", { name: "原来的可用选题" })).toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent("正在")
    await userEvent.click(screen.getByRole("button", { name: "取消本次生成" }))

    await waitFor(() => expect(regenerationSignal?.aborted).toBe(true))
    expect(screen.getByRole("heading", { name: "原来的可用选题" })).toBeInTheDocument()
    expect(screen.queryByText("生成失败")).not.toBeInTheDocument()
  })

  it("首次生成取消后进入可继续生成的中性状态", async () => {
    global.fetch = vi.fn((input, init) => {
      if (String(input).endsWith("/current")) return Promise.resolve(new Response(null, { status: 204 }))
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))
      })
    }) as typeof fetch

    render(<DailyCreationWorkspace />)
    await userEvent.click(await screen.findByRole("button", { name: "取消本次生成" }))

    expect(await screen.findByRole("heading", { name: "已取消本次生成" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "继续生成" })).toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })
})
