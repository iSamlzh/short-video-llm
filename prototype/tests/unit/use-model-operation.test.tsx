import { act, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useModelOperation } from "../../src/hooks/use-model-operation"

describe("useModelOperation", () => {
  afterEach(() => vi.useRealTimers())

  it("请求超过 500ms 后显示阶段与已耗时", async () => {
    vi.useFakeTimers()
    const task = vi.fn(() => new Promise<string>(() => undefined))
    const { result } = renderHook(() => useModelOperation())

    act(() => {
      void result.current.start({ initialStage: "selecting", task, onSuccess: () => undefined })
    })

    expect(result.current.state).toMatchObject({ stage: "selecting", elapsedSeconds: 0, cancellable: true })
    expect(result.current.detailsVisible).toBe(false)

    act(() => vi.advanceTimersByTime(501))

    expect(result.current.detailsVisible).toBe(true)
    act(() => vi.advanceTimersByTime(1_000))
    expect(result.current.state?.elapsedSeconds).toBe(1)
  })

  it("取消只中断本次请求，不产生模型失败", async () => {
    let requestSignal: AbortSignal | undefined
    const task = vi.fn((signal: AbortSignal) => new Promise<string>((_resolve, reject) => {
      requestSignal = signal
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))
    }))
    const { result } = renderHook(() => useModelOperation())

    await act(async () => {
      void result.current.start({ initialStage: "writing", task, onSuccess: () => undefined })
    })
    await act(async () => result.current.cancel())

    expect(requestSignal?.aborted).toBe(true)
    expect(result.current.state).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it("失败后只重试刚才的操作", async () => {
    let attempts = 0
    let finalValue = ""
    const task = async () => {
      attempts += 1
      if (attempts === 1) throw Object.assign(new Error("模型连接失败"), { retryable: true })
      return "新稿"
    }
    const { result } = renderHook(() => useModelOperation())

    await act(async () => {
      await result.current.start({ initialStage: "writing", task, onSuccess: (value) => { finalValue = value } })
    })
    expect(result.current.state).toMatchObject({ retryable: true, cancellable: false })

    await act(async () => result.current.retry())

    expect(attempts).toBe(2)
    expect(finalValue).toBe("新稿")
    expect(result.current.state).toBeNull()
  })
})
