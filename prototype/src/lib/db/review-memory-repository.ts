import type Database from "better-sqlite3"
import type {
  ConfirmedCreationMemory, ContentReviewVersion, GrowthScope, RealContentReview, SampleTier, TenantMemoryVersion,
} from "../../domain/growth-loop"
import type { TokenUsage } from "../llm/adapter"

type ReviewRow = {
  id: string
  tenant_id: string
  ip_profile_id: string
  content_account_id: string
  platform: string
  version: number
  sample_tier: SampleTier
  evidence_cutoff_at: string
  evidence_set_hash: string
  payload_json: string
  status: "generated" | "superseded" | "confirmed"
  created_at: string
}

type MemoryRow = {
  id: string
  tenant_id: string
  ip_profile_id: string
  content_account_id: string
  platform: string
  version: number
  payload_json: string
  source_review_id: string
  content_hash: string
  confirmed_by_user_id: string
  created_at: string
}

export class ReviewMemoryRepository {
  constructor(private readonly database: Database.Database) {}

  findReviewByEvidenceHash(scope: GrowthScope, evidenceSetHash: string) {
    const row = this.database.prepare(`SELECT r.*,a.platform FROM content_review_versions r
      JOIN content_accounts a ON a.id=r.content_account_id
      WHERE r.tenant_id=? AND r.ip_profile_id=? AND r.content_account_id=? AND a.platform=?
        AND r.evidence_set_hash=? LIMIT 1`).get(
      scope.tenantId, scope.ipId, scope.contentAccountId, scope.platform, evidenceSetHash,
    ) as ReviewRow | undefined
    return row ? this.mapReview(row) : null
  }

  startCheckpoint(input: { id: string; scope: GrowthScope; evidenceSetHash: string; now: string }) {
    this.database.prepare(`INSERT INTO review_generation_checkpoints
      (id,tenant_id,ip_profile_id,content_account_id,evidence_set_hash,status,created_at,updated_at)
      VALUES (?,?,?,?,?,'running',?,?)
      ON CONFLICT(tenant_id,ip_profile_id,content_account_id,evidence_set_hash)
      DO UPDATE SET status='running',last_error_code=NULL,updated_at=excluded.updated_at`).run(
      input.id, input.scope.tenantId, input.scope.ipId, input.scope.contentAccountId,
      input.evidenceSetHash, input.now, input.now,
    )
  }

  failCheckpoint(scope: GrowthScope, evidenceSetHash: string, code: string, now: string) {
    this.database.prepare(`UPDATE review_generation_checkpoints SET status='failed',last_error_code=?,updated_at=?
      WHERE tenant_id=? AND ip_profile_id=? AND content_account_id=? AND evidence_set_hash=?`).run(
      code, now, scope.tenantId, scope.ipId, scope.contentAccountId, evidenceSetHash,
    )
  }

  completeCheckpoint(scope: GrowthScope, evidenceSetHash: string, reviewId: string, now: string) {
    this.database.prepare(`UPDATE review_generation_checkpoints
      SET status='completed',review_id=?,last_error_code=NULL,updated_at=?
      WHERE tenant_id=? AND ip_profile_id=? AND content_account_id=? AND evidence_set_hash=?`).run(
      reviewId, now, scope.tenantId, scope.ipId, scope.contentAccountId, evidenceSetHash,
    )
  }

  nextVersion(scope: GrowthScope) {
    const row = this.database.prepare(`SELECT COALESCE(MAX(version),0)+1 version FROM content_review_versions
      WHERE tenant_id=? AND ip_profile_id=? AND content_account_id=?`).get(
      scope.tenantId, scope.ipId, scope.contentAccountId,
    ) as { version: number }
    return row.version
  }

  supersedeGenerated(scope: GrowthScope, exceptEvidenceHash: string) {
    this.database.prepare(`UPDATE content_review_versions SET status='superseded'
      WHERE tenant_id=? AND ip_profile_id=? AND content_account_id=?
        AND status='generated' AND evidence_set_hash<>?`).run(
      scope.tenantId, scope.ipId, scope.contentAccountId, exceptEvidenceHash,
    )
  }

