import { randomUUID } from "node:crypto"
import type Database from "better-sqlite3"
import type { AccessContext } from "../domain/access"
import { contentAnalysisSchema, structureCandidateSchema, type StructureCandidateInput } from "../domain/content-brain-schemas"
import { requirePlatformOperator } from "../lib/auth/guards"
import { ContentBrainRepository } from "../lib/db/content-brain-repository"
import { StructuredLlmClient } from "../lib/llm/structured"

const PROMPT_VERSION = 1

export type ContentAnalysisProgress = (stage: "structure_analysis" | "evidence_validation" | "persistence", message: string) => void

export class ContentAnalysisService {
  private readonly inFlight = new Map<string, Promise<ReturnType<ContentBrainRepository["requireAnalysis"]>>>()

  constructor(
    private readonly database: Database.Database,
    private readonly llm: StructuredLlmClient,
    private readonly repository = new ContentBrainRepository(database),
  ) {}

  async analyze(context: AccessContext, sampleId: string, onProgress?: ContentAnalysisProgress) {
    requirePlatformOperator(context)
    const sample = this.repository.requireSample(sampleId)
    const existing = this.repository.findLatestAnalysisForRevision(sampleId, sample.revisionId)
    if (existing && existing.status !== "rejected" && sample.status !== "analysis_failed") return existing
    const key = `${sampleId}:${sample.revisionId}`
    const running = this.inFlight.get(key)
    if (running) return running
    const task = this.runAnalysis(requirePlatformOperator(context), sample, onProgress)
    this.inFlight.set(key, task)
    try {
      return await task
    } finally {
      this.inFlight.delete(key)
    }
  }

  private async runAnalysis(
    context: ReturnType<typeof requirePlatformOperator>,
    sample: ReturnType<ContentBrainRepository["requireSample"]>,
    onProgress?: ContentAnalysisProgress,
  ) {
    const sampleId = sample.id
    const startedAt = new Date().toISOString()
    this.repository.updateSampleStatus(sampleId, "analyzing", startedAt)
    try {
      onProgress?.("structure_analysis", "正在识别爆款结构")
      const result = await this.llm.generateStructuredResult("content_analysis", {
        title: sample.title,
        transcript: sample.transcript,
        sourcePlatform: sample.sourcePlatform,
        instruction: "只拆解输入内容，所有证据引用必须来自 transcript。",
      }, contentAnalysisSchema)
      onProgress?.("evidence_validation", "正在校验证据引用")
      validateEvidence(result.data)
      onProgress?.("persistence", "正在保存拆解结果")
      const createdAt = new Date().toISOString()
      const persist = this.database.transaction(() => {
        const analysis = this.repository.appendAnalysis({
          id: randomUUID(), sampleId, revisionId: sample.revisionId, payload: result.data,
          model: result.model, promptVersion: PROMPT_VERSION, tokenUsage: result.usage,
          actorUserId: context.userId, createdAt,
        })
        this.repository.updateSampleStatus(sampleId, "review_required", createdAt)
        return analysis
      })
      return persist()
    } catch (error) {
      this.repository.updateSampleStatus(sampleId, "analysis_failed", new Date().toISOString())
      throw error
    }
  }

  saveDraft(context: AccessContext, analysisId: string, input: { expectedVersion: number; payload: unknown }) {
    requirePlatformOperator(context)
    const payload = contentAnalysisSchema.parse(input.payload)
    validateEvidence(payload)
    return this.repository.appendAnalysisDraft({
      id: randomUUID(), sourceAnalysisId: analysisId, expectedVersion: input.expectedVersion,
      payload, actorUserId: context.userId, createdAt: new Date().toISOString(),
    })
  }

