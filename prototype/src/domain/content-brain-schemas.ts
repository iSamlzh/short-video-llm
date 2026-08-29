import { z } from "zod"

const shortText = z.string().trim().min(1).max(500)
const list = (item: z.ZodType<string>, max = 20) => z.array(item).max(max)

export const candidateDecisionSchema = z.enum(["merge_existing", "upgrade_existing", "create_new"])

export const contentAnalysisSchema = z.object({
  summary: z.string().trim().min(5).max(2_000),
  nodes: z.array(z.object({
    kind: shortText,
    instruction: z.string().trim().min(2).max(1_000),
    required: z.boolean(),
    evidenceRefs: z.array(z.string().trim().min(1).max(100)).min(1).max(10),
  }).strict()).min(1).max(12),
  reusablePatterns: list(z.string().trim().min(2).max(500)),
  nonReusableFacts: list(z.string().trim().min(2).max(500)),
  applicability: z.object({
    ipTags: list(shortText, 12),
    audiences: list(shortText, 12),
    goals: list(shortText, 12),
  }).strict(),
  riskNotes: list(z.string().trim().min(2).max(500)),
  evidenceRefs: z.array(z.object({
    id: z.string().trim().min(1).max(100),
    quote: z.string().trim().min(1).max(1_000),
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
  }).strict().refine((value) => value.end > value.start, "EVIDENCE_RANGE_INVALID")).min(1).max(30),
  suggestedDecision: candidateDecisionSchema,
}).strict()

export const structureCandidateSchema = z.object({
  decision: candidateDecisionSchema,
  targetTemplateId: z.string().trim().min(1).max(200).nullable(),
  name: z.string().trim().min(2).max(200),
  applicability: z.object({
    ipTags: list(shortText, 12),
    audiences: list(shortText, 12),
    goals: list(shortText, 12),
  }).strict(),
  nodes: z.array(z.object({
    nodeKey: z.string().trim().min(1).max(100).optional(),
    kind: shortText,
    instruction: z.string().trim().min(2).max(1_000),
    required: z.boolean(),
  }).strict()).min(1).max(12),
  qualityRules: list(z.string().trim().min(2).max(500)),
  riskRules: list(z.string().trim().min(2).max(500)),
  similarities: list(z.string().trim().min(2).max(500)),
  differences: list(z.string().trim().min(2).max(500)),
  confidence: z.enum(["low", "medium", "high"]),
}).strict().superRefine((value, context) => {
  if (value.decision === "create_new" && value.targetTemplateId !== null) {
    context.addIssue({ code: "custom", path: ["targetTemplateId"], message: "NEW_STRUCTURE_TARGET_MUST_BE_NULL" })
  }
  if (value.decision !== "create_new" && value.targetTemplateId === null) {
    context.addIssue({ code: "custom", path: ["targetTemplateId"], message: "EXISTING_STRUCTURE_TARGET_REQUIRED" })
  }
})

export const structurePreviewSchema = z.object({
  topic: z.string().trim().min(2).max(500),
  script: z.string().trim().min(20).max(10_000),
  nodeMappings: z.array(z.object({
    node: z.string().trim().min(1).max(200),
    excerpt: z.string().trim().min(1).max(1_000),
  }).strict()).min(1).max(20),
  qualityChecks: z.array(z.object({
    rule: z.string().trim().min(1).max(500), passed: z.boolean(),
  }).strict()).max(20),
  riskChecks: z.array(z.object({
    rule: z.string().trim().min(1).max(500), passed: z.boolean(),
  }).strict()).max(20),
}).strict()

export const structureEvolutionProposalSchema = z.object({
  decision: z.enum(["upgrade_existing", "no_change"]),
  changeType: z.enum([
    "applicability_adjustment", "node_instruction_update", "quality_rule_update",
    "risk_rule_update", "variant_create", "no_change",
  ]),
  targetTemplateId: z.string().trim().min(1).max(200),
  baseTemplateVersionId: z.string().trim().min(1).max(200),
  summary: z.string().trim().min(10).max(2_000),
  evidenceRefs: z.array(z.string().trim().min(1).max(200)).min(1).max(100),
  evidenceLimits: z.string().trim().min(10).max(2_000),
  proposedTemplate: z.object({
    name: z.string().trim().min(2).max(200),
    applicability: z.object({
      ipTags: list(shortText, 12), audiences: list(shortText, 12), goals: list(shortText, 12),
    }).strict(),
    nodes: z.array(z.object({
      nodeKey: z.string().trim().min(1).max(100),
      kind: shortText,
      instruction: z.string().trim().min(2).max(1_000),
      required: z.boolean(),
    }).strict()).min(1).max(12),
    qualityRules: list(z.string().trim().min(2).max(500)),
    riskRules: list(z.string().trim().min(2).max(500)),
  }).strict(),
  confidence: z.enum(["exploratory", "standard"]),
}).strict()

export const createContentSampleSchema = z.object({
  title: shortText,
  sourcePlatform: z.string().trim().min(1).max(100),
  sourceUrl: z.string().trim().url().max(2_048).nullable().optional(),
  authorReference: z.string().trim().max(500).nullable().optional(),
  transcript: z.string().trim().min(40).max(30_000),
  rightsNote: z.string().trim().min(2).max(2_000),
  publishedAt: z.string().datetime({ offset: true }).nullable().optional(),
  capturedAt: z.string().datetime({ offset: true }).nullable().optional(),
  metrics: z.record(z.string(), z.number().nonnegative()).optional(),
}).strict()

export type CreateContentSampleInput = z.infer<typeof createContentSampleSchema>
export type StructureCandidateInput = z.infer<typeof structureCandidateSchema>
export type StructurePreview = z.infer<typeof structurePreviewSchema>
export type StructureEvolutionProposal = z.infer<typeof structureEvolutionProposalSchema>
