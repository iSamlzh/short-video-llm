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

  it("活动结构包保留供运营台账展示的正式版本号", () => {
    const database = openDatabase(":memory:")
    const repository = new ContentBrainRepository(database)
    repository.saveVersion({
      id: "trust-v3", templateId: "trust", version: 3, name: "真实冲突到责任原则",
      nodes: ["真实冲突", "处理动作", "责任原则"], status: "active", actorUserId: "platform-admin",
      dataOrigin: "formal", isGeneral: false,
    })

    expect(repository.listActivePackages()).toEqual([
      expect.objectContaining({ templateVersionId: "trust-v3", templateId: "trust", version: 3 }),
    ])
    database.close()
  })

  it("工作队列按人工处理优先级排序，并且同阶段保留先入先出", () => {
    const database = openDatabase(":memory:")
    seedPlatformUser(database)
    const repository = new ContentBrainRepository(database)
    createQueueSample(repository, "waiting-old", "旧的待拆解样本", "2026-08-01T10:00:00.000Z")
    createQueueSample(repository, "waiting-new", "新的待拆解样本", "2026-08-29T10:00:00.000Z")
    createQueueSample(repository, "failed", "模型失败样本", "2026-08-02T10:00:00.000Z")
    createQueueSample(repository, "review", "等待人工复核", "2026-08-03T10:00:00.000Z")
    createQueueSample(repository, "decision", "等待结构决策", "2026-08-04T10:00:00.000Z")
    repository.updateSampleStatus("review", "review_required", "2026-08-03T11:00:00.000Z")
    repository.updateSampleStatus("decision", "candidate_ready", "2026-08-04T11:00:00.000Z")
    insertJob(database, { id: "job-failed", sampleId: "failed", status: "failed", createdAt: "2026-08-02T10:01:00.000Z", retryable: 1 })

    const page = repository.listSampleQueue({ queue: "todo", limit: 20 })

    expect(page.items.map((item) => [item.id, item.workStage])).toEqual([
      ["failed", "failed"], ["review", "review_required"], ["decision", "decision_required"],
      ["waiting-old", "waiting_analysis"], ["waiting-new", "waiting_analysis"],
    ])
    expect(page.counts).toEqual(expect.objectContaining({ todo: 5, failed: 1, review_required: 1, decision_required: 1, waiting_analysis: 2, all: 5 }))
    database.close()
  })

  it("只关联样本的最新任务，并支持批次、平台、关键词和日期筛选", () => {
    const database = openDatabase(":memory:")
    seedPlatformUser(database)
    const repository = new ContentBrainRepository(database)
    createQueueSample(repository, "sample-target", "创业者如何复盘第一次失败", "2026-08-15T10:00:00.000Z", "douyin", "创业者老周")
    createQueueSample(repository, "sample-other", "团长售后复盘", "2026-07-15T10:00:00.000Z", "wechat_channels", "林姐")
    insertJob(database, { id: "job-old", sampleId: "sample-target", status: "failed", createdAt: "2026-08-15T10:01:00.000Z", retryable: 1, batchId: "batch-old" })
    insertJob(database, { id: "job-latest", sampleId: "sample-target", status: "queued", createdAt: "2026-08-15T10:02:00.000Z", batchId: "batch-202608" })

    const page = repository.listSampleQueue({
      queue: "waiting_analysis", q: "创业者", sourcePlatform: "douyin", batchId: "batch-202608",
      createdFrom: "2026-08-01T00:00:00.000Z", createdToExclusive: "2026-09-01T00:00:00.000Z", limit: 20,
    })

    expect(page.items).toEqual([expect.objectContaining({
      id: "sample-target", authorReference: "创业者老周", workStage: "waiting_analysis",
      latestJob: expect.objectContaining({ id: "job-latest", batchId: "batch-202608", status: "queued" }),
    })])
    expect(page.counts).toEqual(expect.objectContaining({ todo: 1, waiting_analysis: 1, all: 1 }))
    database.close()
  })

  it("游标分页在同一排序键下不丢失、不重复", () => {
    const database = openDatabase(":memory:")
    seedPlatformUser(database)
    const repository = new ContentBrainRepository(database)
    for (let index = 0; index < 123; index += 1) {
      createQueueSample(repository, `sample-${String(index).padStart(3, "0")}`, `批量样本 ${index}`, "2026-08-20T10:00:00.000Z")
    }

    const ids: string[] = []
    let cursor: string | undefined
    do {
      const page = repository.listSampleQueue({ queue: "todo", cursor, limit: 25 })
      ids.push(...page.items.map((item) => item.id))
      cursor = page.nextCursor ?? undefined
    } while (cursor)

    expect(ids).toHaveLength(123)
    expect(new Set(ids).size).toBe(123)
    expect(ids.at(0)).toBe("sample-000")
    expect(ids.at(-1)).toBe("sample-122")
    database.close()
  })

  it("万级样本下首屏队列查询保持在可交互时间内", () => {
    const database = openDatabase(":memory:")
    seedPlatformUser(database)
    const insert = database.prepare(`INSERT INTO platform_content_samples
      (id,title,source_platform,source_text,rights_note,status,data_origin,created_by_user_id,created_at,current_revision_version,workflow_status,updated_at)
      VALUES (?,?,?,?,?,'pending','formal','platform-user',?,1,?,?)`)
    database.transaction(() => {
      for (let index = 0; index < 10_000; index += 1) {
        const timestamp = new Date(Date.UTC(2026, 7, 1, 0, 0, index)).toISOString()
        insert.run(`scale-${index}`, `规模测试样本 ${index}`, index % 2 ? "douyin" : "wechat_channels", "性能测试正文", "已授权", timestamp, index % 5 === 0 ? "completed" : "draft", timestamp)
      }
    })()
    const repository = new ContentBrainRepository(database)

    const startedAt = performance.now()
    const page = repository.listSampleQueue({ queue: "todo", limit: 50 })
    const elapsedMs = performance.now() - startedAt

    expect(page.items).toHaveLength(50)
    expect(page.counts).toEqual(expect.objectContaining({ todo: 8_000, completed: 2_000, all: 10_000 }))
    expect(elapsedMs).toBeLessThan(1_500)
    database.close()
  })
})

