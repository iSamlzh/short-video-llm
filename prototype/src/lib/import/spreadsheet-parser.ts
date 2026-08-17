import ExcelJS from "exceljs"
import type { MetricImportRow } from "../../domain/growth-loop"
import { metricImportRowSchema } from "../../domain/growth-loop-schemas"

const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_DATA_ROWS = 10_000
const CSV_MIME_TYPES = new Set(["", "text/csv", "application/csv", "application/vnd.ms-excel", "application/octet-stream"])
const XLSX_MIME_TYPES = new Set([
  "",
  "application/octet-stream",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
])

type Input = { filename: string; mimeType: string; bytes: Buffer }
type ParseError = { rowNumber: number; code: string; message: string; redactedReference: string }
export type ParsedMetricFile = { validRows: MetricImportRow[]; errors: ParseError[]; totalRows: number }

type Field = keyof Omit<MetricImportRow, "rowNumber" | "isSimulated">

const aliases: Record<string, Field> = Object.fromEntries([
  [["platform_video_id", "平台作品id", "作品id", "视频id"], "platformVideoId"],
  [["video_url", "视频链接", "作品链接", "url"], "videoUrl"],
  [["title", "标题", "视频标题", "作品标题"], "title"],
  [["published_at", "发布时间", "发布日期"], "publishedAt"],
  [["captured_at", "采集时间", "导出时间", "统计时间"], "capturedAt"],
  [["impressions", "曝光量", "展示量"], "impressions"],
  [["plays", "播放量", "播放"], "plays"],
  [["completions", "完播量", "播放完成量"], "completions"],
  [["completion_rate", "完播率", "播放完成率"], "completionRate"],
  [["likes", "点赞", "点赞量"], "likes"],
  [["comments", "评论", "评论量"], "comments"],
  [["saves", "收藏", "收藏量"], "saves"],
  [["shares", "转发", "分享量"], "shares"],
  [["inquiries", "咨询", "线索量"], "inquiries"],
  [["negative_feedback", "负反馈", "不感兴趣"], "negativeFeedback"],
].flatMap(([names, field]) => (names as string[]).map((name) => [normalizeHeader(name), field as Field])))

const countFields = [
  "impressions", "plays", "completions", "likes", "comments", "saves", "shares", "inquiries", "negativeFeedback",
] as const

export async function parseMetricFile(input: Input): Promise<ParsedMetricFile> {
  if (input.bytes.byteLength > MAX_FILE_BYTES) throw codedError("FILE_TOO_LARGE")
  const extension = input.filename.toLocaleLowerCase().match(/\.[^.]+$/)?.[0]
  if (extension !== ".csv" && extension !== ".xlsx") throw codedError("FILE_TYPE_UNSUPPORTED")
  const mimeType = input.mimeType.trim().toLocaleLowerCase()
  if (extension === ".csv" && (!CSV_MIME_TYPES.has(mimeType) || input.bytes.includes(0))) {
    throw codedError("FILE_TYPE_UNSUPPORTED")
  }
  if (extension === ".xlsx" && (!XLSX_MIME_TYPES.has(mimeType) || !hasZipSignature(input.bytes))) {
    throw codedError("FILE_TYPE_UNSUPPORTED")
  }

  const table = extension === ".csv" ? parseCsv(input.bytes) : await parseXlsx(input.bytes)
  if (!table.length || !table[0].some((cell) => displayCell(cell))) throw codedError("METRIC_HEADERS_INVALID")
  const dataRows = table.slice(1).filter((row) => row.some((cell) => displayCell(cell)))
  if (dataRows.length > MAX_DATA_ROWS) throw codedError("ROW_LIMIT_EXCEEDED")
  const fields = table[0].map((cell) => aliases[normalizeHeader(displayCell(cell))])
  if (!fields.includes("title")) throw codedError("METRIC_HEADERS_INVALID")

  const validRows: MetricImportRow[] = []
  const errors: ParseError[] = []
  const defaultCapturedAt = new Date().toISOString()
  dataRows.forEach((cells, index) => {
    const rowNumber = index + 2
    const raw = Object.fromEntries(fields.flatMap((field, cellIndex) => field ? [[field, cells[cellIndex]]] : [])) as Record<Field, unknown>
    const parsed = parseRow(rowNumber, raw, defaultCapturedAt)
    if ("error" in parsed) errors.push(parsed.error)
    else validRows.push(parsed.row)
  })
  return { validRows, errors, totalRows: dataRows.length }
}

