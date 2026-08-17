import { createHash, randomUUID } from "node:crypto"
import type Database from "better-sqlite3"
import type { ContentAnalysis, SampleStatus } from "../../domain/content-brain"
import type { StructureCandidateInput } from "../../domain/content-brain-schemas"
import type { TokenUsage } from "../llm/adapter"

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
    publishedAt?: string | null; capturedAt?: string | null; metrics?: Record<string, number>;
    contentHash?: string;
    dataOrigin: "demo" | "formal"; actorUserId: string; createdAt: string;
  }) {
    const contentHash = input.contentHash ?? hashTranscript(input.transcript)
    const revisionId = `${input.id}-revision-1`
    this.database.transaction(() => {
      this.database.prepare(`INSERT INTO platform_content_samples
        (id,title,source_platform,source_text,rights_note,status,data_origin,created_by_user_id,created_at,
         source_url,normalized_source_url,author_reference,published_at,captured_at,metrics_json,
         current_revision_version,workflow_status,updated_at)
        VALUES (?,?,?,?,?,'pending',?,?,?, ?,?,?,?,?,?,1,'draft',?)`).run(
        input.id, input.title, input.sourcePlatform, input.transcript, input.rightsNote,
        input.dataOrigin, input.actorUserId, input.createdAt, input.sourceUrl ?? null,
        input.sourceUrl ?? null, input.authorReference ?? null, input.publishedAt ?? null,
        input.capturedAt ?? null, input.metrics ? JSON.stringify(input.metrics) : null, input.createdAt,
      )
      this.database.prepare(`INSERT INTO platform_content_sample_revisions
        (id,sample_id,version,transcript,content_hash,created_by_user_id,created_at)
        VALUES (?,?,?,?,?,?,?)`).run(
        revisionId, input.id, 1, input.transcript, contentHash, input.actorUserId, input.createdAt,
      )
    })()
    return { id: input.id, revisionId, version: 1, contentHash, status: "draft" as const }
  }

  findSampleByContentHash(contentHash: string) {
    const row = this.database.prepare(`SELECT r.sample_id,r.id revision_id,r.version
      FROM platform_content_sample_revisions r
      JOIN platform_content_samples s ON s.id=r.sample_id
      WHERE r.content_hash=? AND s.workflow_status!='rejected'
      ORDER BY r.created_at DESC LIMIT 1`).get(contentHash) as {
        sample_id: string; revision_id: string; version: number
      } | undefined
    return row ? { sampleId: row.sample_id, revisionId: row.revision_id, version: row.version } : null
  }

  requireSample(sampleId: string) {
    const row = this.database.prepare(`SELECT s.*,r.id revision_id,r.transcript,r.content_hash
      FROM platform_content_samples s
      JOIN platform_content_sample_revisions r ON r.sample_id=s.id AND r.version=s.current_revision_version
      WHERE s.id=?`).get(sampleId) as {
        id: string; title: string; source_platform: string; rights_note: string; data_origin: "demo" | "formal";
        workflow_status: SampleStatus; current_revision_version: number; revision_id: string;
        transcript: string; content_hash: string
      } | undefined
    if (!row) throw new Error("CONTENT_SAMPLE_NOT_FOUND")
    return {
      id: row.id, title: row.title, sourcePlatform: row.source_platform, rightsNote: row.rights_note,
      dataOrigin: row.data_origin, status: row.workflow_status, revisionId: row.revision_id,
      revisionVersion: row.current_revision_version, transcript: row.transcript, contentHash: row.content_hash,
    }
  }

  updateSampleStatus(sampleId: string, status: SampleStatus, updatedAt: string) {
    const result = this.database.prepare(`UPDATE platform_content_samples SET workflow_status=?,updated_at=? WHERE id=?`)
      .run(status, updatedAt, sampleId)
    if (result.changes !== 1) throw new Error("CONTENT_SAMPLE_NOT_FOUND")
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
    tokenUsage?: TokenUsage;
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

  requireAnalysis(analysisId: string) {
    const row = this.database.prepare("SELECT * FROM platform_content_analysis_versions WHERE id=?").get(analysisId) as {
      id: string; sample_id: string; revision_id: string; version: number; payload_json: string;
      model: string; prompt_version: number; status: "generated" | "reviewed" | "rejected"; created_at: string
    } | undefined
    if (!row) throw new Error("CONTENT_ANALYSIS_NOT_FOUND")
    return {
      id: row.id, sampleId: row.sample_id, revisionId: row.revision_id, version: row.version,
      payload: JSON.parse(row.payload_json) as ContentAnalysis, model: row.model,
      promptVersion: row.prompt_version, status: row.status, createdAt: row.created_at,
    }
  }

  appendReviewedAnalysis(input: {
    id: string; sourceAnalysisId: string; expectedVersion: number; payload: ContentAnalysis;
    actorUserId: string; createdAt: string;
  }) {
    const source = this.requireAnalysis(input.sourceAnalysisId)
    if (source.version !== input.expectedVersion) throw new Error("ANALYSIS_VERSION_CONFLICT")
    if (source.status !== "generated") throw new Error("ANALYSIS_NOT_REVIEWABLE")
    const version = source.version + 1
    this.database.prepare(`INSERT INTO platform_content_analysis_versions
      (id,sample_id,revision_id,version,payload_json,model,prompt_version,status,created_by_user_id,
       reviewed_by_user_id,reviewed_at,created_at)
      VALUES (?,?,?,?,?,?,?,'reviewed',?,?,?,?)`).run(
      input.id, source.sampleId, source.revisionId, version, JSON.stringify(input.payload), source.model,
      source.promptVersion, input.actorUserId, input.actorUserId, input.createdAt, input.createdAt,
    )
    return this.requireAnalysis(input.id)
  }

  appendCandidate(input: {
    id: string; analysisId: string; sampleId: string; payload: StructureCandidateInput;
    dataOrigin: "demo" | "formal"; actorUserId: string; createdAt: string;
  }) {
    const candidateKey = `${input.sampleId}:${input.payload.decision}:${input.payload.targetTemplateId ?? input.payload.name}`
    const next = this.database.prepare(`SELECT COALESCE(MAX(version),0)+1 version
      FROM platform_structure_candidates WHERE candidate_key=?`).get(candidateKey) as { version: number }
    this.database.transaction(() => {
      this.database.prepare(`INSERT INTO platform_structure_candidates
        (id,candidate_key,sample_id,version,decision,target_template_id,payload_json,status,data_origin,
         created_by_user_id,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,'draft',?,?,?,?)`).run(
        input.id, candidateKey, input.sampleId, next.version, input.payload.decision,
        input.payload.targetTemplateId, JSON.stringify(input.payload), input.dataOrigin,
        input.actorUserId, input.createdAt, input.createdAt,
      )
      this.database.prepare(`INSERT INTO platform_candidate_source_links
        (candidate_id,analysis_id,created_at) VALUES (?,?,?)`).run(input.id, input.analysisId, input.createdAt)
    })()
    return { id: input.id, ...input.payload, version: next.version, status: "draft" as const }
  }

  listCandidateSourceAnalysisIds(candidateId: string) {
    return (this.database.prepare(`SELECT analysis_id FROM platform_candidate_source_links
      WHERE candidate_id=? ORDER BY analysis_id`).all(candidateId) as Array<{ analysis_id: string }>)
      .map((row) => row.analysis_id)
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
