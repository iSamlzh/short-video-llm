import { createHmac, randomUUID } from "node:crypto"
import type Database from "better-sqlite3"
import { DomainOutboxRepository } from "../lib/db/domain-outbox-repository"
import { StructureEvaluationService } from "./structure-evaluation-service"

type ProjectionRow = {
  match_id: string
  publication_id: string
  snapshot_id: string
  usage_id: string
  is_current: number
  match_status: string
  publication_status: string
  publication_source: string
  tenant_id: string
  ip_profile_id: string
  content_account_id: string
  platform: string
  structure_version_id: string
  captured_at: string
  impressions: number | null
  plays: number | null
  completions: number | null
  completion_rate: number | null
  three_second_retention: number | null
  five_second_retention: number | null
  average_watch_seconds: number | null
  likes: number | null
  comments: number | null
  saves: number | null
  shares: number | null
  profile_visits: number | null
  followers_gained: number | null
  inquiries: number | null
  negative_feedback: number | null
}

const metricColumns = [
  "impressions", "plays", "completions", "completion_rate", "three_second_retention",
  "five_second_retention", "average_watch_seconds", "likes", "comments", "saves", "shares",
  "profile_visits", "followers_gained", "inquiries", "negative_feedback",
] as const

export class StructureObservationProjector {
  private readonly outbox: DomainOutboxRepository

  constructor(private readonly database: Database.Database) {
    this.outbox = new DomainOutboxRepository(database)
  }

  processPending(limit = 20) {
    const events = this.outbox.claim(limit)
    let completed = 0
    let failed = 0
    for (const event of events) {
      try {
        const matchId = typeof event.payload.matchId === "string" ? event.payload.matchId : event.aggregateId
        const versions = event.eventType === "structure.match_retracted" ? this.retract(matchId) : this.upsert(matchId)
        versions.forEach((versionId) => new StructureEvaluationService(this.database).evaluate(versionId))
        this.outbox.complete(event.id)
        completed += 1
      } catch (error) {
        this.outbox.fail(event.id, error, event.attemptCount)
        failed += 1
      }
    }
    return { claimed: events.length, completed, failed }
  }

