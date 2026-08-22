"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

export function LogoutButton({ label = "退出" }: { label?: string }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")

  async function logout() {
    if (pending) return
    setPending(true)
    setError("")
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" })
      if (!response.ok) throw new Error("LOGOUT_FAILED")
      router.replace("/login")
      router.refresh()
    } catch {
      setError("暂时无法退出，请重试")
      setPending(false)
    }
  }

  return <span className="logout-control">
    <button className="logout-link" type="button" disabled={pending} onClick={() => void logout()}>
      {pending ? "退出中…" : label}
    </button>
    {error && <span className="visually-hidden" role="alert">{error}</span>}
  </span>
}
