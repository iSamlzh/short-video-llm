import ExcelJS from "exceljs"
import { describe, expect, it } from "vitest"
import { parseContentSampleFile } from "../../src/lib/import/content-sample-parser"

describe("content sample parser", () => {
  it.each([
    ["sample.txt", "这是一次真实经历。客户提出售后问题，我先核验事实，再承担责任并给出处理结果。"],
    ["sample.srt", "1\n00:00:00,000 --> 00:00:02,000\n这是一次真实经历\n\n2\n00:00:02,000 --> 00:00:05,000\n客户提出售后问题，我先核验事实，再承担责任并给出处理结果。"],
    ["sample.vtt", "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\n这是一次真实经历\n\n00:00:02.000 --> 00:00:05.000\n客户提出售后问题，我先核验事实，再承担责任并给出处理结果。"],
  ])("解析 %s 并移除字幕时间轴", async (filename, text) => {
    const parsed = await parseContentSampleFile({
      filename,
      mimeType: "text/plain",
      bytes: Buffer.from(text),
    })

    expect(parsed).toHaveLength(1)
    expect(parsed[0].transcript).toContain("真实经历")
    expect(parsed[0].transcript).not.toMatch(/00:00:/)
  })

  it("解析中文 CSV 为多条样本", async () => {
    const parsed = await parseContentSampleFile({
      filename: "样本.csv",
      mimeType: "text/csv",
      bytes: Buffer.from("标题,文案,来源链接,平台\n售后经历,这是一次具体的售后经历，我先核验问题，再承担责任并给出解决结果。,https://example.test/1,视频号\n选品原则,面对不熟悉的商品，我不会急着推荐，而是先验证品质、售后和真实需求。,https://example.test/2,抖音"),
    })

    expect(parsed.map((item) => item.title)).toEqual(["售后经历", "选品原则"])
    expect(parsed[1]).toMatchObject({ sourcePlatform: "douyin", sourceUrl: "https://example.test/2" })
  })

  it("解析中文 XLSX 并保留指标", async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet("爆款样本")
    sheet.addRow(["标题", "文案", "平台", "播放量", "点赞"])
    sheet.addRow(["真实经历", "这是一次完整的真实经历，我讲清问题、判断、处理过程以及最后坚持的原则。", "视频号", 12000, 680])
    const bytes = Buffer.from(await workbook.xlsx.writeBuffer())

    const parsed = await parseContentSampleFile({
      filename: "样本.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      bytes,
    })

    expect(parsed[0]).toMatchObject({ title: "真实经历", metrics: { plays: 12000, likes: 680 } })
  })

  it("拒绝不支持格式和超过 5MB 的文件", async () => {
    await expect(parseContentSampleFile({
      filename: "sample.pdf", mimeType: "application/pdf", bytes: Buffer.from("content"),
    })).rejects.toThrow("CONTENT_SAMPLE_FILE_TYPE_UNSUPPORTED")
    await expect(parseContentSampleFile({
      filename: "sample.txt", mimeType: "text/plain", bytes: Buffer.alloc(5 * 1024 * 1024 + 1),
    })).rejects.toThrow("CONTENT_SAMPLE_FILE_TOO_LARGE")
  })
})
