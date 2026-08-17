import ExcelJS from "exceljs"
import { describe, expect, it } from "vitest"
import { parseMetricFile } from "../../src/lib/import/spreadsheet-parser"

const xlsxMime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

describe("parseMetricFile", () => {
  it("归一化中文 CSV 表头、百分比和北京时间", async () => {
    const result = await parseMetricFile({
      filename: "视频号.csv",
      mimeType: "text/csv",
      bytes: Buffer.from(
        "作品ID,标题,发布时间,采集时间,播放量,完播率\nwx-1,邻里约定,2026-08-10 10:00,2026-08-17 10:00,1200,35%",
      ),
    })

    expect(result.totalRows).toBe(1)
    expect(result.errors).toEqual([])
    expect(result.validRows[0]).toMatchObject({
      rowNumber: 2,
      platformVideoId: "wx-1",
      title: "邻里约定",
      publishedAt: "2026-08-10T02:00:00.000Z",
      capturedAt: "2026-08-17T02:00:00.000Z",
      plays: 1200,
      completionRate: 0.35,
      isSimulated: false,
    })
  })

  it("接受 XLSX 有效行，并按原行号报告负数指标", async () => {
    const bytes = await makeWorkbookBuffer([
      ["视频链接", "标题", "发布时间", "播放量"],
      ["https://example.test/v/1", "真实经历", "2026-08-10T08:00:00+08:00", 300],
      ["https://example.test/v/2", "错误行", "2026-08-10T08:00:00+08:00", -1],
    ])
    const result = await parseMetricFile({ filename: "metrics.xlsx", mimeType: xlsxMime, bytes })

    expect(result.validRows).toHaveLength(1)
    expect(result.validRows[0]).toMatchObject({
      videoUrl: "https://example.test/v/1",
      title: "真实经历",
      plays: 300,
      isSimulated: false,
    })
    expect(result.errors).toEqual([
      expect.objectContaining({ rowNumber: 3, code: "PLAYS_INVALID" }),
    ])
  })

  it("拒绝超限字节、不支持的类型和超过 10,000 行的数据", async () => {
    await expect(parseMetricFile({
      filename: "metrics.csv",
      mimeType: "text/csv",
      bytes: Buffer.alloc(10 * 1024 * 1024 + 1),
    })).rejects.toThrow("FILE_TOO_LARGE")

    await expect(parseMetricFile({
      filename: "metrics.txt",
      mimeType: "text/plain",
      bytes: Buffer.from("标题,播放量\n测试,1"),
    })).rejects.toThrow("FILE_TYPE_UNSUPPORTED")

    const rows = Array.from({ length: 10_001 }, (_, index) => `id-${index},标题${index},2026-08-17T08:00:00Z`)
    await expect(parseMetricFile({
      filename: "metrics.csv",
      mimeType: "text/csv",
      bytes: Buffer.from(`作品ID,标题,采集时间\n${rows.join("\n")}`),
    })).rejects.toThrow("ROW_LIMIT_EXCEEDED")
  })

  it("要求标题和可用身份，并对错误引用脱敏", async () => {
    const result = await parseMetricFile({
      filename: "metrics.csv",
      mimeType: "text/csv",
      bytes: Buffer.from(
        "作品ID,标题,发布时间,采集时间,播放量\nsecret-video-id,,2026-08-10T08:00:00Z,2026-08-17T08:00:00Z,10\n,只有标题,,2026-08-17T08:00:00Z,20",
      ),
    })

    expect(result.validRows).toEqual([])
    expect(result.errors.map((item) => item.code)).toEqual(["TITLE_REQUIRED", "METRIC_IDENTITY_REQUIRED"])
    expect(result.errors[0].redactedReference).not.toContain("secret-video-id")
  })
})

async function makeWorkbookBuffer(rows: unknown[][]) {
  const workbook = new ExcelJS.Workbook()
  workbook.addWorksheet("数据").addRows(rows)
  return Buffer.from(await workbook.xlsx.writeBuffer())
}
