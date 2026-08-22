import Link from "next/link"
import { LogoutButton } from "@/components/auth/LogoutButton"

export default function LogoutPage() {
  return <main className="access-denied">
    <p className="eyebrow">账号安全</p>
    <h1>退出当前账号？</h1>
    <p>退出后需要重新登录，当前已保存的 IP、口播稿和复盘数据不会受影响。</p>
    <div className="logout-confirm-actions">
      <LogoutButton label="确认退出" />
      <Link className="secondary-button" href="/app/today">返回工作台</Link>
    </div>
  </main>
}
