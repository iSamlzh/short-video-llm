import type { CreationDecisionBrief as CreationDecisionBriefData } from "../../domain/creation-contracts"
import { AgentRationaleDrawer } from "./AgentRationaleDrawer"

export function CreationDecisionBrief({ brief }: { brief: CreationDecisionBriefData }) {
  const recommendationSummary = brief.recommendationSummary ?? brief.whyToday
  const topicOpportunity = brief.topicOpportunity ?? brief.whyToday
  const portraitFitSummary = (brief.portraitFitSummary
    ?? brief.ipEvidenceRefs.map((reference) => reference.relevance).filter(Boolean).join("；"))
    || "画像显示当前 IP 具备与这条选题相关的真实经历和表达基础。"

  return <section className="creation-decision-brief" aria-labelledby="decision-brief-heading">
    <div className="decision-brief-heading">
      <div>
        <p>Agent 的选题判断</p>
        <h2 id="decision-brief-heading">为什么今天推荐这篇</h2>
      </div>
      <AgentRationaleDrawer brief={brief} />
    </div>
    <p className="decision-brief-summary">{recommendationSummary}</p>
    <div className="decision-evidence-bridge">
      <span>画像匹配</span>
      <p>{portraitFitSummary}</p>
    </div>
    <dl className="decision-reasoning-list">
      <div><dt>受众卡点</dt><dd>{brief.audienceProblem}</dd></div>
      <div><dt>选题切入</dt><dd>{topicOpportunity}</dd></div>
      {brief.structureChoice && <div>
        <dt>采用结构</dt>
        <dd><strong>{brief.structureChoice.structureName}</strong><span>{brief.structureChoice.reason}</span></dd>
      </div>}
    </dl>
    <footer className="decision-brief-footer">
      <p><span>内容目标</span><strong>{brief.objective}</strong></p>
      <p className={`decision-data-status is-${brief.recentDataStatus}`}>
        {brief.recentDataStatus === "available" ? brief.recentDataSummary : "尚未使用历史表现"}
      </p>
      <p><span>发布后验证</span>{brief.nextSignal}</p>
    </footer>
  </section>
}
