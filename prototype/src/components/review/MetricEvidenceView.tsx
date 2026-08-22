"use client"

type MetricEvidence = {
  segment: "hook" | "body" | "ending" | "conversion"
  label: string
  status: "supported" | "partial" | "missing"
  metrics: Array<{
    label: string
    value: number
    format: "count" | "rate" | "seconds"
    evidenceSnapshotIds: string[]
  }>
  missingFields: string[]
  interpretation: string
  nextAction: string
}

export function MetricEvidenceView({ evidence = [] }: { evidence?: MetricEvidence[] }) {
  if (!evidence.length) return null
  return <section className="metric-evidence" aria-labelledby="metric-evidence-title">
    <header className="review-section-heading">
      <p className="eyebrow">结构证据</p>
      <h2 id="metric-evidence-title">指标如何落到内容结构</h2>
      <p>这里只展示平台数据能支持的判断；缺少留存曲线时，不会虚构具体掉点。</p>
    </header>
    <div className="metric-evidence-list">
      {evidence.map((item) => <article className="metric-evidence-row" key={item.segment}>
        <div className="metric-evidence-label">
          <h3>{item.label}</h3>
          <span data-status={item.status}>{statusLabel(item.status)}</span>
        </div>
        <div className="metric-evidence-detail">
          {item.metrics.length > 0 && <ul className="metric-evidence-values">
            {item.metrics.map((metric) => <li key={`${item.segment}-${metric.label}`}>
              <strong>{metric.label} {formatMetric(metric.value, metric.format)}</strong>
              <small>证据 {metric.evidenceSnapshotIds.join("、")}</small>
            </li>)}
          </ul>}
          {item.missingFields.length > 0 && <p className="metric-missing">缺少：{item.missingFields.join("、")}</p>}
          <p>{item.interpretation}</p>
          <p className="metric-next-action"><strong>下一步：</strong>{item.nextAction}</p>
        </div>
      </article>)}
    </div>
  </section>
}

function statusLabel(status: MetricEvidence["status"]) {
  return status === "supported" ? "证据完整" : status === "partial" ? "证据不全" : "缺少数据"
}

function formatMetric(value: number, format: MetricEvidence["metrics"][number]["format"]) {
  if (format === "rate") return `${(value * 100).toFixed(1)}%`
  if (format === "seconds") return `${value.toFixed(1)} 秒`
  return new Intl.NumberFormat("zh-CN").format(value)
}
