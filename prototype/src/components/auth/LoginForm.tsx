"use client"

import { FormEvent, useState } from "react"
import { useRouter } from "next/navigation"

export function LoginForm() {
  const router = useRouter()
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError("")
    const form = new FormData(event.currentTarget)
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
    })
    const payload = await response.json()
    if (!response.ok) {
      setError(payload.message ?? "账号或密码不正确")
      setPending(false)
      return
    }
    router.push(payload.audience === "platform" ? "/platform/content-brain" : "/app/today")
    router.refresh()
  }

  return <form className="login-form" onSubmit={submit}>
    <label>邮箱<input name="email" type="email" required defaultValue="owner@example.test" autoComplete="username" /></label>
    <label>密码<input name="password" type="password" required defaultValue="demo-password" autoComplete="current-password" /></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="primary-button" disabled={pending}>{pending ? "正在进入…" : "进入内容工作台"}</button>
  </form>
}
