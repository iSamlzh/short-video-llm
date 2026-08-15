import type { ReactNode } from "react"

export function DecisionCards<T extends { id: string; title: string }>(props: {
  items: T[]
  actionLabel: string
  onSelect: (item: T) => void
  renderDetail: (item: T) => ReactNode
}) {
  return <div className="decision-grid">{props.items.map(item => (
    <article className="decision-card" key={item.id}>
      <h3>{item.title}</h3>
      {props.renderDetail(item)}
      <button type="button" onClick={() => props.onSelect(item)}>{props.actionLabel}</button>
    </article>
  ))}</div>
}