  private upsert(matchId: string) {
    const fingerprint = sourceFingerprint(matchId)
    const row = this.database.prepare(`SELECT
        m.id match_id,m.publication_id,s.id snapshot_id,u.id usage_id,m.is_current,m.status match_status,
        p.status publication_status,p.source publication_source,
        m.tenant_id,m.ip_profile_id,m.content_account_id,s.platform,
        u.primary_structure_version_id structure_version_id,s.captured_at,
        s.impressions,s.plays,s.completions,s.completion_rate,s.three_second_retention,
        s.five_second_retention,s.average_watch_seconds,s.likes,s.comments,s.saves,s.shares,
        s.profile_visits,s.followers_gained,s.inquiries,s.negative_feedback
      FROM publication_match_versions m
      JOIN real_metric_snapshots s ON s.id=m.snapshot_id
      JOIN publications p ON p.id=m.publication_id
      JOIN structure_usage_records u
        ON u.run_id=p.run_id AND u.locked_script_version=p.locked_script_version
      WHERE m.id=? AND u.attribution_status='attributed'`).get(matchId) as ProjectionRow | undefined
    if (!row || row.is_current !== 1 || row.match_status !== "matched"
      || row.publication_status !== "active" || row.publication_source !== "system") {
      return this.retract(matchId)
    }
    const nodeKeys = (this.database.prepare(`SELECT DISTINCT n.node_key
      FROM structure_usage_nodes n
      JOIN structure_usage_records u ON u.id=n.usage_id
      JOIN publications p ON p.run_id=u.run_id AND p.locked_script_version=u.locked_script_version
      JOIN publication_match_versions m ON m.publication_id=p.id
      WHERE m.id=? AND n.template_version_id=u.primary_structure_version_id
      ORDER BY n.node_key`).all(matchId) as Array<{ node_key: string }>).map((item) => item.node_key)
    const baseline = buildPeerBaseline(this.database, row)
    const sampleCount = baseline.peerCount + 1
    const evidenceTier = sampleCount >= 5 ? "confirmed" : sampleCount >= 3 ? "tentative" : "fact"
    const metrics = rawMetrics(row)
    const metricDelta = buildMetricDelta(metrics, baseline.medians, baseline.peerCount >= 3)
    const missingMetrics = metricColumns.filter((name) => row[name] == null).map(toCamelCase)
    const now = new Date().toISOString()
    this.database.transaction(() => {
      this.database.prepare(`UPDATE platform_structure_observations
        SET status='invalidated',revision=revision+1,updated_at=?
        WHERE id IN (
          SELECT o.id FROM platform_structure_observations o
          JOIN structure_observation_source_links l ON l.observation_id=o.id
          WHERE l.publication_id=? AND o.structure_version_id=? AND o.source_fingerprint!=?
            AND o.captured_at<=? AND o.status='active'
        )`).run(now, row.publication_id, row.structure_version_id, fingerprint, row.captured_at)
      this.database.prepare(`INSERT INTO platform_structure_observations
        (id,source_fingerprint,scope_fingerprint,publication_fingerprint,structure_version_id,node_keys_json,
         platform,context_bucket_json,evidence_tier,metrics_json,metric_delta_json,data_quality_json,
         captured_at,status,revision,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'active',1,?,?)
        ON CONFLICT(source_fingerprint) DO UPDATE SET
          scope_fingerprint=excluded.scope_fingerprint,
          publication_fingerprint=excluded.publication_fingerprint,
          structure_version_id=excluded.structure_version_id,
          node_keys_json=excluded.node_keys_json,
          platform=excluded.platform,
          context_bucket_json=excluded.context_bucket_json,
          evidence_tier=excluded.evidence_tier,
          metrics_json=excluded.metrics_json,
          metric_delta_json=excluded.metric_delta_json,
          data_quality_json=excluded.data_quality_json,
          captured_at=excluded.captured_at,
          status='active',revision=platform_structure_observations.revision+1,updated_at=excluded.updated_at`).run(
        randomUUID(), fingerprint, scopeFingerprint(row.tenant_id, row.ip_profile_id), sourceFingerprint(row.publication_id),
        row.structure_version_id, JSON.stringify(nodeKeys), row.platform,
        JSON.stringify({ platform: row.platform }), evidenceTier, JSON.stringify(metrics), JSON.stringify(metricDelta),
        JSON.stringify({ missingMetrics, sampleCount, baselinePeerCount: baseline.peerCount, simulated: false }),
        row.captured_at, now, now,
      )
      const observation = this.database.prepare(`SELECT id FROM platform_structure_observations
        WHERE source_fingerprint=?`).get(fingerprint) as { id: string }
      this.database.prepare(`INSERT OR IGNORE INTO structure_observation_source_links
        (observation_id,usage_id,publication_id,snapshot_id,match_id,created_at)
        VALUES (?,?,?,?,?,?)`).run(
        observation.id, row.usage_id, row.publication_id, row.snapshot_id, row.match_id, now,
      )
    })()
    return [row.structure_version_id]
  }

  private retract(matchId: string) {
    const versions = (this.database.prepare(`SELECT DISTINCT structure_version_id
      FROM platform_structure_observations WHERE source_fingerprint=?`).all(sourceFingerprint(matchId)) as Array<{ structure_version_id: string }>)
      .map((item) => item.structure_version_id)
    this.database.prepare(`UPDATE platform_structure_observations
      SET status='invalidated',revision=revision+1,updated_at=?
      WHERE source_fingerprint=? AND status!='invalidated'`).run(new Date().toISOString(), sourceFingerprint(matchId))
    return versions
  }
}

function sourceFingerprint(matchId: string) {
  return createHmac("sha256", observationHashSalt()).update(matchId).digest("hex")
}

function scopeFingerprint(tenantId: string, ipId: string) {
  return createHmac("sha256", observationHashSalt()).update(`${tenantId}:${ipId}`).digest("hex")
}

