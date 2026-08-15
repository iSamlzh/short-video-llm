export function SimulationAndReview({ snapshot, review, onReview }: { snapshot: any; review?: any; onReview?: () => void }) {
  return <section className="stage-card simulation-card">
    <p className="simulation-label">模拟数据，不代表真实平台表现</p>
    <h2>{review ? "本次内容复盘" : "模拟发布表现"}</h2>
    {snapshot && <div className="metric-grid">
      <span>曝光<strong>{snapshot.impressions}</strong></span><span>播放<strong>{snapshot.plays}</strong></span>
      {snapshot.inquiries !== undefined && <span>咨询<strong>{snapshot.inquiries}</strong></span>}
    </div>}
    {review ? <div className="review-copy">
      <p>{review.summary}</p><h3>值得保留</h3><ul>{review.keep.map((item: string) => <li key={item}>{item}</li>)}</ul>
      <h3>下一条</h3><p>{review.nextContent}</p><small>{review.evidenceLimits}</small>
    </div> : onReview ? <button type="button" onClick={onReview}>生成复盘</button> : null}
  </section>
}
