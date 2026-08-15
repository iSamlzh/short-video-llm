import { beforeEach, describe, expect, it } from "vitest"
import { FakeLlmAdapter } from "../../src/lib/llm/fake"
import { StructuredLlmClient } from "../../src/lib/llm/structured"
import { PrototypeRepository } from "../../src/lib/db/repository"
import { RunService } from "../../src/services/run-service"

const minimumIpInput = {
  displayName: "示例团长",
  experience: "三年社区团购运营经历，服务过多个社区",
  expertise: "社区团购运营",
  audience: "希望拓展本地业务的人",
  voiceStyle: "直接、实在、有案例",
  boundaries: "不承诺确定收益",
}
const topics = Array.from({ length: 3 }, (_, index) => ({
  id: `topic-${index + 1}`,
  title: `团长真实经历选题${index + 1}`,
  angle: "从社区团购的真实经历切入，讲清可复用的方法",
  audienceTension: "想拓展业务但缺少可信方法",
  ipFitEvidence: ["三年社区团购运营经历"],
  structureId: "case-breakdown",
  riskNotes: [],
}))

describe("RunService topics", () => {
  let repository: PrototypeRepository
  let adapter: FakeLlmAdapter
  let service: RunService

  beforeEach(() => {
    repository = new PrototypeRepository(":memory:")
    adapter = new FakeLlmAdapter()
    service = new RunService(repository, new StructuredLlmClient(adapter))
  })

  it("creates three to five IP-fit topic directions", async () => {
    adapter.enqueue({ json: topics })
    const run = service.createRun(minimumIpInput)
    const result = await service.generateTopics(run.id, run.inputVersion)
    expect(result.items).toHaveLength(3)
    expect(result.items.every(item => item.ipFitEvidence.length > 0)).toBe(true)
    expect(service.getRun(run.id).state).toBe("WAITING_TOPIC_SELECTION")
  })

  it("keeps exactly one current topic selection", async () => {
    adapter.enqueue({ json: topics })
    const run = service.createRun(minimumIpInput)
    const batch = await service.generateTopics(run.id, run.inputVersion)
    service.selectTopic(run.id, batch.version, topics[0].id)
    service.selectTopic(run.id, batch.version, topics[1].id)
    expect(repository.listTopicSelections(run.id).filter(item => item.isCurrent)).toEqual([
      expect.objectContaining({ topicId: topics[1].id }),
    ])
  })
})

describe("RunService scripts", () => {
  it("stores exactly three scripts for the selected direction", async () => {
    const repository = new PrototypeRepository(":memory:")
    const adapter = new FakeLlmAdapter([{ json: topics }])
    const service = new RunService(repository, new StructuredLlmClient(adapter))
    const run = service.createRun(minimumIpInput)
    const topicBatch = await service.generateTopics(run.id, run.inputVersion)
    service.selectTopic(run.id, topicBatch.version, topics[0].id)
    const scripts = makeScripts(topics[0].id)
    adapter.enqueue({ json: scripts })

    const batch = await service.generateScripts(run.id, run.inputVersion)
    expect(batch.items).toHaveLength(3)
    expect(new Set(batch.items.map(item => item.topicDirectionId))).toEqual(new Set([topics[0].id]))
    expect(service.getRun(run.id).state).toBe("WAITING_SCRIPT_SELECTION")
  })

  it("rejects the whole batch when one script changes direction", async () => {
    const repository = new PrototypeRepository(":memory:")
    const adapter = new FakeLlmAdapter([{ json: topics }])
    const service = new RunService(repository, new StructuredLlmClient(adapter))
    const run = service.createRun(minimumIpInput)
    const topicBatch = await service.generateTopics(run.id, run.inputVersion)
    service.selectTopic(run.id, topicBatch.version, topics[0].id)
    const scripts = makeScripts(topics[0].id)
    scripts[2].topicDirectionId = "foreign-direction"
    adapter.enqueue({ json: scripts })

    await expect(service.generateScripts(run.id, run.inputVersion))
      .rejects.toMatchObject({ message: expect.stringContaining("SCRIPT_DIRECTION_MISMATCH") })
    expect(repository.listScriptBatches(run.id)).toHaveLength(0)
  })
})

