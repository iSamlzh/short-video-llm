import { createHash } from "node:crypto"
import { metricSnapshotSchema, type QualityReport } from "../../domain/schemas"

export type SimulationScenario = "underperform" | "normal" | "breakout"
const simulatorVersion = "prototype-sim-v1"

function seededRandom(hash: string) {
  let state = Number.parseInt(hash.slice(0, 8), 16) >>> 0
  return () => {
    state = (1664525 * state + 1013904223) >>> 0
    return state / 0x100000000
  }
}

export function simulateMetrics(input: {
  runId: string
  lockedScriptVersion: number
  scores: QualityReport["scores"]
}, scenario: SimulationScenario) {
  const seedHash = createHash("sha256")
    .update(`${input.runId}:${input.lockedScriptVersion}:${simulatorVersion}:${scenario}`).digest("hex")
  const random = seededRandom(seedHash)
  const score = input.scores
  const qualityIndex = 0.30 * score.hook + 0.25 * score.ipFit + 0.20 * score.credibility
    + 0.15 * score.structure + 0.10 * score.callToAction
  const multiplier = { underperform: 0.55, normal: 1, breakout: 2.5 }[scenario]
  const impressions = Math.max(100, Math.round((800 + qualityIndex * 32) * multiplier * (0.9 + random() * 0.2)))
  const plays = Math.min(impressions, Math.round(impressions * (0.38 + score.hook / 250)))
  const completions = Math.min(plays, Math.round(plays * (0.18 + score.structure / 220)))
  const interactions = (rate: number) => Math.min(plays, Math.round(plays * rate * (0.85 + random() * 0.3)))
  return metricSnapshotSchema.parse({
    isSimulated: true, scenario, simulatorVersion, seedHash, impressions, plays, completions,
    likes: interactions(0.045 + score.ipFit / 3000),
    comments: interactions(0.008 + score.credibility / 9000),
    saves: interactions(0.012 + score.structure / 6000),
    shares: interactions(0.006 + score.hook / 12000),
    inquiries: interactions(0.003 + score.callToAction / 12000),
  })
}