  insertReview(input: {
    id: string; scope: GrowthScope; version: number; sampleTier: SampleTier;
    evidenceCutoffAt: string; evidenceSetHash: string; payload: RealContentReview;
    model: string | null; promptVersion: number; usage?: TokenUsage; userId: string; now: string
  }) {
    this.database.prepare(`INSERT INTO content_review_versions
      (id,tenant_id,ip_profile_id,content_account_id,version,sample_tier,evidence_cutoff_at,evidence_set_hash,
       payload_json,model,prompt_version,token_usage_json,status,created_by_user_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'generated',?,?)`).run(
      input.id, input.scope.tenantId, input.scope.ipId, input.scope.contentAccountId, input.version,
      input.sampleTier, input.evidenceCutoffAt, input.evidenceSetHash, JSON.stringify(input.payload),
      input.model, input.promptVersion, input.usage ? JSON.stringify(input.usage) : null, input.userId, input.now,
    )
    return this.requireReview(input.scope, input.id)
  }

  insertEvidenceLink(input: {
    id: string; reviewId: string; publicationId: string; snapshotId: string;
    purpose: "observation" | "hypothesis_for" | "hypothesis_against" | "baseline"; now: string
  }) {
    this.database.prepare(`INSERT OR IGNORE INTO review_evidence_links
      (id,review_id,publication_id,snapshot_id,purpose,created_at) VALUES (?,?,?,?,?,?)`).run(
      input.id, input.reviewId, input.publicationId, input.snapshotId, input.purpose, input.now,
    )
  }

  requireReview(scope: GrowthScope, reviewId: string) {
    const row = this.database.prepare(`SELECT r.*,a.platform FROM content_review_versions r
      JOIN content_accounts a ON a.id=r.content_account_id
      WHERE r.id=? AND r.tenant_id=? AND r.ip_profile_id=? AND r.content_account_id=? AND a.platform=?`).get(
      reviewId, scope.tenantId, scope.ipId, scope.contentAccountId, scope.platform,
    ) as ReviewRow | undefined
    if (!row) throw new Error("REVIEW_NOT_FOUND")
    return this.mapReview(row)
  }

  getCurrent(scope: GrowthScope) {
    const row = this.database.prepare(`SELECT r.*,a.platform FROM content_review_versions r
      JOIN content_accounts a ON a.id=r.content_account_id
      WHERE r.tenant_id=? AND r.ip_profile_id=? AND r.content_account_id=? AND a.platform=?
        AND r.status IN ('generated','confirmed') ORDER BY r.version DESC LIMIT 1`).get(
      scope.tenantId, scope.ipId, scope.contentAccountId, scope.platform,
    ) as ReviewRow | undefined
    return row ? this.mapReview(row) : null
  }

  getHistory(scope: GrowthScope) {
    return (this.database.prepare(`SELECT r.*,a.platform FROM content_review_versions r
      JOIN content_accounts a ON a.id=r.content_account_id
      WHERE r.tenant_id=? AND r.ip_profile_id=? AND r.content_account_id=? AND a.platform=?
      ORDER BY r.version DESC`).all(
      scope.tenantId, scope.ipId, scope.contentAccountId, scope.platform,
    ) as ReviewRow[]).map((row) => this.mapReview(row))
  }

  findMemoryByReviewHash(sourceReviewId: string, contentHash: string) {
    const row = this.database.prepare(`SELECT m.*,a.platform FROM tenant_memory_versions m
      JOIN content_accounts a ON a.id=m.content_account_id
      WHERE m.source_review_id=? AND m.content_hash=? LIMIT 1`).get(sourceReviewId, contentHash) as MemoryRow | undefined
    return row ? this.mapMemory(row) : null
  }

