import { createHash, randomUUID } from "node:crypto"
import type Database from "better-sqlite3"
import type { ContentAnalysis } from "../../domain/content-brain"

type VersionInput = {
  id: string
  templateId: string
  version: number
  name: string
  nodes: string[]
  status: "draft" | "active" | "inactive"
  isGeneral: boolean
  dataOrigin: "demo" | "formal"
  actorUserId: string
}

type Row = {
  id: string
  template_id: string
  version: number
  name: string
  payload_json: string
  status: "draft" | "active" | "inactive"
  is_general: number
  data_origin: "demo" | "formal"
  created_at: string
}

export class ContentBrainRepository {
  constructor(private readonly database: Database.Database) {}

  saveVersion(input: VersionInput) {
    const now = new Date().toISOString()
    if (input.status === "active") {
      this.database.prepare("UPDATE platform_template_versions SET status = 'inactive' WHERE template_id = ? AND status = 'active'").run(input.templateId)
    }
    this.database.prepare(`INSERT INTO platform_template_versions
      (id,template_id,version,name,payload_json,status,is_general,data_origin,created_by_user_id,created_at,activated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      input.id, input.templateId, input.version, input.name, JSON.stringify({ nodes: input.nodes }), input.status,
      input.isGeneral ? 1 : 0, input.dataOrigin, input.actorUserId, now, input.status === "active" ? now : null,
    )
    return { ...input, createdAt: now }
  }

  listActive() {
    const rows = this.database.prepare("SELECT * FROM platform_template_versions WHERE status = 'active' ORDER BY is_general, name, version DESC").all() as Row[]
    return rows.map((row) => ({
      id: row.id,
      templateId: row.template_id,
      version: row.version,
      name: row.name,
      nodes: (JSON.parse(row.payload_json) as { nodes: string[] }).nodes,
      status: row.status,
      isGeneral: Boolean(row.is_general),
      dataOrigin: row.data_origin,
      createdAt: row.created_at,
    }))
  }

  retrieveStructures() {
    return this.listActive().slice(0, 3).map((item) => item.nodes.join(" → "))
  }

  createSample(input: {
    id: string; title: string; sourcePlatform: string; sourceUrl?: string | null;
    authorReference?: string | null; transcript: string; rightsNote: string;
    dataOrigin: "demo" | "formal"; actorUserId: string; createdAt: string;
  }) {
    const contentHash = hashTranscript(input.transcript)
    const revisionId = `${input.id}-revision-1`
    this.database.transaction(() => {
      this.database.prepare(`INSERT INTO platform_content_samples
        (id,title,source_platform,source_text,rights_note,status,data_origin,created_by_user_id,created_at,
         source_url,normalized_source_url,author_reference,current_revision_version,workflow_status,updated_at)
        VALUES (?,?,?,?,?,'pending',?,?,?, ?,?,?,1,'draft',?)`).run(
        input.id, input.title, input.sourcePlatform, input.transcript, input.rightsNote,
        input.dataOrigin, input.actorUserId, input.createdAt, input.sourceUrl ?? null,
        input.sourceUrl ?? null, input.authorReference ?? null, input.createdAt,
      )
      this.database.prepare(`INSERT INTO platform_content_sample_revisions
        (id,sample_id,version,transcript,content_hash,created_by_user_id,created_at)
        VALUES (?,?,?,?,?,?,?)`).run(
        revisionId, input.id, 1, input.transcript, contentHash, input.actorUserId, input.createdAt,
      )
    })()
    return { id: input.id, revisionId, version: 1, contentHash, status: "draft" as const }
  }

  appendSampleRevision(sampleId: string, input: {
    transcript: string; contentHash?: string; expectedVersion: number;
    actorUserId: string; createdAt: string;
  }) {
    const current = this.database.prepare(`SELECT current_revision_version FROM platform_content_samples WHERE id=?`)
      .get(sampleId) as { current_revision_version: number } | undefined
    if (!current) throw new Error("CONTENT_SAMPLE_NOT_FOUND")
    if (current.current_revision_version !== input.expectedVersion) throw new Error("SAMPLE_VERSION_CONFLICT")
    const version = current.current_revision_version + 1
    const id = randomUUID()
    const contentHash = input.contentHash ?? hashTranscript(input.transcript)
    this.database.transaction(() => {
      this.database.prepare(`INSERT INTO platform_content_sample_revisions
        (id,sample_id,version,transcript,content_hash,created_by_user_id,created_at)
        VALUES (?,?,?,?,?,?,?)`).run(id, sampleId, version, input.transcript, contentHash, input.actorUserId, input.createdAt)
      this.database.prepare(`UPDATE platform_content_samples
        SET source_text=?,current_revision_version=?,workflow_status='draft',updated_at=? WHERE id=?`)
        .run(input.transcript, version, input.createdAt, sampleId)
    })()
    return { id, sampleId, version, transcript: input.transcript, contentHash }
  }

  listSampleRevisions(sampleId: string) {
    const rows = this.database.prepare(`SELECT id,sample_id,version,transcript,content_hash,created_at
      FROM platform_content_sample_revisions WHERE sample_id=? ORDER BY version`).all(sampleId) as Array<{
        id: string; sample_id: string; version: number; transcript: string; content_hash: string; created_at: string
      }>
    return rows.map((row) => ({
      id: row.id, sampleId: row.sample_id, version: row.version, transcript: row.transcript,
      contentHash: row.content_hash, createdAt: row.created_at,
    }))
  }

  appendAnalysis(input: {
    id: string; sampleId: string; revisionId: string; payload: ContentAnalysis;
    model: string; promptVersion: number; actorUserId: string; createdAt: string;
    tokenUsage?: Record<string, number>;
  }) {
    const row = this.database.prepare(`SELECT COALESCE(MAX(version),0)+1 version
      FROM platform_content_analysis_versions WHERE sample_id=?`).get(input.sampleId) as { version: number }
    this.database.prepare(`INSERT INTO platform_content_analysis_versions
      (id,sample_id,revision_id,version,payload_json,model,prompt_version,token_usage_json,status,created_by_user_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,'generated',?,?)`).run(
      input.id, input.sampleId, input.revisionId, row.version, JSON.stringify(input.payload), input.model,
      input.promptVersion, input.tokenUsage ? JSON.stringify(input.tokenUsage) : null, input.actorUserId, input.createdAt,
    )
    return { ...input, version: row.version, status: "generated" as const }
  }

  activateCandidate(candidateId: string, input: {
    actorUserId: string; reason: string; expectedVersion: number; createdAt: string;
  }) {
    const candidate = this.database.prepare(`SELECT id FROM platform_structure_candidates
      WHERE id=? AND version=? AND status='activation_required'`).get(candidateId, input.expectedVersion)
    if (!candidate) throw new Error("CANDIDATE_NOT_ACTIVATABLE")
    throw new Error("CANDIDATE_ACTIVATION_NOT_IMPLEMENTED")
  }
}

function hashTranscript(transcript: string) {
  return createHash("sha256").update(transcript.normalize("NFKC").replace(/\s+/g, " ").trim()).digest("hex")
}
