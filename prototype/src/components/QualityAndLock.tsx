export function QualityAndLock({ report, onLock }: { report: any; onLock: () => void }) {
  return <section className="stage-card">
    <p className="eyebrow">发布前检查</p>
    <h2>{report.hardGatePassed ? "文案可以锁定" : "先处理风险再发布"}</h2>
    <div className="score-grid">{Object.entries(report.scores).map(([name, score]) => <span key={name}>{name}<strong>{String(score)}</strong></span>)}</div>
    {report.suggestions?.map((item: string) => <p key={item}>建议：{item}</p>)}
    <button type="button" disabled={!report.hardGatePassed} onClick={onLock}>确认锁稿</button>
  </section>
}
