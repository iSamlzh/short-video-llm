import { randomUUID } from "node:crypto"
import type Database from "better-sqlite3"
import type { AccessContext } from "../domain/access"
import { normalizeStructureNodes } from "../domain/content-brain"
import { structureCandidateSchema, structureEvolutionProposalSchema } from "../domain/content-brain-schemas"
import { requirePlatformOperator } from "../lib/auth/guards"
import { ContentBrainRepository } from "../lib/db/content-brain-repository"
import { StructuredLlmClient } from "../lib/llm/structured"
import { StructureEvaluationService } from "./structure-evaluation-service"

export class StructureEvolutionService {
  private readonly evaluations: StructureEvaluationService
  private readonly contentBrain: ContentBrainRepository

  constructor(
    private readonly database: Database.Database,
    private readonly llm: StructuredLlmClient,
  ) {
    this.evaluations = new StructureEvaluationService(database)
    this.contentBrain = new ContentBrainRepository(database)
  }

  async propose(context: AccessContext, evaluationId: string) {
    requirePlatformOperator(context)
    if (process.env.STRUCTURE_EVOLUTION_CANDIDATES_ENABLED !== "true") {
      throw new Error("STRUCTURE_EVOLUTION_CANDIDATES_DISABLED")
    }
    const evaluation = this.evaluations.get(evaluationId)
    if (evaluation.status !== "current") throw new Error("STRUCTURE_EVALUATION_STALE")
    if (evaluation.confidence === "facts_only") throw new Error("EVALUATION_THRESHOLD_NOT_MET")
    const template = this.requireTemplate(evaluation.templateVersionId)
    const allowedEvidenceIds = this.evaluations.evidenceIds(evaluationId)
    const result = await this.llm.generateStructuredResult("structure_evolution", {
      currentTemplate: template,
      evaluation: {
        id: evaluation.id,
        confidence: evaluation.confidence,
        publicationCount: evaluation.publicationCount,
        eligiblePublicationCount: evaluation.eligiblePublicationCount,
        scopeCount: evaluation.scopeCount,
        aggregate: evaluation.aggregate,
      },
      allowedEvidenceIds,
      constraints: {
        onePrimaryChangeType: true,
        riskRulesMayNotBeDeleted: true,
        nodeKeysMustRemainStable: true,
        noTenantRawData: true,
      },
    }, structureEvolutionProposalSchema)
    const proposal = result.data
    this.validateProposal(proposal, evaluation, template, allowedEvidenceIds)
    if (proposal.decision === "no_change") return { proposal, candidate: null, model: result.model }

    const candidatePayload = structureCandidateSchema.parse({
      decision: "upgrade_existing",
      targetTemplateId: template.templateId,
      name: proposal.proposedTemplate.name,
      applicability: proposal.proposedTemplate.applicability,
      nodes: proposal.proposedTemplate.nodes,
      qualityRules: proposal.proposedTemplate.qualityRules,
      riskRules: proposal.proposedTemplate.riskRules,
      similarities: [`基于结构评估 ${evaluation.id} 保留当前模板身份和未修改部分`],
      differences: [proposal.summary, `证据限制：${proposal.evidenceLimits}`],
      confidence: proposal.confidence === "standard" ? "high" : "medium",
    })
    const candidate = this.contentBrain.appendEvolutionCandidate({
      id: randomUUID(),
      evaluationId,
      baseTemplateVersionId: template.templateVersionId,
      changeType: proposal.changeType,
      evidenceRefs: proposal.evidenceRefs,
      payload: candidatePayload,
      actorUserId: context.userId,
      createdAt: new Date().toISOString(),
    })
    return { proposal, candidate, model: result.model }
  }

  private requireTemplate(templateVersionId: string) {
    const row = this.database.prepare(`SELECT id,template_id,name,payload_json,status
      FROM platform_template_versions WHERE id=?`).get(templateVersionId) as {
        id: string; template_id: string; name: string; payload_json: string; status: string
      } | undefined
    if (!row) throw new Error("TEMPLATE_VERSION_NOT_FOUND")
    const payload = JSON.parse(row.payload_json) as {
      applicability?: { ipTags?: string[]; audiences?: string[]; goals?: string[] }
      nodes?: Array<string | { nodeKey?: string; kind: string; instruction: string; required: boolean }>
      qualityRules?: string[]
      riskRules?: string[]
    }
    return {
      templateVersionId: row.id,
      templateId: row.template_id,
      name: row.name,
      status: row.status,
      applicability: {
        ipTags: payload.applicability?.ipTags ?? [],
        audiences: payload.applicability?.audiences ?? [],
        goals: payload.applicability?.goals ?? [],
      },
      nodes: normalizeStructureNodes((payload.nodes ?? []).map((node) => typeof node === "string"
        ? { kind: "section", instruction: node, required: true } : node)),
      qualityRules: payload.qualityRules ?? [],
      riskRules: payload.riskRules ?? [],
    }
  }

  private validateProposal(
    proposal: ReturnType<typeof structureEvolutionProposalSchema.parse>,
    evaluation: ReturnType<StructureEvaluationService["get"]>,
    template: ReturnType<StructureEvolutionService["requireTemplate"]>,
    allowedEvidenceIds: string[],
  ) {
    if (proposal.targetTemplateId !== template.templateId
      || proposal.baseTemplateVersionId !== template.templateVersionId) {
      throw new Error("EVOLUTION_TEMPLATE_LINEAGE_INVALID")
    }
    if (proposal.evidenceRefs.some((id) => !allowedEvidenceIds.includes(id))) {
      throw new Error("EVIDENCE_REFERENCE_INVALID")
    }
    if (proposal.confidence === "standard" && evaluation.confidence !== "standard") {
      throw new Error("EVOLUTION_CONFIDENCE_EXCEEDS_EVIDENCE")
    }
    if (proposal.decision === "no_change") {
      if (proposal.changeType !== "no_change") throw new Error("EVOLUTION_CHANGE_TYPE_INVALID")
      return
    }
    if (proposal.changeType === "no_change") throw new Error("EVOLUTION_CHANGE_TYPE_INVALID")
    const nodeKeys = proposal.proposedTemplate.nodes.map((node) => node.nodeKey)
    if (new Set(nodeKeys).size !== nodeKeys.length) throw new Error("STRUCTURE_NODE_KEY_DUPLICATE")
    if (template.riskRules.some((rule) => !proposal.proposedTemplate.riskRules.includes(rule))) {
      throw new Error("EVOLUTION_RISK_RULE_REMOVAL_FORBIDDEN")
    }
    const changed = {
      applicability_adjustment: !same(template.applicability, proposal.proposedTemplate.applicability),
      node_instruction_update: !same(template.nodes, proposal.proposedTemplate.nodes),
      quality_rule_update: !same(template.qualityRules, proposal.proposedTemplate.qualityRules),
      risk_rule_update: !same(template.riskRules, proposal.proposedTemplate.riskRules),
    }
    const changedTypes = Object.entries(changed).filter(([, value]) => value).map(([name]) => name)
    if (proposal.changeType === "variant_create") {
      if (!changedTypes.length) throw new Error("EVOLUTION_NO_MATERIAL_CHANGE")
      return
    }
    if (changedTypes.length !== 1 || changedTypes[0] !== proposal.changeType) {
      throw new Error("EVOLUTION_MULTIPLE_CHANGE_TYPES")
    }
  }
}

function same(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right)
}
