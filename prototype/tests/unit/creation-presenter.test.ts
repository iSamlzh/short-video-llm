import { describe, expect, it } from "vitest"
import { presentCreationDraft } from "../../src/services/creation-presenter"

describe("presentCreationDraft", () => {
  it("turns the selected locked script into the result-first document contract", () => {
    const draft = presentCreationDraft({
      run: { id: "run-1" },
      topicBatch: { items: [{ id: "topic-1", title: "真实经历", ipFitEvidence: ["七年团购经历"] }] },
      topicSelection: { topicId: "topic-1" },
      lockedScript: { version: 2, script: { title: "今天这条就讲信任", hook: "先说结论。", body: "第一段。\n\n第二段。", callToAction: "留言说说你的情况。", estimatedSeconds: 75 } },
      qualityReport: { scores: { hook: 84, ipFit: 92, credibility: 90, structure: 82, callToAction: 78 }, suggestions: [] },
    })
    expect(draft.title).toBe("今天这条就讲信任")
    expect(draft.paragraphs).toEqual(["先说结论。", "第一段。", "第二段。", "留言说说你的情况。"])
    expect(draft.evidence).toContain("七年团购经历")
    expect(draft.runId).toBe("run-1")
  })
})
