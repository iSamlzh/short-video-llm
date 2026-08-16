"use client"

import { FormEvent, useEffect, useState } from "react"
import { createRun, getRun, postCommand } from "../lib/api-client"
import { ContextDrawer } from "./ContextDrawer"
import { DecisionCards } from "./DecisionCards"
import { QualityAndLock } from "./QualityAndLock"
import { SimulationAndReview } from "./SimulationAndReview"
import type { IpProfile } from "../domain/models"
import { loadCurrentIp, saveCurrentIp } from "../lib/current-ip-store"

type RunView = any
const fields = [
  ["displayName", "称呼", "例如：王姐"], ["experience", "真实经历", "至少写一段真实业务经历"],
  ["expertise", "擅长领域", "你最熟悉的业务"], ["audience", "目标人群", "你想影响谁"],
  ["voiceStyle", "表达特点", "例如：直接、实在、有案例"], ["boundaries", "不能说的内容", "例如：不承诺确定收益"],
] as const

export function PrototypeWorkspace({ initialRun, initialProfile, resetOnLoad = false }: { initialRun?: RunView; initialProfile?: IpProfile; resetOnLoad?: boolean }) {
  const [run, setRun] = useState<RunView | undefined>(initialRun)
  const [currentIp, setCurrentIp] = useState<IpProfile | null>(initialRun?.ipProfile ?? null)
  const [entryResolved, setEntryResolved] = useState(Boolean(initialRun))
  const [busy, setBusy] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    if (resetOnLoad) {
      window.localStorage.removeItem("content-prototype-run")
      const cleanUrl = new URL(window.location.href)
      if (cleanUrl.searchParams.has("reset")) {
        cleanUrl.searchParams.delete("reset")
        window.history.replaceState({}, "", `${cleanUrl.pathname}${cleanUrl.search}`)
      }
    }
    if (initialRun) {
      saveCurrentIp(initialRun.ipProfile)
      setEntryResolved(true)
      return
    }
    if (resetOnLoad) {
      const storedProfile = loadCurrentIp()
      setCurrentIp(storedProfile)
      setEntryResolved(true)
      if (storedProfile) void startDailyRun(storedProfile)
      return
    }
    const id = window.localStorage.getItem("content-prototype-run")
    if (id) {
      getRun<RunView>(id).then((restored) => {
        setRun(restored)
        setCurrentIp(restored.ipProfile)
        saveCurrentIp(restored.ipProfile)
        setEntryResolved(true)
      }).catch(() => {
        window.localStorage.removeItem("content-prototype-run")
        const storedProfile = loadCurrentIp()
        setCurrentIp(storedProfile)
        setEntryResolved(true)
        if (storedProfile) void startDailyRun(storedProfile)
      })
      return
    }
    const storedProfile = loadCurrentIp()
    setCurrentIp(storedProfile)
    setEntryResolved(true)
    if (storedProfile) void startDailyRun(storedProfile)
  }, [initialRun, resetOnLoad])

  async function refresh(id = run?.id) { if (id) setRun(await getRun<RunView>(id)) }
  async function command(path: string, body: Record<string, unknown>, label: string) {
    if (!run) return
    setBusy(label); setError("")
    try { await postCommand(run.id, path, body); await refresh() }
    catch (caught) { setError(caught instanceof Error ? caught.message : "当前步骤失败，请重试") }
    finally { setBusy("") }
  }
  async function startDailyRun(profile: IpProfile) {
    setCurrentIp(profile); setBusy(`正在为${profile.displayName}准备今日选题…`); setError("")
    try {
      const created = await createRun<RunView>(profile)
      window.localStorage.setItem("content-prototype-run", created.id)
      await postCommand(created.id, "topics/generate", { inputVersion: created.inputVersion })
      setRun(await getRun<RunView>(created.id))
    }
    catch (caught) { setError(caught instanceof Error ? caught.message : "今日选题准备失败") }
    finally { setBusy("") }
  }
  async function submitIp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy("正在建立你的内容上下文…"); setError("")
    const body = Object.fromEntries(new FormData(event.currentTarget))
    try {
      const profile = body as unknown as IpProfile
      saveCurrentIp(profile)
      setCurrentIp(profile)
      const created = await createRun<RunView>(profile)
      window.localStorage.setItem("content-prototype-run", created.id)
      await postCommand(created.id, "topics/generate", { inputVersion: created.inputVersion })
      setRun(await getRun<RunView>(created.id))
    }
    catch (caught) { setError(caught instanceof Error ? caught.message : "创建失败") } finally { setBusy("") }
  }

  const stage = (() => {
    if (!entryResolved || (!run && currentIp && busy)) return <section className="stage-card"><h2>{busy || "正在载入当前 IP…"}</h2></section>
    if (!run && currentIp) return <section className="stage-card"><p className="eyebrow">当前 IP · {currentIp.displayName}</p><h2>继续准备今天的选题</h2><p>当前 IP 已保留，不需要重新建档。</p><button disabled={Boolean(busy)} onClick={() => startDailyRun(currentIp)}>{busy || "重试今日选题"}</button></section>
    if (!run) return <form className="ip-form stage-card" onSubmit={submitIp}><p className="eyebrow">先让 Agent 认识你</p><h2>用真实经历建立你的内容起点</h2>
      {fields.map(([name, label, placeholder]) => <label key={name}>{label}{name === "experience" ? <textarea name={name} required minLength={10} placeholder={placeholder} defaultValue={initialProfile?.[name]} /> : <input name={name} required placeholder={placeholder} defaultValue={initialProfile?.[name]} />}</label>)}
      <button disabled={Boolean(busy)}>{busy || "生成选题方向"}</button></form>
    if (run.state === "READY_FOR_TOPICS") return <section className="stage-card"><p className="eyebrow">今天拍什么</p><h2>先从你的 IP 里找方向</h2><button disabled={Boolean(busy)} onClick={() => command("topics/generate", { inputVersion: run.inputVersion }, "正在理解你的经历并生成方向…")}>生成选题方向</button></section>
    if (run.state === "WAITING_TOPIC_SELECTION") return <section><p className="eyebrow">唯一决策</p><h2>选择今天拍什么</h2><DecisionCards items={run.topicBatch.items} actionLabel="选择这个方向" onSelect={(item: any) => command("topics/select", { batchVersion: run.topicBatch.version, topicId: item.id }, "正在锁定方向…")} renderDetail={(item: any) => <><p>{item.angle}</p><small>为什么适合你：{item.ipFitEvidence.join("、")}</small></>} /></section>
    if (run.state === "READY_FOR_SCRIPTS") return <section className="stage-card"><p className="eyebrow">方向已定</p><h2>围绕这个方向，生成 3 种完整表达</h2><button onClick={() => command("scripts/generate", { inputVersion: run.inputVersion }, "正在生成同方向文案…")}>生成 3 篇文案</button></section>
    if (run.state === "WAITING_SCRIPT_SELECTION") return <section><p className="eyebrow">今天怎么说</p><h2>选择今天的文案</h2><DecisionCards items={run.scriptBatch.items} actionLabel="选为今天拍摄稿" onSelect={(item: any) => command("scripts/select", { batchVersion: run.scriptBatch.version, scriptId: item.id }, "正在确认文案…")} renderDetail={(item: any) => <><blockquote>{item.hook}</blockquote><p>{item.body}</p></>} /></section>
    if (run.state === "READY_FOR_QA") return <section className="stage-card"><h2>发布前独立检查</h2><p>Agent 将检查可信度、IP 匹配和表达结构，不会替你改写。</p><button onClick={() => command("qa/run", { inputVersion: run.inputVersion }, "正在运行发布前 QA…")}>运行发布前 QA</button></section>
    if (run.state === "WAITING_LOCK_CONFIRMATION") return <QualityAndLock report={run.qualityReport} onLock={() => command("lock", {}, "正在锁定版本…")} />
    if (run.state === "LOCKED") return <section className="stage-card"><h2>拍摄稿已锁定</h2><p>下一步用确定性模拟数据验证复盘交互。</p><button onClick={() => command("publication/simulate", {}, "正在生成模拟表现…")}>生成模拟发布数据</button></section>
    if (run.state === "WAITING_REVIEW") return <SimulationAndReview snapshot={run.metricSnapshot} reviewPending={Boolean(busy)} onReview={() => command("review/generate", { metricVersion: run.metricSnapshot.version }, "正在复盘这条内容…")} />
    if (run.state === "REVIEWED") return <SimulationAndReview snapshot={run.metricSnapshot} review={run.review} />
    return <section className="stage-card"><h2>{busy || "Agent 正在处理当前步骤…"}</h2></section>
  })()

  return <main className="workspace-shell"><header><p className="eyebrow">CONTENT STUDIO</p><h1>内容增长 Agent</h1><p>{run?.ipProfile.displayName ?? currentIp?.displayName ?? "首次使用"} · 确定今天拍什么。</p></header>{error && <aside className="error-card">{error}<small>已完成进度仍然保留，请重试当前步骤。</small></aside>}{busy && run && <div className="working-line">{busy}</div>}{stage}{run && <ContextDrawer run={run} />}</main>
}
