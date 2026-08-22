import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import { AgentRationaleDrawer } from "../../src/components/creation/AgentRationaleDrawer"
import { IpBasicInfoStep } from "../../src/components/onboarding/IpBasicInfoStep"
import { ReviewBriefView } from "../../src/components/review/ReviewBriefView"

describe("工作台可访问性契约", () => {
  it("判断依据使用浏览器原生模态对话框并在关闭后归还焦点", async () => {
    render(<AgentRationaleDrawer brief={{
      ipEvidenceRefs: [{ sourceAnswerId: "answer-1", label: "真实服务经历" }],
      repetitionRisk: "low",
      recentDataStatus: "unavailable",
      recentDataSummary: "",
    } as any} />)

    const trigger = screen.getByRole("button", { name: "查看完整判断依据" })
    await userEvent.click(trigger)
    const dialog = screen.getByRole("dialog", { name: "这次推荐依据" })
    expect(dialog.tagName).toBe("DIALOG")

    await userEvent.keyboard("{Escape}")
    expect(screen.queryByRole("dialog", { name: "这次推荐依据" })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it("没有跳转动作的证据编号以静态引用展示，不伪装成按钮", () => {
    render(<ReviewBriefView brief={{
      id: "review-1",
      version: 1,
      sampleTier: "facts_only",
      sampleCount: 1,
      evidenceLimits: "只有一条真实样本，不能形成长期结论。",
      canConfirm: false,
      payload: {
        headline: "先看一条能确定的事实",
        observations: [{ text: "完播率为 54%。", evidenceSnapshotIds: ["snapshot-1"] }],
        hypotheses: [],
        nextContentSignals: ["继续积累同账号数据"],
        keep: [],
        avoid: [],
        evidenceLimits: "只有一条真实样本，不能形成长期结论。",
        structureEvidence: [],
      },
    }} />)

    expect(screen.getByText("snapshot-1")).toBeVisible()
    expect(screen.queryByRole("button", { name: /snapshot-1/ })).not.toBeInTheDocument()
  })

  it("基础信息未完成时说明继续按钮不可用的原因", () => {
    render(<IpBasicInfoStep onContinue={() => undefined} />)
    const submit = screen.getByRole("button", { name: "继续选择行业" })
    expect(submit).toBeDisabled()
    expect(submit).toHaveAccessibleDescription("请先填写 IP 名称")
  })
})
