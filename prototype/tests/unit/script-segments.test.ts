import { describe, expect, it } from "vitest"
import {
  estimateSpokenDuration,
  normalizeScriptSegments,
  scriptToSegments,
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

  it("按照所选内容结构给口播自然段生成可读标题", () => {
    const segments = scriptToSegments({
      id: "script-1",
      hook: "很多团长第一步就做反了。",
      body: "我刚开始也踩过这个坑。\n\n后来我总结出三个判断方法。\n\n最后只保留适合长期做的选择。",
      callToAction: "留言说说你正在面对的问题。",
    }, [
      { kind: "contrast", instruction: "身份反差：先说反常识结论" },
      { kind: "failure", instruction: "失败经历：讲清真实代价" },
      { kind: "insight", instruction: "经验提炼：给出判断方法" },
      { kind: "value", instruction: "价值筛选：说明长期原则" },
    ])

    expect(segments.filter((item) => item.kind === "spoken").map((item) => item.heading)).toEqual([
      "身份反差",
      "失败经历",
      "经验提炼",
      "价值筛选",
      "行动引导",
    ])
  })

  it("把结构版本和稳定节点键写入口播分段血缘", () => {
    const segments = scriptToSegments({
      id: "script-lineage",
      hook: "很多人第一步就做反了。",
      body: "我用一个真实经历讲清楚原因。",
      callToAction: "留言说说你的问题。",
    }, [
      { nodeKey: "conflict-hook", kind: "hook", instruction: "冲突开场" },
      { nodeKey: "case-proof", kind: "case", instruction: "真实案例" },
      { nodeKey: "action-close", kind: "cta", instruction: "行动收束" },
    ], { sourceTemplateVersionId: "template-version-7" })

    expect(segments.filter((item) => item.kind === "spoken").map((item) => ({
      template: item.sourceTemplateVersionId,
      node: item.sourceNodeKey,
      origin: item.origin,
    }))).toEqual([
      { template: "template-version-7", node: "conflict-hook", origin: "structure_node" },
      { template: "template-version-7", node: "case-proof", origin: "structure_node" },
      { template: "template-version-7", node: "action-close", origin: "structure_node" },
    ])
  })
})
