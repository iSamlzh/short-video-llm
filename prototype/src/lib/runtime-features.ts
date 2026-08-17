type RuntimeEnvironment = {
  NODE_ENV?: string
  PROTOTYPE_ENABLE_SIMULATION?: string
  PROTOTYPE_TEST_MODE?: string
  PLAYWRIGHT_TEST_MODE?: string
}

export function resolveRuntimeFeatures(environment: RuntimeEnvironment) {
  const production = environment.NODE_ENV === "production"
  return {
    simulationEnabled: !production
      && environment.PROTOTYPE_TEST_MODE === "true"
      && environment.PLAYWRIGHT_TEST_MODE === "true",
  }
}
