type RuntimeEnvironment = {
  NODE_ENV?: string
  PROTOTYPE_ENABLE_SIMULATION?: string
  PROTOTYPE_DEMO_CONTROLS?: string
  PROTOTYPE_TEST_MODE?: string
  PLAYWRIGHT_TEST_MODE?: string
}

export type RuntimeFeatures = {
  simulationEnabled: boolean
  demoAccountsVisible: boolean
  demoCredentialsPrefilled: boolean
}

export function resolveRuntimeFeatures(environment: RuntimeEnvironment): RuntimeFeatures {
  const production = environment.NODE_ENV === "production"
  const demoControlsEnabled = !production && environment.PROTOTYPE_DEMO_CONTROLS === "true"
  return {
    simulationEnabled: !production
      && environment.PROTOTYPE_TEST_MODE === "true"
      && environment.PLAYWRIGHT_TEST_MODE === "true",
    demoAccountsVisible: demoControlsEnabled,
    demoCredentialsPrefilled: demoControlsEnabled,
  }
}

export function shouldUseSecureSessionCookie(environment: RuntimeEnvironment) {
  const localE2E = environment.PROTOTYPE_TEST_MODE === "true"
    && environment.PLAYWRIGHT_TEST_MODE === "true"
  return environment.NODE_ENV === "production" && !localE2E
}
