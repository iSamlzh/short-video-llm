import { describe, expect, it } from "vitest"
import { resolveRuntimeFeatures } from "../../src/lib/runtime-features"

describe("runtime feature boundary", () => {
  it("never enables simulation in production", () => {
    expect(resolveRuntimeFeatures({
      NODE_ENV: "production",
      PROTOTYPE_ENABLE_SIMULATION: "true",
      PROTOTYPE_TEST_MODE: "true",
      PLAYWRIGHT_TEST_MODE: "true",
    }).simulationEnabled).toBe(false)
  })

  it("requires both test flags outside production", () => {
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
})
