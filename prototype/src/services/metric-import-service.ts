import { createHash, randomUUID } from "node:crypto"
import type Database from "better-sqlite3"
import type { TenantAccessContext } from "../domain/access"
import type { GrowthScope, MetricImportRow } from "../domain/growth-loop"
import { requireTenantCapability } from "../lib/auth/guards"
import { normalizeContentTitle, normalizeVideoUrl } from "../lib/content-identity"
import { MetricsRepository } from "../lib/db/metrics-repository"
import { parseMetricFile, type ParsedMetricFile } from "../lib/import/spreadsheet-parser"
import { PublicationMatcher } from "./publication-matcher"

type ImportInput = { contentAccountId: string; filename: string; mimeType: string; bytes: Buffer }
type Parser = (input: Pick<ImportInput, "filename" | "mimeType" | "bytes">) => Promise<ParsedMetricFile>

export class MetricImportService {
  constructor(
    private readonly database: Database.Database,
    private readonly repository = new MetricsRepository(database),
    private readonly parser: Parser = parseMetricFile,
    private readonly matcher = new PublicationMatcher(database, repository),
  ) {}

  async import(context: TenantAccessContext, input: ImportInput) {
    const scope = this.repository.accountScope(context.tenantId, input.contentAccountId)
    if (!scope) throw new Error("ACCOUNT_SCOPE_FORBIDDEN")
    requireTenantCapability(context, "metrics.import", {
      ipId: scope.ipId,
      contentAccountId: scope.contentAccountId,
    })

    const fileSha256 = createHash("sha256").update(input.bytes).digest("hex")
    const existing = this.repository.findBatchByHash(scope, fileSha256)
    if (existing) return existing

    const batchId = randomUUID()
    const now = new Date().toISOString()
    this.repository.createBatch({
      id: batchId, scope, filename: input.filename.slice(0, 255), fileSha256,
      userId: context.userId, now,
    })

    let parsed: ParsedMetricFile
    try {
      parsed = await this.parser({ filename: input.filename, mimeType: input.mimeType, bytes: input.bytes })
    } catch (error) {
      this.repository.failBatch(batchId, new Date().toISOString())
      throw error
    }

    const persist = this.database.transaction(() => {
      let inserted = 0
      let duplicates = 0
      const persistedAt = new Date().toISOString()
      for (const row of parsed.validRows) {
        const identity = buildContentIdentity(scope, row)
        const wasInserted = this.repository.insertSnapshot({
          id: randomUUID(), scope, batchId, platformContentKey: identity.key,
          normalizedVideoUrl: identity.normalizedVideoUrl, row, now: persistedAt,
        })
        if (wasInserted) inserted += 1
        else duplicates += 1
      }
      for (const error of parsed.errors) {
        this.repository.insertError({ id: randomUUID(), batchId, ...error, now: persistedAt })
      }
      return this.repository.finishBatch(batchId, {
        total: parsed.totalRows,
        inserted,
        duplicates,
        errors: parsed.errors.length,
      }, persistedAt)
    })
    persist()
    return this.matcher.matchBatch(context, batchId)
  }
}

function buildContentIdentity(scope: GrowthScope, row: MetricImportRow) {
  if (row.platformVideoId) return { key: `id:${row.platformVideoId.trim()}`, normalizedVideoUrl: row.videoUrl ? normalizeVideoUrl(row.videoUrl) : null }
  if (row.videoUrl) {
    const normalizedVideoUrl = normalizeVideoUrl(row.videoUrl)
    return { key: `url:${normalizedVideoUrl}`, normalizedVideoUrl }
  }
  const material = `${scope.platform}|${scope.contentAccountId}|${normalizeContentTitle(row.title)}|${row.publishedAt}`
  return { key: `title_time:${createHash("sha256").update(material).digest("hex")}`, normalizedVideoUrl: null }
}
