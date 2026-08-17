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
      lockedScript: { version: 2, scriptSelectionVersion: 1, script },
      qualityReport: { scriptSelectionVersion: 1, scores: { hook: 84, ipFit: 92, credibility: 90, structure: 82, callToAction: 78 }, suggestions: [] },
    })

    expect(draft.status).toBe("locked")
    expect(draft.lockedVersion).toBe(2)
  })
})
