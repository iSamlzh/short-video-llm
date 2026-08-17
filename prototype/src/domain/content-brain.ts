export type SampleStatus =
  | "draft"
  | "analyzing"
  | "review_required"
  | "reviewed"
  | "candidate_ready"
  | "completed"
  | "analysis_failed"
  | "rejected"

export type CandidateStatus =
  | "draft"
  | "preview_ready"
  | "activation_required"
  | "active"
  | "inactive"
  | "rejected"

export type CandidateDecision = "merge_existing" | "upgrade_existing" | "create_new"

export type ContentAnalysis = {
  summary: string
  nodes: Array<{ kind: string; instruction: string; required: boolean; evidenceRefs: string[] }>
  reusablePatterns: string[]
  nonReusableFacts: string[]
  applicability: { ipTags: string[]; audiences: string[]; goals: string[] }
  riskNotes: string[]
  evidenceRefs: Array<{ id: string; quote: string; start: number; end: number }>
  suggestedDecision: CandidateDecision
}

export type TemplatePackage = {
  templateVersionId: string
  templateId: string
  name: string
  applicability: { ipTags: string[]; audiences: string[]; goals: string[] }
  nodes: Array<{ kind: string; instruction: string; required: boolean }>
  qualityRules: string[]
  riskRules: string[]
}
