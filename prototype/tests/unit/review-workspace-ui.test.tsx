import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { ImportOutcome } from "../../src/components/review/ImportOutcome"
import { ReviewBriefView } from "../../src/components/review/ReviewBriefView"
import { ReviewWorkspace } from "../../src/components/review/ReviewWorkspace"

const review = {
  id: "review-1", version: 1, sampleTier: "memory_eligible", sampleCount: 5,
  canConfirm: true, status: "generated", evidenceLimits: "只表达当前账号内相关性，不能证明平台分发因果。",
  payload: {
    headline: "真实人物与具体场景值得继续验证",
    observations: [{ text: "五条样本都来自真实导入，其中三条播放高于账号中位数。", evidenceSnapshotIds: ["s-1"] }],
    hypotheses: [{ text: "具体人物可能帮助用户更快进入情境。", confidence: "low", evidenceFor: ["s-1"], evidenceAgainst: ["s-2"] }],
    keep: ["真实人物与具体场景"], avoid: ["空泛说教"],
    nextContentSignals: ["更快进入具体冲突"], evidenceLimits: "只表达当前账号内相关性，不能证明平台分发因果。",
    structureEvidence: [
      {
        segment: "hook", label: "钩子", status: "supported",
        metrics: [{ label: "3秒留存率", value: 0.68, format: "rate", evidenceSnapshotIds: ["s-1"] }],
        missingFields: [], interpretation: "开头留存有真实数据支持。",
        nextAction: "下一条以《真实人物》稿件 v3 的3秒留存率 68.0% 为基线继续验证。",
      },
      {
        segment: "body", label: "主体", status: "partial",
        metrics: [{ label: "完播率", value: 0.35, format: "rate", evidenceSnapshotIds: ["s-1"] }],
        missingFields: ["平均观看时长"], interpretation: "只能判断整体看完比例，不能定位主体掉点。",
        nextAction: "补采平均观看时长后再判断主体节奏。",
      },
      { segment: "ending", label: "结尾", status: "missing", metrics: [], missingFields: ["收藏", "分享"], interpretation: "缺少结尾行为证据。", nextAction: "补采收藏和分享。" },
      { segment: "conversion", label: "转化", status: "missing", metrics: [], missingFields: ["主页访问", "新增关注", "咨询"], interpretation: "缺少转化证据。", nextAction: "补采转化指标。" },
    ],
  },
}

const mixedImportResult = {
  batchId: "batch-1", status: "review_ready", total: 8, inserted: 7, duplicates: 0,
  errors: [{ rowNumber: 8, errorCode: "PLAYS_INVALID", message: "播放量格式不正确", redactedReference: "第 8 行 · 错误内容" }],
  candidates: 2, unmatched: 1,
  matches: [
    candidate("m-1", "楼道里的邻里约定", "p-1"),
    candidate("m-2", "小区里的暖心接力", "p-2"),
    { id: "m-3", version: 1, status: "matched", snapshot: { title: "已精确关联" }, candidates: [] },
    { id: "m-4", version: 1, status: "matched", snapshot: { title: "已精确关联 2" }, candidates: [] },
    { id: "m-5", version: 1, status: "matched", snapshot: { title: "已精确关联 3" }, candidates: [] },
    { id: "m-6", version: 1, status: "unmatched", snapshot: { title: "历史外部内容" }, candidates: [] },
  ],
}

