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
  it("returns one QA-passed locked draft without requiring manual selection", async () => {
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

    expect(result.run.state).toBe("LOCKED")
    expect(result.topicSelection?.topicId).toBe("topic-1")
    expect(result.scriptSelection?.scriptId).toBe("script-1")
    expect(result.qualityReport?.hardGatePassed).toBe(true)
    expect(result.lockedScript?.script.title).toBe("真正难的不是找货，是让邻居愿意一直信你")
    expect(adapter.calls.map((call) => call.operation)).toEqual(["auto_draft"])
    repository.close()
  })
})
