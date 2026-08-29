import { createHash, randomUUID } from "node:crypto"
import type Database from "better-sqlite3"

type ObservationRow = {
  id: string
  source_fingerprint: string
  scope_fingerprint: string
  publication_fingerprint: string
  node_keys_json: string
  evidence_tier: "fact" | "tentative" | "confirmed"
  metric_delta_json: string
  data_quality_json: string
  captured_at: string
  revision: number
}

export class StructureEvaluationService {
  static readonly algorithmVersion = 1
  static readonly policyVersion = 1

  constructor(private readonly database: Database.Database) {}

  evaluate(templateVersionId: string) {
    const template = this.database.prepare(`SELECT id,template_id FROM platform_template_versions WHERE id=?`)
      .get(templateVersionId) as { id: string; template_id: string } | undefined
    if (!template) throw new Error("TEMPLATE_VERSION_NOT_FOUND")
    const observations = this.database.prepare(`SELECT * FROM platform_structure_observations
      WHERE structure_version_id=? AND status='active' ORDER BY captured_at,id`).all(templateVersionId) as ObservationRow[]
    const inputHash = createHash("sha256").update(observations
      .map((item) => `${item.source_fingerprint}:${item.revision}`).sort().join("|"), "utf8").digest("hex")
    const existing = this.database.prepare(`SELECT * FROM platform_structure_evaluations
      WHERE template_version_id=? AND input_hash=?`).get(templateVersionId, inputHash) as Record<string, unknown> | undefined
    if (existing) {
      this.database.transaction(() => {
        this.database.prepare(`UPDATE platform_structure_evaluations SET status='superseded'
          WHERE template_version_id=? AND status='current' AND id!=?`).run(templateVersionId, existing.id)
        this.database.prepare("UPDATE platform_structure_evaluations SET status='current' WHERE id=?").run(existing.id)
      })()
      return this.map(existing, "current")
    }

    const eligible = observations.filter((item) => {
      const quality = parseJson(item.data_quality_json)
      return item.evidence_tier !== "fact" && Number(quality.baselinePeerCount ?? 0) >= 3
    })
    const publicationCount = new Set(observations.map((item) => item.publication_fingerprint)).size
    const eligiblePublicationCount = new Set(eligible.map((item) => item.publication_fingerprint)).size
    const scopeCount = new Set(eligible.map((item) => item.scope_fingerprint)).size
    const confidence = eligiblePublicationCount >= 10 && scopeCount >= 3
      ? "standard" as const
      : eligiblePublicationCount >= 5 && scopeCount >= 2
        ? "exploratory" as const
        : "facts_only" as const
    const aggregate = buildAggregate(observations, eligible)
    const next = this.database.prepare(`SELECT COALESCE(MAX(version),0)+1 version
      FROM platform_structure_evaluations WHERE template_version_id=?`).get(templateVersionId) as { version: number }
    const id = randomUUID()
    const now = new Date().toISOString()
    this.database.transaction(() => {
      this.database.prepare(`UPDATE platform_structure_evaluations SET status='superseded'
        WHERE template_version_id=? AND status='current'`).run(templateVersionId)
      this.database.prepare(`INSERT INTO platform_structure_evaluations
        (id,template_id,template_version_id,version,input_hash,window_start,window_end,publication_count,
         scope_count,eligible_publication_count,aggregate_json,confidence,algorithm_version,policy_version,status,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'current',?)`).run(
        id, template.template_id, templateVersionId, next.version, inputHash,
        observations[0]?.captured_at ?? null, observations.at(-1)?.captured_at ?? null,
        publicationCount, scopeCount, eligiblePublicationCount, JSON.stringify(aggregate), confidence,
        StructureEvaluationService.algorithmVersion, StructureEvaluationService.policyVersion, now,
      )
      const link = this.database.prepare(`INSERT INTO platform_structure_evaluation_evidence
        (evaluation_id,observation_id,created_at) VALUES (?,?,?)`)
      observations.forEach((observation) => link.run(id, observation.id, now))
    })()
    return this.get(id)
  }

  get(evaluationId: string) {
    const row = this.database.prepare("SELECT * FROM platform_structure_evaluations WHERE id=?")
      .get(evaluationId) as Record<string, unknown> | undefined
    if (!row) throw new Error("STRUCTURE_EVALUATION_NOT_FOUND")
    return this.map(row)
  }

  listCurrent() {
    return (this.database.prepare(`SELECT * FROM platform_structure_evaluations
      WHERE status='current' ORDER BY created_at DESC,id`).all() as Record<string, unknown>[]).map((row) => this.map(row))
  }

  evidenceIds(evaluationId: string) {
    return (this.database.prepare(`SELECT observation_id FROM platform_structure_evaluation_evidence
      WHERE evaluation_id=? ORDER BY observation_id`).all(evaluationId) as Array<{ observation_id: string }>)
      .map((item) => item.observation_id)
  }

