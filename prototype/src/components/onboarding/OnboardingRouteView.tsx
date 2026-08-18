"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import type { IndustryCategory, PortraitDimension, PortraitQuestion } from "../../domain/ip-onboarding"
import { IpBasicInfoStep, type IpBasicInfo } from "./IpBasicInfoStep"
import { IndustryCategoryStep } from "./IndustryCategoryStep"
import { PortraitQuestionStep } from "./PortraitQuestionStep"
import { OnboardingAnswerReview, type AnswerSummary } from "./OnboardingAnswerReview"
import { IpOnboardingView } from "./IpOnboardingView"

type Session = {
  id: string; displayName: string; primaryPlatform: IpBasicInfo["primaryPlatform"]
  industryCategory: IndustryCategory; version: number; state: string; portraitDraft: any
  portraitDraftVersion: number
}
type SessionView = {
  session: Session
  currentQuestion: PortraitQuestion | null
  coveredDimensions: PortraitDimension[]
  canReview: boolean
  answeredSummary: AnswerSummary[]
}

export function OnboardingRouteView() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState("")
  const [basicInfo, setBasicInfo] = useState<IpBasicInfo | null>(null)
  const [localStep, setLocalStep] = useState<"basic" | "industry">("basic")
  const [view, setView] = useState<SessionView | null>(null)
  const [editing, setEditing] = useState<AnswerSummary | null>(null)
  const [portraitStale, setPortraitStale] = useState(false)

  useEffect(() => { void loadCurrent() }, [])

  async function loadCurrent() {
    setLoading(true)
    try {
      const response = await fetch("/api/app/ip-onboarding/sessions")
      setView(response.status === 204 ? null : await readResponse(response))
    } catch (error) { setStatus(messageOf(error, "暂时无法恢复建档进度")) }
    finally { setLoading(false) }
  }

  async function start(industryCategory: IndustryCategory) {
    if (!basicInfo) return
    setBusy(true); setStatus("")
    try {
      const response = await fetch("/api/app/ip-onboarding/sessions", jsonRequest("POST", { ...basicInfo, industryCategory }))
      setView(await readResponse(response)); setEditing(null)
    } catch (error) { await handleFailure(error) }
    finally { setBusy(false) }
  }

  async function saveAnswer(value: string | string[]) {
    if (!view) return
    const questionId = editing?.questionId ?? view.currentQuestion?.id
    if (!questionId) return
    setBusy(true); setStatus("")
    try {
      const response = await fetch(`/api/app/ip-onboarding/sessions/${view.session.id}/answers/${questionId}`, jsonRequest("PUT", {
        value,
        expectedVersion: view.session.version,
        ...(editing ? { mode: "revise" } : {}),
      }))
      setView(await readResponse(response))
      if (editing) setPortraitStale(true)
      setEditing(null)
    } catch (error) { await handleFailure(error) }
    finally { setBusy(false) }
  }

  async function generatePortrait() {
    if (!view) return
    setBusy(true); setStatus("")
    try {
      const response = await fetch(`/api/app/ip-onboarding/sessions/${view.session.id}/portrait-preview`, jsonRequest("POST", { expectedVersion: view.session.version }))
      setView(await readResponse(response)); setPortraitStale(false)
    } catch (error) { await handleFailure(error) }
    finally { setBusy(false) }
  }

  async function confirm() {
    if (!view) return
    const response = await fetch(`/api/app/ip-onboarding/sessions/${view.session.id}/confirm`, jsonRequest("POST", { portraitDraftVersion: view.session.portraitDraftVersion }))
    await readResponse(response)
    router.push("/app/today"); router.refresh()
  }

  async function handleFailure(error: unknown) {
    if (error instanceof HttpError && error.status === 409) {
      await loadCurrent(); setStatus("检测到另一处更新，已恢复到最新进度。")
      return
    }
    setStatus(messageOf(error, "请求暂时未完成，请重试"))
  }

  function requestCorrection(fieldPath: string) {
    if (!view?.session.portraitDraft) return
    const questionId = view.session.portraitDraft.contentPortrait?.sourceMap?.[fieldPath]?.[0]
    const answer = view.answeredSummary.find(item => item.questionId === questionId)
    if (answer) setEditing(answer)
  }

  if (loading) return <div className="document-page onboarding-start-view"><div className="onboarding-sheet onboarding-loading" aria-live="polite"><p className="onboarding-kicker">正在恢复进度</p><div /><div /><div /></div></div>
  if (!view) return <div className="document-page onboarding-start-view">
    {localStep === "basic" || !basicInfo
      ? <IpBasicInfoStep onContinue={info => { setBasicInfo(info); setLocalStep("industry") }} />
      : <IndustryCategoryStep basicInfo={basicInfo} busy={busy} onBack={() => setLocalStep("basic")} onStart={start} />}
    {status && <p className="inline-status onboarding-error" role="alert">{status}</p>}
  </div>

  if (editing) return <div className="document-page onboarding-start-view"><PortraitQuestionStep
    question={{ id: editing.questionId, prompt: editing.question, answerType: "long_text" }}
    initialValue={editing.value} answeredCount={view.answeredSummary.length} busy={busy} isRevision
    onCancel={() => setEditing(null)} onSubmit={saveAnswer}
  />{status && <p className="inline-status onboarding-error" role="alert">{status}</p>}</div>

  if (view.session.state === "PORTRAIT_PREVIEW" && view.session.portraitDraft && !portraitStale) {
    return <IpOnboardingView
      portrait={view.session.portraitDraft.portrait}
      sourceMap={view.session.portraitDraft.contentPortrait?.sourceMap}
      onRequestCorrection={requestCorrection}
      onConfirm={confirm}
    />
  }

  if (view.session.state === "REVIEWING_ANSWERS" || view.session.state === "GENERATION_FAILED" || portraitStale) {
    return <div className="document-page onboarding-start-view"><OnboardingAnswerReview answers={view.answeredSummary} busy={busy} stale={portraitStale} onEdit={setEditing} onGenerate={generatePortrait} />{status && <p className="inline-status onboarding-error" role="alert">{status}</p>}</div>
  }

  if (view.currentQuestion) return <div className="document-page onboarding-start-view"><PortraitQuestionStep question={view.currentQuestion} answeredCount={view.answeredSummary.length} busy={busy} onSubmit={saveAnswer} />{status && <p className="inline-status onboarding-error" role="alert">{status}</p>}</div>
  return <div className="document-page onboarding-start-view"><section className="onboarding-sheet"><h1>建档进度需要恢复</h1><button className="primary-button" onClick={loadCurrent}>重新读取最新进度</button></section></div>
}

function jsonRequest(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
}

async function readResponse(response: Response) {
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new HttpError(response.status, payload.message ?? payload.errorCode ?? "请求失败")
  return payload
}

class HttpError extends Error { constructor(readonly status: number, message: string) { super(message) } }
function messageOf(error: unknown, fallback: string) { return error instanceof Error ? error.message : fallback }
