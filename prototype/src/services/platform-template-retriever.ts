import type { ContentBrainRepository } from "../lib/db/content-brain-repository"

export class PlatformTemplateRetriever {
  constructor(private readonly repository: ContentBrainRepository) {}

  retrieve(query: { ipTags: string[]; audience: string; goal: string }) {
    const active = this.repository.listActivePackages()
    if (!active.length) {
      throw templateAvailabilityError("NO_ACTIVE_TEMPLATE", "平台尚未启用可用的内容结构")
    }
    const specialized = active.filter((item) => !item.isGeneral)
      .map((item) => ({ item, score: score(item.applicability, query) }))
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score
        || right.item.sourceCount - left.item.sourceCount
        || left.item.templateVersionId.localeCompare(right.item.templateVersionId))
      .slice(0, 3)
      .map(({ item: { isGeneral: _isGeneral, sourceCount: _sourceCount, ...item } }) => item)
    if (specialized.length) return specialized
    const general = active.filter((item) => item.isGeneral).slice(0, 1)
      .map(({ isGeneral: _isGeneral, sourceCount: _sourceCount, ...item }) => item)
    if (general.length) return general
    throw templateAvailabilityError("NO_APPLICABLE_TEMPLATE", "当前 IP 暂无匹配的定向结构，且通用内容结构未启用")
  }
}

function templateAvailabilityError(code: "NO_ACTIVE_TEMPLATE" | "NO_APPLICABLE_TEMPLATE", message: string) {
  return Object.assign(new Error(message), { code, status: 503, retryable: false })
}

function score(
  applicability: { ipTags: string[]; audiences: string[]; goals: string[] },
  query: { ipTags: string[]; audience: string; goal: string },
) {
  const ip = applicability.ipTags.some((tag) => query.ipTags.includes(tag)) ? 4 : 0
  const audience = applicability.audiences.includes(query.audience) ? 2 : 0
  const goal = applicability.goals.includes(query.goal) ? 1 : 0
  return ip + audience + goal
}
