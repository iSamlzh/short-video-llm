import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { PrototypeRepository } from "../../src/lib/db/repository"
import { PrototypeFixtureLlmAdapter } from "../../src/lib/llm/fake"
import { StructuredLlmClient } from "../../src/lib/llm/structured"
import { RunService } from "../../src/services/run-service"
import { AutoCreationOrchestrator } from "../../src/services/auto-creation-orchestrator"

describe("AutoCreationOrchestrator", () => {
  it("returns one QA-passed draft awaiting confirmation without requiring manual selection", async () => {
    const directory = mkdtempSync(join(tmpdir(), "auto-creation-"))
    const repository = new PrototypeRepository(join(directory, "prototype.sqlite"))
    const adapter = new PrototypeFixtureLlmAdapter()
    const service = new RunService(repository, new StructuredLlmClient(adapter))
    const result = await new AutoCreationOrchestrator(service).createUsableDraft({
      displayName: "林姐",
      experience: "七年社区团购与团长运营经历，服务过十二个小区",
      expertise: "社区团购选品、社群维护与团长培训",
      audience: "想做本地生意的宝妈和小店主",
      voiceStyle: "直白、温和、讲真实案例",
      boundaries: "不承诺收益，不虚构成功案例，不贬低其他平台",
    })

    expect(result.run.state).toBe("WAITING_LOCK_CONFIRMATION")
    expect(result.topicSelection?.topicId).toBe("topic-1")
    expect(result.scriptSelection?.scriptId).toBe("script-1")
    expect(result.qualityReport?.hardGatePassed).toBe(true)
    expect(result.lockedScript).toBeNull()
    expect(result.scriptBatch?.items.find((script) => script.id === result.scriptSelection?.scriptId)?.title)
      .toBe("真正难的不是找货，是让邻居愿意一直信你")
    expect(adapter.calls.map((call) => call.operation)).toEqual(["auto_draft"])
    repository.close()
  })

  it("changes to the next existing topic instead of asking the model to recommend the same topic again", async () => {
    const directory = mkdtempSync(join(tmpdir(), "change-topic-"))
    const repository = new PrototypeRepository(join(directory, "prototype.sqlite"))
    const adapter = new PrototypeFixtureLlmAdapter()
    const service = new RunService(repository, new StructuredLlmClient(adapter))
    const orchestrator = new AutoCreationOrchestrator(service)
    const result = await orchestrator.createUsableDraft({
      displayName: "林姐",
      experience: "七年社区团购与团长运营经历，服务过十二个小区",
      expertise: "社区团购选品、社群维护与团长培训",
      audience: "想做本地生意的宝妈和小店主",
      voiceStyle: "直白、温和、讲真实案例",
      boundaries: "不承诺收益，不虚构成功案例，不贬低其他平台",
    }, {
      intent: "change_topic",
      topics: [
        { id: "topic-1", title: "旧选题方向", angle: "从真实经历说明旧选题的判断过程", audienceTension: "害怕选错方法", ipFitEvidence: ["七年经历"], structureId: "failure-turn", riskNotes: [] },
        { id: "topic-2", title: "新选题方向", angle: "从真实经历说明新选题的判断过程", audienceTension: "害怕选错方法", ipFitEvidence: ["七年经历"], structureId: "myth-correction", riskNotes: [] },
        { id: "topic-3", title: "备用选题方向", angle: "从真实经历说明备用选题的判断过程", audienceTension: "害怕选错方法", ipFitEvidence: ["七年经历"], structureId: "value-filter", riskNotes: [] },
      ],
      selectedTopicId: "topic-1",
      previousScript: { title: "旧稿", body: "这是一篇需要被替换的旧口播稿正文，内容已经足够长。" },
    })

    expect(result.topicSelection?.topicId).toBe("topic-2")
    expect(result.lockedScript).toBeNull()
    expect(result.scriptBatch?.items.find((script) => script.id === result.scriptSelection?.scriptId)?.topicDirectionId)
      .toBe("topic-2")
    expect(adapter.calls.map((call) => call.operation)).toEqual(["topic_draft"])
    repository.close()
  })
})
