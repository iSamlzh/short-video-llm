import { describe, expect, it } from "vitest"
import {
  estimateSpokenDuration,
  normalizeScriptSegments,
  spokenSegmentText,
} from "../../src/domain/creation-contracts"

describe("结构化口播段落", () => {
  it("只用 spoken 段落计算字数和时长", () => {
    const result = estimateSpokenDuration([
      { id: "spoken-1", kind: "spoken", text: "字".repeat(421) },
      { id: "shot-1", kind: "shot_instruction", text: "正面机位，停顿两秒。" },
      { id: "subtitle-1", kind: "subtitle_emphasis", text: "这里需要大字强调。" },
      { id: "note-1", kind: "compliance_note", text: "不要承诺收益。" },
    ])

    expect(result).toEqual({ spokenCharacters: 421, estimatedSeconds: 106 })
  })

  it("把没有结构信息的历史段落稳定迁移为 spoken", () => {
    expect(normalizeScriptSegments({ paragraphs: ["旧稿第一段", "旧稿第二段"] })).toEqual([
      { id: "legacy-1", kind: "spoken", text: "旧稿第一段" },
      { id: "legacy-2", kind: "spoken", text: "旧稿第二段" },
    ])
  })

  it("复制与数字人音频输入只包含 spoken 文本", () => {
    expect(spokenSegmentText([
      { id: "spoken-1", kind: "spoken", text: "第一段口播" },
      { id: "shot-1", kind: "shot_instruction", text: "镜头推近" },
      { id: "spoken-2", kind: "spoken", text: "第二段口播" },
    ])).toBe("第一段口播\n\n第二段口播")
  })
})
