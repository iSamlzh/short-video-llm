import { createHash, randomUUID } from "node:crypto"
import type Database from "better-sqlite3"
import type { ContentAnalysis, SampleStatus, TemplatePackage } from "../../domain/content-brain"
import type { StructureCandidateInput, StructurePreview } from "../../domain/content-brain-schemas"
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
      nodes: (JSON.parse(row.payload_json) as { nodes: Array<string | { instruction: string }> }).nodes
        .map((node) => typeof node === "string" ? node : node.instruction),
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

  listSamples(status?: SampleStatus) {
    const rows = this.database.prepare(`SELECT s.id,s.title,s.source_platform,s.workflow_status,
      s.current_revision_version,s.data_origin,s.updated_at,
      (SELECT a.id FROM platform_content_analysis_versions a WHERE a.sample_id=s.id ORDER BY a.version DESC LIMIT 1) analysis_id,
      (SELECT c.id FROM platform_structure_candidates c WHERE c.sample_id=s.id ORDER BY c.created_at DESC,c.rowid DESC LIMIT 1) candidate_id
      FROM platform_content_samples s
      WHERE (? IS NULL OR s.workflow_status=?) ORDER BY s.updated_at DESC,s.id DESC`)
      .all(status ?? null, status ?? null) as Array<{
        id: string; title: string; source_platform: string; workflow_status: SampleStatus;
        current_revision_version: number; data_origin: "demo" | "formal"; updated_at: string;
        analysis_id: string | null; candidate_id: string | null;
      }>
    return rows.map((row) => ({
      id: row.id, title: row.title, sourcePlatform: row.source_platform, status: row.workflow_status,
      revisionVersion: row.current_revision_version, dataOrigin: row.data_origin, updatedAt: row.updated_at,
      analysisId: row.analysis_id, candidateId: row.candidate_id,
    }))
  }

  getSampleWorkspace(sampleId: string) {
    const sample = this.requireSample(sampleId)
    const analyses = (this.database.prepare(`SELECT id,version,status,payload_json,model,prompt_version,review_note,created_at
      FROM platform_content_analysis_versions WHERE sample_id=? ORDER BY version`).all(sampleId) as Array<{
        id: string; version: number; status: "generated" | "reviewed" | "rejected"; payload_json: string;
        model: string; prompt_version: number; review_note: string | null; created_at: string;
      }>).map((row) => ({
        id: row.id, version: row.version, status: row.status, payload: JSON.parse(row.payload_json) as ContentAnalysis,
        model: row.model, promptVersion: row.prompt_version, reviewNote: row.review_note, createdAt: row.created_at,
      }))
    const candidates = (this.database.prepare(`SELECT id,version,status,payload_json,review_note,created_at
      FROM platform_structure_candidates WHERE sample_id=? ORDER BY created_at,version`).all(sampleId) as Array<{
        id: string; version: number; status: string; payload_json: string; review_note: string | null; created_at: string;
      }>).map((row) => ({
        id: row.id, version: row.version, status: row.status,
        payload: JSON.parse(row.payload_json) as StructureCandidateInput,
        reviewNote: row.review_note, createdAt: row.created_at,
        preview: this.latestPreview(row.id, row.version),
      }))
    return { sample, revisions: this.listSampleRevisions(sampleId), analyses, candidates }
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
    return this.requireAnalysis(input.id)
  }

  requireAnalysis(analysisId: string) {
    const row = this.database.prepare("SELECT * FROM platform_content_analysis_versions WHERE id=?").get(analysisId) as {
      id: string; sample_id: string; revision_id: string; version: number; payload_json: string;
      model: string; prompt_version: number; status: "generated" | "reviewed" | "rejected"; review_note: string | null; created_at: string
    } | undefined
    if (!row) throw new Error("CONTENT_ANALYSIS_NOT_FOUND")
    return {
      id: row.id, sampleId: row.sample_id, revisionId: row.revision_id, version: row.version,
      payload: JSON.parse(row.payload_json) as ContentAnalysis, model: row.model,
      promptVersion: row.prompt_version, status: row.status, reviewNote: row.review_note, createdAt: row.created_at,
    }
  }

  findLatestAnalysisForRevision(sampleId: string, revisionId: string) {
    const row = this.database.prepare(`SELECT id FROM platform_content_analysis_versions
      WHERE sample_id=? AND revision_id=? ORDER BY version DESC LIMIT 1`).get(sampleId, revisionId) as { id: string } | undefined
    return row ? this.requireAnalysis(row.id) : null
  }

  appendAnalysisDraft(input: {
    id: string; sourceAnalysisId: string; expectedVersion: number; payload: ContentAnalysis;
    actorUserId: string; createdAt: string;
  }) {
    return this.appendHumanAnalysisVersion({ ...input, status: "generated" })
  }

  appendRejectedAnalysis(input: {
    id: string; sourceAnalysisId: string; expectedVersion: number; reason: string;
    actorUserId: string; createdAt: string;
  }) {
    const source = this.requireAnalysis(input.sourceAnalysisId)
    return this.appendHumanAnalysisVersion({
      ...input, payload: source.payload, status: "rejected", reviewNote: input.reason,
    })
  }

  private appendHumanAnalysisVersion(input: {
    id: string; sourceAnalysisId: string; expectedVersion: number; payload: ContentAnalysis;
    status: "generated" | "rejected"; actorUserId: string; createdAt: string; reviewNote?: string;
  }) {
    const source = this.requireAnalysis(input.sourceAnalysisId)
    const latest = this.findLatestAnalysisForRevision(source.sampleId, source.revisionId)
    if (source.version !== input.expectedVersion || latest?.id !== source.id) throw new Error("ANALYSIS_VERSION_CONFLICT")
    if (source.status !== "generated") throw new Error("ANALYSIS_NOT_REVIEWABLE")
    const version = source.version + 1
    this.database.prepare(`INSERT INTO platform_content_analysis_versions
      (id,sample_id,revision_id,version,payload_json,model,prompt_version,status,created_by_user_id,
       reviewed_by_user_id,reviewed_at,review_note,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      input.id, source.sampleId, source.revisionId, version, JSON.stringify(input.payload), source.model,
      source.promptVersion, input.status, input.actorUserId, input.actorUserId, input.createdAt,
      input.reviewNote ?? null, input.createdAt,
    )
    return this.requireAnalysis(input.id)
  }

  appendReviewedAnalysis(input: {
    id: string; sourceAnalysisId: string; expectedVersion: number; payload: ContentAnalysis;
    actorUserId: string; createdAt: string;
  }) {
    const source = this.requireAnalysis(input.sourceAnalysisId)
    const latest = this.findLatestAnalysisForRevision(source.sampleId, source.revisionId)
    if (source.version !== input.expectedVersion || latest?.id !== source.id) throw new Error("ANALYSIS_VERSION_CONFLICT")
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

  requireCandidate(candidateId: string) {
    const row = this.database.prepare("SELECT * FROM platform_structure_candidates WHERE id=?").get(candidateId) as {
      id: string; candidate_key: string; sample_id: string; version: number; decision: StructureCandidateInput["decision"];
      target_template_id: string | null; payload_json: string; status: "draft" | "preview_ready" | "activation_required" | "active" | "inactive" | "rejected";
      data_origin: "demo" | "formal"; review_note: string | null
    } | undefined
    if (!row) throw new Error("STRUCTURE_CANDIDATE_NOT_FOUND")
    return {
      id: row.id, candidateKey: row.candidate_key, sampleId: row.sample_id, version: row.version, decision: row.decision,
      targetTemplateId: row.target_template_id, payload: JSON.parse(row.payload_json) as StructureCandidateInput,
      status: row.status, dataOrigin: row.data_origin, reviewNote: row.review_note,
    }
  }

  rejectCandidate(candidateId: string, input: {
    expectedVersion: number; reason: string; actorUserId: string; createdAt: string;
  }) {
    const candidate = this.requireCandidate(candidateId)
    if (candidate.version !== input.expectedVersion) throw new Error("CANDIDATE_VERSION_CONFLICT")
    if (!["draft", "preview_ready", "activation_required"].includes(candidate.status)) throw new Error("CANDIDATE_NOT_REJECTABLE")
    this.database.prepare(`UPDATE platform_structure_candidates
      SET status='rejected',review_note=?,updated_at=? WHERE id=? AND version=?`).run(
      input.reason, input.createdAt, candidateId, input.expectedVersion,
    )
    return this.requireCandidate(candidateId)
  }

  appendCandidateRevision(input: {
    id: string; candidateId: string; expectedVersion: number; payload: StructureCandidateInput;
    actorUserId: string; createdAt: string;
  }) {
    const current = this.requireCandidate(input.candidateId)
    if (current.version !== input.expectedVersion) throw new Error("CANDIDATE_VERSION_CONFLICT")
    if (current.status !== "draft") throw new Error("CANDIDATE_NOT_EDITABLE")
    const version = current.version + 1
    this.database.transaction(() => {
      this.database.prepare("UPDATE platform_structure_candidates SET status='inactive',updated_at=? WHERE id=?")
        .run(input.createdAt, current.id)
      this.database.prepare(`INSERT INTO platform_structure_candidates
        (id,candidate_key,sample_id,version,decision,target_template_id,payload_json,status,data_origin,
         created_by_user_id,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,'draft',?,?,?,?)`).run(
        input.id, current.candidateKey, current.sampleId, version, input.payload.decision,
        input.payload.targetTemplateId, JSON.stringify(input.payload), current.dataOrigin,
        input.actorUserId, input.createdAt, input.createdAt,
      )
      this.database.prepare(`INSERT INTO platform_candidate_source_links (candidate_id,analysis_id,created_at)
        SELECT ?,analysis_id,? FROM platform_candidate_source_links WHERE candidate_id=?`).run(
        input.id, input.createdAt, current.id,
      )
    })()
    return { id: input.id, ...input.payload, version, status: "draft" as const }
  }

  savePreview(input: {
    id: string; candidateId: string; expectedVersion: number; payload: StructurePreview;
    model: string; actorUserId: string; createdAt: string;
  }) {
    const candidate = this.requireCandidate(input.candidateId)
    if (candidate.version !== input.expectedVersion) throw new Error("CANDIDATE_VERSION_CONFLICT")
    if (candidate.status !== "draft" && candidate.status !== "preview_ready") throw new Error("CANDIDATE_NOT_PREVIEWABLE")
    this.database.transaction(() => {
      this.database.prepare(`INSERT INTO platform_structure_previews
        (id,candidate_id,candidate_version,payload_json,model,created_by_user_id,created_at)
        VALUES (?,?,?,?,?,?,?)`).run(
        input.id, input.candidateId, input.expectedVersion, JSON.stringify(input.payload),
        input.model, input.actorUserId, input.createdAt,
      )
      this.database.prepare(`UPDATE platform_structure_candidates
        SET status='activation_required',updated_at=? WHERE id=? AND version=?`).run(
        input.createdAt, input.candidateId, input.expectedVersion,
      )
    })()
    return { id: input.id, candidateId: input.candidateId, candidateVersion: input.expectedVersion, payload: input.payload, model: input.model }
  }

  latestPreview(candidateId: string, candidateVersion: number) {
    const row = this.database.prepare(`SELECT * FROM platform_structure_previews
      WHERE candidate_id=? AND candidate_version=? ORDER BY created_at DESC,rowid DESC LIMIT 1`)
      .get(candidateId, candidateVersion) as { id: string; payload_json: string; model: string; created_at: string } | undefined
    return row ? { id: row.id, payload: JSON.parse(row.payload_json) as StructurePreview, model: row.model, createdAt: row.created_at } : null
  }

  listActivePackages(): Array<TemplatePackage & { version: number; isGeneral: boolean; sourceCount: number }> {
    const rows = this.database.prepare(`SELECT v.*,
      (SELECT COUNT(*) FROM platform_template_activation_events e WHERE e.template_version_id=v.id) source_count
      FROM platform_template_versions v WHERE v.status='active' ORDER BY v.is_general,v.name,v.id`).all() as Array<Row & { source_count: number }>
    return rows.map((row) => {
      const payload = JSON.parse(row.payload_json) as Partial<TemplatePackage> & {
        nodes?: Array<string | { kind: string; instruction: string; required: boolean }>
      }
      return {
        templateVersionId: row.id,
        templateId: row.template_id,
        version: row.version,
        name: row.name,
        applicability: payload.applicability ?? { ipTags: [], audiences: [], goals: [] },
        nodes: (payload.nodes ?? []).map((node) => typeof node === "string"
          ? { kind: "section", instruction: node, required: true } : node),
        qualityRules: payload.qualityRules ?? [],
        riskRules: payload.riskRules ?? [],
        isGeneral: Boolean(row.is_general),
        sourceCount: row.source_count,
      }
    })
  }

  activateCandidate(candidateId: string, input: {
    actorUserId: string; reason: string; expectedVersion: number; createdAt: string;
  }) {
    let candidate: ReturnType<ContentBrainRepository["requireCandidate"]>
    try {
      candidate = this.requireCandidate(candidateId)
    } catch (error) {
      if ((error as Error).message === "STRUCTURE_CANDIDATE_NOT_FOUND") throw new Error("CANDIDATE_NOT_ACTIVATABLE")
      throw error
    }
    if (candidate.version !== input.expectedVersion) {
      throw new Error("CANDIDATE_NOT_ACTIVATABLE")
    }
    if (candidate.status === "active") {
      const existing = this.database.prepare(`SELECT v.id,v.template_id,v.version,v.name,v.payload_json
        FROM platform_template_activation_events e JOIN platform_template_versions v ON v.id=e.template_version_id
        WHERE e.candidate_id=? AND e.action='activate' ORDER BY e.created_at DESC,e.rowid DESC LIMIT 1`)
        .get(candidateId) as { id: string; template_id: string; version: number; name: string; payload_json: string } | undefined
      if (existing) {
        const payload = JSON.parse(existing.payload_json) as StructureCandidateInput
        return {
          id: existing.id, templateId: existing.template_id, version: existing.version,
          name: existing.name, nodes: payload.nodes.map((node) => node.instruction), status: "active" as const,
        }
      }
    }
    if (candidate.status !== "activation_required") throw new Error("CANDIDATE_NOT_ACTIVATABLE")
    if (!this.latestPreview(candidateId, input.expectedVersion)) throw new Error("PREVIEW_REQUIRED")
    const templateId = candidate.targetTemplateId ?? `template-${candidate.id}`
    const next = this.database.prepare(`SELECT COALESCE(MAX(version),0)+1 version
      FROM platform_template_versions WHERE template_id=?`).get(templateId) as { version: number }
    const versionId = randomUUID()
    const result = this.database.transaction(() => {
      this.database.prepare(`UPDATE platform_template_versions SET status='inactive'
        WHERE template_id=? AND status='active'`).run(templateId)
      this.database.prepare(`INSERT INTO platform_template_versions
        (id,template_id,version,name,payload_json,status,is_general,data_origin,created_by_user_id,created_at,activated_at)
        VALUES (?,?,?,?,?,'active',0,?,?,?,?)`).run(
        versionId, templateId, next.version, candidate.payload.name, JSON.stringify(candidate.payload),
        candidate.dataOrigin, input.actorUserId, input.createdAt, input.createdAt,
      )
      this.database.prepare(`UPDATE platform_structure_candidates SET status='active',updated_at=? WHERE id=?`)
        .run(input.createdAt, candidateId)
      this.database.prepare(`INSERT INTO platform_template_activation_events
        (id,template_id,template_version_id,candidate_id,action,actor_user_id,reason,created_at)
        VALUES (?,?,?,?,'activate',?,?,?)`).run(
        randomUUID(), templateId, versionId, candidateId, input.actorUserId, input.reason, input.createdAt,
      )
      return {
        id: versionId, templateId, version: next.version, name: candidate.payload.name,
        nodes: candidate.payload.nodes.map((node) => node.instruction), status: "active" as const,
      }
    })
    return result()
  }

  deactivateTemplateVersion(versionId: string, input: { actorUserId: string; reason: string; createdAt: string }) {
    const row = this.database.prepare(`SELECT id,template_id,version,name,status FROM platform_template_versions WHERE id=?`)
      .get(versionId) as { id: string; template_id: string; version: number; name: string; status: string } | undefined
    if (!row) throw new Error("TEMPLATE_VERSION_NOT_FOUND")
    if (row.status !== "active") throw new Error("TEMPLATE_VERSION_NOT_ACTIVE")
    this.database.transaction(() => {
      this.database.prepare("UPDATE platform_template_versions SET status='inactive' WHERE id=?").run(versionId)
      this.database.prepare(`INSERT INTO platform_template_activation_events
        (id,template_id,template_version_id,candidate_id,action,actor_user_id,reason,created_at)
        VALUES (?,?,?,NULL,'deactivate',?,?,?)`).run(
        randomUUID(), row.template_id, versionId, input.actorUserId, input.reason, input.createdAt,
      )
    })()
    return { id: row.id, templateId: row.template_id, version: row.version, name: row.name, status: "inactive" as const }
  }

  rollbackTemplateVersion(versionId: string, input: { actorUserId: string; reason: string; createdAt: string }) {
    const row = this.database.prepare(`SELECT id,template_id,version,name,status FROM platform_template_versions WHERE id=?`)
      .get(versionId) as { id: string; template_id: string; version: number; name: string; status: string } | undefined
    if (!row) throw new Error("TEMPLATE_VERSION_NOT_FOUND")
    if (row.status !== "inactive") throw new Error("TEMPLATE_VERSION_NOT_ROLLBACKABLE")
    this.database.transaction(() => {
      this.database.prepare(`UPDATE platform_template_versions SET status='inactive'
        WHERE template_id=? AND status='active'`).run(row.template_id)
      this.database.prepare(`UPDATE platform_template_versions SET status='active',activated_at=? WHERE id=?`)
        .run(input.createdAt, versionId)
      this.database.prepare(`INSERT INTO platform_template_activation_events
        (id,template_id,template_version_id,candidate_id,action,actor_user_id,reason,created_at)
        VALUES (?,?,?,NULL,'rollback',?,?,?)`).run(
        randomUUID(), row.template_id, versionId, input.actorUserId, input.reason, input.createdAt,
      )
    })()
    return { id: row.id, templateId: row.template_id, version: row.version, name: row.name, status: "active" as const }
  }
}

function hashTranscript(transcript: string) {
  return createHash("sha256").update(transcript.normalize("NFKC").replace(/\s+/g, " ").trim()).digest("hex")
}
