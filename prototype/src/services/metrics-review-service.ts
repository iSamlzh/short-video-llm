import { createHash, randomUUID } from "node:crypto"
import type Database from "better-sqlite3"

type MetricScope = { tenantId: string; ipId: string; accountId: string; dataOrigin: "demo" | "formal" }
type MetricRow = {
  content_title: string
  plays: number
  completion_rate: number
  likes: number
  comments: number
  shares: number
  negative_feedback: number
  data_origin: "demo" | "formal"
}

function parseLine(line: string) {
  const fields: string[] = []
  let current = ""
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (character === '"' && line[index + 1] === '"') { current += '"'; index += 1 }
    else if (character === '"') quoted = !quoted
    else if (character === "," && !quoted) { fields.push(current.trim()); current = "" }
    else current += character
  }
  fields.push(current.trim())
  return fields
}

export class MetricsReviewService {
  constructor(private readonly database: Database.Database) {}

  importCsv(scope: MetricScope, csv: string) {
    const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean)
    if (lines.length < 2) throw new Error("CSV_EMPTY")
    const headers = parseLine(lines[0]).map((item) => item.toLowerCase())
    const required = ["title", "plays", "completion_rate", "likes", "comments", "shares", "negative_feedback"]
    if (required.some((header) => !headers.includes(header))) throw new Error("CSV_HEADERS_INVALID")
    let inserted = 0
    let duplicates = 0
    const errors: Array<{ row: number; message: string }> = []
    const statement = this.database.prepare(`INSERT OR IGNORE INTO imported_content_metrics
      (id,tenant_id,ip_profile_id,content_account_id,content_title,published_at,plays,completion_rate,likes,comments,shares,negative_feedback,source_hash,data_origin,created_at)
      VALUES (?,?,?,?,?,NULL,?,?,?,?,?,?,?,?,?)`)
    lines.slice(1).forEach((line, index) => {
      const values = parseLine(line)
      const item = Object.fromEntries(headers.map((header, headerIndex) => [header, values[headerIndex] ?? ""]))
      const numbers = required.slice(1).map((header) => Number(item[header]))
      if (!item.title || numbers.some((value) => !Number.isFinite(value) || value < 0) || numbers[1] > 1) {
        errors.push({ row: index + 2, message: "标题或指标格式不正确" })
        return
      }
      const hash = createHash("sha256").update(`${item.title}|${numbers.join("|")}`).digest("hex")
      const result = statement.run(randomUUID(), scope.tenantId, scope.ipId, scope.accountId, item.title, ...numbers, hash, scope.dataOrigin, new Date().toISOString())
      if (result.changes) inserted += 1
      else duplicates += 1
    })
    return { inserted, duplicates, errors }
  }

  buildBrief(scope: Omit<MetricScope, "dataOrigin"> & { dataOrigin?: "demo" | "formal" }) {
    const rows = this.database.prepare(`SELECT * FROM imported_content_metrics
      WHERE tenant_id = ? AND ip_profile_id = ? AND content_account_id = ?
      ORDER BY created_at DESC LIMIT 100`).all(scope.tenantId, scope.ipId, scope.accountId) as MetricRow[]
    if (!rows.length) throw new Error("NO_IMPORTED_METRICS")
    const averagePlays = rows.reduce((sum, row) => sum + row.plays, 0) / rows.length
    const ranked = [...rows].sort((a, b) => (b.plays * b.completion_rate + b.comments * 20 + b.shares * 30 - b.negative_feedback * 50) - (a.plays * a.completion_rate + a.comments * 20 + a.shares * 30 - a.negative_feedback * 50))
    const top = ranked[0]
    const weak = ranked.at(-1)!
    const evidence = [top, ...(weak === top ? [] : [weak])].map((row, index) => ({
      title: row.content_title,
      finding: index === 0 ? "在当前导入样本中，触达与深度互动的组合表现最好。" : "在当前导入样本中，触达与互动组合偏弱，需要谨慎归因。",
      metrics: [
        `播放：${row.plays.toLocaleString("zh-CN")}（真实导入）`,
        `完播率：${(row.completion_rate * 100).toFixed(1)}%（真实导入）`,
        `评论 / 转发：${row.comments} / ${row.shares}`,
      ],
    }))
    const isDemo = rows.every((row) => row.data_origin === "demo")
    return {
      lead: `当前账号最值得保留的是：“${top.content_title}”里的具体场景`,
      sampleCount: rows.length,
      dataOriginLabel: isDemo ? "开发演示数据" : "真实导入数据",
      summary: `基于当前导入的 ${rows.length} 条内容，具体人物、场景与经验判断更容易同时获得播放和深度互动。当前平均播放约 ${Math.round(averagePlays).toLocaleString("zh-CN")}，建议保留真实经验主线。`,
      evidence,
      uncertain: "现有数据只能说明内容表现之间的相关性，无法单独证明选题、发布时间或平台分发造成了结果。",
      next: ["延续表现较好内容中的具体人物与真实场景。", "开头更快交代冲突，正文保留可验证的行动细节。", "连续发布 3 条同类内容后再比较，避免单条样本误判。"],
      evidenceLimits: "结论来自已导入账号数据，只表达相关性，不声称平台因果。",
    }
  }
}
