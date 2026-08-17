import Database from "better-sqlite3"
import { describe, expect, it } from "vitest"
import { openDatabase } from "../../src/lib/db/database"
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

  it("保留样本修订和拆解的不可变版本", () => {
    const database = openDatabase(":memory:")
    const repository = new ContentBrainRepository(database)
    const sample = repository.createSample({
      id: "sample-1",
      title: "一次售后让我重新理解团长",
      sourcePlatform: "wechat_channels",
      sourceUrl: "https://example.test/video/1",
      authorReference: "团长样本 A",
      transcript: "这是第一版真实经历正文，用来验证样本修订和拆解版本不会相互覆盖。",
      rightsNote: "已授权用于内部分析",
      dataOrigin: "formal",
      actorUserId: "platform-user",
      createdAt: "2026-08-17T12:00:00.000Z",
    })

    const revision2 = repository.appendSampleRevision(sample.id, {
      transcript: "这是修正后的真实经历正文，用来验证第二版样本正文独立保存。",
      contentHash: "hash-v2",
      expectedVersion: 1,
      actorUserId: "platform-user",
      createdAt: "2026-08-17T12:01:00.000Z",
    })
    const analysis1 = repository.appendAnalysis({
      id: "analysis-1", sampleId: sample.id, revisionId: revision2.id,
      payload: analysisPayload("第一次拆解"), model: "fixture", promptVersion: 1,
      actorUserId: "platform-user", createdAt: "2026-08-17T12:02:00.000Z",
    })
    const analysis2 = repository.appendAnalysis({
      id: "analysis-2", sampleId: sample.id, revisionId: revision2.id,
      payload: analysisPayload("第二次拆解"), model: "fixture", promptVersion: 1,
      actorUserId: "platform-user", createdAt: "2026-08-17T12:03:00.000Z",
    })

    expect(revision2.version).toBe(2)
    expect([analysis1.version, analysis2.version]).toEqual([1, 2])
    expect(repository.listSampleRevisions(sample.id).map((item) => item.transcript)).toEqual([
      "这是第一版真实经历正文，用来验证样本修订和拆解版本不会相互覆盖。",
      "这是修正后的真实经历正文，用来验证第二版样本正文独立保存。",
    ])
    database.close()
  })

  it("未满足启用条件时保留原活动版本", () => {
    const database = openDatabase(":memory:")
    const repository = new ContentBrainRepository(database)
    repository.saveVersion({
      id: "stable-v1", templateId: "trust", version: 1, name: "信任结构",
      nodes: ["真实场景", "行动方法"], status: "active", actorUserId: "platform-admin",
      dataOrigin: "formal", isGeneral: true,
    })

    expect(() => repository.activateCandidate("missing-candidate", {
      actorUserId: "platform-admin", reason: "启用新结构", expectedVersion: 1,
      createdAt: "2026-08-17T12:04:00.000Z",
    })).toThrow("CANDIDATE_NOT_ACTIVATABLE")
    expect(repository.listActive()).toEqual([expect.objectContaining({ id: "stable-v1" })])
    database.close()
  })
})

function analysisPayload(summary: string) {
  return {
    summary,
    nodes: [{ kind: "hook", instruction: "用真实冲突开场", required: true, evidenceRefs: ["e1"] }],
    reusablePatterns: ["具体事件开场"],
    nonReusableFacts: ["具体人物姓名"],
    applicability: { ipTags: ["团长"], audiences: ["社区用户"], goals: ["建立信任"] },
    riskNotes: ["不承诺收益"],
    evidenceRefs: [{ id: "e1", quote: "一次售后", start: 0, end: 4 }],
    suggestedDecision: "create_new" as const,
  }
}
