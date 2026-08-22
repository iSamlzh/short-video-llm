import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { AccessRepository } from "../../src/lib/db/access-repository"
import { openDatabase } from "../../src/lib/db/database"
import { PrototypeRepository } from "../../src/lib/db/repository"
import { PrototypeFixtureLlmAdapter } from "../../src/lib/llm/fake"
import { StructuredLlmClient } from "../../src/lib/llm/structured"
import { seedDemoData } from "../../src/scripts/demo-data"
import { AccessService } from "../../src/services/access-service"
import { AutoCreationOrchestrator } from "../../src/services/auto-creation-orchestrator"
import { CreationAppService } from "../../src/services/creation-app-service"
import { RunService } from "../../src/services/run-service"
import type { TemplatePackage } from "../../src/domain/content-brain"

const packageFor = (templateVersionId: string): TemplatePackage => ({
  templateVersionId,
  templateId: "template-trust",
  name: "真实场景到责任原则",
  applicability: { ipTags: ["社区团购选品与团长运营"], audiences: [], goals: [] },
  nodes: [{ kind: "hook", instruction: "以真实冲突开场", required: true }],
  qualityRules: ["必须包含具体处理动作"],
  riskRules: ["不得承诺收益"],
})

describe("CreationAppService draft lifecycle", () => {
  let appDatabase: ReturnType<typeof openDatabase>
  let repository: PrototypeRepository
  let adapter: PrototypeFixtureLlmAdapter
  let service: CreationAppService
  let access: AccessService
  let packages: TemplatePackage[]

  beforeEach(async () => {
    const directory = mkdtempSync(join(tmpdir(), "creation-app-service-"))
    appDatabase = openDatabase(join(directory, "app.sqlite"))
    await seedDemoData(appDatabase, "demo-password")
    repository = new PrototypeRepository(join(directory, "runs.sqlite"))
    adapter = new PrototypeFixtureLlmAdapter()
    packages = [packageFor("template-v1")]
    const runs = new RunService(repository, new StructuredLlmClient(adapter), () => packages)
    service = new CreationAppService(appDatabase, runs, new AutoCreationOrchestrator(runs))
    access = new AccessService(new AccessRepository(appDatabase))
  })

  afterEach(() => {
    repository.close()
    appDatabase.close()
  })

  it("saves a new immutable revision, reruns QA and locks that exact revision", async () => {
    const owner = access.resolve("user-owner", "tenant")
    if (owner.audience !== "tenant") throw new Error("TENANT_CONTEXT_REQUIRED")
    const created = await service.create(owner)
    const paragraphs = [...created.paragraphs]
    paragraphs[1] = `${paragraphs[1]} 这是运营人员补充的一条真实经验。`

    const saved = service.saveDraft(owner, created.runId!, { expectedRevision: created.revision, paragraphs })

    expect(saved.saved).toBe(true)
    expect(saved.revision).toBe(created.revision + 1)
    expect(saved.status).toBe("needs_qa")
    expect(saved.checks).toEqual([])

    const finalized = await service.finalize(owner, created.runId!, { expectedRevision: saved.revision, paragraphs })

    expect(finalized.status).toBe("locked")
    expect(finalized.revision).toBe(saved.revision)
    expect(finalized.lockedVersion).toBe(1)
    expect(adapter.calls.map((call) => call.operation)).toEqual(["auto_draft", "qa"])
  })

  it("reuses the current matching QA result when finalizing an unchanged generated draft", async () => {
    const owner = access.resolve("user-owner", "tenant")
    if (owner.audience !== "tenant") throw new Error("TENANT_CONTEXT_REQUIRED")
    const created = await service.create(owner)

    const finalized = await service.finalize(owner, created.runId!, {
      expectedRevision: created.revision,
      paragraphs: created.paragraphs,
    })

    expect(finalized.status).toBe("locked")
    expect(adapter.calls.map((call) => call.operation)).toEqual(["auto_draft"])
  })

  it("持久化结构化段落，并只从锁定版本生成导出数据", async () => {
    const owner = access.resolve("user-owner", "tenant")
    if (owner.audience !== "tenant") throw new Error("TENANT_CONTEXT_REQUIRED")
    const created = await service.create(owner)
    const segments = created.segments.map((segment: any) => segment.kind === "spoken" && segment.id.endsWith("-2")
      ? { ...segment, text: `${segment.text} 这是结构化修改。` }
      : segment)

    const saved = service.saveDraft(owner, created.runId!, { expectedRevision: created.revision, segments })
    expect(saved.status).toBe("needs_qa")
    expect(saved.segments).toEqual(segments)

    const finalized = await service.finalize(owner, created.runId!, { expectedRevision: saved.revision, segments })
    const exported = service.getLockedExport(owner, created.runId!)
    expect(finalized.status).toBe("locked")
    expect(exported.segments).toEqual(segments)
    expect(exported).not.toHaveProperty("paragraphs")
  })

  it("rejects users without edit capability and users outside the run scope", async () => {
    const owner = access.resolve("user-owner", "tenant")
    const reviewer = access.resolve("user-reviewer", "tenant")
    if (owner.audience !== "tenant" || reviewer.audience !== "tenant") throw new Error("TENANT_CONTEXT_REQUIRED")
    const created = await service.create(owner)
    const input = { expectedRevision: created.revision, paragraphs: created.paragraphs }

    expect(() => service.saveDraft(reviewer, created.runId!, input)).toThrow("CAPABILITY_FORBIDDEN")
    expect(() => service.saveDraft({ ...owner, ipIds: [] }, created.runId!, input)).toThrow("RUN_NOT_FOUND")
  })

  it("locks the exact structure versions used by a run instead of retrieving them again", async () => {
    const owner = access.resolve("user-owner", "tenant")
    if (owner.audience !== "tenant") throw new Error("TENANT_CONTEXT_REQUIRED")
    const created = await service.create(owner)

    packages = [packageFor("template-v2")]
    const loaded = service.getRun(owner, created.runId!)

    expect(created.structureVersionIds).toEqual(["template-v1"])
    expect(loaded.structureVersionIds).toEqual(["template-v1"])
    expect(loaded.structureInfluence).toBe("已结合平台审核通过的内容结构")
  })

  it("新IP把内容画像字段传入创作模型且旧六字段流程保持可用", async () => {
    const owner = access.resolve("user-owner", "tenant")
    if (owner.audience !== "tenant") throw new Error("TENANT_CONTEXT_REQUIRED")
    const current = appDatabase.prepare(`SELECT i.id, i.profile_json
      FROM user_current_context c JOIN ip_profiles i ON i.id=c.ip_profile_id
      WHERE c.user_id=? AND c.tenant_id=?`).get(owner.userId, owner.tenantId) as { id: string; profile_json: string }
    const profile = JSON.parse(current.profile_json)
    profile.industryCategory = "health_wellness"
    profile.contentPortrait = {
      schemaVersion: 1,
      questionSetVersion: "ip-question-bank-v1",
      industryCategory: "health_wellness",
      identityPositioning: "真实经营经验分享者",
      credibilitySources: ["七年社区团购经验"],
      targetAudience: "想做本地生意的宝妈和小店主",
      audienceQuestions: ["如何判断选品是否适合邻居"],
      coreBeliefs: ["长期信任比短期销量重要"],
      contentAssets: ["选品记录和售后案例"],
      presentationStyles: ["真实故事"],
      commercialConnections: ["用选品方法自然连接产品"],
      desiredActions: ["关注并留言具体问题"],
      boundaries: ["不承诺收益"],
      topicPillars: [{ title: "真实选品判断", rationale: "受众高频问题", sourceQuestionIds: ["q01"] }],
      confirmedFacts: [{ statement: "七年社区团购经验", sourceQuestionIds: ["q02"] }],
      uncertainties: [],
      sourceMap: { targetAudience: ["q01"] },
    }
    appDatabase.prepare("UPDATE ip_profiles SET profile_json=? WHERE id=?")
      .run(JSON.stringify(profile), current.id)

    await service.create(owner)

    expect(adapter.calls[0].input).toMatchObject({
      ipProfile: {
        contentPortrait: {
          audienceQuestions: ["如何判断选品是否适合邻居"],
          coreBeliefs: ["长期信任比短期销量重要"],
          contentAssets: ["选品记录和售后案例"],
          topicPillars: [{ title: "真实选品判断" }],
        },
      },
    })
  })
})
