"use client"

import { useCallback, useEffect, useRef, useState } from "react"

export type ModelOperationStage = "preparing" | "selecting" | "writing" | "checking" | "saving"

export type ModelOperationState = {
  stage: ModelOperationStage
  elapsedSeconds: number
  cancellable: boolean
  retryable: boolean
}

type StartOptions<T> = {
  initialStage: ModelOperationStage
  task: (signal: AbortSignal) => Promise<T>
  onSuccess: (value: T) => void
}

type StoredOptions = StartOptions<unknown>

const stageTimelines: Record<ModelOperationStage, Array<{ afterMs: number; stage: ModelOperationStage }>> = {
  preparing: [
    { afterMs: 800, stage: "selecting" },
    { afterMs: 2_500, stage: "writing" },
    { afterMs: 10_000, stage: "checking" },
    { afterMs: 15_000, stage: "saving" },
  ],
  selecting: [
    { afterMs: 2_500, stage: "writing" },
    { afterMs: 10_000, stage: "checking" },
    { afterMs: 15_000, stage: "saving" },
  ],
  writing: [
    { afterMs: 10_000, stage: "checking" },
    { afterMs: 15_000, stage: "saving" },
  ],
  checking: [{ afterMs: 5_000, stage: "saving" }],
  saving: [],
}

export function useModelOperation() {
  const [state, setState] = useState<ModelOperationState | null>(null)
  const [detailsVisible, setDetailsVisible] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const timersRef = useRef<Array<ReturnType<typeof setTimeout>>>([])
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const requestIdRef = useRef(0)
  const retryRef = useRef<StoredOptions | null>(null)

  const clearTimers = useCallback(() => {
    timersRef.current.forEach(clearTimeout)
    timersRef.current = []
    if (intervalRef.current) clearInterval(intervalRef.current)
    intervalRef.current = null
  }, [])

  const start = useCallback(async <T,>(options: StartOptions<T>) => {
    controllerRef.current?.abort()
    clearTimers()
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    retryRef.current = options as StoredOptions
    const controller = new AbortController()
    controllerRef.current = controller
    setError(null)
    setDetailsVisible(false)
    setState({ stage: options.initialStage, elapsedSeconds: 0, cancellable: true, retryable: false })

    timersRef.current.push(setTimeout(() => {
      if (requestIdRef.current === requestId) setDetailsVisible(true)
    }, 500))
    stageTimelines[options.initialStage].forEach(({ afterMs, stage }) => {
      timersRef.current.push(setTimeout(() => {
        if (requestIdRef.current === requestId) setState(current => current ? { ...current, stage } : current)
      }, afterMs))
    })
    intervalRef.current = setInterval(() => {
      if (requestIdRef.current === requestId) {
        setState(current => current ? { ...current, elapsedSeconds: current.elapsedSeconds + 1 } : current)
      }
    }, 1_000)

    try {
      const value = await options.task(controller.signal)
      if (requestIdRef.current !== requestId) return
      options.onSuccess(value)
      clearTimers()
      controllerRef.current = null
      setState(null)
      setDetailsVisible(false)
    } catch (value) {
      if (requestIdRef.current !== requestId || isAbortError(value)) return
      clearTimers()
      controllerRef.current = null
      const failure = value as { message?: string; retryable?: boolean }
      setError(failure.message || "模型操作失败")
      setDetailsVisible(true)
      setState(current => ({
        stage: current?.stage ?? options.initialStage,
        elapsedSeconds: current?.elapsedSeconds ?? 0,
        cancellable: false,
        retryable: failure.retryable !== false,
      }))
    }
  }, [clearTimers])

  const cancel = useCallback(() => {
    requestIdRef.current += 1
    controllerRef.current?.abort()
    controllerRef.current = null
    clearTimers()
    setState(null)
    setDetailsVisible(false)
    setError(null)
  }, [clearTimers])

  const retry = useCallback(async () => {
    const options = retryRef.current
    if (options) await start(options)
  }, [start])

  useEffect(() => () => {
    requestIdRef.current += 1
    controllerRef.current?.abort()
    clearTimers()
  }, [clearTimers])

  return {
    state,
    detailsVisible,
    error,
    running: Boolean(state?.cancellable),
    start,
    cancel,
    retry,
  }
}

function isAbortError(value: unknown) {
  return value instanceof Error && value.name === "AbortError"
}
