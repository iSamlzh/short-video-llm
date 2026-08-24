import { describe, expect, it } from "vitest"
import { authorizePrototypeApi } from "../../src/lib/prototype-api-access"

describe("旧原型调试 API 环境隔离", () => {
  const request = (headers?: HeadersInit) => new Request("http://127.0.0.1/api/prototype/runs", { headers })

  it("生产环境即使误开开关也固定返回不可访问", () => {
    expect(authorizePrototypeApi(request(), {
      APP_ENV: "production",
      ENABLE_PROTOTYPE_API: "true",
    })).toEqual({ allowed: false, status: 404 })
  })

  it("本地和 E2E 必须显式开启后才允许访问", () => {
    expect(authorizePrototypeApi(request(), { APP_ENV: "development" }))
      .toEqual({ allowed: false, status: 404 })
    expect(authorizePrototypeApi(request(), {
      APP_ENV: "development",
      ENABLE_PROTOTYPE_API: "true",
    })).toEqual({ allowed: true })
    expect(authorizePrototypeApi(request(), {
      APP_ENV: "e2e",
      ENABLE_PROTOTYPE_API: "true",
    })).toEqual({ allowed: true })
  })

  it("共享测试环境启用调试时必须提供匹配令牌", () => {
    const environment = {
      APP_ENV: "staging",
      ENABLE_PROTOTYPE_API: "true",
      PROTOTYPE_API_TOKEN: "shared-test-secret",
    }
    expect(authorizePrototypeApi(request(), environment)).toEqual({ allowed: false, status: 401 })
    expect(authorizePrototypeApi(request({ "x-prototype-token": "wrong" }), environment))
      .toEqual({ allowed: false, status: 401 })
    expect(authorizePrototypeApi(request({ authorization: "Bearer shared-test-secret" }), environment))
      .toEqual({ allowed: true })
  })
})