function observationHashSalt() {
  const configured = process.env.STRUCTURE_OBSERVATION_HASH_SALT
  if (configured) return configured
  if (process.env.APP_ENV === "production" || process.env.NODE_ENV === "production") {
    throw new Error("STRUCTURE_OBSERVATION_HASH_SALT_REQUIRED")
  }
  return "local-structure-observation-salt-v1"
}

function toCamelCase(value: string) {
  return value.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
}

type RawMetrics = ReturnType<typeof rawMetrics>

function rawMetrics(row: Pick<ProjectionRow, typeof metricColumns[number]>) {
  return Object.fromEntries(metricColumns.map((name) => [toCamelCase(name), row[name]])) as Record<string, number | null>
}

function normalizedMetrics(metrics: Record<string, number | null>) {
  const plays = metrics.plays
  const perThousand = (value: number | null) => value == null || !plays ? null : value / plays * 1_000
  return {
    completionRate: metrics.completionRate,
    threeSecondRetention: metrics.threeSecondRetention,
    fiveSecondRetention: metrics.fiveSecondRetention,
    averageWatchSeconds: metrics.averageWatchSeconds,
    likesPerThousand: perThousand(metrics.likes),
    commentsPerThousand: perThousand(metrics.comments),
    savesPerThousand: perThousand(metrics.saves),
    sharesPerThousand: perThousand(metrics.shares),
    profileVisitsPerThousand: perThousand(metrics.profileVisits),
    followersGainedPerThousand: perThousand(metrics.followersGained),
    inquiriesPerThousand: perThousand(metrics.inquiries),
    negativeFeedbackPerThousand: perThousand(metrics.negativeFeedback),
  }
}

function buildPeerBaseline(database: Database.Database, row: ProjectionRow) {
  const peers = database.prepare(`SELECT m.publication_id,
      s.impressions,s.plays,s.completions,s.completion_rate,s.three_second_retention,
      s.five_second_retention,s.average_watch_seconds,s.likes,s.comments,s.saves,s.shares,
      s.profile_visits,s.followers_gained,s.inquiries,s.negative_feedback
    FROM publication_match_versions m
    JOIN real_metric_snapshots s ON s.id=m.snapshot_id
    JOIN publications p ON p.id=m.publication_id AND p.status='active'
    WHERE m.tenant_id=? AND m.ip_profile_id=? AND m.content_account_id=? AND s.platform=?
      AND m.is_current=1 AND m.status='matched' AND m.publication_id!=?
    ORDER BY s.captured_at DESC,s.id DESC`).all(
    row.tenant_id, row.ip_profile_id, row.content_account_id, row.platform, row.publication_id,
  ) as Array<Pick<ProjectionRow, typeof metricColumns[number]> & { publication_id: string }>
  const latest = new Map<string, Record<string, number | null>>()
  peers.forEach((peer) => {
    if (!latest.has(peer.publication_id)) latest.set(peer.publication_id, normalizedMetrics(rawMetrics(peer)))
  })
  const values = [...latest.values()]
  const names = Object.keys(normalizedMetrics(rawMetrics(row)))
  const medians = Object.fromEntries(names.map((name) => [name, median(values.map((item) => item[name]))]))
  return { peerCount: latest.size, medians }
}

function buildMetricDelta(metrics: RawMetrics, medians: Record<string, number | null>, baselineUsable: boolean) {
  const current = normalizedMetrics(metrics)
  return Object.fromEntries(Object.entries(current).map(([name, value]) => {
    const baselineMedian = baselineUsable ? medians[name] ?? null : null
    const absoluteDelta = value == null || baselineMedian == null ? null : value - baselineMedian
    const relativeDelta = absoluteDelta == null || baselineMedian == null
      ? null : absoluteDelta / Math.max(Math.abs(baselineMedian), 0.0001)
    return [name, { current: value, baselineMedian, absoluteDelta, relativeDelta }]
  }))
}

function median(values: Array<number | null>) {
  const present = values.filter((value): value is number => value != null).sort((a, b) => a - b)
  if (!present.length) return null
  const middle = Math.floor(present.length / 2)
  return present.length % 2 ? present[middle] : (present[middle - 1] + present[middle]) / 2
}
