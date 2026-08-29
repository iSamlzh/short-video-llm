import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type Database from "better-sqlite3"
import type { PlatformAccessContext } from "../../src/domain/access"
import { openDatabase } from "../../src/lib/db/database"
import { ContentBrainRepository } from "../../src/lib/db/content-brain-repository"
import { FakeLlmAdapter } from "../../src/lib/llm/fake"
import { StructuredLlmClient } from "../../src/lib/llm/structured"
import { ContentBrainWorkflowService } from "../../src/services/content-brain-workflow-service"
import { structurePreviewPrompt } from "../../src/prompts/content-brain"

describe("ContentBrainWorkflowService", () => {
  let database: Database.Database
  let repository: ContentBrainRepository
  let adapter: FakeLlmAdapter
  let service: ContentBrainWorkflowService
  let candidateId: string
  const operator: PlatformAccessContext = {
    audience: "platform", userId: "platform-operator", platformRole: "platform_operator",
  }
  const admin: PlatformAccessContext = {
    audience: "platform", userId: "platform-admin", platformRole: "platform_admin",
  }

  beforeEach(() => {
    database = openDatabase(":memory:")
    repository = new ContentBrainRepository(database)
    adapter = new FakeLlmAdapter()
    service = new ContentBrainWorkflowService(database, new StructuredLlmClient(adapter), repository)
    candidateId = seedCandidate(repository)
  })

  afterEach(() => database.close())

  it("试生成不写入租户业务表", async () => {
    const before = tenantTableCounts(database)
    adapter.enqueue({ json: validPreview })

    const preview = await service.previewCandidate(operator, candidateId, 1)

    expect(preview.payload.script).toContain("真实售后冲突")
    expect(tenantTableCounts(database)).toEqual(before)
    expect(repository.requireCandidate(candidateId).status).toBe("activation_required")
    expect(adapter.calls[0].systemPrompt).toBe(structurePreviewPrompt)
    expect(adapter.calls[0].systemPrompt).toContain('"nodeMappings"')
    expect(adapter.calls[0].systemPrompt).toContain("passed 必须是 JSON 布尔值")
  })

  it("未完成试生成不能启用，运营人员也不能越权启用", () => {
    expect(() => service.activateCandidate(admin, candidateId, {
      reason: "首版启用", expectedVersion: 1,
    })).toThrow("PREVIEW_REQUIRED")
    expect(() => service.activateCandidate(operator, candidateId, {
      reason: "越权启用", expectedVersion: 1,
    })).toThrow("PLATFORM_ADMIN_REQUIRED")
  })

  it("管理员原子启用候选并保留可回退版本", async () => {
    repository.saveVersion({
      id: "trust-v1", templateId: "trust", version: 1, name: "信任结构",
      nodes: ["旧开头", "旧原则"], status: "active", isGeneral: true,
      dataOrigin: "formal", actorUserId: admin.userId,
    })
    const upgradeId = seedCandidate(repository, { decision: "upgrade_existing", targetTemplateId: "trust" })
    adapter.enqueue({ json: validPreview })
    await service.previewCandidate(operator, upgradeId, 1)

    const activated = service.activateCandidate(admin, upgradeId, {
      reason: "试生成通过", expectedVersion: 1,
    })

    expect(activated).toMatchObject({ templateId: "trust", version: 2, status: "active" })
    expect(repository.listActive()).toEqual([expect.objectContaining({ id: activated.id, version: 2 })])
    expect(database.prepare(
      "SELECT action,reason FROM platform_template_activation_events WHERE template_version_id=?",
    ).get(activated.id)).toEqual({ action: "activate", reason: "试生成通过" })
    expect(repository.requireSample("sample-trust").status).toBe("completed")

    const repeated = service.activateCandidate(admin, upgradeId, {
      reason: "重复提交不应产生新版本", expectedVersion: 1,
    })
    expect(repeated.id).toBe(activated.id)
    expect(database.prepare("SELECT COUNT(*) count FROM platform_template_versions WHERE template_id='trust'").get())
      .toEqual({ count: 2 })
    expect(repository.requireSample("sample-trust").status).toBe("completed")
  })

  it("人工修改候选时创建新版本并保留来源", () => {
    const reviewed = service.reviewCandidate(operator, candidateId, {
      expectedVersion: 1,
      payload: { ...candidatePayload, name: "真实售后—处理动作—责任原则" },
    })

    expect(reviewed).toMatchObject({ version: 2, status: "draft", name: "真实售后—处理动作—责任原则" })
    expect(reviewed.id).not.toBe(candidateId)
    expect(repository.requireCandidate(candidateId).status).toBe("inactive")
    expect(repository.listCandidateSourceAnalysisIds(reviewed.id)).toEqual(
      repository.listCandidateSourceAnalysisIds(candidateId),
    )
  })

  it("运营人员可驳回候选且保留版本历史", () => {
    const rejected = service.rejectCandidate(operator, candidateId, {
      expectedVersion: 1, reason: "样本过于特殊，暂不具备复用价值",
    })

    expect(rejected).toMatchObject({ id: candidateId, version: 1, status: "rejected" })
    expect(repository.requireSample("sample-new").status).toBe("reviewed")
  })

  it("管理员可以停用当前版本并回退到历史稳定版本", async () => {
    repository.saveVersion({
      id: "trust-v1", templateId: "trust", version: 1, name: "信任结构",
      nodes: ["旧开头", "旧原则"], status: "active", isGeneral: true,
      dataOrigin: "formal", actorUserId: admin.userId,
    })
    const upgradeId = seedCandidate(repository, { decision: "upgrade_existing", targetTemplateId: "trust" })
    adapter.enqueue({ json: validPreview })
    await service.previewCandidate(operator, upgradeId, 1)
    const v2 = service.activateCandidate(admin, upgradeId, { reason: "升级", expectedVersion: 1 })

    service.deactivateVersion(admin, v2.id, "质量复核")
    expect(repository.listActive()).toHaveLength(0)
    const rollback = service.rollbackVersion(admin, "trust-v1", "恢复稳定版本")

    expect(rollback).toMatchObject({ id: "trust-v1", status: "active" })
    expect(database.prepare(`SELECT action,reason FROM platform_template_activation_events
      WHERE template_version_id='trust-v1' ORDER BY created_at DESC,rowid DESC LIMIT 1`).get())
      .toEqual({ action: "rollback", reason: "恢复稳定版本" })
  })
})

