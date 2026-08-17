import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type Database from "better-sqlite3"
import type { PlatformAccessContext } from "../../src/domain/access"
import { openDatabase } from "../../src/lib/db/database"
import { ContentBrainRepository } from "../../src/lib/db/content-brain-repository"
import { FakeLlmAdapter } from "../../src/lib/llm/fake"
import { StructuredLlmClient } from "../../src/lib/llm/structured"
import { ContentAnalysisService } from "../../src/services/content-analysis-service"

describe("ContentAnalysisService", () => {
  let database: Database.Database
  let repository: ContentBrainRepository
  let adapter: FakeLlmAdapter
  let service: ContentAnalysisService
  const platform: PlatformAccessContext = {
    audience: "platform", userId: "platform-user", platformRole: "platform_operator",
  }

  beforeEach(() => {
    database = openDatabase(":memory:")
    repository = new ContentBrainRepository(database)
    adapter = new FakeLlmAdapter()
    service = new ContentAnalysisService(database, new StructuredLlmClient(adapter), repository)
    repository.createSample({
      id: "sample-1", title: "一次售后让我重新理解团长", sourcePlatform: "wechat_channels",
      transcript: "这是一次真实售后经历。客户提出问题后，我先核验事实，再承担责任，最后把处理原则讲清楚。",
      rightsNote: "已授权内部分析", dataOrigin: "formal", actorUserId: platform.userId,
      createdAt: "2026-08-17T12:00:00.000Z",
    })
  })

  afterEach(() => database.close())

  it("保存带证据引用和不可复用事实的拆解版本，并只修复一次无效 JSON", async () => {
    adapter.enqueue({ text: "not-json" })
    adapter.enqueue({ json: validAnalysis })

    const result = await service.analyze(platform, "sample-1")

    expect(result.payload.nonReusableFacts).toEqual(["具体客户姓名不能复用"])
    expect(result.payload.nodes.every((node) => node.evidenceRefs.length > 0)).toBe(true)
    expect(result).toMatchObject({ version: 1, model: "fake-test-model", status: "generated" })
    expect(repository.requireSample("sample-1").status).toBe("review_required")
    expect(adapter.calls.map((call) => call.operation)).toEqual(["content_analysis", "repair"])
  })

  it("未人工通过的拆解不能生成结构候选", async () => {
    adapter.enqueue({ json: validAnalysis })
    const analysis = await service.analyze(platform, "sample-1")

    await expect(service.proposeCandidate(platform, analysis.id)).rejects.toThrow("REVIEWED_ANALYSIS_REQUIRED")
    expect(database.prepare("SELECT COUNT(*) count FROM platform_structure_candidates").get()).toEqual({ count: 0 })
  })

  it("人工通过后生成带来源关系的结构候选", async () => {
    adapter.enqueue({ json: validAnalysis })
    adapter.enqueue({ json: validCandidate })
    const generated = await service.analyze(platform, "sample-1")
    const reviewed = service.approveAnalysis(platform, generated.id, {
      expectedVersion: generated.version,
      payload: validAnalysis,
    })

    const candidate = await service.proposeCandidate(platform, reviewed.id)

    expect(candidate).toMatchObject({ decision: "create_new", status: "draft", version: 1 })
    expect(repository.listCandidateSourceAnalysisIds(candidate.id)).toEqual([reviewed.id])
    expect(repository.requireSample("sample-1").status).toBe("candidate_ready")
  })
})

const validAnalysis = {
  summary: "用具体售后冲突建立可信度，再提炼团长的责任边界。",
  nodes: [
    { kind: "hook", instruction: "以售后冲突开场", required: true, evidenceRefs: ["e1"] },
    { kind: "principle", instruction: "落到可长期坚持的原则", required: true, evidenceRefs: ["e2"] },
  ],
  reusablePatterns: ["具体冲突—处理过程—责任原则"],
  nonReusableFacts: ["具体客户姓名不能复用"],
  applicability: { ipTags: ["团长"], audiences: ["本地经营者"], goals: ["建立信任"] },
  riskNotes: ["不得承诺收益"],
  evidenceRefs: [
    { id: "e1", quote: "真实售后经历", start: 4, end: 10 },
    { id: "e2", quote: "处理原则", start: 40, end: 44 },
  ],
  suggestedDecision: "create_new" as const,
}

const validCandidate = {
  decision: "create_new" as const,
  targetTemplateId: null,
  name: "真实冲突—责任原则",
  applicability: { ipTags: ["团长"], audiences: ["本地经营者"], goals: ["建立信任"] },
  nodes: [
    { kind: "hook", instruction: "用可核验冲突开场", required: true },
    { kind: "principle", instruction: "给出处理动作与责任原则", required: true },
  ],
  qualityRules: ["必须包含具体处理动作"],
  riskRules: ["不得承诺收益"],
  similarities: [],
  differences: ["现有结构没有售后责任节点"],
  confidence: "medium" as const,
}
