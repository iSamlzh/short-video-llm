import JSZip from "jszip"
import { describe, expect, it } from "vitest"
import { buildScriptDocx } from "../../src/services/script-export-service"

describe("口播稿 DOCX 导出", () => {
  it("生成可打开的 DOCX，并分别写入口播正文和拍摄提示", async () => {
    const bytes = await buildScriptDocx({
      title: "没成交的时候，先别急着买更多流量",
      paragraphs: ["这是第一段口播。", "这是第二段口播。"],
      shootingTips: ["语速适中，语气真诚。", "正面机位，光线柔和。"],
    })

    const zip = await JSZip.loadAsync(bytes)
    expect(Object.keys(zip.files)).toEqual(expect.arrayContaining([
      "[Content_Types].xml",
      "_rels/.rels",
      "word/document.xml",
      "word/styles.xml",
    ]))
    const documentXml = await zip.file("word/document.xml")!.async("string")
    expect(documentXml).toContain("没成交的时候，先别急着买更多流量")
    expect(documentXml).toContain("这是第一段口播。")
    expect(documentXml).toContain("拍摄提示")
    expect(documentXml).toContain("语速适中，语气真诚。")
  })

  it("转义用户文本，避免破坏 Word XML", async () => {
    const bytes = await buildScriptDocx({
      title: "A&B <主题>",
      paragraphs: ["先讲 A&B，再讲 <边界>。"],
      shootingTips: [],
    })

    const zip = await JSZip.loadAsync(bytes)
    const documentXml = await zip.file("word/document.xml")!.async("string")
    expect(documentXml).toContain("A&amp;B &lt;主题&gt;")
    expect(documentXml).toContain("先讲 A&amp;B，再讲 &lt;边界&gt;。")
  })

  it("按段落类型分开导出口播正文与制作提示", async () => {
    const bytes = await buildScriptDocx({
      title: "结构化口播稿",
      segments: [
        { id: "spoken-1", kind: "spoken", text: "只把这句送入口播正文。" },
        { id: "shot-1", kind: "shot_instruction", text: "镜头缓慢推近。" },
        { id: "subtitle-1", kind: "subtitle_emphasis", text: "字幕强调长期信任。" },
        { id: "note-1", kind: "compliance_note", text: "不得承诺收益。" },
      ],
    })

    const zip = await JSZip.loadAsync(bytes)
    const documentXml = await zip.file("word/document.xml")!.async("string")
    expect(documentXml).toContain("口播正文")
    expect(documentXml).toContain("只把这句送入口播正文。")
    expect(documentXml).toContain("制作提示")
    expect(documentXml).toContain("镜头缓慢推近。")
    expect(documentXml).toContain("字幕强调长期信任。")
    expect(documentXml).toContain("内容备注")
    expect(documentXml).toContain("不得承诺收益。")
  })
})
