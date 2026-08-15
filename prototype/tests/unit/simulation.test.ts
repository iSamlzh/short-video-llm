import { describe, expect, it } from "vitest"
import { simulateMetrics } from "../../src/lib/simulation/metric-simulator"

const input = {
  runId: "run-1",
  lockedScriptVersion: 1,
  scores: { hook: 82, ipFit: 90, credibility: 88, structure: 80, callToAction: 75 },
}

describe("metric simulator", () => {
  it("reproduces metrics for the same locked script and scenario", () => {
    const first = simulateMetrics(input, "normal")
    const second = simulateMetrics(input, "normal")
    expect(second).toEqual(first)
    expect(first.isSimulated).toBe(true)
    expect(first.plays).toBeLessThanOrEqual(first.impressions)
    expect(first.completions).toBeLessThanOrEqual(first.plays)
  })

  it("changes scale across explicit demo scenarios", () => {
    expect(simulateMetrics(input, "breakout").impressions)
      .toBeGreaterThan(simulateMetrics(input, "underperform").impressions)
  })
})
