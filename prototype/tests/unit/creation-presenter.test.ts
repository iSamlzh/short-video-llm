import { describe, expect, it } from "vitest"
import { presentCreationDraft } from "../../src/services/creation-presenter"

describe("presentCreationDraft", () => {
  it("presents the selected draft before it is locked", () => {
    const draft = presentCreationDraft({
      run: { id: "run-1", state: "WAITING_LOCK_CONFIRMATION" },
      topicBatch: { items: [{ id: "topic-1", title: "真实经历", ipFitEvidence: ["七年团购经历"] }] },
      topicSelection: { topicId: "topic-1" },
      scriptBatch: { version: 1, items: [{ id: "script-1", title: "今天这条就讲信任", hook: "先说结论。", body: "第一段。\n\n第二段。", callToAction: "留言说说你的情况。", estimatedSeconds: 75 }] },
      scriptSelection: { version: 1, batchVersion: 1, scriptId: "script-1" },
      lockedScript: null,
      qualityReport: { scriptSelectionVersion: 1, scores: { hook: 84, ipFit: 92, credibility: 90, structure: 82, callToAction: 78 }, suggestions: [] },
    })
    expect(draft.title).toBe("今天这条就讲信任")
    expect(draft.paragraphs).toEqual(["先说结论。", "第一段。", "第二段。", "留言说说你的情况。"])
    expect(draft.evidence).toContain("七年团购经历")
    expect(draft.runId).toBe("run-1")
    expect(draft.revision).toBe(1)
    expect(draft.status).toBe("ready_to_confirm")
    expect(draft.lockedVersion).toBeNull()
    expect(draft.checks).toHaveLength(3)
  })

  it("does not present stale quality checks for a newer script revision", () => {
    const draft = presentCreationDraft({
      run: { id: "run-1", state: "READY_FOR_QA" },
      topicBatch: { items: [{ id: "topic-1", title: "真实经历", ipFitEvidence: ["七年团购经历"] }] },
      topicSelection: { topicId: "topic-1" },
      scriptBatch: { version: 2, items: [{ id: "script-2", title: "修改后的稿子", hook: "新的开头。", body: "这是修改之后足够长的正文内容，用来说明保存后旧质检结果不能继续展示。", callToAction: "说说你的经历。", estimatedSeconds: 70 }] },
      scriptSelection: { version: 2, batchVersion: 2, scriptId: "script-2" },
      lockedScript: null,
      qualityReport: { scriptSelectionVersion: 1, scores: { hook: 84, ipFit: 92, credibility: 90, structure: 82, callToAction: 78 }, suggestions: [] },
    })

    expect(draft.status).toBe("needs_qa")
    expect(draft.checks).toEqual([])
  })

  it("marks only the matching immutable revision as locked", () => {
    const script = { id: "script-1", title: "已经定稿", hook: "先说结论。", body: "这是一段已经通过检查且确认定稿的完整正文内容。", callToAction: "留言说说你的情况。", estimatedSeconds: 75 }
    const draft = presentCreationDraft({
      run: { id: "run-1", state: "LOCKED" },
      topicBatch: { items: [{ id: "topic-1", title: "真实经历", ipFitEvidence: ["七年团购经历"] }] },
      topicSelection: { topicId: "topic-1" },
      scriptBatch: { version: 1, items: [script] },
      scriptSelection: { version: 1, batchVersion: 1, scriptId: "script-1" },
      lockedScript: { version: 2, scriptSelectionVersion: 1, script, createdAt: "2026-08-18T06:30:00.000Z" },
      qualityReport: { scriptSelectionVersion: 1, scores: { hook: 84, ipFit: 92, credibility: 90, structure: 82, callToAction: 78 }, suggestions: [] },
    })

    expect(draft.status).toBe("locked")
    expect(draft.lockedVersion).toBe(2)
    expect(draft.finalizedAt).toBe("2026-08-18T06:30:00.000Z")
  })

  it("统一用结构化 spoken 段落计算字数和时长", () => {
    const spokenText = "字".repeat(421)
    const draft = presentCreationDraft({
      run: { id: "run-segments", state: "WAITING_LOCK_CONFIRMATION" },
      topicBatch: { items: [{ id: "topic-1", title: "真实经历", ipFitEvidence: ["七年团购经历"] }] },
      topicSelection: { topicId: "topic-1" },
      scriptBatch: { version: 1, items: [{
        id: "script-1", title: "结构化口播稿", hook: "旧开头占位。", body: "旧正文占位，但这段不能参与新的统一字数和时长计算。", callToAction: "旧结尾占位。", estimatedSeconds: 299,
        segments: [
          { id: "spoken-1", kind: "spoken", text: spokenText },
          { id: "shot-1", kind: "shot_instruction", text: "正面机位，停顿两秒。" },
        ],
      }] },
      scriptSelection: { version: 1, batchVersion: 1, scriptId: "script-1" },
      lockedScript: null,
      qualityReport: { scriptSelectionVersion: 1, scores: { hook: 84, ipFit: 92, credibility: 90, structure: 82, callToAction: 78 }, suggestions: [] },
    })

    expect(draft.wordCount).toBe("约 421 字")
    expect(draft.duration).toBe("约 106 秒")
    expect(draft.segments).toEqual([
      { id: "spoken-1", kind: "spoken", text: spokenText },
      { id: "shot-1", kind: "shot_instruction", text: "正面机位，停顿两秒。" },
    ])
  })

  it("读取旧稿时生成稳定的 spoken 兼容段落", () => {
    const draft = presentCreationDraft({
      run: { id: "legacy-run", state: "WAITING_LOCK_CONFIRMATION" },
      topicBatch: { items: [{ id: "topic-1", title: "真实经历", ipFitEvidence: ["七年团购经历"] }] },
      topicSelection: { topicId: "topic-1" },
      scriptBatch: { version: 1, items: [{ id: "legacy-script", title: "历史稿", hook: "历史开头。", body: "这是历史稿中仍需正常显示的完整正文内容。", callToAction: "历史结尾。", estimatedSeconds: 60 }] },
      scriptSelection: { version: 1, batchVersion: 1, scriptId: "legacy-script" },
      lockedScript: null,
      qualityReport: { scriptSelectionVersion: 1, scores: { hook: 84, ipFit: 92, credibility: 90, structure: 82, callToAction: 78 }, suggestions: [] },
    })

    expect(draft.segments.slice(0, 3)).toEqual([
      { id: "legacy-script-spoken-1", kind: "spoken", text: "历史开头。" },
      { id: "legacy-script-spoken-2", kind: "spoken", text: "这是历史稿中仍需正常显示的完整正文内容。" },
      { id: "legacy-script-spoken-3", kind: "spoken", text: "历史结尾。" },
    ])
  })
})
