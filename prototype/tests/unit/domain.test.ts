import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { transition } from "../../src/domain/state-machine"
import { PrototypeRepository } from "../../src/lib/db/repository"

const opened: PrototypeRepository[] = []
const minimumIpInput = {
  displayName: "示例团长",
  experience: "三年社区团购运营经历，服务过多个社区",
  expertise: "社区团购运营",
  audience: "希望拓展本地业务的人",
  voiceStyle: "直接、实在、有案例",
  boundaries: "不承诺确定收益",
}

function repositoryAt(path: string) {
  const repository = new PrototypeRepository(path)
  opened.push(repository)
  return repository
}

afterEach(() => {
  for (const repository of opened.splice(0)) repository.close()
})

describe("prototype domain", () => {
  it("rejects script generation before topic selection", () => {
    expect(() => transition("WAITING_TOPIC_SELECTION", "GENERATE_SCRIPTS"))
      .toThrow("INVALID_TRANSITION")
  })

  it("moves a confirmed or locked script back to QA after a saved revision", () => {
    expect(transition("WAITING_LOCK_CONFIRMATION", "SAVE_SCRIPT_REVISION")).toBe("READY_FOR_QA")
    expect(transition("LOCKED", "SAVE_SCRIPT_REVISION")).toBe("READY_FOR_QA")
  })

  it("restores the current run after reopening SQLite", () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "content-prototype-")), "run.sqlite")
    const first = repositoryAt(dbPath)
    const run = first.createRun(minimumIpInput)
    first.close()
    opened.splice(opened.indexOf(first), 1)

    const reopened = repositoryAt(dbPath)
    expect(reopened.getRun(run.id)?.state).toBe("READY_FOR_TOPICS")
    expect(reopened.getRun(run.id)?.ipProfile.displayName).toBe("示例团长")
  })

  it("returns the same topic batch for an idempotent command", () => {
    const repository = repositoryAt(":memory:")
    const run = repository.createRun(minimumIpInput)
    const items = [{
      id: "topic-1",
      title: "我做社区团购踩过的坑",
      angle: "用三年真实经历拆解新团长最容易忽略的问题",
      audienceTension: "想拓客但害怕没有方法",
      ipFitEvidence: ["三年社区团购经历"],
      structureId: "failure-turn",
      riskNotes: [],
      decisionBrief: {
        objective: "建立信任" as const,
        whyToday: "当前受众正在判断这些经验是否值得长期相信。",
        audienceProblem: "想找到适合自己的方法，但害怕做出错误判断。",
        ipEvidenceRefs: [{ label: "三年社区团购经历", sourceAnswerId: "profile:experience" }],
        recentDataStatus: "none" as const,
        repetitionRisk: "low" as const,
        nextSignal: "发布后观察完播率和评论中的真实问题。",
      },
    }]
    const first = repository.saveTopicBatch(run.id, run.inputVersion, items, "topics:1")
    const second = repository.saveTopicBatch(run.id, run.inputVersion, items, "topics:1")
    expect(second.version).toBe(first.version)
    expect(repository.listTopicBatches(run.id)).toHaveLength(1)
  })
})
