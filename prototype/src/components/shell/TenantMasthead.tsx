import Link from "next/link"
import { WorkspaceContextSwitcher } from "./WorkspaceContextSwitcher"
import type { WorkspaceContext } from "@/services/workspace-context-service"
import { LogoutButton } from "../auth/LogoutButton"

export function TenantMasthead({ context, userName, active, canManageTeam = false, canManageIps = false }: {
  context: WorkspaceContext
  userName: string
  active?: "today" | "content" | "review" | "team"
  canManageTeam?: boolean
  canManageIps?: boolean
}) {
  return <header className="masthead tenant-masthead">
    <div className="masthead-left">
      <Link className="product-name" href="/app/today">内容增长 Agent</Link>
      <nav aria-label="主要任务" className="task-navigation">
        <Link aria-current={active === "today" ? "page" : undefined} href="/app/today">今日创作</Link>
        <Link aria-current={active === "content" ? "page" : undefined} href="/app/content">内容记录</Link>
        <Link aria-current={active === "review" ? "page" : undefined} href="/app/review">复盘与优化</Link>
        {canManageTeam && <Link aria-current={active === "team" ? "page" : undefined} href="/app/team">团队</Link>}
      </nav>
    </div>
    <div className="context-navigation" aria-label="当前工作上下文">
      <WorkspaceContextSwitcher initialContext={context} canManageIps={canManageIps} />
      <span className="context-divider" aria-hidden="true" />
      <span className="current-user-name">{userName}</span>
      <LogoutButton />
    </div>
  </header>
}
