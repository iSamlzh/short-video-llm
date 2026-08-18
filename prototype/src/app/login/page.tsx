import { redirect } from "next/navigation"
import { resolveCurrentAccess } from "@/lib/auth/request-access"
import { LoginForm } from "@/components/auth/LoginForm"

export default async function LoginPage() {
  const context = await resolveCurrentAccess()
  if (context) redirect(context.audience === "platform" ? "/platform/content-brain" : "/app/today")
  return <main className="login-page">
    <section className="login-intro"><p className="eyebrow">内容增长 Agent</p><h1>每天打开，就有一篇真正适合你的口播稿</h1><p>系统会记住当前 IP、真实经历和表达边界。成员各自登录，只能看到被授权的账号与任务。</p></section>
    <section className="login-panel"><h2>进入你的内容团队</h2><p>首次使用验证账号已预填。生产环境不会提供共享默认账号。</p><LoginForm defaultEmail="firsttime@example.test" /><details><summary>其他开发角色</summary><p>owner@example.test · operator@example.test · reviewer@example.test · platform@example.test</p><p>密码均由本地演示环境变量提供。</p></details></section>
  </main>
}
