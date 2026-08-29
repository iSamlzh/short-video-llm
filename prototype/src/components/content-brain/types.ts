export type SampleSummary = {
  id: string
  title: string
  sourcePlatform: string
  status: string
  revisionVersion: number
  dataOrigin?: "demo" | "formal"
  updatedAt?: string
  analysisId?: string | null
  candidateId?: string | null
}

export type AnalysisPayload = {
  summary: string
  nodes: Array<{ kind: string; instruction: string; required: boolean; evidenceRefs: string[] }>
  reusablePatterns: string[]
  nonReusableFacts: string[]
  applicability: { ipTags: string[]; audiences: string[]; goals: string[] }
  riskNotes: string[]
  evidenceRefs: Array<{ id: string; quote: string; start: number; end: number }>
  suggestedDecision: "merge_existing" | "upgrade_existing" | "create_new"
}

export type CandidatePayload = {
  decision: "merge_existing" | "upgrade_existing" | "create_new"
  targetTemplateId: string | null
  name: string
  applicability: { ipTags: string[]; audiences: string[]; goals: string[] }
  nodes: Array<{ nodeKey?: string; kind: string; instruction: string; required: boolean }>
  qualityRules: string[]
  riskRules: string[]
  similarities: string[]
  differences: string[]
  confidence: "low" | "medium" | "high"
}

export type StructurePreview = {
  id: string
  candidateVersion?: number
  payload: {
    topic: string
    script: string
    nodeMappings: Array<{ node: string; excerpt: string }>
    qualityChecks: Array<{ rule: string; passed: boolean }>
    riskChecks: Array<{ rule: string; passed: boolean }>
  }
}

export type CandidateRecord = {
  id: string
  version: number
  status: string
  decision?: CandidatePayload["decision"]
  targetTemplateId?: string | null
  payload: CandidatePayload
  preview?: StructurePreview | null
  createdAt?: string
  createdBy?: string
  sourceAnalysisIds?: string[]
  sampleId?: string
  sourceType?: "sample_breakdown" | "outcome_evolution"
  sourceReferenceId?: string | null
  baseTemplateVersionId?: string | null
  changeType?: string | null
  activation?: {
    templateId: string
    templateVersionId: string
    templateVersion: number
    reason: string
    activatedBy: string
    activatedAt: string
  } | null
}

export type SampleQueueStage = "waiting_analysis" | "running" | "review_required" | "decision_required" | "failed" | "completed" | "rejected"
export type SampleQueueName = "todo" | SampleQueueStage | "all"

export type SampleQueueFilters = {
  queue: SampleQueueName
  q?: string
  sourcePlatform?: string
  batchId?: string
  from?: string
  to?: string
  cursor?: string
  limit?: number
}

export type SampleQueueItem = SampleSummary & {
  workStage: SampleQueueStage
  sourceUrl?: string | null
  authorReference?: string | null
  createdAt: string
  queueAt: string
  createdBy: string
  latestJob: null | {
    id: string
    batchId?: string | null
    status: AgentJob["status"]
    stage: string
    progressMessage: string
    errorCode?: string | null
    retryable: boolean
    attemptCount: number
    maxAttempts: number
    availableAt?: string | null
    startedAt?: string | null
    finishedAt?: string | null
    createdAt: string
    updatedAt: string
  }
}

export type SampleQueueCounts = Record<SampleQueueName, number>

export type SampleQueuePage = {
  items: SampleQueueItem[]
  counts: SampleQueueCounts
  nextCursor: string | null
}

export type SampleWorkspace = {
  sample: SampleSummary & { transcript: string }
  revisions: unknown[]
  analyses: Array<{ id: string; version: number; status: string; payload: AnalysisPayload; model?: string; promptVersion?: number; reviewNote?: string | null }>
  candidates: CandidateRecord[]
}

export type ActiveStructure = {
  templateVersionId: string
  templateId: string
  version: number
  name: string
  applicability: { ipTags: string[]; audiences: string[]; goals: string[] }
  nodes: Array<{ nodeKey?: string; kind: string; instruction: string; required: boolean }>
  qualityRules: string[]
  riskRules: string[]
  isGeneral: boolean
  sourceCount: number
}

