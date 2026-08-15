import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import { PrototypeWorkspace } from "../../src/components/PrototypeWorkspace"
import { SimulationAndReview } from "../../src/components/SimulationAndReview"

describe("prototype workspace", () => {
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
    expect(screen.getByRole("button", { name: "生成选题方向" })).toBeVisible()
    expect(screen.queryByText("选择今天的文案")).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "生成选题方向" }))
    expect(await screen.findByText("选择今天拍什么")).toBeVisible()
  })

  it("always labels publication metrics as simulated", () => {
    render(<SimulationAndReview snapshot={{ isSimulated: true, impressions: 3200, plays: 1800 }} />)
    expect(screen.getByText("模拟数据，不代表真实平台表现")).toBeVisible()
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
})
