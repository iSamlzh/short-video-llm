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

describe("CreationAppService draft lifecycle", () => {
  let appDatabase: ReturnType<typeof openDatabase>
  let repository: PrototypeRepository
  let adapter: PrototypeFixtureLlmAdapter
  let service: CreationAppService
  let access: AccessService

  beforeEach(async () => {
    const directory = mkdtempSync(join(tmpdir(), "creation-app-service-"))
    appDatabase = openDatabase(join(directory, "app.sqlite"))
    await seedDemoData(appDatabase, "demo-password")
    repository = new PrototypeRepository(join(directory, "runs.sqlite"))
    adapter = new PrototypeFixtureLlmAdapter()
    const runs = new RunService(repository, new StructuredLlmClient(adapter), () => ["真实场景—认知转折—行动方法"])
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

  it("rejects users without edit capability and users outside the run scope", async () => {
    const owner = access.resolve("user-owner", "tenant")
    const reviewer = access.resolve("user-reviewer", "tenant")
    if (owner.audience !== "tenant" || reviewer.audience !== "tenant") throw new Error("TENANT_CONTEXT_REQUIRED")
    const created = await service.create(owner)
    const input = { expectedRevision: created.revision, paragraphs: created.paragraphs }

    expect(() => service.saveDraft(reviewer, created.runId!, input)).toThrow("CAPABILITY_FORBIDDEN")
    expect(() => service.saveDraft({ ...owner, ipIds: [] }, created.runId!, input)).toThrow("RUN_NOT_FOUND")
  })
})
