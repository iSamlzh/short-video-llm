import { createHash } from "node:crypto"
import type Database from "better-sqlite3"
import type { GrowthScope, SampleTier } from "../domain/growth-loop"

type EvidenceRow = {
  publication_id: string
  snapshot_id: string
  title: string
  published_at: string | null
  captured_at: string
  impressions: number | null
  plays: number | null
  completions: number | null
  completion_rate: number | null
  likes: number | null
  comments: number | null
  saves: number | null
  shares: number | null
  inquiries: number | null
  negative_feedback: number | null
  is_simulated: number
}

export type BaselineSnapshot = {
  publicationId: string
  snapshotId: string
  title: string
  publishedAt: string | null
  capturedAt: string
  metrics: Record<MetricName, number | null>
  isSimulated: boolean
}

type MetricName = "impressions" | "plays" | "completions" | "completionRate" | "likes" | "comments" | "saves" | "shares" | "inquiries" | "negativeFeedback"
const metricNames: MetricName[] = [
  "impressions", "plays", "completions", "completionRate", "likes", "comments", "saves", "shares", "inquiries", "negativeFeedback",
]

export class AccountBaselineService {
  constructor(private readonly database: Database.Database) {}

  build(scope: GrowthScope) {
    const history = (this.database.prepare(`SELECT
        m.publication_id,p.title,s.id snapshot_id,s.published_at,s.captured_at,s.impressions,s.plays,s.completions,
        s.completion_rate,s.likes,s.comments,s.saves,s.shares,s.inquiries,s.negative_feedback,s.is_simulated
      FROM publication_match_versions m
      JOIN real_metric_snapshots s ON s.id=m.snapshot_id
      JOIN publications p ON p.id=m.publication_id AND p.status='active'
      WHERE m.tenant_id=? AND m.ip_profile_id=? AND m.content_account_id=? AND s.platform=?
        AND m.is_current=1 AND m.status='matched'
      ORDER BY m.publication_id,s.captured_at DESC,s.id DESC`).all(
      scope.tenantId, scope.ipId, scope.contentAccountId, scope.platform,
    ) as EvidenceRow[]).map(mapEvidence)
    const latestByPublication = new Map<string, BaselineSnapshot>()
    history.forEach((item) => { if (!latestByPublication.has(item.publicationId)) latestByPublication.set(item.publicationId, item) })
    const latestSnapshots = [...latestByPublication.values()].sort((a, b) => a.publicationId.localeCompare(b.publicationId))
    const count = latestSnapshots.length
    const sampleTier: SampleTier = count >= 5 ? "memory_eligible" : count >= 3 ? "tentative" : "facts_only"
    const evidenceSetHash = createHash("sha256")
      .update(latestSnapshots.map((item) => `${item.publicationId}:${item.snapshotId}`).sort().join("|"))
      .digest("hex")
    const medians = Object.fromEntries(metricNames.map((name) => [name, median(latestSnapshots.map((item) => item.metrics[name]))])) as Record<MetricName, number | null>
    const ranges = Object.fromEntries(metricNames.map((name) => {
      const values = latestSnapshots.map((item) => item.metrics[name]).filter((value): value is number => value !== null).sort((a, b) => a - b)
      return [name, values.length ? { low: quantile(values, 0.25), high: quantile(values, 0.75) } : null]
    })) as Record<MetricName, { low: number; high: number } | null>
    return {
      scope, sampleTier, uniquePublicationCount: count, latestSnapshots, history,
      medians, ranges, missingFields: metricNames.filter((name) => medians[name] === null), evidenceSetHash,
    }
  }
}

function mapEvidence(row: EvidenceRow): BaselineSnapshot {
  return {
    publicationId: row.publication_id, snapshotId: row.snapshot_id, title: row.title,
    publishedAt: row.published_at, capturedAt: row.captured_at, isSimulated: row.is_simulated === 1,
    metrics: {
      impressions: row.impressions, plays: row.plays, completions: row.completions,
      completionRate: row.completion_rate, likes: row.likes, comments: row.comments,
      saves: row.saves, shares: row.shares, inquiries: row.inquiries,
      negativeFeedback: row.negative_feedback,
    },
  }
}

function median(values: Array<number | null>) {
  const present = values.filter((value): value is number => value !== null).sort((a, b) => a - b)
  if (!present.length) return null
  const middle = Math.floor(present.length / 2)
  return present.length % 2 ? present[middle] : (present[middle - 1] + present[middle]) / 2
}

function quantile(values: number[], position: number) {
  const index = (values.length - 1) * position
  const lower = Math.floor(index)
  const fraction = index - lower
  return values[lower] + (values[lower + 1] === undefined ? 0 : fraction * (values[lower + 1] - values[lower]))
}