  rejectAnalysis(context: AccessContext, analysisId: string, input: { expectedVersion: number; reason: string }) {
    requirePlatformOperator(context)
    if (!input.reason.trim()) throw new Error("REJECTION_REASON_REQUIRED")
    const source = this.repository.requireAnalysis(analysisId)
    const createdAt = new Date().toISOString()
    const persist = this.database.transaction(() => {
      const rejected = this.repository.appendRejectedAnalysis({
        id: randomUUID(), sourceAnalysisId: analysisId, expectedVersion: input.expectedVersion,
        reason: input.reason.trim(), actorUserId: context.userId, createdAt,
      })
      this.repository.updateSampleStatus(source.sampleId, "rejected", createdAt)
      return rejected
    })
    return persist()
  }

  approveAnalysis(context: AccessContext, analysisId: string, input: { expectedVersion: number; payload: unknown }) {
    requirePlatformOperator(context)
    const payload = contentAnalysisSchema.parse(input.payload)
    validateEvidence(payload)
    const source = this.repository.requireAnalysis(analysisId)
    const createdAt = new Date().toISOString()
    const persist = this.database.transaction(() => {
      const reviewed = this.repository.appendReviewedAnalysis({
        id: randomUUID(), sourceAnalysisId: analysisId, expectedVersion: input.expectedVersion,
        payload, actorUserId: context.userId, createdAt,
      })
      this.repository.updateSampleStatus(source.sampleId, "reviewed", createdAt)
      return reviewed
    })
    return persist()
  }

  async proposeCandidate(context: AccessContext, analysisId: string) {
    requirePlatformOperator(context)
    const analysis = this.repository.requireAnalysis(analysisId)
    if (analysis.status !== "reviewed") throw new Error("REVIEWED_ANALYSIS_REQUIRED")
    const sample = this.repository.requireSample(analysis.sampleId)
    const payload = await this.llm.generateStructured("structure_candidate", {
      analysis: analysis.payload,
      existingStructures: this.repository.listActive().map((item) => ({
        templateId: item.templateId, name: item.name, nodes: item.nodes,
      })),
      evidenceCount: 1,
    }, structureCandidateSchema) as StructureCandidateInput
    const createdAt = new Date().toISOString()
    const persist = this.database.transaction(() => {
      const candidate = this.repository.appendCandidate({
        id: randomUUID(), analysisId, sampleId: analysis.sampleId, payload,
        dataOrigin: sample.dataOrigin, actorUserId: context.userId, createdAt,
      })
      this.repository.updateSampleStatus(analysis.sampleId, "candidate_ready", createdAt)
      return candidate
    })
    return persist()
  }

  async approveAndPropose(context: AccessContext, analysisId: string, input: { expectedVersion: number; payload: unknown }) {
    const analysis = this.approveAnalysis(context, analysisId, input)
    const candidate = await this.proposeCandidate(context, analysis.id)
    return { analysis, candidate }
  }

  findApprovedResult(sourceAnalysisId: string) {
    const source = this.repository.requireAnalysis(sourceAnalysisId)
    const latest = this.repository.findLatestAnalysisForRevision(source.sampleId, source.revisionId)
    if (!latest || latest.status !== "reviewed") throw new Error("APPROVED_ANALYSIS_RESULT_NOT_FOUND")
    const candidateView = this.repository.getSampleWorkspace(source.sampleId).candidates
      .find((item) => this.repository.listCandidateSourceAnalysisIds(item.id).includes(latest.id))
    if (!candidateView) throw new Error("APPROVED_ANALYSIS_RESULT_NOT_FOUND")
    const stored = this.repository.requireCandidate(candidateView.id)
    const candidate = { id: stored.id, ...stored.payload, version: stored.version, status: "draft" as const }
    return { analysis: latest, candidate }
  }
}

function validateEvidence(payload: { nodes: Array<{ evidenceRefs: string[] }>; evidenceRefs: Array<{ id: string }> }) {
  const allowed = new Set(payload.evidenceRefs.map((item) => item.id))
  if (payload.nodes.some((node) => node.evidenceRefs.some((id) => !allowed.has(id)))) {
    throw Object.assign(new Error("CONTENT_ANALYSIS_EVIDENCE_INVALID"), { code: "CONTENT_ANALYSIS_EVIDENCE_INVALID" })
  }
}
