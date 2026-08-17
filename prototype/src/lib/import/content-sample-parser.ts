import ExcelJS from "exceljs"

const MAX_FILE_BYTES = 5 * 1024 * 1024
const ALLOWED_EXTENSIONS = new Set([".txt", ".srt", ".vtt", ".csv", ".xlsx"])

export type ParsedContentSample = {
  title: string
  transcript: string
  sourcePlatform: string
  sourceUrl?: string
  publishedAt?: string
  metrics?: Record<string, number>
}

type Input = { filename: string; mimeType: string; bytes: Buffer }

const aliases = new Map([
  ["标题", "title"], ["title", "title"],
  ["文案", "transcript"], ["字幕", "transcript"], ["正文", "transcript"], ["transcript", "transcript"],
  ["来源链接", "sourceUrl"], ["视频链接", "sourceUrl"], ["url", "sourceUrl"],
  ["平台", "sourcePlatform"], ["platform", "sourcePlatform"],
  ["发布时间", "publishedAt"], ["publishedat", "publishedAt"],
  ["播放量", "plays"], ["点赞", "likes"], ["评论", "comments"], ["收藏", "saves"], ["分享", "shares"],
])

export async function parseContentSampleFile(input: Input): Promise<ParsedContentSample[]> {
  if (input.bytes.byteLength > MAX_FILE_BYTES) throw codedError("CONTENT_SAMPLE_FILE_TOO_LARGE")
  const extension = input.filename.toLocaleLowerCase().match(/\.[^.]+$/)?.[0] ?? ""
  if (!ALLOWED_EXTENSIONS.has(extension)) throw codedError("CONTENT_SAMPLE_FILE_TYPE_UNSUPPORTED")
  if (extension === ".xlsx" && !hasZipSignature(input.bytes)) throw codedError("CONTENT_SAMPLE_FILE_TYPE_UNSUPPORTED")
  if (extension !== ".xlsx" && input.bytes.includes(0)) throw codedError("CONTENT_SAMPLE_FILE_TYPE_UNSUPPORTED")

  if (extension === ".txt" || extension === ".srt" || extension === ".vtt") {
    const raw = input.bytes.toString("utf8").replace(/^\uFEFF/, "")
    const transcript = normalizeTranscript(extension === ".txt" ? raw : stripSubtitle(raw))
    if (!transcript) throw codedError("CONTENT_SAMPLE_TRANSCRIPT_REQUIRED")
    return [{
      title: input.filename.replace(/\.[^.]+$/, ""), transcript,
      sourcePlatform: "other",
    }]
  }

  const table = extension === ".csv" ? parseCsv(input.bytes) : await parseXlsx(input.bytes)
  return parseTable(table)
}

export function normalizeTranscript(value: string) {
  return value.normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+/g, " ")
    .replace(/\s*([，。！？；：、,.!?;:])\s*/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function stripSubtitle(value: string) {
  return value.split(/\r?\n/).filter((line) => {
    const text = line.trim()
    return text && text !== "WEBVTT" && !/^\d+$/.test(text)
      && !/^\d{2}:\d{2}(?::\d{2})?[.,]\d{3}\s+-->\s+/.test(text)
  }).map((line) => line.replace(/<[^>]+>/g, "").trim()).join("\n")
}

function parseTable(table: unknown[][]): ParsedContentSample[] {
  if (!table.length) throw codedError("CONTENT_SAMPLE_HEADERS_INVALID")
  const fields = table[0].map((cell) => aliases.get(normalizeHeader(displayCell(cell))))
  if (!fields.includes("transcript")) throw codedError("CONTENT_SAMPLE_HEADERS_INVALID")
  const results: ParsedContentSample[] = []
  for (const cells of table.slice(1)) {
    if (!cells.some((cell) => displayCell(cell))) continue
    const row = Object.fromEntries(fields.flatMap((field, index) => field ? [[field, cells[index]]] : [])) as Record<string, unknown>
    const transcript = normalizeTranscript(displayCell(row.transcript))
    if (!transcript) continue
    const sourceUrl = optionalText(row.sourceUrl)
    if (sourceUrl) { try { new URL(sourceUrl) } catch { throw codedError("CONTENT_SAMPLE_URL_INVALID") } }
    const metrics = Object.fromEntries(["plays", "likes", "comments", "saves", "shares"].flatMap((field) => {
      const number = optionalCount(row[field])
      return number === undefined ? [] : [[field, number]]
    }))
    results.push({
      title: optionalText(row.title) ?? transcript.slice(0, 24),
      transcript,
      sourcePlatform: normalizePlatform(optionalText(row.sourcePlatform)),
      ...(sourceUrl ? { sourceUrl } : {}),
      ...(optionalText(row.publishedAt) ? { publishedAt: optionalText(row.publishedAt) } : {}),
      ...(Object.keys(metrics).length ? { metrics } : {}),
    })
  }
  if (!results.length) throw codedError("CONTENT_SAMPLE_ROWS_EMPTY")
  return results
}

function parseCsv(bytes: Buffer) {
  const text = bytes.toString("utf8").replace(/^\uFEFF/, "")
  const rows: string[][] = []
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

function normalizeHeader(value: string) { return value.normalize("NFKC").trim().toLocaleLowerCase().replace(/[\s_-]+/g, "") }
function optionalText(value: unknown) { return displayCell(value).trim() || undefined }
function optionalCount(value: unknown) {
  if (value === undefined || displayCell(value) === "") return undefined
  const number = Number(displayCell(value).replace(/,/g, ""))
  return Number.isSafeInteger(number) && number >= 0 ? number : undefined
}
function normalizePlatform(value?: string) {
  if (value === "视频号" || value === "wechat_channels") return "wechat_channels"
  if (value === "抖音" || value === "douyin") return "douyin"
  return value || "other"
}
function hasZipSignature(bytes: Buffer) { return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b }
function codedError(code: string) { return Object.assign(new Error(code), { code }) }
