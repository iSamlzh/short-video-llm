export function QualityAndLock({ report, onLock }: { report: any; onLock: () => void }) {
  const labels: Record<string, string> = { hook: "开场吸引力", ipFit: "IP 一致性", credibility: "可信度", structure: "表达结构", callToAction: "行动引导" }
  const average = Math.round(Object.values(report.scores as Record<string, number>).reduce((sum, value) => sum + value, 0) / Object.keys(report.scores).length)
  return <section>
    <p className="stage-kicker">独立质量检查已完成</p>
    <h2 className="stage-title">{report.hardGatePassed ? "这篇稿子可以进入最终确认" : "先处理风险，再锁定内容"}</h2>
    <p className="stage-lead">Quality & Learning Agent 只检查事实、IP 匹配和表达质量，不会替 Content Agent 修改原稿。</p>
    <div className="quality-layout">
      <div className="quality-summary"><span>综合质量</span><strong>{average}</strong><p>{report.hardGatePassed ? "所有发布硬门槛均已通过" : report.hardGateReasons.join("；")}</p></div>
      <div className="quality-checks">{Object.entries(report.scores).map(([name, score]) => <div key={name}><span>{labels[name] ?? name}</span><strong>{String(score)}</strong></div>)}</div>
    </div>
    {report.suggestions?.length > 0 && <div className="quality-suggestions"><strong>可以继续优化</strong>{report.suggestions.map((item: string) => <p key={item}>{item}</p>)}</div>}
    <div className="stage-actions"><span>锁定后，任何修改都会创建新版本并重新质检</span><button className="primary-action" type="button" disabled={!report.hardGatePassed} onClick={onLock}>确认锁稿</button></div>
  </section>
}
