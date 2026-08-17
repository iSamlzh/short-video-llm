import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { TemplatePackage } from "../../src/domain/content-brain"
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

describe("content brain tenant boundary", () => {
  let appDatabase: ReturnType<typeof openDatabase>
  let repository: PrototypeRepository

  beforeEach(async () => {
    const directory = mkdtempSync(join(tmpdir(), "content-brain-security-"))
    appDatabase = openDatabase(join(directory, "app.sqlite"))
    await seedDemoData(appDatabase, "demo-password")
    repository = new PrototypeRepository(join(directory, "runs.sqlite"))
  })

  afterEach(() => {
    repository.close()
    appDatabase.close()
  })

  it("uses redacted structure rules for generation without exposing platform knowledge", async () => {
    const structure: TemplatePackage = {
      templateVersionId: "template-v1",
      templateId: "template-secret",
      name: "内部结构名称",
      applicability: { ipTags: ["社区团购选品与团长运营"], audiences: [], goals: [] },
      nodes: [{ kind: "hook", instruction: "用冲突开场", required: true }],
      qualityRules: ["需要具体动作"],
      riskRules: ["禁止收益承诺"],
    }
    const adapter = new PrototypeFixtureLlmAdapter()
    const runs = new RunService(repository, new StructuredLlmClient(adapter), () => [structure])
    const service = new CreationAppService(appDatabase, runs, new AutoCreationOrchestrator(runs))
    const access = new AccessService(new AccessRepository(appDatabase)).resolve("user-owner", "tenant")
    if (access.audience !== "tenant") throw new Error("TENANT_CONTEXT_REQUIRED")

    const result = await service.create(access)
    const serializedResult = JSON.stringify(result)
    const modelInput = JSON.stringify(adapter.calls[0]?.input)

    expect(result.structureVersionIds).toEqual(["template-v1"])
    expect(modelInput).toContain("用冲突开场")
    expect(modelInput).not.toContain("template-secret")
    expect(modelInput).not.toContain("template-v1")
    expect(serializedResult).not.toMatch(/nodes|qualityRules|riskRules|sourceText|evidenceRefs|rightsNote|operatorNote/)
  })
})
