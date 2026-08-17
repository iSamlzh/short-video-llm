import { z } from "zod"
export { realContentReviewSchema } from "./growth-loop-schemas"

export const ipProfileSchema = z.object({
  displayName: z.string().trim().min(1),
  experience: z.string().trim().min(10),
  expertise: z.string().trim().min(2),
  audience: z.string().trim().min(2),
  voiceStyle: z.string().trim().min(2),
  boundaries: z.string().trim().min(2),
})

export const topicDirectionCandidateSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(4),
  angle: z.string().min(10),
  audienceTension: z.string().min(5),
  ipFitEvidence: z.array(z.string().min(1)).min(1),
  structureId: z.string().min(1),
  riskNotes: z.array(z.string()),
})
export const topicBatchSchema = z.array(topicDirectionCandidateSchema).min(3).max(5)

export const scriptCandidateSchema = z.object({
  id: z.string().min(1),
  topicDirectionId: z.string().min(1),
  title: z.string().min(4),
  hook: z.string().min(5),
  body: z.string().min(30),
  callToAction: z.string().min(4),
  estimatedSeconds: z.number().int().min(15).max(300),
})
export const scriptBatchSchema = z.array(scriptCandidateSchema).length(3)
export const scriptRevisionParagraphsSchema = z.array(z.string().trim().min(1)).min(2).max(30)

const scoreSchema = z.number().min(0).max(100)
export const qualityReportSchema = z.object({
  hardGatePassed: z.boolean(),
  hardGateReasons: z.array(z.string()),
  scores: z.object({
    hook: scoreSchema,
    ipFit: scoreSchema,
    credibility: scoreSchema,
    structure: scoreSchema,
    callToAction: scoreSchema,
  }),
  suggestions: z.array(z.string()),
})

export const autoDraftSchema = z.object({
  topics: topicBatchSchema,
  selectedTopicId: z.string().min(1),
  scripts: scriptBatchSchema,
  selectedScriptId: z.string().min(1),
  qualityReport: qualityReportSchema,
})

export const topicDraftSchema = z.object({
  scripts: scriptBatchSchema,
  selectedScriptId: z.string().min(1),
  qualityReport: qualityReportSchema,
})

export const metricSnapshotSchema = z.object({
  isSimulated: z.literal(true),
  scenario: z.enum(["underperform", "normal", "breakout"]),
  simulatorVersion: z.string(),
  seedHash: z.string(),
  impressions: z.number().int().nonnegative(),
  plays: z.number().int().nonnegative(),
  completions: z.number().int().nonnegative(),
  likes: z.number().int().nonnegative(),
  comments: z.number().int().nonnegative(),
  saves: z.number().int().nonnegative(),
  shares: z.number().int().nonnegative(),
  inquiries: z.number().int().nonnegative(),
})

export const contentReviewSchema = z.object({
  summary: z.string().min(5),
  keep: z.array(z.string()).min(1),
  improve: z.array(z.string()).min(1),
  nextContent: z.string().min(5),
  evidenceLimits: z.string().min(5),
  claimsRealCausation: z.boolean(),
})

export type TopicDirectionCandidate = z.infer<typeof topicDirectionCandidateSchema>
export type ScriptCandidate = z.infer<typeof scriptCandidateSchema>
export type QualityReport = z.infer<typeof qualityReportSchema>
export type MetricSnapshot = z.infer<typeof metricSnapshotSchema>
export type ContentReview = z.infer<typeof contentReviewSchema>
