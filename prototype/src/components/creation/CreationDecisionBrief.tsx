import type { CreationDecisionBrief as CreationDecisionBriefData } from "../../domain/creation-contracts"
import { AgentRationaleDrawer } from "./AgentRationaleDrawer"

export function CreationDecisionBrief({ brief }: { brief: CreationDecisionBriefData }) {
  return <section className="creation-decision-brief" aria-labelledby="decision-brief-heading">
    <div className="decision-brief-heading">
      <div>
        <p>Agent 的选题判断</p>
        <h2 id="decision-brief-heading">为什么今天推荐这篇</h2>
      </div>
      <AgentRationaleDrawer brief={brief} />
    </div>
    <dl className="decision-brief-grid">
      <div><dt>内容目标</dt><dd>{brief.objective}</dd></div>
      <div><dt>今日理由</dt><dd>{brief.whyToday}</dd></div>
      <div><dt>受众问题</dt><dd>{brief.audienceProblem}</dd></div>
      <div><dt>发布后观察</dt><dd>{brief.nextSignal}</dd></div>
    </dl>
    <p className={`decision-data-status is-${brief.recentDataStatus}`}>
      {brief.recentDataStatus === "available" ? brief.recentDataSummary : "尚未使用历史表现"}
    </p>
  </section>
}
