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
  nodes: Array<{ kind: string; instruction: string; required: boolean }>
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
  nodes: Array<{ kind: string; instruction: string; required: boolean }>
  qualityRules: string[]
  riskRules: string[]
  isGeneral: boolean
  sourceCount: number
}

export type ContentBrainApi = {
  createSample(input: Record<string, unknown>): Promise<{ sampleId: string; duplicate?: boolean }>
  importSamples(file: File, rightsNote: string): Promise<Array<{ sampleId: string; duplicate?: boolean }>>
  analyze(sampleId: string): Promise<unknown>
  getSample(sampleId: string): Promise<SampleWorkspace>
  saveAnalysis(analysisId: string, input: { expectedVersion: number; payload: AnalysisPayload }): Promise<unknown>
  approveAnalysis(analysisId: string, input: { expectedVersion: number; payload: AnalysisPayload }): Promise<unknown>
  rejectAnalysis(analysisId: string, input: { expectedVersion: number; reason: string }): Promise<unknown>
  saveCandidate(candidateId: string, input: { expectedVersion: number; payload: CandidatePayload }): Promise<unknown>
  previewCandidate(candidateId: string, input: { expectedVersion: number }): Promise<StructurePreview>
  rejectCandidate(candidateId: string, input: { expectedVersion: number; reason: string }): Promise<unknown>
  activateCandidate(candidateId: string, input: { expectedVersion: number; reason: string }): Promise<unknown>
  listSamples(): Promise<SampleSummary[]>
  listStructures(): Promise<ActiveStructure[]>
}
