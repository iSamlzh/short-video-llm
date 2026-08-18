import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { ContentBrainWorkspace } from "../../src/components/content-brain/ContentBrainWorkspace"
import { AnalysisReviewDocument } from "../../src/components/content-brain/AnalysisReviewDocument"
import { StructureDecisionDocument } from "../../src/components/content-brain/StructureDecisionDocument"
import { StructureLedger } from "../../src/components/content-brain/StructureLedger"

describe("AI 原生爆款拆解工作区", () => {
  it("以新增爆款样本开始而不是空白模板", () => {
    render(<ContentBrainWorkspace initialSamples={[]} initialStructures={[]} canActivate api={fixtureApi() as any} />)
    expect(screen.getByRole("button", { name: "新增爆款样本" })).toBeVisible()
    expect(screen.queryByText("新建空白模板")).not.toBeInTheDocument()
    expect(screen.getByText("先提供一条真实内容，Agent 再提炼可复用结构。" )).toBeVisible()
  })

  it("新增样本后直接开始拆解并进入结果文档", async () => {
    const api = fixtureApi()
    render(<ContentBrainWorkspace initialSamples={[]} initialStructures={[]} canActivate api={api as any} />)
    await userEvent.click(screen.getByRole("button", { name: "新增爆款样本" }))
    await userEvent.type(screen.getByLabelText("样本标题"), "一次售后让我重新理解团长")
    await userEvent.type(screen.getByLabelText("口播原文"), "这是一段超过四十字的真实售后经历。客户提出问题后，我先核验事实，再承担责任，最后把处理原则讲清楚。")
    await userEvent.type(screen.getByLabelText("授权说明"), "已获内部拆解授权")
    await userEvent.click(screen.getByRole("button", { name: "保存并开始拆解" }))

    expect(api.createSample).toHaveBeenCalledOnce()
    expect(api.analyze).toHaveBeenCalledWith("sample-1")
    expect(await screen.findByText("用具体售后冲突建立可信度，再提炼团长责任边界。" )).toBeVisible()
  })

  it("拆解结果优先显示节点、来源证据和不可复用事实，编辑仅在通过时提交", async () => {
    const api = fixtureApi()
    render(<AnalysisReviewDocument workspace={workspaceFixture} api={api as any} onUpdated={vi.fn()} />)

    expect(screen.getByRole("heading", { name: "Agent 拆解结论" })).toBeVisible()
    expect(screen.getByText("具体客户姓名不能复用")).toBeVisible()
    expect(screen.getAllByText("真实售后经历").length).toBeGreaterThan(0)
    await userEvent.clear(screen.getByLabelText("拆解摘要"))
    await userEvent.type(screen.getByLabelText("拆解摘要"), "人工修正后的拆解摘要，强调处理动作。")
    expect(api.saveAnalysis).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole("button", { name: "通过拆解并判断结构" }))
    expect(api.approveAnalysis).toHaveBeenCalledWith("analysis-1", expect.objectContaining({
      expectedVersion: 1,
      payload: expect.objectContaining({ summary: "人工修正后的拆解摘要，强调处理动作。" }),
    }))
  })

  it("复核完成后同步更新爆款样本首页状态", async () => {
    const api = fixtureApi()
    const candidateWorkspace = {
      ...workspaceFixture,
      sample: { ...workspaceFixture.sample, status: "candidate_ready" },
      candidates: [candidateFixture],
    }
    api.getSample.mockResolvedValueOnce(workspaceFixture).mockResolvedValueOnce(candidateWorkspace)
    api.listSamples.mockResolvedValueOnce([
      { ...workspaceFixture.sample, status: "candidate_ready" },
    ])
    render(<ContentBrainWorkspace
      initialSamples={[workspaceFixture.sample]}
      initialStructures={[]}
      canActivate
      api={api as any}
    />)

    await userEvent.click(screen.getByRole("button", { name: /一次售后让我重新理解团长.*待复核/ }))
    await userEvent.click(await screen.findByRole("button", { name: "通过拆解并判断结构" }))
    await screen.findByText("拟议结构")
    await userEvent.click(screen.getByRole("button", { name: "爆款样本" }))

    expect(screen.getByRole("button", { name: /一次售后让我重新理解团长.*待决策/ })).toBeVisible()
  })

  it("试生成成功后仍要求人工确认启用", async () => {
    const api = fixtureApi()
    render(<StructureDecisionDocument candidate={candidateFixture} canActivate api={api as any} onUpdated={vi.fn()} />)
    await userEvent.click(screen.getByRole("button", { name: "试生成" }))
    expect(await screen.findByText("这份结构如何生成口播稿")).toBeVisible()
    await userEvent.click(screen.getByRole("button", { name: "启用这个结构" }))
    expect(screen.getByRole("dialog", { name: "确认启用结构版本" })).toBeVisible()
    expect(screen.getByText("原回退点")).toBeVisible()
  })

  it("候选结构在本地编辑，明确保存后才创建新版本", async () => {
    const api = fixtureApi()
    render(<StructureDecisionDocument candidate={candidateFixture} canActivate api={api as any} onUpdated={vi.fn()} />)
    await userEvent.clear(screen.getByLabelText("开场结构指令"))
    await userEvent.type(screen.getByLabelText("开场结构指令"), "先给出可核验冲突，再说明处理动作")
    expect(api.saveCandidate).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole("button", { name: "保存结构草稿" }))
    expect(api.saveCandidate).toHaveBeenCalledWith("candidate-1", expect.objectContaining({
      expectedVersion: 1,
      payload: expect.objectContaining({ nodes: [expect.objectContaining({ instruction: "先给出可核验冲突，再说明处理动作" })] }),
    }))
  })

  it("平台运营只能提交启用审核，不能直接调用启用接口", async () => {
    const api = fixtureApi()
    render(<StructureDecisionDocument candidate={{ ...candidateFixture, preview: previewFixture }} canActivate={false} api={api as any} onUpdated={vi.fn()} />)
    await userEvent.click(screen.getByRole("button", { name: "提交启用审核" }))
    expect(screen.getByText("已提交管理员复核。结构尚未进入团长创作。" )).toBeVisible()
    expect(api.activateCandidate).not.toHaveBeenCalled()
  })

  it("人工可以说明原因后驳回结构候选", async () => {
    const api = fixtureApi()
    render(<StructureDecisionDocument candidate={candidateFixture} canActivate api={api as any} onUpdated={vi.fn()} />)
    await userEvent.click(screen.getByRole("button", { name: "驳回结构" }))
    await userEvent.type(screen.getByLabelText("结构驳回原因"), "样本过于特殊，暂不具备复用价值")
    await userEvent.click(screen.getByRole("button", { name: "确认驳回结构" }))
    expect(api.rejectCandidate).toHaveBeenCalledWith("candidate-1", {
      expectedVersion: 1, reason: "样本过于特殊，暂不具备复用价值",
    })
  })

  it("启用失败留在确认层并显示可操作的中文错误", async () => {
    const api = fixtureApi()
    api.activateCandidate.mockRejectedValueOnce(new Error("该候选版本已被更新，请刷新后重试"))
    render(<StructureDecisionDocument candidate={{ ...candidateFixture, preview: previewFixture }} canActivate api={api as any} onUpdated={vi.fn()} />)
    await userEvent.click(screen.getByRole("button", { name: "启用这个结构" }))
    await userEvent.type(screen.getByLabelText("启用原因"), "试生成结果符合质量要求")
    await userEvent.click(screen.getByRole("button", { name: "确认启用" }))
    expect(await screen.findByText("该候选版本已被更新，请刷新后重试")).toBeVisible()
    expect(screen.getByRole("dialog", { name: "确认启用结构版本" })).toBeVisible()
  })

  it("空结构库明确说明只有人工启用版本才能进入团长创作", () => {
    render(<StructureLedger structures={[]} />)
    expect(screen.getByText("还没有已启用结构")).toBeVisible()
    expect(screen.getByText("结构必须经过样本拆解、人工复核和试生成后才能进入团长创作。" )).toBeVisible()
  })
})

