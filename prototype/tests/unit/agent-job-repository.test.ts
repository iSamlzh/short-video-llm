import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type Database from "better-sqlite3"
import { AgentJobRepository } from "../../src/lib/db/agent-job-repository"
import { openDatabase } from "../../src/lib/db/database"
import { seedDemoData } from "../../src/scripts/demo-data"

describe("AgentJobRepository", () => {
  let database: Database.Database
  let repository: AgentJobRepository

  beforeEach(async () => {
    database = openDatabase(":memory:")
    await seedDemoData(database, "demo-password")
    repository = new AgentJobRepository(database)
  })

  afterEach(() => database.close())

  it("持久化排队状态并阻止同一样本重复运行", () => {
    const first = repository.enqueue({
      scopeType: "platform", scopeId: "platform", actorUserId: "user-platform",
      resourceId: "sample-one", idempotencyKey: "job-request-12345678",
    })
    const duplicate = repository.enqueue({
      scopeType: "platform", scopeId: "platform", actorUserId: "user-platform",
      resourceId: "sample-one", idempotencyKey: "another-request-12345678",
    })

    expect(first.created).toBe(true)
    expect(duplicate.created).toBe(false)
    expect(duplicate.job.id).toBe(first.job.id)
    expect(repository.claimNext()).toMatchObject({ id: first.job.id, status: "running", stage: "source_validation" })
  })

  it("可重试错误先自动回队，达到次数后保存终态", () => {
    const created = repository.enqueue({
      scopeType: "platform", scopeId: "platform", actorUserId: "user-platform",
      resourceId: "sample-two", idempotencyKey: "retry-request-12345678",
    }).job
    repository.claimNext()
    expect(repository.failOrRequeue(created.id, "LLM_TIMEOUT", true)).toMatchObject({
      status: "queued", stage: "retry_wait", attemptCount: 1,
    })
    database.prepare("UPDATE agent_jobs SET available_at=? WHERE id=?").run(new Date(0).toISOString(), created.id)
    repository.claimNext()
    expect(repository.failOrRequeue(created.id, "LLM_TIMEOUT", true)).toMatchObject({
      status: "timed_out", retryable: true, attemptCount: 2,
    })
  })

  it("完成任务时保存业务结果引用而不复制拆解正文", () => {
    const created = repository.enqueue({
      scopeType: "platform", scopeId: "platform", actorUserId: "user-platform",
      resourceId: "sample-three", idempotencyKey: "success-request-12345678",
    }).job
    repository.claimNext()
    const done = repository.succeed(created.id, "analysis-1")
    expect(done).toMatchObject({ status: "succeeded", stage: "review_ready", resultReference: "analysis-1" })
    expect(database.prepare("SELECT payload_json FROM agent_jobs WHERE id=?").get(created.id)).toEqual({
      payload_json: JSON.stringify({ sampleId: "sample-three" }),
    })
  })
})
