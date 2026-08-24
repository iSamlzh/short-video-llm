import { describe, expect, it } from "vitest"
import { resolveRuntimeFeatures, shouldUseSecureSessionCookie } from "../../src/lib/runtime-features"
import { validateRuntimeEnvironment } from "../../src/lib/runtime-environment-validation"

describe("运行环境能力边界", () => {
  it("生产环境始终关闭模拟、演示账号和凭据预填", () => {
    expect(resolveRuntimeFeatures({
      NODE_ENV: "production",
      PROTOTYPE_DEMO_CONTROLS: "true",
      PROTOTYPE_TEST_MODE: "true",
      PLAYWRIGHT_TEST_MODE: "true",
    })).toMatchObject({
      appEnvironment: "production",
      prototypeApiEnabled: false,
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
      APP_ENV: "e2e",
      PROTOTYPE_TEST_MODE: "true",
      PLAYWRIGHT_TEST_MODE: "false",
    }).simulationEnabled).toBe(false)
    expect(resolveRuntimeFeatures({
      APP_ENV: "e2e",
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
      APP_ENV: "e2e",
      PROTOTYPE_TEST_MODE: "true",
      PLAYWRIGHT_TEST_MODE: "true",
    })).toBe(false)
    expect(shouldUseSecureSessionCookie({ NODE_ENV: "development" })).toBe(false)
  })

  it("生产环境拒绝调试、测试和非绝对数据库路径", () => {
    expect(() => validateRuntimeEnvironment({
      APP_ENV: "production",
      NODE_ENV: "production",
      ENABLE_PROTOTYPE_API: "true",
      PROTOTYPE_TEST_MODE: "true",
      PROTOTYPE_DB_PATH: ".data/prototype.sqlite",
    })).toThrow(/PROTOTYPE_API_FORBIDDEN.*PROTOTYPE_TEST_MODE_FORBIDDEN.*PRODUCTION_DB_PATH_MUST_BE_ABSOLUTE/)
  })

  it("生产环境接受明确且隔离的安全配置", () => {
    expect(validateRuntimeEnvironment({
      APP_ENV: "production",
      NODE_ENV: "production",
      ENABLE_PROTOTYPE_API: "false",
      PROTOTYPE_TEST_MODE: "false",
      PLAYWRIGHT_TEST_MODE: "false",
      PROTOTYPE_DEMO_CONTROLS: "false",
      PROTOTYPE_ALLOW_DEMO_CLEAR: "false",
      PROTOTYPE_DB_PATH: "C:\\srv\\content-agent\\data\\production.sqlite",
    })).toEqual({ appEnvironment: "production" })
  })

  it("E2E 强制双测试开关且禁止真实模型", () => {
    expect(() => validateRuntimeEnvironment({
      APP_ENV: "e2e",
      PROTOTYPE_TEST_MODE: "true",
      PLAYWRIGHT_TEST_MODE: "true",
      ALLOW_LIVE_MODEL: "true",
    })).toThrow(/LIVE_MODEL_FORBIDDEN_IN_E2E/)
  })

  it("共享测试环境启用调试 API 时强制要求独立令牌", () => {
    expect(() => validateRuntimeEnvironment({
      APP_ENV: "staging",
      ENABLE_PROTOTYPE_API: "true",
    })).toThrow(/PROTOTYPE_API_TOKEN_REQUIRED_IN_STAGING/)
  })
})
