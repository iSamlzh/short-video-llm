import { afterEach, describe, expect, it } from "vitest"
import { NextRequest } from "next/server"
import { POST } from "../../src/app/api/prototype/[...segments]/route"

const original = {
  APP_ENV: process.env.APP_ENV,
  ENABLE_PROTOTYPE_API: process.env.ENABLE_PROTOTYPE_API,
}

afterEach(() => {
  restore("APP_ENV", original.APP_ENV)
  restore("ENABLE_PROTOTYPE_API", original.ENABLE_PROTOTYPE_API)
})

describe("旧原型调试 API 路由", () => {
  it("生产拒绝发生在解析请求体和初始化服务之前", async () => {
    process.env.APP_ENV = "production"
    process.env.ENABLE_PROTOTYPE_API = "true"
    const request = new NextRequest("http://127.0.0.1/api/prototype/runs", {
      method: "POST",
      body: "这不是 JSON",
      headers: { "content-type": "application/json" },
    })

    const response = await POST(request, { params: Promise.resolve({ segments: ["runs"] }) })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ errorCode: "NOT_FOUND" })
  })
})

function restore(key: "APP_ENV" | "ENABLE_PROTOTYPE_API", value: string | undefined) {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}