  evidence(evaluationId: string) {
    this.get(evaluationId)
    return (this.database.prepare(`SELECT o.id,o.platform,o.context_bucket_json,o.evidence_tier,
        o.node_keys_json,o.metrics_json,o.metric_delta_json,o.data_quality_json,o.captured_at,o.status
      FROM platform_structure_evaluation_evidence e
      JOIN platform_structure_observations o ON o.id=e.observation_id
      WHERE e.evaluation_id=? ORDER BY o.captured_at DESC,o.id`).all(evaluationId) as Array<{
        id: string; platform: string; context_bucket_json: string; evidence_tier: string;
        node_keys_json: string; metrics_json: string; metric_delta_json: string; data_quality_json: string;
        captured_at: string; status: string;
      }>).map((row) => ({
      id: row.id,
      platform: row.platform,
      contextBucket: parseJson(row.context_bucket_json),
      evidenceTier: row.evidence_tier,
      nodeKeys: parseStringArray(row.node_keys_json),
      metrics: parseJson(row.metrics_json),
      metricDelta: parseJson(row.metric_delta_json),
      dataQuality: parseJson(row.data_quality_json),
      capturedAt: row.captured_at,
      status: row.status,
    }))
  }

  private map(row: Record<string, unknown>, forcedStatus?: "current") {
    return {
      id: String(row.id), templateId: String(row.template_id), templateVersionId: String(row.template_version_id),
      version: Number(row.version), inputHash: String(row.input_hash),
      windowStart: row.window_start == null ? null : String(row.window_start),
      windowEnd: row.window_end == null ? null : String(row.window_end),
      publicationCount: Number(row.publication_count), scopeCount: Number(row.scope_count),
      eligiblePublicationCount: Number(row.eligible_publication_count),
      aggregate: parseJson(String(row.aggregate_json)),
      confidence: String(row.confidence) as "facts_only" | "exploratory" | "standard",
      algorithmVersion: Number(row.algorithm_version), policyVersion: Number(row.policy_version),
      status: forcedStatus ?? String(row.status) as "building" | "current" | "superseded" | "failed",
      createdAt: String(row.created_at),
    }
  }
}

function buildAggregate(all: ObservationRow[], eligible: ObservationRow[]) {
  const metricEntries = new Map<string, Array<{ current: number | null; absoluteDelta: number | null; relativeDelta: number | null }>>()
  eligible.forEach((observation) => {
    const delta = parseJson(observation.metric_delta_json)
    Object.entries(delta).forEach(([name, value]) => {
      const item = value as Record<string, unknown>
      const values = metricEntries.get(name) ?? []
      values.push({
        current: numberOrNull(item.current),
        absoluteDelta: numberOrNull(item.absoluteDelta),
        relativeDelta: numberOrNull(item.relativeDelta),
      })
      metricEntries.set(name, values)
    })
  })
  const metrics = Object.fromEntries([...metricEntries.entries()].map(([name, values]) => [name, {
    sampleCount: values.length,
    currentMedian: median(values.map((item) => item.current)),
    absoluteDeltaMedian: median(values.map((item) => item.absoluteDelta)),
    relativeDeltaMedian: median(values.map((item) => item.relativeDelta)),
    positiveCount: values.filter((item) => (item.absoluteDelta ?? 0) > 0).length,
    negativeCount: values.filter((item) => (item.absoluteDelta ?? 0) < 0).length,
  }]))
  const nodeCounts = new Map<string, number>()
  all.forEach((item) => parseStringArray(item.node_keys_json).forEach((key) => nodeCounts.set(key, (nodeCounts.get(key) ?? 0) + 1)))
  return {
    metrics,
    nodeCoverage: Object.fromEntries([...nodeCounts.entries()].sort(([a], [b]) => a.localeCompare(b))),
    evidenceTierCounts: {
      fact: all.filter((item) => item.evidence_tier === "fact").length,
      tentative: all.filter((item) => item.evidence_tier === "tentative").length,
      confirmed: all.filter((item) => item.evidence_tier === "confirmed").length,
    },
    evidenceLimits: [
      "视频级指标只能评价完整结构组合，不能证明单个节点的因果效果。",
      "未达到账号基线门槛的观察仅作为事实展示，不参与相对提升结论。",
    ],
  }
}

function parseJson(value: string) {
  try { return JSON.parse(value) as Record<string, unknown> } catch { return {} }
}

function parseStringArray(value: string) {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []
  } catch { return [] }
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function median(values: Array<number | null>) {
  const present = values.filter((value): value is number => value != null).sort((a, b) => a - b)
  if (!present.length) return null
  const middle = Math.floor(present.length / 2)
  return present.length % 2 ? present[middle] : (present[middle - 1] + present[middle]) / 2
}
