"use client"

import { FormEvent, useState } from "react"
import { useRouter } from "next/navigation"

export function ChangePasswordForm({ audience }: { audience: "tenant" | "platform" }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true); setError("")
    const form = new FormData(event.currentTarget)
    const response = await fetch("/api/auth/change-password", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: form.get("password"), confirmation: form.get("confirmation") }),
    })
    const body = await response.json().catch(() => ({})) as { message?: string }
    if (!response.ok) { setError(body.message ?? "修改失败"); setPending(false); return }
    router.push(audience === "platform" ? "/platform/content-brain" : "/app/today")
    router.refresh()
  }
  return <form className="login-form" onSubmit={submit}>
    <label htmlFor="new-password">新密码<input id="new-password" name="password" type="password" minLength={10} required autoComplete="new-password" /></label>
    <label htmlFor="password-confirmation">再次输入<input id="password-confirmation" name="confirmation" type="password" minLength={10} required autoComplete="new-password" /></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="primary-button" disabled={pending}>{pending ? "正在保存…" : "保存并进入工作台"}</button>
  </form>
}
