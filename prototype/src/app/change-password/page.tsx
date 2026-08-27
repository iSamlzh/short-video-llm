import { redirect } from "next/navigation"
import { resolveCurrentSession } from "@/lib/auth/request-access"
import { ChangePasswordForm } from "@/components/auth/ChangePasswordForm"

export default async function ChangePasswordPage() {
  const session = await resolveCurrentSession()
  if (!session) redirect("/login")
  if (!session.mustChangePassword) redirect(session.audience === "platform" ? "/platform/content-brain" : "/app/today")
  return <main className="login-page">
    <section className="login-intro"><p className="eyebrow">首次登录保护</p><h1>先设置你自己的密码</h1><p>临时密码只用于第一次登录。修改后，旧登录状态会全部失效。</p></section>
    <section className="login-panel"><h2>设置新密码</h2><p>至少 10 位，同时包含字母和数字。</p><ChangePasswordForm audience={session.audience} /></section>
  </main>
}
