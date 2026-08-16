import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { PrototypeWorkspace } from "../../src/components/PrototypeWorkspace"
import { SimulationAndReview } from "../../src/components/SimulationAndReview"
import { saveCurrentIp } from "../../src/lib/current-ip-store"

const persistedProfile = {
  displayName: "示例团长",
  experience: "三年社区团购运营经历，服务过多个社区",
  expertise: "社区团购运营",
  audience: "希望拓展本地业务的人",
  voiceStyle: "直接、实在、有案例",
  boundaries: "不承诺确定收益",
}

describe("prototype workspace", () => {
  beforeEach(() => window.localStorage.clear())

  it("renders the single content growth workspace", () => {
    render(<PrototypeWorkspace />)
    expect(screen.getByRole("heading", { name: "内容增长 Agent" })).toBeVisible()
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument()
  })

  it("reveals one decision stage at a time", async () => {
    const user = userEvent.setup()
    const initialRun = {
      id: "run-1", state: "READY_FOR_TOPICS", inputVersion: 1, schemaVersion: 1,
      ipProfile: { displayName: "示例团长", experience: "三年社区团购运营经历", expertise: "社区运营", audience: "本地创业者", voiceStyle: "直接实在", boundaries: "不承诺收益" },
      createdAt: "now", updatedAt: "now",
    } as const
    const topicItems = [{ id: "topic-1", title: "真实经历怎么变成信任", angle: "用三年运营经历说明可信内容如何形成", audienceTension: "想拓客又怕说得太虚", ipFitEvidence: ["三年经历"], structureId: "case-breakdown", riskNotes: [] }]
    global.fetch = ((url: RequestInfo | URL) => Promise.resolve(new Response(JSON.stringify(
      String(url).includes("topics/generate") ? { items: topicItems } : { ...initialRun, state: "WAITING_TOPIC_SELECTION", topicBatch: { version: 1, items: topicItems } },
    ), { status: 200, headers: { "content-type": "application/json" } }))) as typeof fetch
    render(<PrototypeWorkspace initialRun={initialRun} />)
    expect(screen.getByRole("button", { name: "重试今日选题" })).toBeVisible()
    expect(screen.queryByText("选择今天的口播稿")).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "重试今日选题" }))
    expect(await screen.findByText("今天，先确定真正值得拍的一条")).toBeVisible()
  })

  it("uses the persisted current IP without showing onboarding again", async () => {
    saveCurrentIp(persistedProfile)
    const topicItems = [{ id: "topic-1", title: "真实经历怎么变成信任", angle: "用三年运营经历说明可信内容如何形成", audienceTension: "想拓客又怕说得太虚", ipFitEvidence: ["三年经历"], structureId: "case-breakdown", riskNotes: [] }]
    const run = {
      id: "run-daily", state: "WAITING_TOPIC_SELECTION", inputVersion: 1, schemaVersion: 1,
      ipProfile: persistedProfile, topicBatch: { version: 1, items: topicItems }, createdAt: "now", updatedAt: "now",
    }
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith("/runs") && init?.method === "POST") {
        return new Response(JSON.stringify({ ...run, state: "READY_FOR_TOPICS", topicBatch: undefined }), { status: 201, headers: { "content-type": "application/json" } })
      }
      if (url.includes("topics/generate")) {
        return new Response(JSON.stringify(run.topicBatch), { status: 200, headers: { "content-type": "application/json" } })
      }
      return new Response(JSON.stringify(run), { status: 200, headers: { "content-type": "application/json" } })
    }) as typeof fetch

    render(<PrototypeWorkspace />)

    expect(screen.queryByLabelText("称呼")).not.toBeInTheDocument()
    expect(await screen.findByText("今天，先确定真正值得拍的一条")).toBeVisible()
    expect(screen.getByRole("button", { name: "当前 IP 示例团长" })).toBeVisible()
  })

  it("moves from topic selection directly into script generation", async () => {
    const user = userEvent.setup()
    const topicItems = [{ id: "topic-1", title: "真实经历怎么变成信任", angle: "用三年运营经历说明可信内容如何形成", audienceTension: "想拓客又怕说得太虚", ipFitEvidence: ["三年经历"], structureId: "case-breakdown", riskNotes: [] }]
    const scripts = Array.from({ length: 3 }, (_, index) => ({
      id: `script-${index + 1}`, topicDirectionId: "topic-1", title: `口播稿 ${index + 1}`,
      hook: "很多团长第一步就做错了", body: "这是完整口播稿正文，用真实经历说明社区团购如何建立信任，并给出今天能够执行的方法。",
      callToAction: "欢迎留言交流", estimatedSeconds: 60,
    }))
    const topicSelectionRun = {
      id: "run-topic", state: "WAITING_TOPIC_SELECTION", inputVersion: 1, schemaVersion: 1,
      ipProfile: persistedProfile, topicBatch: { version: 1, items: topicItems }, createdAt: "now", updatedAt: "now",
    }
    let releaseSelection!: (response: Response) => void
    const pendingSelection = new Promise<Response>((resolve) => { releaseSelection = resolve })
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("topics/select")) return pendingSelection
      return Promise.resolve(new Response(JSON.stringify({
        ...topicSelectionRun,
        state: "WAITING_SCRIPT_SELECTION",
        scriptBatch: { version: 1, items: scripts },
      }), { status: 200, headers: { "content-type": "application/json" } }))
    }) as typeof fetch

    render(<PrototypeWorkspace initialRun={topicSelectionRun} />)
    await user.click(screen.getByRole("button", { name: "选择这个方向" }))

    expect(screen.getByText("正在生成同方向口播稿…")).toBeVisible()
    expect(screen.queryByRole("button", { name: "生成 3 篇文案" })).not.toBeInTheDocument()
    releaseSelection(new Response(JSON.stringify({ version: 1, items: scripts }), { status: 200, headers: { "content-type": "application/json" } }))
    expect(await screen.findByText("选择今天的口播稿")).toBeVisible()
  })

  it("always labels publication metrics as simulated", () => {
    render(<SimulationAndReview snapshot={{ isSimulated: true, impressions: 3200, plays: 1800 }} />)
    expect(screen.getByText("模拟数据，不代表真实平台表现")).toBeVisible()
  })

  it("disables the review action while a review request is running", () => {
    render(<SimulationAndReview
      snapshot={{ isSimulated: true, impressions: 3200, plays: 1800 }}
      onReview={() => undefined}
      reviewPending
    />)

    expect(screen.getByRole("button", { name: "正在复盘这条内容…" })).toBeDisabled()
  })

  it("prefills an explicitly requested demo IP profile", () => {
    render(<PrototypeWorkspace initialProfile={{
      displayName: "林姐",
      experience: "五年社区零售与团购运营经历，服务过十二个小区",
      expertise: "社区团购选品与团长运营",
      audience: "想做本地生意的宝妈和小店主",
      voiceStyle: "直白、温和、喜欢讲真实案例",
      boundaries: "不承诺收入，不虚构成功案例",
    }} />)
    expect(screen.getByLabelText("称呼")).toHaveValue("林姐")
    expect(screen.getByLabelText("真实经历")).toHaveValue("五年社区零售与团购运营经历，服务过十二个小区")
  })

  it("starts a new run when an explicit reset is requested", () => {
    window.localStorage.setItem("content-prototype-run", "old-run")
    render(<PrototypeWorkspace resetOnLoad initialProfile={{
      displayName: "林姐",
      experience: "五年社区零售与团购运营经历，服务过十二个小区",
      expertise: "社区团购选品与团长运营",
      audience: "想做本地生意的宝妈和小店主",
      voiceStyle: "直白、温和、喜欢讲真实案例",
      boundaries: "不承诺收入，不虚构成功案例",
    }} />)
    expect(window.localStorage.getItem("content-prototype-run")).toBeNull()
    expect(screen.getByLabelText("称呼")).toHaveValue("林姐")
    expect(screen.getByRole("button", { name: "完成初始化并生成选题" })).toBeVisible()
  })
})
