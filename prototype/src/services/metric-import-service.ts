import { createHash, randomUUID } from "node:crypto"
import type Database from "better-sqlite3"
import type { TenantAccessContext } from "../domain/access"
import type { GrowthScope, MetricImportRow } from "../domain/growth-loop"
import { requireTenantCapability } from "../lib/auth/guards"
import { normalizeContentTitle, normalizeVideoUrl } from "../lib/content-identity"
import { MetricsRepository } from "../lib/db/metrics-repository"
import { PublicationRepository } from "../lib/db/publication-repository"
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

  getResult(context: TenantAccessContext, batchId: string) {
    const { scope } = this.repository.requireBatchScope(batchId, context.tenantId)
    requireTenantCapability(context, "metrics.import", {
      ipId: scope.ipId,
      contentAccountId: scope.contentAccountId,
    })
    const batch = this.repository.requireBatch(batchId)
    const snapshots = new Map(this.repository.listSnapshotModels(batchId).map((item) => [item.id, item]))
    const publications = new Map(new PublicationRepository(this.database).listActiveByScope(scope).map((item) => [item.id, item]))
    const matches = this.repository.listCurrentMatches(batchId).map((match) => {
      const snapshot = snapshots.get(match.snapshotId)
      return {
        ...match,
        snapshot: snapshot ? {
          id: snapshot.id,
          title: snapshot.title,
          publishedAt: snapshot.publishedAt,
          capturedAt: snapshot.capturedAt,
        } : null,
        candidates: match.candidateIds.flatMap((id) => {
          const publication = publications.get(id)
          return publication ? [{
            id: publication.id,
            title: publication.title,
            publishedAt: publication.publishedAt,
            explanation: candidateExplanation(snapshot?.publishedAt ?? null, publication.publishedAt),
          }] : []
        }),
      }
    })
    return {
      ...batch,
      matched: matches.filter((item) => item.status === "matched").length,
      candidates: matches.filter((item) => item.status === "candidate").length,
      unmatched: matches.filter((item) => item.status === "unmatched").length,
      errorCount: batch.errors,
      errors: this.repository.listErrors(batchId),
      matches,
    }
  }
}

function candidateExplanation(snapshotTime: string | null, publicationTime: string) {
  if (!snapshotTime) return "同一账号下的确定性候选"
  const hours = Math.round(Math.abs(Date.parse(snapshotTime) - Date.parse(publicationTime)) / 3_600_000)
  return `同一账号 · 发布时间相差约 ${hours} 小时`
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
