import { describe, expect, it } from "vitest"
import { creationErrorResponse } from "../../src/app/api/app/creation/[...segments]/route"

describe("创作路由模型错误合同", () => {
  it.each([
    ["MODEL_RATE_LIMITED", 429],
    ["LLM_TIMEOUT", 504],
    ["MODEL_SCHEMA_INVALID", 502],
    ["MODEL_CONNECTION_FAILED", 503],
  ] as const)("稳定映射 %s", async (code, status) => {
    const response = creationErrorResponse(Object.assign(new Error("模型暂时不可用"), { code, retryable: true }))

    expect(response.status).toBe(status)
    expect(await response.json()).toEqual({
      errorCode: code,
      message: "模型暂时不可用",
      retryable: true,
    })
  })

  it.each(["MEMORY_VERSION_STALE", "MEMORY_REVIEW_MISMATCH", "REVIEW_NOT_CONFIRMED"])("将下一轮血缘冲突 %s 映射为 409", async (code) => {
    const response = creationErrorResponse(new Error(code))
    expect(response.status).toBe(409)
  })
})
