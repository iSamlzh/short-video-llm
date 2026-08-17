import type Database from "better-sqlite3"
import type {
  GrowthScope, MatchMethod, MatchStatus, MetricImportResult, MetricImportRow, PublicationMatch,
} from "../../domain/growth-loop"

type BatchRow = {
  id: string
  status: MetricImportResult["status"]
  total_rows: number
  inserted_rows: number
  duplicate_rows: number
  error_rows: number
  candidate_rows: number
  unmatched_rows: number
}

type SnapshotRow = {
  id: string
  tenant_id: string
  ip_profile_id: string
  content_account_id: string
  platform: string
  platform_content_key: string
  platform_video_id: string | null
  video_url: string | null
  normalized_video_url: string | null
  title: string
  published_at: string | null
  captured_at: string
  impressions: number | null
  plays: number | null
  completions: number | null
  completion_rate: number | null
  likes: number | null
  comments: number | null
  saves: number | null
  shares: number | null
  inquiries: number | null
  negative_feedback: number | null
  is_simulated: number
  source_batch_id: string
  source_row_number: number
  created_at: string
}

export type MetricSnapshot = GrowthScope & {
  id: string
  platformContentKey: string
  platformVideoId: string | null
  videoUrl: string | null
  normalizedVideoUrl: string | null
  title: string
  publishedAt: string | null
  capturedAt: string
  sourceBatchId: string
  sourceRowNumber: number
}

type MatchRow = {
  id: string
  tenant_id: string
  ip_profile_id: string
  content_account_id: string
  platform: string
  snapshot_id: string
  publication_id: string | null
  candidate_ids_json: string
  method: MatchMethod
  status: MatchStatus
  explanation: string
  version: number
  is_current: number
}

export class MetricsRepository {
  constructor(private readonly database: Database.Database) {}

  accountScope(tenantId: string, contentAccountId: string): GrowthScope | null {
    const row = this.database.prepare(`SELECT tenant_id, ip_profile_id, id content_account_id, platform
      FROM content_accounts WHERE id=? AND tenant_id=? AND status='active'`).get(contentAccountId, tenantId) as {
        tenant_id: string; ip_profile_id: string; content_account_id: string; platform: string
      } | undefined
    return row ? {
      tenantId: row.tenant_id, ipId: row.ip_profile_id,
      contentAccountId: row.content_account_id, platform: row.platform,
    } : null
  }

  findBatchByHash(scope: GrowthScope, fileSha256: string) {
    const row = this.database.prepare(`SELECT * FROM metric_import_batches
      WHERE tenant_id=? AND content_account_id=? AND file_sha256=? LIMIT 1`).get(
      scope.tenantId, scope.contentAccountId, fileSha256,
    ) as BatchRow | undefined
    return row ? this.mapResult(row) : null
  }

  createBatch(input: { id: string; scope: GrowthScope; filename: string; fileSha256: string; userId: string; now: string }) {
    this.database.prepare(`INSERT INTO metric_import_batches
      (id,tenant_id,ip_profile_id,content_account_id,platform,filename,file_sha256,status,created_by_user_id,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,'processing',?,?,?)`).run(
      input.id, input.scope.tenantId, input.scope.ipId, input.scope.contentAccountId, input.scope.platform,
      input.filename, input.fileSha256, input.userId, input.now, input.now,
    )
  }

  insertSnapshot(input: {
    id: string; scope: GrowthScope; batchId: string; platformContentKey: string;
    normalizedVideoUrl: string | null; row: MetricImportRow; now: string
  }) {
    const row = input.row
    const result = this.database.prepare(`INSERT OR IGNORE INTO real_metric_snapshots
      (id,tenant_id,ip_profile_id,content_account_id,platform,platform_content_key,platform_video_id,video_url,
       normalized_video_url,title,published_at,captured_at,impressions,plays,completions,completion_rate,likes,
       comments,saves,shares,inquiries,negative_feedback,is_simulated,source_batch_id,source_row_number,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?)`).run(
      input.id, input.scope.tenantId, input.scope.ipId, input.scope.contentAccountId, input.scope.platform,
      input.platformContentKey, row.platformVideoId ?? null, row.videoUrl ?? null, input.normalizedVideoUrl,
      row.title, row.publishedAt ?? null, row.capturedAt, row.impressions ?? null, row.plays ?? null,
      row.completions ?? null, row.completionRate ?? null, row.likes ?? null, row.comments ?? null,
      row.saves ?? null, row.shares ?? null, row.inquiries ?? null, row.negativeFeedback ?? null,
      input.batchId, row.rowNumber, input.now,
    )
    return result.changes === 1
  }

