import Link from "next/link"

export function TenantMasthead({ context, active }: {
  context: { teamName: string; ipName: string; accountName: string; userName: string }
  active?: "today" | "review" | "team"
}) {
  return <header className="masthead tenant-masthead">
    <div className="masthead-left">
      <Link className="product-name" href="/app/today">内容增长 Agent</Link>
      <nav aria-label="主要任务" className="task-navigation">
        <Link aria-current={active === "today" ? "page" : undefined} href="/app/today">今日创作</Link>
        <Link aria-current={active === "review" ? "page" : undefined} href="/app/review">复盘与优化</Link>
        <Link aria-current={active === "team" ? "page" : undefined} href="/app/team">团队</Link>
      </nav>
    </div>
    <div className="context-navigation" aria-label="当前工作上下文">
      <button>当前团队：{context.teamName}</button><span />
      <button>当前 IP：{context.ipName}</button><span />
      <button>当前账号：{context.accountName}</button><span />
      <button>{context.userName}</button>
    </div>
  </header>
}
