"use client"

import { useMemo, useState } from "react"
import { ArrowClockwise, ArrowRight, ChartLineUp, CheckCircle, MagnifyingGlass, ShieldCheck } from "@phosphor-icons/react"
import type {
  ActiveStructure,
  ContentBrainApi,
  StructureEvaluation,
  StructureEvaluationDetail,
  StructureObservationEvidence,
} from "./types"

export function StructureEvolutionWorkspace({ structures, evaluations, evolutionEnabled, api, onEvaluated, onOpenCandidate }: {
  structures: ActiveStructure[]
  evaluations: StructureEvaluation[]
  evolutionEnabled: boolean
  api: ContentBrainApi
  onEvaluated: (evaluation: StructureEvaluation) => void
  onOpenCandidate: (sampleId: string) => void | Promise<void>
}) {
  const evaluationByVersion = useMemo(() => new Map(evaluations.map((item) => [item.templateVersionId, item])), [evaluations])
  const [selectedVersionId, setSelectedVersionId] = useState(structures[0]?.templateVersionId ?? "")
  const [detail, setDetail] = useState<StructureEvaluationDetail | null>(null)
  const [pending, setPending] = useState<"evaluate" | "detail" | "propose" | null>(null)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const structure = structures.find((item) => item.templateVersionId === selectedVersionId) ?? structures[0]
  const evaluation = structure ? evaluationByVersion.get(structure.templateVersionId) : undefined

  if (!structures.length) return <section className="brain-empty-state brain-evolution-empty">
    <ChartLineUp size={32} />
    <h2>还没有可评估的结构</h2>
    <p>结构启用并用于口播稿创作后，真实发布数据才会形成匿名观察并进入结构评估。</p>
  </section>

  async function evaluateNow() {
    if (!structure) return
    setPending("evaluate"); setError(""); setNotice("")
    try {
      const next = await api.evaluateStructure(structure.templateVersionId)
      onEvaluated(next)
      setDetail(await api.getEvaluation(next.id))
      setNotice(next.confidence === "facts_only" ? "评估已刷新，当前证据只支持事实记录。" : "评估已刷新，可以查看匿名证据与改进边界。")
    } catch (cause) { setError(messageOf(cause, "结构评估失败，请重试")) }
    finally { setPending(null) }
  }

  async function openDetail(target: StructureEvaluation) {
    setPending("detail"); setError(""); setNotice("")
    try { setDetail(await api.getEvaluation(target.id)) }
    catch (cause) { setError(messageOf(cause, "评估证据读取失败，请重试")) }
    finally { setPending(null) }
  }

  async function propose() {
    if (!evaluation) return
    setPending("propose"); setError(""); setNotice("")
    try {
      const result = await api.proposeEvolution(evaluation.id)
      if (!result.candidate) {
        setNotice(`本次评估不建议修改结构。${result.proposal.summary}`)
        return
      }
      if (!result.candidate.sampleId) throw new Error("候选已生成，但缺少复核入口")
      await onOpenCandidate(result.candidate.sampleId)
    } catch (cause) { setError(messageOf(cause, "结构候选生成失败，请重试")) }
    finally { setPending(null) }
  }

  return <section className="brain-evolution-workspace">
    <header className="brain-evolution-heading">
      <div><span className="brain-kicker">真实结果驱动</span><h1>结构进化</h1><p>发布数据先形成匿名观察，再由确定性规则计算证据等级。任何结构修改都必须进入人工复核，不会自动覆盖启用版本。</p></div>
      <span><ShieldCheck size={18} />租户原稿与身份不进入平台证据</span>
    </header>

    <div className="brain-evolution-layout">
      <aside className="brain-evolution-index" aria-label="启用结构评估列表">
        {structures.map((item) => {
          const itemEvaluation = evaluationByVersion.get(item.templateVersionId)
          return <button key={item.templateVersionId} aria-current={item.templateVersionId === structure?.templateVersionId ? "true" : undefined} onClick={() => {
            setSelectedVersionId(item.templateVersionId); setDetail(null); setError(""); setNotice("")
          }}>
            <strong>{item.name}</strong>
            <small>v{item.version} · {evaluationLabel(itemEvaluation)}</small>
          </button>
        })}
      </aside>

      <article className="brain-evolution-document">
        <header>
          <div><span>当前启用结构</span><h2>{structure?.name}</h2></div>
          <button className="brain-button-secondary" disabled={pending !== null} onClick={evaluateNow}><ArrowClockwise size={17} />{pending === "evaluate" ? "正在评估" : evaluation ? "刷新评估" : "建立评估"}</button>
        </header>

        <section className="brain-evolution-conclusion">
          <span>{evaluation ? confidenceTitle(evaluation.confidence) : "等待真实反馈"}</span>
          <h3>{evaluation ? conclusion(evaluation) : "当前结构还没有评估版本"}</h3>
          <p>{evaluation ? evidenceBoundary(evaluation) : "发布并导入真实视频数据后，系统会自动建立观察；也可以手动刷新，确认当前是否已经有可用数据。"}</p>
        </section>

        {evaluation && <dl className="brain-evolution-counts">
          <div><dt>纳入作品</dt><dd>{evaluation.publicationCount}</dd></div>
          <div><dt>有效作品</dt><dd>{evaluation.eligiblePublicationCount}</dd></div>
          <div><dt>匿名画像范围</dt><dd>{evaluation.scopeCount}</dd></div>
          <div><dt>评估版本</dt><dd>v{evaluation.version}</dd></div>
        </dl>}

        {error && <p className="brain-inline-error" role="alert">{error}</p>}
        {notice && <p className="brain-success-note" role="status">{notice}</p>}

        {evaluation && <section className="brain-evolution-actions" aria-label="结构评估操作">
          <button className="brain-button-secondary" disabled={pending !== null} onClick={() => openDetail(evaluation)}><MagnifyingGlass size={17} />{pending === "detail" ? "正在读取" : "查看证据"}</button>
          {evolutionEnabled && evaluation.confidence !== "facts_only"
            ? <button className="brain-button-primary" disabled={pending !== null} onClick={propose}>{pending === "propose" ? "正在生成候选" : "生成改进候选"}<ArrowRight size={17} /></button>
            : <p>{evaluation.confidence === "facts_only" ? "证据未达到候选门槛" : "候选生成处于灰度关闭状态"}</p>}
        </section>}

        {detail && detail.evaluation.id === evaluation?.id && <EvaluationEvidence detail={detail} structure={structure} />}
      </article>
    </div>
  </section>
}