  insertError(input: {
    id: string; batchId: string; rowNumber: number; code: string;
    message: string; redactedReference: string; now: string
  }) {
    this.database.prepare(`INSERT OR IGNORE INTO metric_import_row_errors
      (id,batch_id,row_number,error_code,message,redacted_reference,created_at)
      VALUES (?,?,?,?,?,?,?)`).run(
      input.id, input.batchId, input.rowNumber, input.code, input.message, input.redactedReference, input.now,
    )
  }

  finishBatch(batchId: string, counts: { total: number; inserted: number; duplicates: number; errors: number }, now: string) {
    this.database.prepare(`UPDATE metric_import_batches SET status='parsed', total_rows=?, inserted_rows=?,
      duplicate_rows=?, error_rows=?, updated_at=? WHERE id=?`).run(
      counts.total, counts.inserted, counts.duplicates, counts.errors, now, batchId,
    )
    return this.requireBatch(batchId)
  }

  failBatch(batchId: string, now: string) {
    this.database.prepare("UPDATE metric_import_batches SET status='failed', updated_at=? WHERE id=?")
      .run(now, batchId)
  }

  requireBatch(batchId: string) {
    const row = this.database.prepare("SELECT * FROM metric_import_batches WHERE id=?").get(batchId) as BatchRow | undefined
    if (!row) throw new Error("METRIC_BATCH_NOT_FOUND")
    return this.mapResult(row)
  }

  requireBatchScope(batchId: string, tenantId: string) {
    const row = this.database.prepare(`SELECT tenant_id,ip_profile_id,content_account_id,platform,status
      FROM metric_import_batches WHERE id=? AND tenant_id=?`).get(batchId, tenantId) as {
        tenant_id: string; ip_profile_id: string; content_account_id: string; platform: string;
        status: MetricImportResult["status"]
      } | undefined
    if (!row) throw new Error("METRIC_BATCH_NOT_FOUND")
    return {
      scope: {
        tenantId: row.tenant_id, ipId: row.ip_profile_id,
        contentAccountId: row.content_account_id, platform: row.platform,
      } satisfies GrowthScope,
      status: row.status,
    }
  }

  listSnapshots(batchId: string) {
    return this.database.prepare("SELECT * FROM real_metric_snapshots WHERE source_batch_id=? ORDER BY source_row_number")
      .all(batchId) as SnapshotRow[]
  }

  listSnapshotModels(batchId: string): MetricSnapshot[] {
    return (this.listSnapshots(batchId) as SnapshotRow[]).map((row) => this.mapSnapshot(row))
  }

  requireSnapshot(snapshotId: string) {
    const row = this.database.prepare("SELECT * FROM real_metric_snapshots WHERE id=?")
      .get(snapshotId) as SnapshotRow | undefined
    if (!row) throw new Error("METRIC_SNAPSHOT_NOT_FOUND")
    return this.mapSnapshot(row)
  }

  currentMatchForSnapshot(snapshotId: string) {
    const row = this.database.prepare(`SELECT m.*, s.platform FROM publication_match_versions m
      JOIN real_metric_snapshots s ON s.id=m.snapshot_id
      WHERE m.snapshot_id=? AND m.is_current=1`).get(snapshotId) as MatchRow | undefined
    return row ? this.mapMatch(row) : null
  }

  requireCurrentMatch(matchId: string) {
    const row = this.database.prepare(`SELECT m.*, s.platform FROM publication_match_versions m
      JOIN real_metric_snapshots s ON s.id=m.snapshot_id
      WHERE m.id=? AND m.is_current=1`).get(matchId) as MatchRow | undefined
    if (!row) throw new Error("MATCH_VERSION_CONFLICT")
    return this.mapMatch(row)
  }

