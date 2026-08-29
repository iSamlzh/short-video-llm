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

describe("结构使用血缘", () => {
  let database: ReturnType<typeof openDatabase>
  let repository: PrototypeRepository

  beforeEach(async () => {
    const path = join(mkdtempSync(join(tmpdir(), "structure-usage-")), "app.sqlite")
    database = openDatabase(path)
    await seedDemoData(database, "demo-password")
    repository = new PrototypeRepository(path)
  })

  afterEach(() => {
    repository.close()
    database.close()
  })

  it("定稿时原子记录唯一主结构、辅助结构和命中节点", async () => {
    const now = new Date().toISOString()
    const insert = database.prepare(`INSERT INTO platform_template_versions
      (id,template_id,version,name,payload_json,status,is_general,data_origin,created_by_user_id,created_at,activated_at)
      VALUES (?,?,?,?,?,'active',0,'formal','user-platform',?,?)`)
    insert.run("lineage-primary-v1", "lineage-primary", 1, "主结构", "{}", now, now)
    insert.run("lineage-support-v1", "lineage-support", 1, "辅助结构", "{}", now, now)
    const packages: TemplatePackage[] = [
      {
        templateVersionId: "lineage-primary-v1", templateId: "lineage-primary", name: "主结构",
        applicability: { ipTags: [], audiences: [], goals: [] },
        nodes: [
          { nodeKey: "hook-conflict", kind: "hook", instruction: "冲突开场", required: true },
          { nodeKey: "body-case", kind: "case", instruction: "案例展开", required: true },
          { nodeKey: "close-action", kind: "cta", instruction: "行动收束", required: true },
        ],
        qualityRules: [], riskRules: [],
      },
      {
        templateVersionId: "lineage-support-v1", templateId: "lineage-support", name: "辅助结构",
        applicability: { ipTags: [], audiences: [], goals: [] },
        nodes: [{ nodeKey: "support-hook", kind: "hook", instruction: "辅助开场", required: true }],
        qualityRules: [], riskRules: [],
      },
    ]
    const runs = new RunService(
      repository,
      new StructuredLlmClient(new PrototypeFixtureLlmAdapter()),
      () => packages,
    )
    const service = new CreationAppService(database, runs, new AutoCreationOrchestrator(runs))
    const owner = new AccessService(new AccessRepository(database)).resolve("user-owner", "tenant")
    if (owner.audience !== "tenant") throw new Error("TENANT_CONTEXT_REQUIRED")

    const created = await service.create(owner, {}, "2026-08-29")
    await service.finalize(owner, created.runId!, {
      expectedRevision: created.revision,
      segments: created.segments,
    })

    const usage = database.prepare("SELECT * FROM structure_usage_records WHERE run_id=?")
      .get(created.runId) as Record<string, unknown>
    expect(usage.primary_structure_version_id).toBe("lineage-primary-v1")
    expect(JSON.parse(String(usage.supporting_structure_version_ids_json))).toEqual(["lineage-support-v1"])
    expect(usage.attribution_status).toBe("attributed")
    const nodes = database.prepare(`SELECT DISTINCT node_key FROM structure_usage_nodes
      WHERE usage_id=? ORDER BY node_key`).all(usage.id) as Array<{ node_key: string }>
    expect(nodes.map((item) => item.node_key)).toEqual(["body-case", "close-action", "hook-conflict"])
  })
})
