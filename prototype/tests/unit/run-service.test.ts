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
  decisionBrief: {
    objective: "建立信任" as const,
    whyToday: "今天需要先回答受众对长期经营可信度的疑问。",
    audienceProblem: "想拓展业务但缺少可信方法",
    ipEvidenceRefs: [{ label: "三年社区团购运营经历", sourceAnswerId: "profile:experience" }],
    recentDataStatus: "none" as const,
    repetitionRisk: "low" as const,
    nextSignal: "发布后观察完播和咨询问题。",
  },
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

  it("records a failed topic-generation step before returning to the retry checkpoint", async () => {
    const run = service.createRun(minimumIpInput)

    await expect(service.generateTopics(run.id, run.inputVersion)).rejects.toThrow("FAKE_LLM_RESPONSE_MISSING")

    expect(service.getRun(run.id).state).toBe("READY_FOR_TOPICS")
    expect(repository.listStepErrors(run.id)).toEqual([
      expect.objectContaining({ errorCode: "FAKE_LLM_RESPONSE_MISSING:topics", retryFromState: "READY_FOR_TOPICS" }),
    ])
  })

  it("拒绝模型引用当前 IP 证据目录之外的回答", async () => {
    adapter.enqueue({ json: topics.map((topic, index) => index === 0 ? {
      ...topic,
      decisionBrief: {
        ...topic.decisionBrief,
        ipEvidenceRefs: [{ label: "不存在的经历", sourceAnswerId: "answer-foreign" }],
      },
    } : topic) })
    const run = service.createRun(minimumIpInput)

    await expect(service.generateTopics(run.id, run.inputVersion)).rejects.toThrow("DECISION_EVIDENCE_INVALID")
    expect(repository.listTopicBatches(run.id)).toHaveLength(0)
  })
})

describe("RunService scripts", () => {
  it("generates scripts immediately after a topic is selected", async () => {
    const repository = new PrototypeRepository(":memory:")
    const adapter = new FakeLlmAdapter([{ json: topics }])
    const service = new RunService(repository, new StructuredLlmClient(adapter))
    const run = service.createRun(minimumIpInput)
    const topicBatch = await service.generateTopics(run.id, run.inputVersion)
    adapter.enqueue({ json: makeScripts(topics[0].id) })

    const scriptBatch = await service.selectTopicAndGenerateScripts(
      run.id,
      topicBatch.version,
      topics[0].id,
      run.inputVersion,
    )

    expect(scriptBatch.items).toHaveLength(3)
    expect(service.getRun(run.id).state).toBe("WAITING_SCRIPT_SELECTION")
  })

  it("keeps the topic selection when automatic script generation fails", async () => {
    const repository = new PrototypeRepository(":memory:")
    const adapter = new FakeLlmAdapter([{ json: topics }])
    const service = new RunService(repository, new StructuredLlmClient(adapter))
    const run = service.createRun(minimumIpInput)
    const topicBatch = await service.generateTopics(run.id, run.inputVersion)

    await expect(service.selectTopicAndGenerateScripts(
      run.id,
      topicBatch.version,
      topics[0].id,
      run.inputVersion,
    )).rejects.toThrow("FAKE_LLM_RESPONSE_MISSING")

    expect(repository.getCurrentTopicSelection(run.id)?.topicId).toBe(topics[0].id)
    expect(service.getRun(run.id).state).toBe("READY_FOR_SCRIPTS")
  })

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

  it("binds QA and locked output to the selected script revision", async () => {
    const { repository, service, adapter, run } = await selectedScriptFixture()
    const selection = repository.getCurrentScriptSelection(run.id)!
    adapter.enqueue({ json: qualityReport(true) })

    await service.runQa(run.id, run.inputVersion)
    const report = repository.getLatestQualityReport(run.id)
    expect(report?.scriptSelectionVersion).toBe(selection.version)

    service.lockScript(run.id)
    expect(repository.getLatestLockedScript(run.id)?.scriptSelectionVersion).toBe(selection.version)
  })

  it("saves an edited script as a new immutable selection", async () => {
    const { repository, service, adapter, run } = await selectedScriptFixture()
    adapter.enqueue({ json: qualityReport(true) })
    await service.runQa(run.id, run.inputVersion)
    const before = repository.getCurrentScriptSelection(run.id)!

    const result = service.saveScriptRevision(run.id, before.version, ["新开头", "这是人工修改后的完整正文内容，保存后必须形成一个不可覆盖的新版本。", "新结尾"])

    expect(result.saved).toBe(true)
    expect(result.revision).toBe(before.version + 1)
    expect(service.getRun(run.id).state).toBe("READY_FOR_QA")
    expect(repository.listScriptBatches(run.id)).toHaveLength(2)
  })

  it("rejects a save based on a stale script revision", async () => {
    const { repository, service, adapter, run } = await selectedScriptFixture()
    adapter.enqueue({ json: qualityReport(true) })
    await service.runQa(run.id, run.inputVersion)
    const before = repository.getCurrentScriptSelection(run.id)!
    service.saveScriptRevision(run.id, before.version, ["版本二开头", "这是版本二的完整正文内容，用于验证并发编辑时不能静默覆盖。", "版本二结尾"])

    expect(() => service.saveScriptRevision(run.id, before.version, ["冲突开头", "这是冲突客户端提交的正文内容，不应该覆盖已经保存的新版本。", "冲突结尾"]))
      .toThrow("SCRIPT_VERSION_CONFLICT")
  })

  it("does not create a revision when paragraphs are unchanged", async () => {
    const { repository, service, adapter, run } = await selectedScriptFixture()
    adapter.enqueue({ json: qualityReport(true) })
    await service.runQa(run.id, run.inputVersion)
    const selection = repository.getCurrentScriptSelection(run.id)!
    const script = repository.getSelectedScript(run.id)!

    const result = service.saveScriptRevision(run.id, selection.version, [script.hook, script.body, script.callToAction])

    expect(result).toMatchObject({ saved: false, revision: selection.version })
    expect(repository.listScriptBatches(run.id)).toHaveLength(1)
  })

  it("rejects locking when QA belongs to an older script revision", async () => {
    const { repository, service, adapter, run } = await selectedScriptFixture()
    adapter.enqueue({ json: qualityReport(true) })
    await service.runQa(run.id, run.inputVersion)
    const selection = repository.getCurrentScriptSelection(run.id)!
    service.saveScriptRevision(run.id, selection.version, ["更新开头", "这是 QA 之后更新的正文内容，旧质量报告不能用于锁定这个版本。", "更新结尾"])

    expect(() => service.lockScript(run.id)).toThrow("QA_RESULT_STALE")
  })

  it("returns the same lock when the same revision is finalized twice", async () => {
    const { service, adapter, run } = await selectedScriptFixture()
    adapter.enqueue({ json: qualityReport(true) })
    await service.runQa(run.id, run.inputVersion)

    const first = service.lockScript(run.id)
    const second = service.lockScript(run.id)

    expect(second.version).toBe(first.version)
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
