import Database from "better-sqlite3"
import { describe, expect, it } from "vitest"
import { CreationLineageRepository } from "../../src/lib/db/creation-lineage-repository"

describe("CreationLineageRepository", () => {
  it("keeps one current daily run inside the exact tenant/IP/account scope", () => {
    const database = new Database(":memory:")
    database.exec(`CREATE TABLE creation_run_context (
      run_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, actor_user_id TEXT NOT NULL,
      ip_profile_id TEXT NOT NULL, content_account_id TEXT, business_date TEXT NOT NULL,
      tenant_memory_version INTEGER, structure_version_ids_json TEXT NOT NULL DEFAULT '[]',
      trigger_type TEXT NOT NULL DEFAULT 'manual', source_review_id TEXT,
      created_at TEXT NOT NULL
    )`)
    const repository = new CreationLineageRepository(database)
    repository.attach({ runId: "run-1", tenantId: "tenant-1", actorUserId: "owner", ipId: "ip-1", accountId: "account-1", businessDate: "2026-08-17", tenantMemoryVersion: 2, structureVersionIds: ["template-v1"] })
    repository.attach({ runId: "run-2", tenantId: "tenant-1", actorUserId: "owner", ipId: "ip-1", accountId: "account-1", businessDate: "2026-08-17", tenantMemoryVersion: 3, structureVersionIds: ["template-v2"] })

    expect(repository.current("tenant-1", "ip-1", "account-1", "2026-08-17")?.runId).toBe("run-2")
    expect(repository.get("run-1")?.tenantMemoryVersion).toBe(2)
    expect(repository.get("run-1")?.structureVersionIds).toEqual(["template-v1"])
    expect(repository.get("run-1")?.triggerType).toBe("manual")
    expect(repository.canAccess("run-2", { tenantId: "tenant-2", ipIds: ["ip-1"], contentAccountIds: ["account-1"] })).toBe(false)
    database.close()
  })
})