describe("RunService QA and locking", () => {
  it("uses a separate QA model operation", async () => {
    const { service, adapter, run } = await selectedScriptFixture()
    adapter.enqueue({ json: qualityReport(true) })
    await service.runQa(run.id, run.inputVersion)
    expect(adapter.calls.at(-1)?.operation).toBe("qa")
  })

  it("does not lock a script that fails a hard gate", async () => {
    const { service, adapter, run } = await selectedScriptFixture()
    adapter.enqueue({ json: qualityReport(false) })
    await service.runQa(run.id, run.inputVersion)
    expect(() => service.lockScript(run.id)).toThrow("QA_HARD_GATE_BLOCKED")
  })
})

describe("RunService review", () => {
  it("passes simulated lineage to the review operation", async () => {
    const { service, adapter, run, snapshot } = await reviewFixture()
    adapter.enqueue({ json: reviewResult(false) })
    await service.generateReview(run.id, snapshot.version)
    const call = adapter.calls.at(-1)
    expect(call?.operation).toBe("review")
    expect(JSON.stringify(call?.input)).toContain('"isSimulated":true')
  })

  it("rejects a review that presents simulation as real causation", async () => {
    const { service, adapter, run, snapshot } = await reviewFixture()
    adapter.enqueue({ json: reviewResult(true) })
    await expect(service.generateReview(run.id, snapshot.version))
      .rejects.toMatchObject({ message: expect.stringContaining("REVIEW_CAUSALITY_VIOLATION") })
  })
})

async function selectedScriptFixture() {
  const repository = new PrototypeRepository(":memory:")
  const adapter = new FakeLlmAdapter([{ json: topics }])
  const service = new RunService(repository, new StructuredLlmClient(adapter))
  const run = service.createRun(minimumIpInput)
  const topicBatch = await service.generateTopics(run.id, run.inputVersion)
  service.selectTopic(run.id, topicBatch.version, topics[0].id)
  const scripts = makeScripts(topics[0].id)
  adapter.enqueue({ json: scripts })
  const scriptBatch = await service.generateScripts(run.id, run.inputVersion)
  service.selectScript(run.id, scriptBatch.version, scripts[0].id)
  return { repository, adapter, service, run }
}

function qualityReport(hardGatePassed: boolean) {
  return {
    hardGatePassed,
    hardGateReasons: hardGatePassed ? [] : ["存在无法核实的收益承诺"],
    scores: { hook: 82, ipFit: 90, credibility: 88, structure: 80, callToAction: 75 },
    suggestions: ["补充真实经历中的具体动作"],
  }
}

async function reviewFixture() {
  const fixture = await selectedScriptFixture()
  fixture.adapter.enqueue({ json: qualityReport(true) })
  await fixture.service.runQa(fixture.run.id, fixture.run.inputVersion)
  fixture.service.lockScript(fixture.run.id)
  const snapshot = fixture.service.simulatePublication(fixture.run.id)
  return { ...fixture, snapshot }
}

function reviewResult(claimsRealCausation: boolean) {
  return {
    summary: "这是一轮用于验证内容闭环的模拟表现摘要",
    keep: ["真实经历形成了可信表达"],
    improve: ["开头可以更快进入受众问题"],
    nextContent: "下一条继续沿这个方向拆解一个具体案例",
    evidenceLimits: "全部指标来自模拟器，不能代表平台真实表现或因果关系",
    claimsRealCausation,
  }
}

function makeScripts(topicDirectionId: string) {
  return Array.from({ length: 3 }, (_, index) => ({
    id: `script-${index + 1}`,
    topicDirectionId,
    title: `同一方向口播稿${index + 1}`,
    hook: "很多团长第一步就做错了",
    body: `这是第${index + 1}种表达路径。我用三年社区团购的真实经历，拆开讲清如何避免常见错误，并给出今天能执行的方法。`,
    callToAction: "想交流具体情况，可以留言",
    estimatedSeconds: 60,
  }))
}

export { makeScripts, minimumIpInput, qualityReport, reviewResult, topics }
