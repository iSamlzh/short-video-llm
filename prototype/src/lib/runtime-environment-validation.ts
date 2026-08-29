import { posix, resolve, win32 } from "node:path"
import { resolveAppEnvironment, type RuntimeEnvironment } from "./runtime-features"

export function validateRuntimeEnvironment(environment: RuntimeEnvironment, cwd = process.cwd()) {
  const appEnvironment = resolveAppEnvironment(environment)
  const errors: string[] = []

  if (appEnvironment === "production") {
    if (environment.APP_ENV !== "production") errors.push("APP_ENV_PRODUCTION_REQUIRED")
    if (environment.ENABLE_PROTOTYPE_API === "true") errors.push("PROTOTYPE_API_FORBIDDEN")
    if (environment.PROTOTYPE_TEST_MODE === "true") errors.push("PROTOTYPE_TEST_MODE_FORBIDDEN")
    if (environment.PLAYWRIGHT_TEST_MODE === "true") errors.push("PLAYWRIGHT_TEST_MODE_FORBIDDEN")
    if (environment.PROTOTYPE_DEMO_CONTROLS === "true") errors.push("DEMO_CONTROLS_FORBIDDEN")
    if (environment.PROTOTYPE_ALLOW_DEMO_CLEAR === "true") errors.push("DEMO_CLEAR_FORBIDDEN")
    if (environment.CONTENT_ANALYSIS_INLINE_WORKER === "true") errors.push("INLINE_CONTENT_WORKER_FORBIDDEN")
    validateProductionDatabasePath(environment.PROTOTYPE_DB_PATH, cwd, errors)
  }

  if (appEnvironment === "staging") {
    if (environment.PROTOTYPE_TEST_MODE === "true" || environment.PLAYWRIGHT_TEST_MODE === "true") {
      errors.push("E2E_FLAGS_FORBIDDEN_IN_STAGING")
    }
    if (environment.PROTOTYPE_DEMO_CONTROLS === "true" || environment.PROTOTYPE_ALLOW_DEMO_CLEAR === "true") {
      errors.push("DEMO_FLAGS_FORBIDDEN_IN_STAGING")
    }
    if (environment.ENABLE_PROTOTYPE_API === "true" && !environment.PROTOTYPE_API_TOKEN) {
      errors.push("PROTOTYPE_API_TOKEN_REQUIRED_IN_STAGING")
    }
  }

  if (appEnvironment === "e2e") {
    if (environment.PROTOTYPE_TEST_MODE !== "true" || environment.PLAYWRIGHT_TEST_MODE !== "true") {
      errors.push("E2E_FLAGS_REQUIRED")
    }
    if (environment.ALLOW_LIVE_MODEL === "true") errors.push("LIVE_MODEL_FORBIDDEN_IN_E2E")
  }

  if (errors.length) {
    throw Object.assign(new Error(`运行环境配置不安全：${errors.join(", ")}`), {
      code: "UNSAFE_RUNTIME_ENVIRONMENT",
      details: errors,
    })
  }
  return { appEnvironment }
}

function validateProductionDatabasePath(path: string | undefined, cwd: string, errors: string[]) {
  if (!path) {
    errors.push("PRODUCTION_DB_PATH_REQUIRED")
    return
  }
  // Deployment validation can run on a different OS from the target release.
  // Accept either platform's absolute syntax while still rejecting relative paths.
  if (!posix.isAbsolute(path) && !win32.isAbsolute(path)) {
    errors.push("PRODUCTION_DB_PATH_MUST_BE_ABSOLUTE")
  }
  const normalized = resolve(cwd, path).toLowerCase()
  if (/(^|[\\/_.-])(e2e|test|development|dev)([\\/_.-]|$)/.test(normalized)) {
    errors.push("PRODUCTION_DB_PATH_LOOKS_NON_PRODUCTION")
  }
}
