import { createHash, randomUUID } from "node:crypto"
import type { AccessContext } from "../domain/access"
import { createContentSampleSchema, type CreateContentSampleInput } from "../domain/content-brain-schemas"
import { requirePlatformOperator } from "../lib/auth/guards"
import { normalizeVideoUrl } from "../lib/content-identity"
import { ContentBrainRepository } from "../lib/db/content-brain-repository"
import { normalizeTranscript, parseContentSampleFile } from "../lib/import/content-sample-parser"

export class ContentSampleService {
  constructor(private readonly repository: ContentBrainRepository) {}

  createFromText(context: AccessContext, raw: CreateContentSampleInput) {
    requirePlatformOperator(context)
    const input = createContentSampleSchema.parse({ ...raw, transcript: normalizeTranscript(raw.transcript) })
    const contentHash = hashTranscript(input.transcript)
    const existing = this.repository.findSampleByContentHash(contentHash)
    if (existing) return { sampleId: existing.sampleId, revisionId: existing.revisionId, version: existing.version, duplicate: true }
    const id = randomUUID()
    const createdAt = new Date().toISOString()
    const created = this.repository.createSample({
      id,
      title: input.title,
      sourcePlatform: input.sourcePlatform,
      sourceUrl: input.sourceUrl ? normalizeVideoUrl(input.sourceUrl) : null,
      authorReference: input.authorReference,
      transcript: input.transcript,
      rightsNote: input.rightsNote,
      publishedAt: input.publishedAt,
      capturedAt: input.capturedAt,
      metrics: input.metrics,
      contentHash,
      dataOrigin: "formal",
      actorUserId: context.userId,
      createdAt,
    })
    return { sampleId: created.id, revisionId: created.revisionId, version: created.version, duplicate: false }
  }

  async createFromFile(context: AccessContext, input: { filename: string; mimeType: string; bytes: Buffer; rightsNote: string }) {
    requirePlatformOperator(context)
    const samples = await parseContentSampleFile(input)
    return samples.map((sample) => this.createFromText(context, {
      ...sample,
      rightsNote: input.rightsNote,
    }))
  }
}

function hashTranscript(transcript: string) {
  return createHash("sha256").update(normalizeTranscript(transcript)).digest("hex")
}
