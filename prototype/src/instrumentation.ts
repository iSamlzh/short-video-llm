export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateRuntimeEnvironment } = await import("./lib/runtime-environment-validation")
    validateRuntimeEnvironment(process.env)
  }
}
