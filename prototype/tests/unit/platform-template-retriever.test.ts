import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type Database from "better-sqlite3"
import { openDatabase } from "../../src/lib/db/database"
import { ContentBrainRepository } from "../../src/lib/db/content-brain-repository"
import { PlatformTemplateRetriever } from "../../src/services/platform-template-retriever"

describe("PlatformTemplateRetriever", () => {
  let database: Database.Database
  let repository: ContentBrainRepository
  let retriever: PlatformTemplateRetriever

  beforeEach(() => {
    database = openDatabase(":memory:")
    repository = new ContentBrainRepository(database)
    retriever = new PlatformTemplateRetriever(repository)
  })

  afterEach(() => database.close())

  it("只返回匹配的已启用脱敏结构包", () => {
    insertPackage(database, "leader-v1", "leader", false, ["团长"], "active")
    insertPackage(database, "general-v1", "general", true, [], "active")
    insertPackage(database, "draft-v1", "draft", false, ["团长"], "draft")

    const result = retriever.retrieve({ ipTags: ["团长"], audience: "本地经营者", goal: "建立信任" })

    expect(result.map((item) => item.templateVersionId)).toEqual(["leader-v1"])
    expect(JSON.stringify(result)).not.toMatch(/sourceText|rightsNote|evidenceRefs|operator/)
  })

  it("没有专用结构时返回通用结构，完全为空时明确失败", () => {
    insertPackage(database, "general-v1", "general", true, [], "active")
    expect(retriever.retrieve({ ipTags: ["美食"], audience: "宝妈", goal: "建立信任" }))
      .toEqual([expect.objectContaining({ templateVersionId: "general-v1" })])

    database.prepare("UPDATE platform_template_versions SET status='inactive'").run()
    try {
      retriever.retrieve({ ipTags: ["美食"], audience: "宝妈", goal: "建立信任" })
      throw new Error("EXPECTED_RETRIEVAL_FAILURE")
    } catch (error) {
      expect(error).toMatchObject({ code: "NO_ACTIVE_TEMPLATE", status: 503, retryable: false })
    }
  })

  it("只有不匹配的定向结构时明确报告缺少适用结构", () => {
    database.prepare("UPDATE platform_template_versions SET status='inactive'").run()
    insertPackage(database, "startup-v1", "startup", false, ["创业"], "active")

    try {
      retriever.retrieve({ ipTags: ["健康管理"], audience: "家庭用户", goal: "健康科普" })
      throw new Error("EXPECTED_RETRIEVAL_FAILURE")
    } catch (error) {
      expect(error).toMatchObject({
        code: "NO_APPLICABLE_TEMPLATE",
        status: 503,
        retryable: false,
        message: "当前 IP 暂无匹配的定向结构，且通用内容结构未启用",
      })
    }
  })
})

function insertPackage(
  database: Database.Database,
  id: string,
  templateId: string,
  isGeneral: boolean,
  ipTags: string[],
  status: "active" | "draft",
) {
  database.prepare(`INSERT INTO platform_template_versions
    (id,template_id,version,name,payload_json,status,is_general,data_origin,created_by_user_id,created_at,activated_at)
    VALUES (?,?,1,?,?,?,?,'formal','platform-admin','2026-08-17T12:00:00.000Z',?)`).run(
    id, templateId, `${templateId} 结构`, JSON.stringify({
      applicability: { ipTags, audiences: ["本地经营者"], goals: ["建立信任"] },
      nodes: [{ kind: "hook", instruction: "真实冲突开场", required: true }],
      qualityRules: ["包含具体动作"], riskRules: ["不得承诺收益"],
    }), status, isGeneral ? 1 : 0, status === "active" ? "2026-08-17T12:00:00.000Z" : null,
  )
}
