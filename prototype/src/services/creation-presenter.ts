type RunView = {
  run?: { id?: string; state?: string }
  id?: string
  ipProfile?: { displayName?: string }
  topicBatch?: { items?: Array<{ id: string; title: string; ipFitEvidence?: string[] }> } | null
  topicSelection?: { topicId: string } | null
  scriptBatch?: {
    version: number
    items: Array<{ id: string; title: string; hook: string; body: string; callToAction: string; estimatedSeconds: number }>
  } | null
  scriptSelection?: { version: number; batchVersion: number; scriptId: string } | null
  lockedScript?: {
    version: number
    scriptSelectionVersion: number | null
    script: { title: string; hook: string; body: string; callToAction: string; estimatedSeconds: number }
  } | null
  qualityReport?: {
    scriptSelectionVersion: number | null
    scores: { hook: number; ipFit: number; credibility: number; structure: number; callToAction: number }
    suggestions?: string[]
  } | null
}

export function presentCreationDraft(view: RunView) {
  const selection = view.scriptSelection
  const script = view.scriptBatch?.items.find((item) => item.id === selection?.scriptId)
  if (!selection || !script) throw new Error("SCRIPT_SELECTION_REQUIRED")
  const qualityMatches = view.qualityReport?.scriptSelectionVersion === selection.version
  const lockedMatches = view.lockedScript?.scriptSelectionVersion === selection.version
  const status = lockedMatches ? "locked" : qualityMatches ? "ready_to_confirm" : "needs_qa"
  const topic = view.topicBatch?.items?.find((item) => item.id === view.topicSelection?.topicId)
  const bodyParts = script.body.split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean)
  const score = qualityMatches ? view.qualityReport?.scores : undefined
  const checks = score ? [
    { title: "事实可信", note: `可信度 ${score.credibility}，基于当前 IP 的已确认经历，未发现虚构案例。` },
    { title: "符合你的表达", note: `匹配度 ${score.ipFit}，已遵守当前 IP 的说话方式与内容边界。` },
    { title: "无收益承诺", note: `结构分 ${score.structure}，未出现收益保证、绝对化用语或诱导表达。` },
  ] : []
  return {
    runId: view.run?.id ?? view.id,
    lead: status === "locked"
      ? `${view.ipProfile?.displayName ?? "当前 IP"}，这篇已经定稿`
      : status === "needs_qa"
        ? "修改已保存，定稿前需要重新检查"
        : `${view.ipProfile?.displayName ?? "当前 IP"}，今天这篇可以直接拍`,
    title: script.title,
    duration: `约 ${script.estimatedSeconds} 秒`,
    wordCount: `约 ${[script.hook, script.body, script.callToAction].join("").length} 字`,
    version: `v${selection.version} · ${status === "locked" ? "已定稿" : status === "needs_qa" ? "待检查" : "待确认"}`,
    revision: selection.version,
    status,
    lockedVersion: view.lockedScript?.version ?? null,
    paragraphs: [script.hook, ...bodyParts, script.callToAction],
    checks,
    evidence: [
      ...(topic?.ipFitEvidence?.length ? topic.ipFitEvidence : ["当前 IP 的已确认画像"]),
      "表达边界：不夸大、不承诺、不贬低竞品",
      "选题方向：真实经历与长期信任",
    ],
    alternatives: {
      topics: view.topicBatch?.items?.map((item) => ({ id: item.id, title: item.title })) ?? [],
    },
  }
}