function seedCandidate(repository: ContentBrainRepository, overrides: Partial<typeof candidatePayload> = {}) {
  const suffix = overrides.targetTemplateId ?? "new"
  const sampleId = `sample-${suffix}`
  repository.createSample({
    id: sampleId, title: "真实售后经历", sourcePlatform: "wechat_channels",
    transcript: "这是一次真实售后冲突，我先核验问题，再承担责任并把处理原则讲清楚。",
    rightsNote: "内部授权", dataOrigin: "formal", actorUserId: "platform-operator",
    createdAt: "2026-08-17T12:00:00.000Z",
  })
  const sample = repository.requireSample(sampleId)
  const analysis = repository.appendAnalysis({
    id: `analysis-${suffix}`, sampleId, revisionId: sample.revisionId, payload: analysisPayload,
    model: "fixture", promptVersion: 1, actorUserId: "platform-operator",
    createdAt: "2026-08-17T12:01:00.000Z",
  })
  const reviewed = repository.appendReviewedAnalysis({
    id: `reviewed-${suffix}`, sourceAnalysisId: analysis.id, expectedVersion: analysis.version,
    payload: analysisPayload, actorUserId: "platform-operator", createdAt: "2026-08-17T12:02:00.000Z",
  })
  return repository.appendCandidate({
    id: `candidate-${suffix}`, analysisId: reviewed.id, sampleId,
    payload: { ...candidatePayload, ...overrides }, dataOrigin: "formal",
    actorUserId: "platform-operator", createdAt: "2026-08-17T12:03:00.000Z",
  }).id
}

function tenantTableCounts(database: Database.Database) {
  return Object.fromEntries(["creation_run_context", "publications", "real_metric_snapshots", "tenant_memory_versions"]
    .map((table) => [table, (database.prepare(`SELECT COUNT(*) count FROM ${table}`).get() as { count: number }).count]))
}

const analysisPayload = {
  summary: "真实冲突进入，处理后落到责任原则。",
  nodes: [{ kind: "hook", instruction: "真实冲突开场", required: true, evidenceRefs: ["e1"] }],
  reusablePatterns: ["冲突—处理—原则"], nonReusableFacts: ["具体姓名"],
  applicability: { ipTags: ["团长"], audiences: ["本地经营者"], goals: ["建立信任"] },
  riskNotes: ["不得承诺收益"],
  evidenceRefs: [{ id: "e1", quote: "真实售后冲突", start: 4, end: 10 }],
  suggestedDecision: "create_new" as const,
}

const candidatePayload = {
  decision: "create_new" as "create_new" | "merge_existing" | "upgrade_existing",
  targetTemplateId: null as string | null,
  name: "真实冲突—责任原则",
  applicability: { ipTags: ["团长"], audiences: ["本地经营者"], goals: ["建立信任"] },
  nodes: [{ kind: "hook", instruction: "用可核验冲突开场", required: true }],
  qualityRules: ["包含具体处理动作"], riskRules: ["不得承诺收益"],
  similarities: [], differences: ["新增责任原则"], confidence: "medium" as const,
}

const validPreview = {
  topic: "一次售后如何建立长期信任",
  script: "从一次真实售后冲突讲起，说明核验、承担和处理动作，最后落到长期责任原则。",
  nodeMappings: [{ node: "真实冲突", excerpt: "一次真实售后冲突" }],
  qualityChecks: [{ rule: "包含具体处理动作", passed: true }],
  riskChecks: [{ rule: "不得承诺收益", passed: true }],
}
