import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import HomePage from "../../src/app/page"
import { PrototypeWorkspace } from "../../src/components/PrototypeWorkspace"
import { SimulationAndReview } from "../../src/components/SimulationAndReview"

describe("prototype workspace", () => {
  it("renders the single content growth workspace", () => {
    render(<HomePage />)
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
    expect(screen.getByRole("button", { name: "生成选题方向" })).toBeVisible()
    expect(screen.queryByText("选择今天的文案")).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "生成选题方向" }))
    expect(await screen.findByText("选择今天拍什么")).toBeVisible()
  })

  it("always labels publication metrics as simulated", () => {
    render(<SimulationAndReview snapshot={{ isSimulated: true, impressions: 3200, plays: 1800 }} />)
    expect(screen.getByText("模拟数据，不代表真实平台表现")).toBeVisible()
  })
})
