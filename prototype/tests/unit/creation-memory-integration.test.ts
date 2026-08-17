import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { AccessRepository } from "../../src/lib/db/access-repository"
import { CreationLineageRepository } from "../../src/lib/db/creation-lineage-repository"
import { openDatabase } from "../../src/lib/db/database"
import { PrototypeRepository } from "../../src/lib/db/repository"
import { PrototypeFixtureLlmAdapter } from "../../src/lib/llm/fake"
import { StructuredLlmClient } from "../../src/lib/llm/structured"
import { seedDemoData } from "../../src/scripts/demo-data"
import { AccessService } from "../../src/services/access-service"
import { AutoCreationOrchestrator } from "../../src/services/auto-creation-orchestrator"
import { CreationAppService } from "../../src/services/creation-app-service"
import { RunService } from "../../src/services/run-service"

describe("确认记忆回流到创作", () => {
  let appDatabase: ReturnType<typeof openDatabase>
  let repository: PrototypeRepository
  let adapter: PrototypeFixtureLlmAdapter
  let creation: CreationAppService
  let access: AccessService

  beforeEach(async () => {
    const directory = mkdtempSync(join(tmpdir(), "creation-memory-"))
    appDatabase = openDatabase(join(directory, "app.sqlite"))
    await seedDemoData(appDatabase, "demo-password")
    seedMemory(appDatabase, 1, "第一版记忆")
    seedMemory(appDatabase, 2, "保留真实邻里场景")
    repository = new PrototypeRepository(join(directory, "runs.sqlite"))
    adapter = new PrototypeFixtureLlmAdapter()
    const runs = new RunService(repository, new StructuredLlmClient(adapter))
    creation = new CreationAppService(appDatabase, runs, new AutoCreationOrchestrator(runs))
    access = new AccessService(new AccessRepository(appDatabase))
  })
  afterEach(() => { repository.close(); appDatabase.close() })

  it("只把最小化已确认记忆传给模型，并固定 Run 使用的版本", async () => {
    const owner = access.resolve("user-owner", "tenant")
    if (owner.audience !== "tenant") throw new Error("TENANT_CONTEXT_REQUIRED")
    const created = await creation.create(owner)
    const input = adapter.calls.find((call) => call.operation === "auto_draft")?.input

    expect(input).toMatchObject({ tenantMemory: {
      version: 2,
      keep: ["保留真实邻里场景"],
      avoid: ["避免空泛说教"],
      nextContentSignals: ["更快进入具体冲突"],
    } })
    expect(JSON.stringify(input)).not.toContain("evidenceLimits")
    expect(JSON.stringify(input)).not.toContain("rawMetrics")

    const lineage = new CreationLineageRepository(appDatabase)
    expect(lineage.get(created.runId!)?.tenantMemoryVersion).toBe(2)
    seedMemory(appDatabase, 3, "第三版记忆")
    expect(lineage.get(created.runId!)?.tenantMemoryVersion).toBe(2)
    expect(creation.getRun(owner, created.runId!).memoryInfluence).toEqual({
      version: 2,
      summary: "保留真实邻里场景；更快进入具体冲突",
    })
  })
})

function seedMemory(database: ReturnType<typeof openDatabase>, version: number, keep: string) {
  database.prepare(`INSERT INTO tenant_memory_versions
    (id,tenant_id,ip_profile_id,content_account_id,version,payload_json,confirmed_by_user_id,created_at,
     source_review_id,content_hash,schema_version)
    VALUES (?,'tenant-linjie','ip-linjie','account-linjie-wechat',?,?,'user-owner',?, ?,?,1)`).run(
    `memory-${version}`, version, JSON.stringify({
      keep: [keep], avoid: ["避免空泛说教"], nextContentSignals: ["更快进入具体冲突"],
      evidenceLimits: "只表达相关性",
    }), `2026-08-17T0${version}:00:00Z`, `review-${version}`, `hash-${version}`,
  )
}
