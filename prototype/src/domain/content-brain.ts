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
  nodes: Array<{ nodeKey?: string; kind: string; instruction: string; required: boolean }>
  qualityRules: string[]
  riskRules: string[]
}

export function normalizeStructureNodeKey(
  node: { nodeKey?: string; kind?: string },
  index: number,
) {
  const explicit = node.nodeKey?.trim()
  if (explicit) return explicit
  const kind = (node.kind ?? "node")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return `${kind || "node"}-${index + 1}`
}

export function normalizeStructureNodes<T extends { nodeKey?: string; kind: string; instruction: string; required: boolean }>(nodes: T[]) {
  const used = new Set<string>()
  return nodes.map((node, index) => {
    const base = normalizeStructureNodeKey(node, index)
    let nodeKey = base
    let suffix = 2
    while (used.has(nodeKey)) nodeKey = `${base}-${suffix++}`
    used.add(nodeKey)
    return { ...node, nodeKey }
  })
}
