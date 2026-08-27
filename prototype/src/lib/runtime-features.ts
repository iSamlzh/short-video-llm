export type AppEnvironment = "development" | "e2e" | "staging" | "production"

export type RuntimeEnvironment = {
  APP_ENV?: string
  NODE_ENV?: string
  ENABLE_PROTOTYPE_API?: string
  ALLOW_LIVE_MODEL?: string
  PROTOTYPE_DB_PATH?: string
  PROTOTYPE_ENABLE_SIMULATION?: string
  PROTOTYPE_DEMO_CONTROLS?: string
  PROTOTYPE_TEST_MODE?: string
  PLAYWRIGHT_TEST_MODE?: string
  PROTOTYPE_ALLOW_DEMO_CLEAR?: string
  PROTOTYPE_API_TOKEN?: string
  LLM_BASE_URL?: string
  LLM_API_KEY?: string
  LLM_MODEL?: string
  LLM_STREAMING?: string
  LLM_MAX_OUTPUT_TOKENS?: string
  DISK_MIN_FREE_MB?: string
  HEALTH_MODEL_FAILURE_THRESHOLD?: string
  APP_VERSION?: string
}

export type RuntimeFeatures = {
  appEnvironment: AppEnvironment
  prototypeApiEnabled: boolean
  prototypeApiRequiresToken: boolean
  prototypeFixtureLlm: boolean
  simulationEnabled: boolean
  demoAccountsVisible: boolean
  demoCredentialsPrefilled: boolean
}

export function resolveRuntimeFeatures(environment: RuntimeEnvironment): RuntimeFeatures {
  const appEnvironment = resolveAppEnvironment(environment)
  const localOrE2e = appEnvironment === "development" || appEnvironment === "e2e"
  const prototypeApiEnabled = appEnvironment !== "production"
    && environment.ENABLE_PROTOTYPE_API === "true"
  const demoControlsEnabled = localOrE2e && environment.PROTOTYPE_DEMO_CONTROLS === "true"
  return {
    appEnvironment,
    prototypeApiEnabled,
    prototypeApiRequiresToken: prototypeApiEnabled && appEnvironment === "staging",
    prototypeFixtureLlm: appEnvironment === "e2e" || environment.ALLOW_LIVE_MODEL !== "true",
    simulationEnabled: appEnvironment === "e2e"
      && environment.PROTOTYPE_TEST_MODE === "true"
      && environment.PLAYWRIGHT_TEST_MODE === "true",
    demoAccountsVisible: demoControlsEnabled,
    demoCredentialsPrefilled: demoControlsEnabled,
  }
}

export function shouldUseSecureSessionCookie(environment: RuntimeEnvironment) {
  const appEnvironment = resolveAppEnvironment(environment)
  return appEnvironment === "production" || appEnvironment === "staging"
}

export function resolveAppEnvironment(environment: RuntimeEnvironment): AppEnvironment {
  if (environment.APP_ENV === "development" || environment.APP_ENV === "e2e"
    || environment.APP_ENV === "staging" || environment.APP_ENV === "production") {
    return environment.APP_ENV
  }
  if (environment.NODE_ENV === "test") return "e2e"
  if (environment.NODE_ENV === "development") return "development"
  return "production"
}
