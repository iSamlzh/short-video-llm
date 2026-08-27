"use client"

import { FormEvent, useRef, useState } from "react"
import { useRouter } from "next/navigation"

export function LoginForm({ defaultEmail = "", defaultPassword = "" }: {
  defaultEmail?: string
  defaultPassword?: string
}) {
  const router = useRouter()
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  const pendingRequest = useRef(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pendingRequest.current) return
    pendingRequest.current = true
    setPending(true)
    setError("")
    try {
      const form = new FormData(event.currentTarget)
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      })
      const payload = await response.json().catch(() => ({})) as { message?: string; audience?: string; mustChangePassword?: boolean }
      if (!response.ok) {
        setError(payload.message ?? "账号或密码不正确")
        return
      }
      router.push(payload.mustChangePassword ? "/change-password" : payload.audience === "platform" ? "/platform/content-brain" : "/app/today")
      router.refresh()
    } catch {
      setError("暂时无法连接登录服务，请稍后重试")
    } finally {
      pendingRequest.current = false
      setPending(false)
    }
  }

  return <form className="login-form" onSubmit={submit} noValidate={false}>
    <label htmlFor="login-email">邮箱<input id="login-email" name="email" type="email" required defaultValue={defaultEmail} autoComplete="username" /></label>
    <label htmlFor="login-password">密码<input id="login-password" name="password" type="password" required defaultValue={defaultPassword} autoComplete="current-password" aria-invalid={error ? true : undefined} aria-describedby={error ? "login-error" : undefined} /></label>
    {error && <p className="form-error" id="login-error" role="alert" aria-live="assertive">{error}</p>}
    <button className="primary-button" type="submit" disabled={pending}>{pending ? "正在进入…" : "进入内容工作台"}</button>
  </form>
}
