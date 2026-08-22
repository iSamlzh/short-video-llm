export type GrowthScope = {
  tenantId: string
  ipId: string
  contentAccountId: string
  platform: string
}

export type SampleTier = "facts_only" | "tentative" | "memory_eligible"

export type PublicationSource = "system" | "external"
export type PublicationStatus = "active" | "disabled"

export type Publication = GrowthScope & {
  id: string
  source: PublicationSource
  runId: string | null
  lockedVersion: number | null
  lockedSelectionVersion: number | null
  title: string
  platformVideoId: string | null
  videoUrl: string | null
  normalizedVideoUrl: string | null
  publishedAt: string
  status: PublicationStatus
  createdByUserId: string
  createdAt: string
}

export type RecordSystemPublicationInput = {
  runId: string
  lockedVersion: number
  contentAccountId: string
  platformVideoId?: string
  videoUrl?: string
  publishedAt: string
}

export type CreateExternalPublicationInput = {
  contentAccountId: string
  platformVideoId?: string
  videoUrl?: string
  title: string
  publishedAt: string
}

export type NormalizedVideoMetrics = {
  impressions?: number
  plays?: number
  completions?: number
  completionRate?: number
  threeSecondRetention?: number
  fiveSecondRetention?: number
  averageWatchSeconds?: number
  likes?: number
  comments?: number
  saves?: number
  shares?: number
  profileVisits?: number
  followersGained?: number
  inquiries?: number
  negativeFeedback?: number
}

export type MetricImportRow = NormalizedVideoMetrics & {
  rowNumber: number
  platformVideoId?: string
  videoUrl?: string
  title: string
  publishedAt?: string
  capturedAt: string
  rawColumns: Record<string, string | number | boolean | null>
  isSimulated: false
}

export type MetricImportResult = {
  batchId: string
  status: "processing" | "parsed" | "matched" | "review_ready" | "completed" | "failed"
  total: number
  inserted: number
  duplicates: number
  errors: number
  candidates: number
  unmatched: number
}

export type MatchMethod =
  | "exact_video_id"
  | "exact_url"
  | "exact_title_time"
  | "similarity_candidate"
  | "manual_existing"
  | "manual_external_created"

export type MatchStatus = "matched" | "candidate" | "unmatched" | "rejected"

export type PublicationMatch = GrowthScope & {
  id: string
  snapshotId: string
  publicationId: string | null
  candidateIds: string[]
  method: MatchMethod
  status: MatchStatus
  explanation: string
  version: number
  isCurrent: boolean
}

export type RealContentReview = {
  headline: string
  observations: Array<{ text: string; evidenceSnapshotIds: string[] }>
  hypotheses: Array<{
    text: string
    confidence: "low" | "medium"
    evidenceFor: string[]
    evidenceAgainst: string[]
  }>
  keep: string[]
  avoid: string[]
  nextContentSignals: string[]
  evidenceLimits: string
  structureEvidence: Array<{
    segment: "hook" | "body" | "ending" | "conversion"
    label: "钩子" | "主体" | "结尾" | "转化"
    status: "supported" | "partial" | "missing"
    metrics: Array<{
      label: string
      value: number
      format: "count" | "rate" | "seconds"
      evidenceSnapshotIds: string[]
    }>
    missingFields: string[]
    interpretation: string
    nextAction: string
  }>
}

export type ContentReviewVersion = GrowthScope & {
  id: string
  version: number
  sampleTier: SampleTier
  evidenceCutoffAt: string
  evidenceSetHash: string
  payload: RealContentReview
  status: "generated" | "superseded" | "confirmed"
  createdAt: string
}

export type TenantMemoryVersion = GrowthScope & {
  id: string
  version: number
  sourceReviewId: string
  contentHash: string
  payload: {
    keep: string[]
    avoid: string[]
    nextContentSignals: string[]
    evidenceLimits: string
  }
  confirmedByUserId: string
  createdAt: string
}

export type ConfirmedCreationMemory = Pick<TenantMemoryVersion, "version"> & {
  keep: string[]
  avoid: string[]
  nextContentSignals: string[]
}
