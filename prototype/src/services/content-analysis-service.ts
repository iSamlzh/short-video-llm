import { randomUUID } from "node:crypto"
import type Database from "better-sqlite3"
import type { AccessContext } from "../domain/access"
import { contentAnalysisSchema, structureCandidateSchema, type StructureCandidateInput } from "../domain/content-brain-schemas"
import { requirePlatformOperator } from "../lib/auth/guards"
import { ContentBrainRepository } from "../lib/db/content-brain-repository"
import { StructuredLlmClient } from "../lib/llm/structured"

const PROMPT_VERSION = 1

export class ContentAnalysisService {
  constructor(
    private readonly database: Database.Database,
    private readonly llm: StructuredLlmClient,
    private readonly repository = new ContentBrainRepository(database),
  ) {}

  async analyze(context: AccessContext, sampleId: string) {
    requirePlatformOperator(context)
    const sample = this.repository.requireSample(sampleId)
    const startedAt = new Date().toISOString()
    this.repository.updateSampleStatus(sampleId, "analyzing", startedAt)
    try {
      const result = await this.llm.generateStructuredResult("content_analysis", {
        title: sample.title,
        transcript: sample.transcript,
        sourcePlatform: sample.sourcePlatform,
        instruction: "只拆解输入内容，所有证据引用必须来自 transcript。",
      }, contentAnalysisSchema)
      validateEvidence(result.data)
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
}

function validateEvidence(payload: { nodes: Array<{ evidenceRefs: string[] }>; evidenceRefs: Array<{ id: string }> }) {
  const allowed = new Set(payload.evidenceRefs.map((item) => item.id))
  if (payload.nodes.some((node) => node.evidenceRefs.some((id) => !allowed.has(id)))) {
    throw Object.assign(new Error("CONTENT_ANALYSIS_EVIDENCE_INVALID"), { code: "CONTENT_ANALYSIS_EVIDENCE_INVALID" })
  }
}