  nextMemoryVersion(scope: GrowthScope) {
    const row = this.database.prepare(`SELECT COALESCE(MAX(version),0)+1 version FROM tenant_memory_versions
      WHERE tenant_id=? AND ip_profile_id=? AND content_account_id=?`).get(
      scope.tenantId, scope.ipId, scope.contentAccountId,
    ) as { version: number }
    return row.version
  }

  insertMemory(input: {
    id: string; scope: GrowthScope; version: number; sourceReviewId: string; contentHash: string;
    payload: TenantMemoryVersion["payload"]; userId: string; now: string
  }) {
    this.database.prepare(`INSERT INTO tenant_memory_versions
      (id,tenant_id,ip_profile_id,content_account_id,version,payload_json,confirmed_by_user_id,created_at,
       source_review_id,content_hash,schema_version)
      VALUES (?,?,?,?,?,?,?,?,?,?,1)`).run(
      input.id, input.scope.tenantId, input.scope.ipId, input.scope.contentAccountId, input.version,
      JSON.stringify(input.payload), input.userId, input.now, input.sourceReviewId, input.contentHash,
    )
    return this.requireMemory(input.scope, input.version)
  }

  markReviewConfirmed(scope: GrowthScope, reviewId: string) {
    const result = this.database.prepare(`UPDATE content_review_versions SET status='confirmed'
      WHERE id=? AND tenant_id=? AND ip_profile_id=? AND content_account_id=? AND status='generated'`).run(
      reviewId, scope.tenantId, scope.ipId, scope.contentAccountId,
    )
    if (!result.changes) throw new Error("REVIEW_SUPERSEDED")
  }

  getCurrentMemory(scope: GrowthScope) {
    const row = this.database.prepare(`SELECT m.*,a.platform FROM tenant_memory_versions m
      JOIN content_accounts a ON a.id=m.content_account_id
      WHERE m.tenant_id=? AND m.ip_profile_id=? AND m.content_account_id=? AND a.platform=?
      ORDER BY m.version DESC LIMIT 1`).get(
      scope.tenantId, scope.ipId, scope.contentAccountId, scope.platform,
    ) as MemoryRow | undefined
    return row ? this.mapMemory(row) : null
  }

  requireMemory(scope: GrowthScope, version: number) {
    const row = this.database.prepare(`SELECT m.*,a.platform FROM tenant_memory_versions m
      JOIN content_accounts a ON a.id=m.content_account_id
      WHERE m.tenant_id=? AND m.ip_profile_id=? AND m.content_account_id=? AND a.platform=? AND m.version=?`).get(
      scope.tenantId, scope.ipId, scope.contentAccountId, scope.platform, version,
    ) as MemoryRow | undefined
    if (!row) throw new Error("TENANT_MEMORY_NOT_FOUND")
    return this.mapMemory(row)
  }

  private mapReview(row: ReviewRow): ContentReviewVersion {
    return {
      id: row.id, tenantId: row.tenant_id, ipId: row.ip_profile_id,
      contentAccountId: row.content_account_id, platform: row.platform, version: row.version,
      sampleTier: row.sample_tier, evidenceCutoffAt: row.evidence_cutoff_at,
      evidenceSetHash: row.evidence_set_hash, payload: JSON.parse(row.payload_json) as RealContentReview,
      status: row.status, createdAt: row.created_at,
    }
  }

  private mapMemory(row: MemoryRow): TenantMemoryVersion {
    const payload = JSON.parse(row.payload_json) as TenantMemoryVersion["payload"]
    return {
      id: row.id, tenantId: row.tenant_id, ipId: row.ip_profile_id,
      contentAccountId: row.content_account_id, platform: row.platform, version: row.version,
      sourceReviewId: row.source_review_id, contentHash: row.content_hash, payload,
      confirmedByUserId: row.confirmed_by_user_id, createdAt: row.created_at,
    }
  }
}

export function toConfirmedCreationMemory(memory: TenantMemoryVersion): ConfirmedCreationMemory {
  return {
    version: memory.version,
    keep: memory.payload.keep,
    avoid: memory.payload.avoid,
    nextContentSignals: memory.payload.nextContentSignals,
  }
}