function fixtureApi() {
  return {
    createSample: vi.fn().mockResolvedValue({ sampleId: "sample-1", duplicate: false }),
    importSamples: vi.fn().mockResolvedValue([]),
    analyze: vi.fn().mockResolvedValue({ id: "analysis-1" }),
    getSample: vi.fn().mockResolvedValue(workspaceFixture),
    saveAnalysis: vi.fn().mockResolvedValue({}), approveAnalysis: vi.fn().mockResolvedValue({}),
    rejectAnalysis: vi.fn().mockResolvedValue({}), saveCandidate: vi.fn().mockResolvedValue({}),
    previewCandidate: vi.fn().mockResolvedValue(previewFixture), rejectCandidate: vi.fn().mockResolvedValue({}),
    activateCandidate: vi.fn().mockResolvedValue({ id: "version-1" }),
    listSamples: vi.fn().mockResolvedValue([]), listStructures: vi.fn().mockResolvedValue([]),
  }
}

const analysisPayload = {
  summary: "用具体售后冲突建立可信度，再提炼团长责任边界。",
  nodes: [
    { kind: "开场", instruction: "以售后冲突开场", required: true, evidenceRefs: ["e1"] },
    { kind: "原则", instruction: "落到可长期坚持的原则", required: true, evidenceRefs: ["e2"] },
  ],
  reusablePatterns: ["具体冲突、处理过程、责任原则"], nonReusableFacts: ["具体客户姓名不能复用"],
  applicability: { ipTags: ["团长"], audiences: ["本地经营者"], goals: ["建立信任"] },
  riskNotes: ["不得承诺收益"],
  evidenceRefs: [
    { id: "e1", quote: "真实售后经历", start: 4, end: 10 },
    { id: "e2", quote: "处理原则", start: 40, end: 44 },
  ],
  suggestedDecision: "create_new" as const,
}

const candidateFixture = {
  id: "candidate-1", version: 1, status: "draft", decision: "create_new" as const, targetTemplateId: null,
  payload: {
    decision: "create_new" as const, targetTemplateId: null, name: "真实冲突到责任原则",
    applicability: { ipTags: ["团长"], audiences: ["本地经营者"], goals: ["建立信任"] },
    nodes: [{ kind: "开场", instruction: "用可核验冲突开场", required: true }],
    qualityRules: ["必须包含具体处理动作"], riskRules: ["不得承诺收益"],
    similarities: [], differences: ["新增责任原则节点"], confidence: "medium" as const,
  },
}

const previewFixture = {
  id: "preview-1", candidateVersion: 1,
  payload: {
    topic: "一次售后如何建立长期信任",
    script: "从一次真实售后冲突讲起，说明核验、承担和处理动作，最后落到长期责任原则。",
    nodeMappings: [{ node: "真实冲突", excerpt: "一次真实售后冲突" }],
    qualityChecks: [{ rule: "必须包含具体处理动作", passed: true }],
    riskChecks: [{ rule: "不得承诺收益", passed: true }],
  },
}

const workspaceFixture = {
  sample: { id: "sample-1", title: "一次售后让我重新理解团长", status: "review_required", transcript: "真实售后经历正文", sourcePlatform: "视频号", revisionVersion: 1 },
  revisions: [],
  analyses: [{ id: "analysis-1", version: 1, status: "generated", payload: analysisPayload, model: "fixture", promptVersion: 1 }],
  candidates: [],
}