function parseRow(rowNumber: number, raw: Record<Field, unknown>, defaultCapturedAt: string): { row: MetricImportRow } | { error: ParseError } {
  const title = displayCell(raw.title).trim()
  if (!title) return rowError(rowNumber, "TITLE_REQUIRED", "标题不能为空", title)
  const platformVideoId = optionalText(raw.platformVideoId)
  const videoUrl = optionalText(raw.videoUrl)
  if (videoUrl) {
    try { new URL(videoUrl) } catch { return rowError(rowNumber, "VIDEO_URL_INVALID", "视频链接格式不正确", title) }
  }
  const publishedAt = raw.publishedAt === undefined || !displayCell(raw.publishedAt)
    ? undefined : parseDate(raw.publishedAt)
  if (raw.publishedAt !== undefined && displayCell(raw.publishedAt) && !publishedAt) {
    return rowError(rowNumber, "PUBLISHED_AT_INVALID", "发布时间格式不正确", title)
  }
  if (!platformVideoId && !videoUrl && !publishedAt) {
    return rowError(rowNumber, "METRIC_IDENTITY_REQUIRED", "需要作品 ID、视频链接或标题与发布时间", title)
  }
  const capturedAt = raw.capturedAt === undefined || !displayCell(raw.capturedAt)
    ? defaultCapturedAt : parseDate(raw.capturedAt)
  if (!capturedAt) return rowError(rowNumber, "CAPTURED_AT_INVALID", "采集时间格式不正确", title)

  const counts: Partial<Record<(typeof countFields)[number], number>> = {}
  for (const field of countFields) {
    const value = raw[field]
    if (value === undefined || displayCell(value) === "") continue
    const number = parseCount(value)
    if (number === null) return rowError(rowNumber, `${camelToConstant(field)}_INVALID`, `${field} 必须为非负整数`, title)
    counts[field] = number
  }
  let completionRate: number | undefined
  if (raw.completionRate !== undefined && displayCell(raw.completionRate) !== "") {
    completionRate = parseRate(raw.completionRate) ?? undefined
    if (completionRate === undefined) return rowError(rowNumber, "COMPLETION_RATE_INVALID", "完播率必须在 0 到 1 之间", title)
  }

  const candidate = {
    rowNumber, platformVideoId, videoUrl, title, publishedAt, capturedAt,
    ...counts, completionRate, isSimulated: false as const,
  }
  const result = metricImportRowSchema.safeParse(candidate)
  if (!result.success) return rowError(rowNumber, "METRIC_ROW_INVALID", "指标行格式不正确", title)
  return { row: result.data }
}

function parseCsv(bytes: Buffer) {
  const text = bytes.toString("utf8").replace(/^\uFEFF/, "")
  const rows: unknown[][] = []
  let row: string[] = []
  let value = ""
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (character === '"' && quoted && text[index + 1] === '"') { value += '"'; index += 1 }
    else if (character === '"') quoted = !quoted
    else if (character === "," && !quoted) { row.push(value); value = "" }
    else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1
      row.push(value); rows.push(row); row = []; value = ""
    } else value += character
  }
  if (value || row.length) { row.push(value); rows.push(row) }
  return rows
}

async function parseXlsx(bytes: Buffer) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(bytes as never)
  const worksheet = workbook.worksheets[0]
  if (!worksheet) return []
  const rows: unknown[][] = []
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    rows.push(Array.from({ length: row.cellCount }, (_, index) => row.getCell(index + 1).value))
  })
  return rows
}

function displayCell(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (value instanceof Date) return value.toISOString()
  if (typeof value === "object") {
    const rich = value as { text?: unknown; result?: unknown; richText?: Array<{ text?: string }> }
    if (rich.text !== undefined) return String(rich.text)
    if (rich.result !== undefined) return displayCell(rich.result)
    if (rich.richText) return rich.richText.map((item) => item.text ?? "").join("")
  }
  return String(value).trim()
}

function parseDate(value: unknown) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString()
  const text = displayCell(value)
  const local = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/)
  const normalized = local
    ? `${local[1]}-${local[2]}-${local[3]}T${local[4] ?? "00"}:${local[5] ?? "00"}:${local[6] ?? "00"}+08:00`
    : text
  const time = Date.parse(normalized)
  return Number.isFinite(time) ? new Date(time).toISOString() : null
}

function parseCount(value: unknown) {
  if (typeof value === "number") return Number.isInteger(value) && value >= 0 ? value : null
  const normalized = displayCell(value).replace(/,/g, "")
  if (!/^\d+$/.test(normalized)) return null
  const number = Number(normalized)
  return Number.isSafeInteger(number) ? number : null
}

function parseRate(value: unknown) {
  if (typeof value === "number") return value >= 0 && value <= 1 ? value : null
  const text = displayCell(value)
  const percent = text.endsWith("%")
  const number = Number(percent ? text.slice(0, -1) : text)
  const normalized = percent ? number / 100 : number
  return Number.isFinite(normalized) && normalized >= 0 && normalized <= 1 ? normalized : null
}

function optionalText(value: unknown) { return displayCell(value).trim() || undefined }
function normalizeHeader(value: string) { return value.normalize("NFKC").trim().toLocaleLowerCase().replace(/[\s_-]+/g, "") }
function hasZipSignature(bytes: Buffer) { return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b }
function camelToConstant(value: string) { return value.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase() }
function codedError(code: string) { return Object.assign(new Error(code), { code }) }
function rowError(rowNumber: number, code: string, message: string, title: string): { error: ParseError } {
  const safeTitle = title ? title.slice(0, 24) : "未提供标题"
  return { error: { rowNumber, code, message, redactedReference: `第 ${rowNumber} 行 · ${safeTitle}` } }
}
