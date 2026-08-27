import { afterEach, describe, expect, it, vi } from "vitest"
import { linkRequestToTask, setRequestLogIdentity, withRequestLog } from "../../src/lib/observability/request-log"

afterEach(() => vi.restoreAllMocks())

describe("结构化请求日志", () => {
  it("关联请求、身份与任务，并只提取错误码而不记录正文", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const handler = withRequestLog(async (request: Request) => {
      await request.json()
      setRequestLogIdentity({ userId: "user-1", tenantId: "tenant-1", audience: "tenant" })
      linkRequestToTask("558046b4-d852-4cea-8428-b538164e2a0c")
      return Response.json({ errorCode: "LLM_TIMEOUT", message: "包含敏感正文" }, { status: 504 })
    })

    const response = await handler(new Request("http://localhost/api/app/content/558046b4-d852-4cea-8428-b538164e2a0c", {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": "req_test_12345678" },
      body: JSON.stringify({ prompt: "不能进入日志的完整提示词" }),
    }))

    expect(response.headers.get("x-request-id")).toBe("req_test_12345678")
    expect(error).toHaveBeenCalledTimes(1)
    const raw = String(error.mock.calls[0]?.[0])
    const entry = JSON.parse(raw)
    expect(entry).toMatchObject({
      level: "error",
      event: "http_request",
      requestId: "req_test_12345678",
      method: "POST",
      route: "/api/app/content/:runId",
      status: 504,
      tenantId: "tenant-1",
      userId: "user-1",
      taskId: "558046b4-d852-4cea-8428-b538164e2a0c",
      errorCode: "LLM_TIMEOUT",
    })
    expect(raw).not.toContain("完整提示词")
    expect(raw).not.toContain("敏感正文")
  })

  it("不信任格式异常的外部请求编号", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined)
    const handler = withRequestLog(async () => Response.json({ ok: true }))
    const response = await handler(new Request("http://localhost/api/health/live", {
      headers: { "x-request-id": "unsafe request id" },
    }))

    expect(response.headers.get("x-request-id")).toMatch(/^req_[0-9a-f-]{36}$/)
    expect(JSON.parse(String(info.mock.calls[0]?.[0]))).toMatchObject({ event: "http_request", status: 200 })
  })
})
