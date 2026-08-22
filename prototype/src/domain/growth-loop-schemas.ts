import { z } from "zod"

const isoDateTimeSchema = z.string().datetime({ offset: true })
const optionalIdentitySchema = {
  platformVideoId: z.string().trim().min(1).max(256).optional(),
  videoUrl: z.string().trim().url().max(2_048).optional(),
}

export const sampleTierSchema = z.enum(["facts_only", "tentative", "memory_eligible"])

export const recordSystemPublicationInputSchema = z.object({
  runId: z.string().trim().min(1),
  lockedVersion: z.number().int().positive(),
  contentAccountId: z.string().trim().min(1),
  ...optionalIdentitySchema,
  publishedAt: isoDateTimeSchema,
}).strict().refine((value) => Boolean(value.platformVideoId || value.videoUrl), {
  message: "PUBLICATION_IDENTITY_REQUIRED",
})

export const createExternalPublicationInputSchema = z.object({
  contentAccountId: z.string().trim().min(1),
  ...optionalIdentitySchema,
  title: z.string().trim().min(1).max(500),
  publishedAt: isoDateTimeSchema,
}).strict()

const optionalCount = z.number().int().nonnegative().optional()
const optionalRate = z.number().min(0).max(1).optional()
export const metricImportRowSchema = z.object({
  rowNumber: z.number().int().positive(),
  ...optionalIdentitySchema,
  title: z.string().trim().min(1).max(500),
  publishedAt: isoDateTimeSchema.optional(),
  capturedAt: isoDateTimeSchema,
  impressions: optionalCount,
  plays: optionalCount,
  completions: optionalCount,
  completionRate: optionalRate,
  threeSecondRetention: optionalRate,
  fiveSecondRetention: optionalRate,
  averageWatchSeconds: z.number().nonnegative().optional(),
  likes: optionalCount,
  comments: optionalCount,
  saves: optionalCount,
  shares: optionalCount,
  profileVisits: optionalCount,
  followersGained: optionalCount,
  inquiries: optionalCount,
  negativeFeedback: optionalCount,
  rawColumns: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  isSimulated: z.literal(false),
}).strict().refine((value) => Boolean(value.platformVideoId || value.videoUrl || value.publishedAt), {
  message: "METRIC_IDENTITY_REQUIRED",
})

export const confirmMatchInputSchema = z.object({
  publicationId: z.string().trim().min(1),
  expectedVersion: z.number().int().positive(),
}).strict()

export const realContentReviewSchema = z.object({
  headline: z.string().trim().min(5),
  observations: z.array(z.object({
    text: z.string().trim().min(5),
    evidenceSnapshotIds: z.array(z.string().trim().min(1)).min(1),
  }).strict()),
  hypotheses: z.array(z.object({
    text: z.string().trim().min(5),
    confidence: z.enum(["low", "medium"]),
    evidenceFor: z.array(z.string().trim().min(1)),
    evidenceAgainst: z.array(z.string().trim().min(1)),
  }).strict()),
  keep: z.array(z.string().trim().min(2)),
  avoid: z.array(z.string().trim().min(2)),
  nextContentSignals: z.array(z.string().trim().min(2)),
  evidenceLimits: z.string().trim().min(10),
  structureEvidence: z.array(z.object({
    segment: z.enum(["hook", "body", "ending", "conversion"]),
    label: z.enum(["钩子", "主体", "结尾", "转化"]),
    status: z.enum(["supported", "partial", "missing"]),
    metrics: z.array(z.object({
      label: z.string().trim().min(1),
      value: z.number().nonnegative(),
      format: z.enum(["count", "rate", "seconds"]),
      evidenceSnapshotIds: z.array(z.string().trim().min(1)).min(1),
    }).strict()),
    missingFields: z.array(z.string().trim().min(1)),
    interpretation: z.string().trim().min(2),
    nextAction: z.string().trim().min(2),
  }).strict()).optional(),
}).strict()

export const confirmMemoryInputSchema = z.object({
  reviewId: z.string().trim().min(1),
  keep: z.array(z.string().trim().min(2)).max(20),
  avoid: z.array(z.string().trim().min(2)).max(20),
  nextContentSignals: z.array(z.string().trim().min(2)).max(20),
}).strict()

export type RecordSystemPublicationInput = z.infer<typeof recordSystemPublicationInputSchema>
export type CreateExternalPublicationInput = z.infer<typeof createExternalPublicationInputSchema>
export type MetricImportRowInput = z.infer<typeof metricImportRowSchema>
export type ConfirmMemoryInput = z.infer<typeof confirmMemoryInputSchema>