export type StructureEvaluation = {
  id: string
  templateId: string
  templateVersionId: string
  version: number
  windowStart: string | null
  windowEnd: string | null
  publicationCount: number
  scopeCount: number
  eligiblePublicationCount: number
  aggregate: {
    metrics?: Record<string, {
      sampleCount: number
      currentMedian: number | null
      absoluteDeltaMedian: number | null
      relativeDeltaMedian: number | null
      positiveCount: number
      negativeCount: number
    }>
    nodeCoverage?: Record<string, number>
    evidenceTierCounts?: { fact?: number; tentative?: number; confirmed?: number }
    evidenceLimits?: string[]
  }
  confidence: "facts_only" | "exploratory" | "standard"
  algorithmVersion: number
  policyVersion: number
  status: "building" | "current" | "superseded" | "failed"
  createdAt: string
}

export type StructureObservationEvidence = {
  id: string
  platform: string
  contextBucket: Record<string, unknown>
  evidenceTier: "fact" | "tentative" | "confirmed"
  nodeKeys: string[]
  metrics: Record<string, unknown>
  metricDelta: Record<string, unknown>
  dataQuality: Record<string, unknown>
  capturedAt: string
  status: string
}

export type StructureEvaluationDetail = {
  evaluation: StructureEvaluation
  evidence: StructureObservationEvidence[]
}

export type EvolutionProposalResult = {
  proposal: { decision: "upgrade" | "no_change"; summary: string; evidenceLimits: string }
  candidate: CandidateRecord | null
  model: string
}

export type AgentJob = {
  id: string
  jobType: "content_analysis"
  resourceType: "content_sample"
  resourceId: string
  batchId?: string | null
  parentJobId?: string | null
  status: "queued" | "running" | "succeeded" | "failed" | "timed_out" | "cancelled"
  stage: string
  progressMessage: string
  resultReference?: string | null
  errorCode?: string | null
  retryable: boolean
  attemptCount: number
  maxAttempts: number
  heartbeatAt?: string | null
  startedAt?: string | null
  finishedAt?: string | null
  createdAt: string
  updatedAt: string
}

export type ContentBrainApi = {
  createSample(input: Record<string, unknown>): Promise<{ sampleId: string; duplicate?: boolean }>
  importSamples(file: File, rightsNote: string): Promise<Array<{ sampleId: string; duplicate?: boolean }>>
  analyze(sampleId: string, batchId?: string): Promise<AgentJob>
  getTask(taskId: string): Promise<AgentJob>
  listTasks(): Promise<AgentJob[]>
  retryTask(taskId: string): Promise<AgentJob>
  getSample(sampleId: string): Promise<SampleWorkspace>
  saveAnalysis(analysisId: string, input: { expectedVersion: number; payload: AnalysisPayload }): Promise<unknown>
  approveAnalysis(analysisId: string, input: { expectedVersion: number; payload: AnalysisPayload }): Promise<unknown>
  rejectAnalysis(analysisId: string, input: { expectedVersion: number; reason: string }): Promise<unknown>
  saveCandidate(candidateId: string, input: { expectedVersion: number; payload: CandidatePayload }): Promise<unknown>
  previewCandidate(candidateId: string, input: { expectedVersion: number }): Promise<StructurePreview>
  rejectCandidate(candidateId: string, input: { expectedVersion: number; reason: string }): Promise<unknown>
  activateCandidate(candidateId: string, input: { expectedVersion: number; reason: string }): Promise<unknown>
  listSamples(): Promise<SampleSummary[]>
  listSampleQueue(filters: SampleQueueFilters): Promise<SampleQueuePage>
  retryManyTasks(jobIds: string[]): Promise<{ accepted: number; jobs: AgentJob[] }>
  listStructures(): Promise<ActiveStructure[]>
  listEvaluations(): Promise<StructureEvaluation[]>
  getEvaluation(evaluationId: string): Promise<StructureEvaluationDetail>
  evaluateStructure(templateVersionId: string): Promise<StructureEvaluation>
  proposeEvolution(evaluationId: string): Promise<EvolutionProposalResult>
}
