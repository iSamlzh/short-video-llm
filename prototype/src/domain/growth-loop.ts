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

export type MetricImportRow = {
  rowNumber: number
  platformVideoId?: string
  videoUrl?: string
  title: string
  publishedAt?: string
  capturedAt: string
  impressions?: number
  plays?: number
  completions?: number
  completionRate?: number
  likes?: number
  comments?: number
  saves?: number
  shares?: number
  inquiries?: number
  negativeFeedback?: number
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
