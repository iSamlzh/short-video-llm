import { randomUUID } from "node:crypto"
import type Database from "better-sqlite3"
import type { AccessContext } from "../domain/access"
import { structureCandidateSchema, structurePreviewSchema } from "../domain/content-brain-schemas"
import { requirePlatformAdmin, requirePlatformOperator } from "../lib/auth/guards"
import { ContentBrainRepository } from "../lib/db/content-brain-repository"
import { StructuredLlmClient } from "../lib/llm/structured"

export class ContentBrainWorkflowService {
  constructor(
    private readonly database: Database.Database,
    private readonly llm: StructuredLlmClient,
    private readonly repository = new ContentBrainRepository(database),
  ) {}

  async previewCandidate(context: AccessContext, candidateId: string, expectedVersion: number) {
    requirePlatformOperator(context)
    const candidate = this.repository.requireCandidate(candidateId)
    if (candidate.version !== expectedVersion) throw new Error("CANDIDATE_VERSION_CONFLICT")
    const result = await this.llm.generateStructuredResult("structure_preview", {
      simulatedIp: {
        displayName: "林姐", experience: "七年社区团购运营",
        audience: "想做本地生意的宝妈和小店主", boundaries: "不承诺收益，不虚构案例",
      },
      candidate: candidate.payload,
    }, structurePreviewSchema)
    return this.repository.savePreview({
      id: randomUUID(), candidateId, expectedVersion, payload: result.data, model: result.model,
      actorUserId: context.userId, createdAt: new Date().toISOString(),
    })
  }

  getLatestPreview(context: AccessContext, candidateId: string, expectedVersion: number) {
    requirePlatformOperator(context)
    const candidate = this.repository.requireCandidate(candidateId)
    if (candidate.version !== expectedVersion) throw new Error("CANDIDATE_VERSION_CONFLICT")
    const preview = this.repository.latestPreview(candidateId, expectedVersion)
    if (!preview) throw new Error("STRUCTURE_PREVIEW_NOT_FOUND")
    return { ...preview, candidateId, candidateVersion: expectedVersion }
  }

  reviewCandidate(context: AccessContext, candidateId: string, input: { expectedVersion: number; payload: unknown }) {
    requirePlatformOperator(context)
    const payload = structureCandidateSchema.parse(input.payload)
    return this.repository.appendCandidateRevision({
      id: randomUUID(), candidateId, expectedVersion: input.expectedVersion, payload,
      actorUserId: context.userId, createdAt: new Date().toISOString(),
    })
  }

  rejectCandidate(context: AccessContext, candidateId: string, input: { expectedVersion: number; reason: string }) {
    requirePlatformOperator(context)
    if (!input.reason.trim()) throw new Error("REJECTION_REASON_REQUIRED")
    const candidate = this.repository.requireCandidate(candidateId)
    const createdAt = new Date().toISOString()
    const persist = this.database.transaction(() => {
      const rejected = this.repository.rejectCandidate(candidateId, {
        expectedVersion: input.expectedVersion, reason: input.reason.trim(),
        actorUserId: context.userId, createdAt,
      })
      this.repository.updateSampleStatus(candidate.sampleId, "reviewed", createdAt)
      return rejected
    })
    return persist()
  }

  activateCandidate(context: AccessContext, candidateId: string, input: { reason: string; expectedVersion: number }) {
    const admin = requirePlatformAdmin(context)
    if (!input.reason.trim()) throw new Error("ACTIVATION_REASON_REQUIRED")
    const candidate = this.repository.requireCandidate(candidateId)
    if (!this.repository.latestPreview(candidateId, input.expectedVersion)) throw new Error("PREVIEW_REQUIRED")
    if (candidate.version !== input.expectedVersion) throw new Error("CANDIDATE_VERSION_CONFLICT")
    return this.repository.activateCandidate(candidateId, {
      actorUserId: admin.userId, reason: input.reason.trim(), expectedVersion: input.expectedVersion,
      createdAt: new Date().toISOString(),
    })
  }

  deactivateVersion(context: AccessContext, versionId: string, reason: string) {
    const admin = requirePlatformAdmin(context)
    if (!reason.trim()) throw new Error("DEACTIVATION_REASON_REQUIRED")
    return this.repository.deactivateTemplateVersion(versionId, {
      actorUserId: admin.userId, reason: reason.trim(), createdAt: new Date().toISOString(),
    })
  }

  rollbackVersion(context: AccessContext, versionId: string, reason: string) {
    const admin = requirePlatformAdmin(context)
    if (!reason.trim()) throw new Error("ROLLBACK_REASON_REQUIRED")
    return this.repository.rollbackTemplateVersion(versionId, {
      actorUserId: admin.userId, reason: reason.trim(), createdAt: new Date().toISOString(),
    })
  }
}
