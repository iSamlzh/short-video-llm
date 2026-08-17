import Database from "better-sqlite3"
import { describe, expect, it } from "vitest"
import { ContentBrainRepository } from "../../src/lib/db/content-brain-repository"

describe("ContentBrainRepository", () => {
  it("only retrieves activated immutable structure versions", () => {
    const database = new Database(":memory:")
    database.exec(`CREATE TABLE platform_template_versions (
      id TEXT PRIMARY KEY, template_id TEXT NOT NULL, version INTEGER NOT NULL, name TEXT NOT NULL,
      payload_json TEXT NOT NULL, status TEXT NOT NULL, is_general INTEGER NOT NULL DEFAULT 0,
      data_origin TEXT NOT NULL, created_by_user_id TEXT NOT NULL, created_at TEXT NOT NULL, activated_at TEXT
    )`)
    const repository = new ContentBrainRepository(database)
    repository.saveVersion({ id: "v1", templateId: "trust", version: 1, name: "信任结构", nodes: ["真实场景", "认知转折"], status: "draft", actorUserId: "operator", dataOrigin: "demo", isGeneral: true })
    repository.saveVersion({ id: "v2", templateId: "trust", version: 2, name: "信任结构", nodes: ["真实场景", "认知转折", "行动方法"], status: "active", actorUserId: "operator", dataOrigin: "demo", isGeneral: true })

    expect(repository.listActive()).toEqual([expect.objectContaining({ id: "v2", version: 2 })])
    expect(repository.retrieveStructures()).toEqual(["真实场景 → 认知转折 → 行动方法"])
    database.close()
  })
})
