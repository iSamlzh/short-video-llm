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

export { minimumIpInput, topics }
