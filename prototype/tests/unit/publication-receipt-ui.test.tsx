import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { PublicationReceipt } from "../../src/components/creation/PublicationReceipt"
import { DailyCreationView } from "../../src/components/creation/DailyCreationView"
import { demoProductData } from "../../src/presets/product-demo"

const accounts = [
  { id: "account-wechat", label: "视频号｜林姐说团购", platform: "wechat_channels" },
  { id: "account-douyin", label: "抖音｜林姐说团购", platform: "douyin" },
]

describe("锁稿后的发布回执", () => {
  it("未锁稿时不打断复制和定稿主路径", () => {
    render(<DailyCreationView draft={{ ...demoProductData.draft, status: "ready_to_confirm" }} publicationAccounts={accounts} />)
    expect(screen.queryByText("这条视频已经发布了吗？")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "复制并去拍" })).toBeVisible()
  })

  it("锁稿文档脚注后显示一个轻量回执，并可展开身份输入", async () => {
    render(<DailyCreationView
      draft={{ ...demoProductData.draft, status: "locked", lockedVersion: 2 }}
      publicationAccounts={accounts}
    />)
    expect(screen.getByText("这条视频已经发布了吗？")).toBeVisible()
    await userEvent.click(screen.getByRole("button", { name: "记录已发布" }))
    expect(screen.getByLabelText("作品 ID 或视频链接")).toBeVisible()
    expect(screen.getByLabelText("发布账号")).toHaveValue("account-wechat")
  })

  it("保存失败后保留输入，重试成功后折叠为已关联状态", async () => {
    const save = vi.fn()
      .mockRejectedValueOnce(new Error("网络繁忙，请稍后再试"))
      .mockResolvedValueOnce({
        id: "publication-1", contentAccountId: "account-wechat", platform: "wechat_channels",
        platformVideoId: "wx-100", publishedAt: "2026-08-17T08:00:00Z",
      })
    render(<PublicationReceipt
      runId="run-1"
      lockedVersion={2}
      accounts={accounts}
      save={save}
    />)
    await userEvent.click(screen.getByRole("button", { name: "记录已发布" }))
    await userEvent.type(screen.getByLabelText("作品 ID 或视频链接"), "wx-100")
    await userEvent.click(screen.getByRole("button", { name: "保存发布记录" }))
    expect(await screen.findByDisplayValue("wx-100")).toBeVisible()
    expect(screen.getByRole("status")).toHaveTextContent("网络繁忙")

    await userEvent.click(screen.getByRole("button", { name: "重新保存" }))
    expect(await screen.findByText(/已关联发布/)).toBeVisible()
    expect(save).toHaveBeenCalledTimes(2)
  })

  it("成功后可增加其他账号发布，不覆盖第一条记录", async () => {
    const save = vi.fn()
      .mockResolvedValueOnce({ id: "p-1", contentAccountId: "account-wechat", platform: "wechat_channels", platformVideoId: "wx-1", publishedAt: "2026-08-17T08:00:00Z" })
      .mockResolvedValueOnce({ id: "p-2", contentAccountId: "account-douyin", platform: "douyin", platformVideoId: "dy-1", publishedAt: "2026-08-17T09:00:00Z" })
    render(<PublicationReceipt runId="run-1" lockedVersion={2} accounts={accounts} save={save} />)
    await record("wx-1")
    await userEvent.click(await screen.findByRole("button", { name: "增加其他账号发布" }))
    await userEvent.selectOptions(screen.getByLabelText("发布账号"), "account-douyin")
    await userEvent.type(screen.getByLabelText("作品 ID 或视频链接"), "dy-1")
    await userEvent.click(screen.getByRole("button", { name: "保存发布记录" }))
    expect(await screen.findAllByText(/已关联发布/)).toHaveLength(2)
  })
})

async function record(identity: string) {
  await userEvent.click(screen.getByRole("button", { name: "记录已发布" }))
  await userEvent.type(screen.getByLabelText("作品 ID 或视频链接"), identity)
  await userEvent.click(screen.getByRole("button", { name: "保存发布记录" }))
}
