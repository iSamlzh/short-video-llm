import type Database from "better-sqlite3"

type ContextInput = {
  runId: string
  tenantId: string
  actorUserId: string
  ipId: string
  ipProfileVersion: number
  accountId: string | null
  businessDate: string
  tenantMemoryVersion?: number | null
  structureVersionIds?: string[]
  primaryStructureVersionId?: string | null
  supportingStructureVersionIds?: string[]
  triggerType?: "manual" | "review_followup"
  sourceReviewId?: string | null
}

type Scope = { tenantId: string; ipIds: string[]; contentAccountIds: string[] }
type Row = {
  run_id: string; tenant_id: string; ip_profile_id: string; content_account_id: string | null;
  business_date: string; tenant_memory_version: number | null; structure_version_ids_json: string;
  primary_structure_version_id: string | null; supporting_structure_version_ids_json: string;
  ip_profile_version: number | null;
  trigger_type: "manual" | "review_followup"; source_review_id: string | null
}

export class CreationLineageRepository {
  constructor(private readonly database: Database.Database) {}

  attach(input: ContextInput) {
    this.database.prepare(`INSERT INTO creation_run_context
      (run_id,tenant_id,actor_user_id,ip_profile_id,ip_profile_version,content_account_id,business_date,tenant_memory_version,
       structure_version_ids_json,primary_structure_version_id,supporting_structure_version_ids_json,
       trigger_type,source_review_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      input.runId,
      input.tenantId,
      input.actorUserId,
      input.ipId,
      input.ipProfileVersion,
      input.accountId,
      input.businessDate,
      input.tenantMemoryVersion ?? null,
      JSON.stringify(input.structureVersionIds ?? []),
      input.primaryStructureVersionId ?? null,
      JSON.stringify(input.supportingStructureVersionIds ?? []),
      input.triggerType ?? "manual",
      input.sourceReviewId ?? null,
      new Date().toISOString(),
    )
  }

  assignStructures(runId: string, input: {
    primaryStructureVersionId: string | null
    supportingStructureVersionIds: string[]
  }) {
    const result = this.database.prepare(`UPDATE creation_run_context
      SET primary_structure_version_id=?,supporting_structure_version_ids_json=? WHERE run_id=?`).run(
      input.primaryStructureVersionId,
      JSON.stringify(input.supportingStructureVersionIds),
      runId,
    )
    if (result.changes !== 1) throw new Error("RUN_NOT_FOUND")
    return this.get(runId)
  }

  current(tenantId: string, ipId: string, accountId: string | null, businessDate: string) {
    const row = this.database.prepare(`SELECT * FROM creation_run_context
      WHERE tenant_id = ? AND ip_profile_id = ?
        AND ((content_account_id = ?) OR (content_account_id IS NULL AND ? IS NULL))
        AND business_date = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`)
      .get(tenantId, ipId, accountId, accountId, businessDate) as Row | undefined
    return row ? this.map(row) : null
  }

  get(runId: string) {
    const row = this.database.prepare("SELECT * FROM creation_run_context WHERE run_id = ?").get(runId) as Row | undefined
    return row ? this.map(row) : null
  }

  canAccess(runId: string, scope: Scope) {
    const row = this.get(runId)
    if (!row || row.tenantId !== scope.tenantId || !scope.ipIds.includes(row.ipId)) return false
    return !row.accountId || scope.contentAccountIds.includes(row.accountId)
  }

  private map(row: Row) {
    return {
      runId: row.run_id,
      tenantId: row.tenant_id,
      ipId: row.ip_profile_id,
      ipProfileVersion: row.ip_profile_version,
      accountId: row.content_account_id,
      businessDate: row.business_date,
      tenantMemoryVersion: row.tenant_memory_version,
      structureVersionIds: parseStringArray(row.structure_version_ids_json),
      primaryStructureVersionId: row.primary_structure_version_id,
      supportingStructureVersionIds: parseStringArray(row.supporting_structure_version_ids_json),
      triggerType: row.trigger_type,
      sourceReviewId: row.source_review_id,
    }
  }
}

function parseStringArray(value: string) {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []
  } catch {
    return []
  }
}
