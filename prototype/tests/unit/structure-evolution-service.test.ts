import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type Database from "better-sqlite3"
import type { PlatformAccessContext } from "../../src/domain/access"
import { openDatabase } from "../../src/lib/db/database"
import { FakeLlmAdapter } from "../../src/lib/llm/fake"
import { StructuredLlmClient } from "../../src/lib/llm/structured"
import { StructureEvaluationService } from "../../src/services/structure-evaluation-service"
import { StructureEvolutionService } from "../../src/services/structure-evolution-service"

const operator: PlatformAccessContext = {
  audience: "platform", userId: "platform-operator", platformRole: "platform_operator",
}

describe("结构评估与进化候选", () => {
  let database: Database.Database
  let evaluations: StructureEvaluationService

  beforeEach(() => {
    database = openDatabase(":memory:")
    evaluations = new StructureEvaluationService(database)
    seedTemplate(database)
    for (let index = 0; index < 5; index += 1) seedObservation(database, index)
    process.env.STRUCTURE_EVOLUTION_CANDIDATES_ENABLED = "true"
  })

  afterEach(() => {
    delete process.env.STRUCTURE_EVOLUTION_CANDIDATES_ENABLED
    database.close()
  })

  it("用确定性算法生成幂等评估并在输入变化后保留旧版本", () => {
    const first = evaluations.evaluate("evolution-template-v1")
    const same = evaluations.evaluate("evolution-template-v1")
    expect(first).toMatchObject({
      version: 1, publicationCount: 5, eligiblePublicationCount: 5, scopeCount: 2,
      confidence: "exploratory", status: "current",
    })
    expect(same.id).toBe(first.id)

    seedObservation(database, 5)
    const next = evaluations.evaluate("evolution-template-v1")
    expect(next.version).toBe(2)
    expect(database.prepare("SELECT status FROM platform_structure_evaluations WHERE id=?").get(first.id))
      .toEqual({ status: "superseded" })
  })

  it("LLM 只能基于评估白名单提出单一变更，并进入现有候选试生成流程", async () => {
    const evaluation = evaluations.evaluate("evolution-template-v1")
    const evidenceIds = evaluations.evidenceIds(evaluation.id)
    const adapter = new FakeLlmAdapter([{ json: {
      decision: "upgrade_existing",
      changeType: "quality_rule_update",
      targetTemplateId: "evolution-template",
      baseTemplateVersionId: "evolution-template-v1",
      summary: "聚合观察支持保留当前结构，并补充更明确的内容可用性规则。",
      evidenceRefs: [evidenceIds[0]],
      evidenceLimits: "当前证据不能证明单个结构节点导致了视频表现变化。",
      proposedTemplate: {
        name: "真实冲突—方法收束",
        applicability: { ipTags: ["创业"], audiences: ["创业者"], goals: ["建立信任"] },
        nodes: [
          { nodeKey: "conflict-hook", kind: "hook", instruction: "真实冲突开场", required: true },
          { nodeKey: "method-close", kind: "body", instruction: "给出方法并收束", required: true },
        ],
        qualityRules: ["必须给出具体动作", "结尾必须给出可执行判断"],
        riskRules: ["不得承诺收益"],
      },
      confidence: "exploratory",
    } }])
    const service = new StructureEvolutionService(database, new StructuredLlmClient(adapter))
    const result = await service.propose(operator, evaluation.id)

    expect(result.candidate).toMatchObject({
      sourceType: "outcome_evolution",
      sourceReferenceId: evaluation.id,
      baseTemplateVersionId: "evolution-template-v1",
      changeType: "quality_rule_update",
      status: "draft",
    })
    expect(database.prepare(`SELECT COUNT(*) count FROM platform_candidate_observation_evidence
      WHERE candidate_id=?`).get(result.candidate!.id)).toEqual({ count: 1 })
    expect(database.prepare(`SELECT COUNT(*) count FROM platform_content_samples
      WHERE source_platform='internal_evolution'`).get()).toEqual({ count: 1 })
    expect(adapter.calls[0].input).not.toHaveProperty("tenantId")
  })

  it("拒绝模型引用白名单外观察或同时修改多个结构维度", async () => {
    const evaluation = evaluations.evaluate("evolution-template-v1")
    const adapter = new FakeLlmAdapter([{ json: {
      decision: "upgrade_existing", changeType: "quality_rule_update",
      targetTemplateId: "evolution-template", baseTemplateVersionId: "evolution-template-v1",
      summary: "尝试引用不存在的观察并修改结构。", evidenceRefs: ["unknown-observation"],
      evidenceLimits: "当前证据不能证明任何单节点因果。",
      proposedTemplate: {
        name: "真实冲突—方法收束",
        applicability: { ipTags: ["创业"], audiences: ["创业者"], goals: ["建立信任"] },
        nodes: [{ nodeKey: "changed", kind: "hook", instruction: "已改变节点", required: true }],
        qualityRules: ["必须给出具体动作", "新增规则"], riskRules: ["不得承诺收益"],
      }, confidence: "exploratory",
    } }])
    await expect(new StructureEvolutionService(database, new StructuredLlmClient(adapter)).propose(operator, evaluation.id))
      .rejects.toThrow("EVIDENCE_REFERENCE_INVALID")
  })
})

function seedTemplate(database: Database.Database) {
  const payload = {
    applicability: { ipTags: ["创业"], audiences: ["创业者"], goals: ["建立信任"] },
    nodes: [
      { nodeKey: "conflict-hook", kind: "hook", instruction: "真实冲突开场", required: true },
      { nodeKey: "method-close", kind: "body", instruction: "给出方法并收束", required: true },
    ],
    qualityRules: ["必须给出具体动作"], riskRules: ["不得承诺收益"],
  }
  database.prepare(`INSERT INTO platform_template_versions
    (id,template_id,version,name,payload_json,status,is_general,data_origin,created_by_user_id,created_at,activated_at)
    VALUES ('evolution-template-v1','evolution-template',1,'真实冲突—方法收束',?,'active',0,'formal',
      'platform-operator','2026-08-29T00:00:00.000Z','2026-08-29T00:00:00.000Z')`).run(JSON.stringify(payload))
}

function seedObservation(database: Database.Database, index: number) {
  const scope = index % 2 === 0 ? "scope-a" : "scope-b"
  const metricDelta = {
    completionRate: { current: 0.45 + index / 100, baselineMedian: 0.4, absoluteDelta: 0.05 + index / 100, relativeDelta: 0.125 },
    inquiriesPerThousand: { current: 3 + index, baselineMedian: 2, absoluteDelta: 1 + index, relativeDelta: 0.5 },
  }
  database.prepare(`INSERT INTO platform_structure_observations
    (id,source_fingerprint,scope_fingerprint,publication_fingerprint,structure_version_id,node_keys_json,
     platform,context_bucket_json,evidence_tier,metrics_json,metric_delta_json,data_quality_json,captured_at,
     status,revision,created_at,updated_at)
    VALUES (?,?,?,?,?,'["conflict-hook","method-close"]','douyin','{"platform":"douyin"}',
      'tentative','{}',?,? ,?,'active',1,?,?)`).run(
    `evolution-observation-${index}`, `source-${index}`, scope, `publication-${index}`, "evolution-template-v1",
    JSON.stringify(metricDelta), JSON.stringify({ baselinePeerCount: 3, simulated: false }),
    `2026-08-${String(10 + index).padStart(2, "0")}T00:00:00.000Z`,
    "2026-08-29T00:00:00.000Z", "2026-08-29T00:00:00.000Z",
  )
}