function EvaluationEvidence({ detail, structure }: { detail: StructureEvaluationDetail; structure: ActiveStructure }) {
  const metricEntries = Object.entries(detail.evaluation.aggregate.metrics ?? {})
  const nodeCoverage = detail.evaluation.aggregate.nodeCoverage ?? {}
  const limits = detail.evaluation.aggregate.evidenceLimits ?? []
  return <div className="brain-evolution-evidence">
    <section>
      <h3>指标中位数变化</h3>
      {metricEntries.length ? <div className="brain-evolution-metrics" role="table" aria-label="结构评估指标">
        <div role="row"><span role="columnheader">指标</span><span role="columnheader">有效样本</span><span role="columnheader">相对账号基线</span><span role="columnheader">正向 / 负向</span></div>
        {metricEntries.map(([name, metric]) => <div role="row" key={name}><strong role="cell">{metricName(name)}</strong><span role="cell">{metric.sampleCount}</span><span role="cell">{formatPercent(metric.relativeDeltaMedian)}</span><span role="cell">{metric.positiveCount} / {metric.negativeCount}</span></div>)}
      </div> : <p className="brain-evolution-muted">当前没有达到账号基线要求的指标样本。</p>}
    </section>

    <section>
      <h3>结构节点覆盖</h3>
      <div className="brain-evolution-node-list">{structure.nodes.map((node) => <p key={node.nodeKey ?? node.kind}><span>{node.kind}</span><strong>{nodeCoverage[node.nodeKey ?? ""] ?? 0} 条作品</strong><small>{node.instruction}</small></p>)}</div>
    </section>

    <section className="brain-evolution-limits">
      <h3>结论边界</h3>
      {limits.map((limit) => <p key={limit}><ShieldCheck size={17} />{limit}</p>)}
    </section>

    <section>
      <h3>匿名观察记录</h3>
      {detail.evidence.length ? <div className="brain-evolution-observations">{detail.evidence.map((item) => <ObservationRow key={item.id} item={item} />)}</div>
        : <p className="brain-evolution-muted">当前评估没有观察记录。</p>}
    </section>
  </div>
}

function ObservationRow({ item }: { item: StructureObservationEvidence }) {
  return <details>
    <summary><span><CheckCircle size={17} />{tierName(item.evidenceTier)}</span><strong>{item.platform || "未知平台"}</strong><small>{formatDate(item.capturedAt)}</small></summary>
    <div><p>覆盖节点：{item.nodeKeys.join("、") || "未记录"}</p><p>数据质量：账号基线 {String(item.dataQuality.baselinePeerCount ?? 0)} 条同类作品</p><code>{item.id}</code></div>
  </details>
}

function evaluationLabel(evaluation?: StructureEvaluation) {
  if (!evaluation) return "尚未评估"
  return `${confidenceTitle(evaluation.confidence)}，${evaluation.publicationCount} 条作品`
}

function confidenceTitle(confidence: StructureEvaluation["confidence"]) {
  return ({ facts_only: "事实积累", exploratory: "探索性证据", standard: "标准证据" })[confidence]
}

function conclusion(evaluation: StructureEvaluation) {
  if (evaluation.confidence === "standard") return `已有 ${evaluation.eligiblePublicationCount} 条有效作品、${evaluation.scopeCount} 个匿名画像范围，可进入结构改进复核。`
  if (evaluation.confidence === "exploratory") return `已有 ${evaluation.eligiblePublicationCount} 条有效作品，允许提出小范围、可回退的探索性修改。`
  return `已记录 ${evaluation.publicationCount} 条作品，当前只展示事实，不推断结构改进方向。`
}

function evidenceBoundary(evaluation: StructureEvaluation) {
  if (evaluation.confidence === "facts_only") return "有效作品或跨画像范围不足，系统不会调用模型生成结构候选。"
  return "指标反映完整结构组合相对同账号基线的表现，不宣称单个节点与结果存在因果关系。"
}

function metricName(name: string) {
  return ({ views: "播放", likes: "点赞", comments: "评论", shares: "分享", follows: "关注", leads: "线索", orders: "订单", gmv: "GMV" } as Record<string, string>)[name] ?? name
}

function formatPercent(value: number | null) {
  if (value == null) return "无基线"
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`
}

function tierName(tier: StructureObservationEvidence["evidenceTier"]) {
  return ({ fact: "事实记录", tentative: "可比较观察", confirmed: "稳定观察" })[tier]
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value))
}

function messageOf(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message : fallback
}