function seedPlatformUser(database: Database.Database) {
  database.prepare(`INSERT INTO users
    (id,email_normalized,display_name,password_hash,audience,platform_role,status,data_origin,created_at)
    VALUES ('platform-user','operator@example.test','平台运营','hash','platform','platform_operator','active','formal','2026-08-01T00:00:00.000Z')`).run()
}

function createQueueSample(repository: ContentBrainRepository, id: string, title: string, createdAt: string, sourcePlatform = "wechat_channels", authorReference = "样本作者") {
  return repository.createSample({
    id, title, sourcePlatform, sourceUrl: `https://example.test/${id}`, authorReference,
    transcript: "这是一段用于验证平台样本工作队列的数据，包含足够的正文信息并且已经获得内部分析授权。",
    rightsNote: "已授权用于内部分析", dataOrigin: "formal", actorUserId: "platform-user", createdAt,
  })
}

function insertJob(database: Database.Database, input: { id: string; sampleId: string; status: "queued" | "failed"; createdAt: string; retryable?: 0 | 1; batchId?: string }) {
  database.prepare(`INSERT INTO agent_jobs
    (id,scope_type,scope_id,actor_user_id,job_type,resource_type,resource_id,batch_id,idempotency_key,status,stage,
     progress_message,payload_json,error_code,retryable,attempt_count,max_attempts,available_at,finished_at,created_at,updated_at)
    VALUES (?,'platform','platform','platform-user','content_analysis','content_sample',?,?,? ,?,'queued',?,'{}',?, ?,1,2,?,?,?,?)`).run(
    input.id, input.sampleId, input.batchId ?? null, `idem-${input.id}`, input.status,
    input.status === "failed" ? "模型返回结构不完整" : "等待 Agent 接手",
    input.status === "failed" ? "LLM_INVALID_RESPONSE" : null, input.retryable ?? 0,
    input.createdAt, input.status === "failed" ? input.createdAt : null, input.createdAt, input.createdAt,
  )
}

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
