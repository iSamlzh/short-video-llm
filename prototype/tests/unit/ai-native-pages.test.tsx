import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { IpOnboardingView } from "../../src/components/onboarding/IpOnboardingView"
import { DailyCreationView } from "../../src/components/creation/DailyCreationView"
import { ReviewBriefView } from "../../src/components/review/ReviewBriefView"
import { TeamDelegationView } from "../../src/components/team/TeamDelegationView"
import { ContentBrainWorkspace } from "../../src/components/content-brain/ContentBrainWorkspace"
import { demoProductData } from "../../src/presets/product-demo"

describe("approved AI-native page hierarchy", () => {
  it("confirms an AI portrait instead of showing a long onboarding form", async () => {
    const confirm = vi.fn()
    render(<IpOnboardingView portrait={demoProductData.portrait} onConfirm={confirm} />)

    expect(screen.getByRole("heading", { name: /我理解的林姐/ })).toBeVisible()
    expect(screen.queryAllByRole("textbox")).toHaveLength(0)
    expect(screen.getByText(/修改它所依据的原回答/)).toBeVisible()
    await userEvent.click(screen.getByRole("button", { name: "这个理解准确，开始创作" }))
    expect(confirm).toHaveBeenCalledOnce()
  })

  it("shows one usable script before optional adjustments", () => {
    render(<DailyCreationView draft={{
      ...demoProductData.draft,
      decisionBrief: {
        recommendationSummary: "基于七年社区团购经历，今天讲清团长如何用长期判断赢得邻居信任。",
        portraitFitSummary: "画像显示她有长期一线团购经验，表达重视真实取舍，适合用判断过程建立信任。",
        objective: "建立信任",
        whyToday: "受众正在决定是否长期相信一个团长的判断。",
        audienceProblem: "不知道怎样判断一个团长是否值得长期信任。",
        topicOpportunity: "从一次选品判断失误切入，给出值得长期信任的三个判断标准。",
        ipEvidenceRefs: [{
          label: "七年社区团购经历",
          sourceAnswerId: "answer-experience",
          relevance: "长期一线经历能让信任判断来自真实取舍，而不是泛泛讲道理。",
        }],
        structureChoice: {
          structureId: "failure-turn-v1",
          structureName: "踩坑转折结构",
          reason: "先讲判断失误，再还原改进动作，适合把真实经历转成可信方法。",
        },
        recentDataStatus: "none",
        repetitionRisk: "low",
        nextSignal: "发布后重点观察完播率和评论中的信任问题。",
      },
    }} />)

    expect(screen.getByText("今天建议讲")).toBeVisible()
    expect(screen.getByText("建立信任")).toBeVisible()
    expect(screen.getByText("基于七年社区团购经历，今天讲清团长如何用长期判断赢得邻居信任。")).toBeVisible()
    expect(screen.getByText("画像显示她有长期一线团购经验，表达重视真实取舍，适合用判断过程建立信任。")).toBeVisible()
    expect(screen.getByText("不知道怎样判断一个团长是否值得长期信任。")).toBeVisible()
    expect(screen.getByText("从一次选品判断失误切入，给出值得长期信任的三个判断标准。")).toBeVisible()
    expect(screen.getByText("踩坑转折结构")).toBeVisible()
    expect(screen.getByText("发布后重点观察完播率和评论中的信任问题。")).toBeVisible()
    expect(screen.getByText("尚未使用历史表现")).toBeVisible()
    expect(screen.queryByText(/近期账号表现|已参考复盘/)).not.toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "真正难的不是找货，是让邻居愿意一直信你" })).toBeVisible()
    expect(screen.getByRole("button", { name: "确认定稿" })).toBeVisible()
    expect(screen.getByText("人工确认后定稿，即可下载 DOCX；复制文本也会启用")).toBeVisible()
    expect(screen.queryByRole("button", { name: "下载口播稿" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "复制文本" })).not.toBeInTheDocument()
    expect(screen.queryByText("选择今天的口播稿")).not.toBeInTheDocument()
    expect(screen.queryByText("模拟发布表现")).not.toBeInTheDocument()
  })

  it("把详细证据放入用户主动打开的判断依据层", async () => {
    render(<DailyCreationView draft={{
      ...demoProductData.draft,
      decisionBrief: {
        recommendationSummary: "用七年社区团购经历回答新团长的信任判断问题。",
        portraitFitSummary: "画像显示她拥有长期一线经验，并且习惯从真实踩坑中总结判断方法。",
        objective: "建立信任",
        whyToday: "今天先回答信任问题。",
        audienceProblem: "不知道该相信谁。",
        topicOpportunity: "从一次真实踩坑切入，说明判断团长是否可信的方法。",
        ipEvidenceRefs: [{
          label: "七年社区团购经历",
          sourceAnswerId: "answer-experience",
          relevance: "这段经历能支撑具体的判断过程，而不是只给结论。",
        }],
        structureChoice: {
          structureId: "failure-turn-v1",
          structureName: "真实经历复盘结构",
          reason: "先讲踩坑，再给出判断方法，适合建立可信度。",
        },
        recentDataStatus: "none",
        repetitionRisk: "medium",
        nextSignal: "观察真实评论问题。",
      },
    }} />)

    expect(screen.queryByRole("dialog", { name: "这次推荐依据" })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "查看完整判断依据" }))
    expect(screen.getByRole("dialog", { name: "这次推荐依据" })).toBeVisible()
    expect(screen.queryByText("七年社区团购经历")).not.toBeInTheDocument()
    expect(screen.getAllByText("画像显示她拥有长期一线经验，并且习惯从真实踩坑中总结判断方法。").length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText("真实经历复盘结构").length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText("先讲踩坑，再给出判断方法，适合建立可信度。").length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText("中等重复风险")).toBeVisible()
  })

  it("sends different intents for changing the topic and changing the expression", async () => {
    const regenerate = vi.fn()
    render(<DailyCreationView draft={demoProductData.draft} onRegenerate={regenerate} />)

    await userEvent.click(screen.getByRole("button", { name: "换一个选题" }))
    expect(regenerate).toHaveBeenLastCalledWith("change_topic")
    await userEvent.click(screen.getByRole("button", { name: "换一种讲法" }))
    expect(regenerate).toHaveBeenLastCalledWith("change_expression")
  })

  it("replaces the visible script paragraphs when a changed-topic draft arrives", () => {
    const { rerender } = render(<DailyCreationView draft={demoProductData.draft} />)
    const changed = { ...demoProductData.draft, runId: "run-2", title: "换题后的标题", paragraphs: ["这是换题后的新正文。"] }

    rerender(<DailyCreationView draft={changed} />)

    expect(screen.getByText("这是换题后的新正文。")).toBeVisible()
    expect(screen.queryByText(demoProductData.draft.paragraphs[0])).not.toBeInTheDocument()
  })

  it("edits one script paragraph without opening the other paragraphs", async () => {
    render(<DailyCreationView draft={demoProductData.draft} />)

    const editSecondParagraph = screen.getByRole("button", { name: "编辑第 2 段" })
    expect(editSecondParagraph).toBeEnabled()
    await userEvent.click(editSecondParagraph)

    const secondParagraph = screen.getByRole("textbox", { name: "第 2 段" })
    expect(secondParagraph).toBeVisible()
    expect(screen.queryByRole("textbox", { name: "第 1 段" })).not.toBeInTheDocument()

    await userEvent.clear(secondParagraph)
    await userEvent.type(secondParagraph, "这是单独修改后的第二段。")
    await userEvent.click(screen.getByRole("button", { name: "完成第 2 段编辑" }))

    expect(screen.getByText("这是单独修改后的第二段。")).toBeVisible()
    expect(screen.queryByRole("textbox", { name: "第 2 段" })).not.toBeInTheDocument()
  })

  it("saves all paragraphs before closing one paragraph editor", async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    render(<DailyCreationView draft={demoProductData.draft} onSave={save} />)

    await userEvent.click(screen.getByRole("button", { name: "编辑第 2 段" }))
    const secondParagraph = screen.getByRole("textbox", { name: "第 2 段" })
    await userEvent.clear(secondParagraph)
    await userEvent.type(secondParagraph, "持久化后的第二段")
    await userEvent.click(screen.getByRole("button", { name: "完成第 2 段编辑" }))

    expect(save).toHaveBeenCalledWith(demoProductData.draft.paragraphs.map((text, index) => ({
      id: `draft-${index + 1}`,
      kind: "spoken",
      text: index === 1 ? "持久化后的第二段" : text,
    })))
    expect(screen.queryByRole("textbox", { name: "第 2 段" })).not.toBeInTheDocument()
  })

  it("keeps edited text open when saving fails", async () => {
    const save = vi.fn().mockRejectedValue(new Error("保存失败"))
    render(<DailyCreationView draft={demoProductData.draft} onSave={save} />)

    await userEvent.click(screen.getByRole("button", { name: "编辑第 2 段" }))
    await userEvent.click(screen.getByRole("button", { name: "完成第 2 段编辑" }))

    expect(screen.getByRole("textbox", { name: "第 2 段" })).toBeVisible()
  })

  it("finalizes the visible paragraphs before enabling export actions", async () => {
    const finalize = vi.fn().mockResolvedValue(undefined)
    render(<DailyCreationView draft={demoProductData.draft} onFinalize={finalize} />)

    await userEvent.click(screen.getByRole("button", { name: "确认定稿" }))

    expect(finalize).toHaveBeenCalledWith({
      segments: demoProductData.draft.paragraphs.map((text, index) => ({
        id: `draft-${index + 1}`,
        kind: "spoken",
        text,
      })),
    })
  })

  it("首版允许用户人工确认后直接定稿", () => {
    render(<DailyCreationView draft={{ ...demoProductData.draft, status: "needs_qa" }} />)

    expect(screen.getByRole("button", { name: "确认定稿" })).toBeEnabled()
    expect(screen.getByText("人工确认后定稿，即可下载 DOCX；复制文本也会启用")).toBeVisible()
  })

  it("makes download primary and keeps copy as a tertiary action after locking", async () => {
    const download = vi.fn()
    const copy = vi.fn().mockResolvedValue(undefined)
    render(<DailyCreationView
      draft={{ ...demoProductData.draft, status: "locked", lockedVersion: 1, version: "v1 · 已定稿", finalizedAt: "2026-08-18T06:30:00.000Z" }}
      onDownload={download}
      onCopy={copy}
    />)

    expect(screen.getByText("已定稿 · 2026-08-18 14:30")).toBeVisible()
    await userEvent.click(screen.getByRole("button", { name: "下载口播稿" }))
    expect(download).toHaveBeenCalledOnce()
    const copyAction = screen.getByRole("button", { name: "复制文本" })
    expect(copyAction).toHaveClass("tertiary-action")
    await userEvent.click(copyAction)
    expect(copy).toHaveBeenCalledOnce()
    expect(screen.getByText("v1 · 已定稿")).toBeVisible()
  })

  it("keeps a locked script read-only until the user explicitly returns to editing", async () => {
    render(<DailyCreationView draft={{
      ...demoProductData.draft,
      status: "locked",
      lockedVersion: 1,
      version: "v1 · 已定稿",
    }} />)

    expect(screen.queryByRole("button", { name: "编辑第 1 段" })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "返回编辑" }))
    expect(screen.getByRole("button", { name: "编辑第 1 段" })).toBeVisible()
  })

  it("显示已自动生效的记忆版本，但不增加选择器或权重设置", () => {
    render(<DailyCreationView draft={{
      ...demoProductData.draft,
      memoryInfluence: { version: 1, summary: "保留真实邻里场景；开头更快进入冲突" },
    }} />)
    expect(screen.getAllByText(/记忆 v1/).length).toBeGreaterThan(0)
    expect(screen.getByText(/已参考确认复盘/)).toBeVisible()
    expect(screen.queryByText(/权重|选择记忆|是否使用记忆/)).not.toBeInTheDocument()
  })

  it("keeps account review conclusions tenant-private", () => {
    render(<ReviewBriefView brief={demoProductData.review} />)

    expect(screen.getByText("真实邻里场景值得继续验证")).toBeVisible()
    expect(screen.getByRole("button", { name: "确认并用于后续创作" })).toBeVisible()
    expect(screen.getByText(/不会改动平台模板或通用策略/)).toBeVisible()
  })

  it("uses real team members and explicit data scopes instead of fixed demo delegation", () => {
    render(<TeamDelegationView initialData={{
      members: [{ membershipId: "m1", displayName: "当前团长", email: "owner@example.test", roleKey: "owner", status: "active", mustChangePassword: false, isCurrentUser: true, ipIds: ["ip1"], contentAccountIds: ["a1"], capabilities: ["team.manage"] }],
      ips: [{ id: "ip1", display_name: "健康管理 IP" }],
      accounts: [{ id: "a1", account_name: "健康生活号", platform: "视频号" }],
      grantableCapabilities: ["team.manage"], audits: [],
    }} />)

    expect(screen.getByText("让每个人只看到该负责的内容")).toBeVisible()
    expect(screen.getByText(/可访问 1 个 IP、1 个内容账号/)).toBeVisible()
    expect(screen.getByRole("button", { name: "新增成员" })).toBeVisible()
    expect(screen.queryByText(/小周/)).not.toBeInTheDocument()
  })

  it("keeps the platform structure ledger separate from customer content", () => {
    render(<ContentBrainWorkspace initialSamples={[]} initialStructures={[]} canActivate api={{} as any} />)

    expect(screen.getByRole("button", { name: "新增爆款样本" })).toBeVisible()
    expect(screen.getByText(/先提供一条真实内容/)).toBeVisible()
    expect(screen.queryByText("林姐说团购")).not.toBeInTheDocument()
  })
})