describe("结果优先的真实复盘工作区", () => {
  it("先总结成功结果，只展开需要处理的候选", () => {
    render(<ImportOutcome result={mixedImportResult as any} />)
    expect(screen.getByRole("heading", { name: "已处理 8 条，3 条已关联" })).toBeVisible()
    expect(screen.getAllByRole("button", { name: /确认关联/ })).toHaveLength(2)
    expect(screen.queryByText("批次管理")).not.toBeInTheDocument()
  })

  it("即使仍有候选行，也会自动继续生成可用复盘", async () => {
    const api = {
      getCurrentReview: vi.fn().mockResolvedValue(null),
      getBatch: vi.fn().mockResolvedValue(mixedImportResult),
      importMetrics: vi.fn().mockResolvedValue({ batchId: "batch-1" }),
      generateReview: vi.fn().mockResolvedValue(review),
      confirmMatch: vi.fn(), createExternal: vi.fn(), confirmMemory: vi.fn(),
    }
    render(<ReviewWorkspace contentAccountId="account-1" api={api as any} />)
    const file = new File(["binary"], "metrics.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
    await userEvent.upload(screen.getByLabelText("导入真实平台数据"), file)

    expect(api.generateReview).toHaveBeenCalledOnce()
    expect(await screen.findByText("能确定什么")).toBeVisible()
  })

  it.each([
    ["facts_only", 2, "当前只有 2 条可关联视频，只展示事实"],
    ["tentative", 4, "样本较少，暂不能形成长期记忆"],
  ])("%s 层级不显示记忆确认", (sampleTier, sampleCount, message) => {
    render(<ReviewBriefView brief={{ ...review, sampleTier, sampleCount, canConfirm: false }} />)
    expect(screen.getByText(message)).toBeVisible()
    expect(screen.queryByRole("button", { name: "确认并用于后续创作" })).not.toBeInTheDocument()
  })

  it("记忆字段可编辑，但证据边界只读", () => {
    render(<ReviewBriefView brief={review} />)
    expect(screen.getByLabelText("继续保留")).toBeVisible()
    expect(screen.getByLabelText("尽量避免")).toBeVisible()
    expect(screen.getByLabelText("下一轮信号")).toBeVisible()
    expect(screen.getAllByText(review.evidenceLimits).length).toBeGreaterThan(0)
    expect(screen.getByRole("button", { name: "确认并用于后续创作" })).toBeVisible()
  })

  it("把真实指标按钩子、主体、结尾和转化展示，并明确数据缺口", () => {
    render(<ReviewBriefView brief={review} />)

    expect(screen.getByRole("heading", { name: "指标如何落到内容结构" })).toBeVisible()
    for (const label of ["钩子", "主体", "结尾", "转化"]) {
      expect(screen.getByRole("heading", { name: label })).toBeVisible()
    }
    expect(screen.getByText("3秒留存率 68.0%")).toBeVisible()
    expect(screen.getByText(/缺少：平均观看时长/)).toBeVisible()
    expect(screen.getByText(/稿件 v3/)).toBeVisible()
  })

  it("支持一次确认每条记录唯一的高置信候选", async () => {
    const confirmHighConfidence = vi.fn().mockResolvedValue(undefined)
    render(<ImportOutcome result={mixedImportResult as any} onConfirmHighConfidence={confirmHighConfidence} />)

    expect(screen.getAllByText("高置信度")).toHaveLength(2)
    expect(screen.getAllByText(/同一内容账号/).length).toBeGreaterThan(0)
    await userEvent.click(screen.getByRole("button", { name: "批量确认 2 条高置信候选" }))

    expect(confirmHighConfidence).toHaveBeenCalledWith([
      { matchId: "m-1", publicationId: "p-1", version: 1 },
      { matchId: "m-2", publicationId: "p-2", version: 1 },
    ])
  })
})

function candidate(id: string, title: string, publicationId: string) {
  return {
    id, version: 1, status: "candidate", explanation: "标题与发布时间接近，需要人工确认",
    snapshot: { title, publishedAt: "2026-08-10T08:00:00Z" },
    candidates: [{
      id: publicationId, title: `${title}（已发布）`, publishedAt: "2026-08-10T09:00:00Z",
      explanation: "同一内容账号 · 发布时间相差 1 小时", confidence: "high",
      reasons: ["同一内容账号", "发布时间相差 1 小时", "标题相似度 94%"],
    }],
  }
}