  listCurrentMatches(batchId: string) {
    return (this.database.prepare(`SELECT m.*, s.platform FROM publication_match_versions m
      JOIN real_metric_snapshots s ON s.id=m.snapshot_id
      WHERE s.source_batch_id=? AND m.is_current=1 ORDER BY s.source_row_number`).all(batchId) as MatchRow[])
      .map((row) => this.mapMatch(row))
  }

  appendMatch(input: {
    id: string; snapshot: MetricSnapshot; publicationId: string | null; candidateIds: string[];
    method: MatchMethod; status: MatchStatus; explanation: string; version: number;
    confirmedByUserId?: string; confirmedAt?: string; createdAt: string
  }) {
    this.database.prepare("UPDATE publication_match_versions SET is_current=0 WHERE snapshot_id=? AND is_current=1")
      .run(input.snapshot.id)
    this.database.prepare(`INSERT INTO publication_match_versions
      (id,tenant_id,ip_profile_id,content_account_id,snapshot_id,publication_id,candidate_ids_json,
       method,status,explanation,version,is_current,confirmed_by_user_id,confirmed_at,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)`).run(
      input.id, input.snapshot.tenantId, input.snapshot.ipId, input.snapshot.contentAccountId,
      input.snapshot.id, input.publicationId, JSON.stringify(input.candidateIds), input.method,
      input.status, input.explanation, input.version, input.confirmedByUserId ?? null,
      input.confirmedAt ?? null, input.createdAt,
    )
    return this.requireCurrentMatch(input.id)
  }

  updateMatchProgress(batchId: string, input: { status: "matched" | "review_ready"; candidates: number; unmatched: number }) {
    this.database.prepare(`UPDATE metric_import_batches SET status=?,candidate_rows=?,unmatched_rows=?,updated_at=? WHERE id=?`)
      .run(input.status, input.candidates, input.unmatched, new Date().toISOString(), batchId)
    return this.requireBatch(batchId)
  }

  listErrors(batchId: string) {
    return (this.database.prepare(`SELECT row_number, error_code, message, redacted_reference
      FROM metric_import_row_errors WHERE batch_id=? ORDER BY row_number`).all(batchId) as Array<{
        row_number: number; error_code: string; message: string; redacted_reference: string
      }>).map((row) => ({
        rowNumber: row.row_number,
        errorCode: row.error_code,
        message: row.message,
        redactedReference: row.redacted_reference,
      }))
  }

  private mapResult(row: BatchRow): MetricImportResult {
    return {
      batchId: row.id, status: row.status, total: row.total_rows, inserted: row.inserted_rows,
      duplicates: row.duplicate_rows, errors: row.error_rows, candidates: row.candidate_rows,
      unmatched: row.unmatched_rows,
    }
  }

  private mapSnapshot(row: SnapshotRow): MetricSnapshot {
    return {
      id: row.id, tenantId: row.tenant_id, ipId: row.ip_profile_id,
      contentAccountId: row.content_account_id, platform: row.platform,
      platformContentKey: row.platform_content_key, platformVideoId: row.platform_video_id,
      videoUrl: row.video_url, normalizedVideoUrl: row.normalized_video_url, title: row.title,
      publishedAt: row.published_at, capturedAt: row.captured_at,
      sourceBatchId: row.source_batch_id, sourceRowNumber: row.source_row_number,
    }
  }

  private mapMatch(row: MatchRow): PublicationMatch {
    return {
      id: row.id, tenantId: row.tenant_id, ipId: row.ip_profile_id,
      contentAccountId: row.content_account_id, platform: row.platform,
      snapshotId: row.snapshot_id, publicationId: row.publication_id,
      candidateIds: JSON.parse(row.candidate_ids_json) as string[], method: row.method,
      status: row.status, explanation: row.explanation, version: row.version,
      isCurrent: row.is_current === 1,
    }
  }
}
