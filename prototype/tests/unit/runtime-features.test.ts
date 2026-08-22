import { describe, expect, it } from "vitest"
import { resolveRuntimeFeatures, shouldUseSecureSessionCookie } from "../../src/lib/runtime-features"

describe("运行环境能力边界", () => {
  it("生产环境始终关闭模拟、演示账号和凭据预填", () => {
    expect(resolveRuntimeFeatures({
      NODE_ENV: "production",
      PROTOTYPE_DEMO_CONTROLS: "true",
      PROTOTYPE_TEST_MODE: "true",
      PLAYWRIGHT_TEST_MODE: "true",
    })).toEqual({
      simulationEnabled: false,
      demoAccountsVisible: false,
      demoCredentialsPrefilled: false,
    })
  })

  it("非生产环境也必须显式开启演示控制才展示测试账号", () => {
    expect(resolveRuntimeFeatures({ NODE_ENV: "development" })).toMatchObject({
      demoAccountsVisible: false,
      demoCredentialsPrefilled: false,
    })
    expect(resolveRuntimeFeatures({
      NODE_ENV: "development",
      PROTOTYPE_DEMO_CONTROLS: "true",
    })).toMatchObject({
      demoAccountsVisible: true,
      demoCredentialsPrefilled: true,
    })
  })

  it("模拟数据只在两项测试开关同时启用时开放", () => {
    expect(resolveRuntimeFeatures({
      NODE_ENV: "test",
      PROTOTYPE_TEST_MODE: "true",
      PLAYWRIGHT_TEST_MODE: "false",
    }).simulationEnabled).toBe(false)
    expect(resolveRuntimeFeatures({
      NODE_ENV: "test",
      PROTOTYPE_TEST_MODE: "true",
      PLAYWRIGHT_TEST_MODE: "true",
    }).simulationEnabled).toBe(true)
  })

  it("生产会话默认使用 Secure，仅本机双重 E2E 标记允许 HTTP 浏览器验证", () => {
    expect(shouldUseSecureSessionCookie({ NODE_ENV: "production" })).toBe(true)
    expect(shouldUseSecureSessionCookie({
      NODE_ENV: "production",
      PROTOTYPE_TEST_MODE: "true",
      PLAYWRIGHT_TEST_MODE: "false",
    })).toBe(true)
    expect(shouldUseSecureSessionCookie({
      NODE_ENV: "production",
      PROTOTYPE_TEST_MODE: "true",
      PLAYWRIGHT_TEST_MODE: "true",
    })).toBe(false)
    expect(shouldUseSecureSessionCookie({ NODE_ENV: "development" })).toBe(false)
  })
})
