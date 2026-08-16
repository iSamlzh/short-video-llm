type TopicItem = {
  id: string
  title: string
  angle: string
  ipFitEvidence: string[]
}

export function TopicDirectionList({ items, pending, onSelect }: { items: TopicItem[]; pending: boolean; onSelect: (item: TopicItem) => void }) {
  return <div className="topic-list">{items.map((item, index) => <article className="topic-row" key={item.id}>
    <span className="topic-rank">{String(index + 1).padStart(2, "0")}</span>
    <div className="topic-copy">
      {index === 0 && <span className="recommendation">建议今天先拍</span>}
      <h3>{item.title}</h3>
      <p>{item.angle}</p>
      <small>适合原因：{item.ipFitEvidence.join("、")}</small>
    </div>
    <button type="button" disabled={pending} onClick={() => onSelect(item)}>选择这个方向</button>
  </article>)}</div>
}
