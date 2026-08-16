"use client"

import { FormEvent, useEffect, useState } from "react"
import { createRun, getRun, postCommand } from "../lib/api-client"
import { ContextDrawer } from "./ContextDrawer"
import { CurrentIpContext } from "./CurrentIpContext"
import { DailyProgress } from "./DailyProgress"
import { QualityAndLock } from "./QualityAndLock"
import { ScriptCandidateList } from "./ScriptCandidateList"
import { SimulationAndReview } from "./SimulationAndReview"
import { TopicDirectionList } from "./TopicDirectionList"
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
  async function selectScriptAndRunQa(script: any) {
    if (!run) return
    setBusy("正在进行独立质量检查…"); setError("")
    try {
      await postCommand(run.id, "scripts/select", { batchVersion: run.scriptBatch.version, scriptId: script.id })
      await postCommand(run.id, "qa/run", { inputVersion: run.inputVersion })
      await refresh()
    }
    catch (caught) { setError(caught instanceof Error ? caught.message : "质量检查失败，请重试") }
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
    if (!entryResolved || (!run && currentIp && busy)) return <section className="loading-stage" aria-live="polite"><p>{busy || "正在载入当前 IP…"}</p><h2>正在准备你的每日内容</h2></section>
    if (!run && currentIp) return <section className="recovery-stage"><p className="stage-kicker">当前 IP · {currentIp.displayName}</p><h2>继续准备今天的选题</h2><p>当前 IP 已保留，不需要重新建档。</p><button className="primary-action" disabled={Boolean(busy)} onClick={() => startDailyRun(currentIp)}>{busy || "重试今日选题"}</button></section>
    if (!run) return <form className="ip-form onboarding-sheet" onSubmit={submitIp}><p className="stage-kicker">首次初始化</p><h2>先建立你的第一个 IP</h2><p className="stage-lead">这些信息只在首次使用或主动新增 IP 时填写。完成后，系统会直接为当前 IP 准备每日选题。</p>
      {fields.map(([name, label, placeholder]) => <label key={name}>{label}{name === "experience" ? <textarea name={name} required minLength={10} placeholder={placeholder} defaultValue={initialProfile?.[name]} /> : <input name={name} required placeholder={placeholder} defaultValue={initialProfile?.[name]} />}</label>)}
      <button className="primary-action" disabled={Boolean(busy)}>{busy || "完成初始化并生成选题"}</button></form>
    if (run.state === "READY_FOR_TOPICS") return <section className="recovery-stage"><p className="stage-kicker">今日选题尚未生成</p><h2>重新准备今天的方向</h2><p>当前 IP 和已完成进度都已保留。</p><button className="primary-action" disabled={Boolean(busy)} onClick={() => command("topics/generate", { inputVersion: run.inputVersion }, "正在理解你的经历并生成方向…")}>重试今日选题</button></section>
    if (run.state === "WAITING_TOPIC_SELECTION") return <section><p className="stage-kicker">已结合 {run.ipProfile.displayName} 的 IP 属性完成筛选</p><h2 className="stage-title">今天，先确定真正值得拍的一条</h2><p className="stage-lead">Agent 读取了当前 IP、内容目标和爆款结构。你只需要选一个方向，系统会立即生成同方向的三篇完整口播稿。</p><TopicDirectionList items={run.topicBatch.items} pending={Boolean(busy)} onSelect={(item: any) => command("topics/select", { batchVersion: run.topicBatch.version, topicId: item.id, inputVersion: run.inputVersion }, "正在生成同方向口播稿…")} /></section>
    if (run.state === "READY_FOR_SCRIPTS") return <section className="recovery-stage"><p className="stage-kicker">选题已经保留</p><h2>口播稿生成没有完成</h2><p>不需要重新选择方向，只重试本次生成。</p><button className="primary-action" disabled={Boolean(busy)} onClick={() => command("scripts/generate", { inputVersion: run.inputVersion }, "正在重新生成同方向口播稿…")}>重新生成口播稿</button></section>
    if (run.state === "WAITING_SCRIPT_SELECTION") return <section><p className="stage-kicker">同一方向，三种完整表达</p><h2 className="stage-title">选择今天的口播稿</h2><p className="stage-lead">先选出最像你的一版。确认后，系统会直接执行独立质量检查，不需要再触发 Agent 步骤。</p><ScriptCandidateList items={run.scriptBatch.items} pending={Boolean(busy)} onConfirm={selectScriptAndRunQa} /></section>
    if (run.state === "READY_FOR_QA") return <section className="recovery-stage"><p className="stage-kicker">所选口播稿已经保留</p><h2>质量检查没有完成</h2><p>系统只检查可信度、IP 匹配和表达结构，不会擅自改写。</p><button className="primary-action" disabled={Boolean(busy)} onClick={() => command("qa/run", { inputVersion: run.inputVersion }, "正在重新进行质量检查…")}>重新检查</button></section>
    if (run.state === "WAITING_LOCK_CONFIRMATION") return <QualityAndLock report={run.qualityReport} onLock={() => command("lock", {}, "正在锁定版本…")} />
    if (run.state === "LOCKED") return <section><p className="stage-kicker">今日内容已锁定</p><h2 className="stage-title">{run.ipProfile.displayName}，今天可以开拍了</h2><div className="locked-sheet"><strong>锁定稿 v{run.lockedScript?.version ?? 1}</strong><h3>{run.lockedScript?.script?.title}</h3><p>所选方向、口播稿、质量标准和确认记录已经保存。后续修改会创建新版本，不会覆盖本次锁定稿。</p></div><div className="handoff-grid"><div><small>预计时长</small><strong>{run.lockedScript?.script?.estimatedSeconds ?? 60} 秒</strong></div><div><small>当前交付</small><strong>完整口播稿与质量记录</strong></div><div><small>下一步</small><strong>真人拍摄并记录发布链接</strong></div></div><div className="stage-actions"><span>原型将使用模拟数据验证复盘界面</span><button className="primary-action" onClick={() => command("publication/simulate", {}, "正在生成模拟表现…")}>生成模拟发布数据</button></div></section>
    if (run.state === "WAITING_REVIEW") return <SimulationAndReview snapshot={run.metricSnapshot} reviewPending={Boolean(busy)} onReview={() => command("review/generate", { metricVersion: run.metricSnapshot.version }, "正在复盘这条内容…")} />
    if (run.state === "REVIEWED") return <SimulationAndReview snapshot={run.metricSnapshot} review={run.review} />
    return <section className="loading-stage" aria-live="polite"><p>{busy || "Agent 正在处理当前步骤…"}</p><h2>已完成的内容会自动保留</h2></section>
  })()

  const activeProfile = run?.ipProfile ?? currentIp
  return <div className="app-shell">
    <header className="app-header"><div className="header-inner"><h1 className="brand-title">内容增长 Agent</h1><div className="header-context"><span>2026 年 8 月 16 日</span>{activeProfile && <CurrentIpContext profile={activeProfile} />}</div></div></header>
    <main className={`daily-workspace ${run ? "has-run" : "onboarding"}`}>
      {run && <DailyProgress state={run.state} />}
      <div className="stage-column">{error && <aside className="error-card" role="alert">{error}<small>已完成进度仍然保留，请重试当前步骤。</small></aside>}{busy && run && <div className="working-line" aria-live="polite">{busy}</div>}{stage}{run && <ContextDrawer run={run} />}</div>
      {run && <aside className="agent-margin"><h2>Agent 的判断</h2><p>所有推荐都绑定当前 IP 的真实经历、表达边界和已发布内容结构，内部依据可按需展开。</p></aside>}
    </main>
  </div>
}
