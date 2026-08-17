"use client"

import { ChangeEvent, useEffect, useRef, useState } from "react"
import { ReviewBriefView } from "./ReviewBriefView"

async function read(response: Response) {
  if (response.status === 204) return null
  const body = await response.json()
  if (!response.ok) throw new Error(body.message || body.errorCode || "请求失败")
  return body
}

export function ReviewWorkspace() {
  const [brief, setBrief] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState("")
  const input = useRef<HTMLInputElement>(null)

  async function refresh() {
    setLoading(true)
    try { setBrief(await fetch("/api/app/review/current").then(read)) }
    catch (error) { setNotice(error instanceof Error ? error.message : "读取失败") }
    finally { setLoading(false) }
  }
  useEffect(() => { void refresh() }, [])

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setLoading(true)
    try {
      const result = await fetch("/api/app/review/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ csv: await file.text() }) }).then(read)
      setNotice(`成功导入 ${result.inserted} 条${result.duplicates ? `，跳过 ${result.duplicates} 条重复数据` : ""}${result.errors?.length ? `，${result.errors.length} 条需修正` : ""}`)
      await refresh()
    } catch (error) { setNotice(error instanceof Error ? error.message : "导入失败"); setLoading(false) }
    finally { event.target.value = "" }
  }

  async function confirm() {
    const result = await fetch("/api/app/review/confirm", { method: "POST" }).then(read)
    setNotice(`已形成当前 IP 的创作记忆 v${result.version}`)
  }

  return <main>
    <input ref={input} className="visually-hidden" type="file" accept=".csv,text/csv" onChange={importFile} />
    {notice && <p className="workspace-notice" role="status">{notice}</p>}
    {loading && !brief ? <section className="agent-working"><p className="eyebrow">Agent 正在读取当前账号数据</p><h1>先找出真正值得你看的内容。</h1></section> : brief ? <ReviewBriefView brief={brief} onImport={() => input.current?.click()} onConfirm={confirm} /> : <section className="empty-review"><p className="eyebrow">当前账号还没有可复盘数据</p><h1>导入平台导出的 CSV，Agent 会先给结论，再给证据。</h1><p>首版采用导入，平台 API 自动回流放在二期；开发模拟数据不会进入正式环境。</p><button className="primary-button" onClick={() => input.current?.click()}>导入真实数据</button><details><summary>CSV 需要哪些列？</summary><code>title,plays,completion_rate,likes,comments,shares,negative_feedback</code></details></section>}
  </main>
}
