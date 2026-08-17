import { randomUUID } from "node:crypto"
import type Database from "better-sqlite3"
import type { TenantAccessContext } from "../domain/access"
import type { MatchMethod, MatchStatus, Publication } from "../domain/growth-loop"
import { requireTenantCapability } from "../lib/auth/guards"
import { normalizeContentTitle, normalizeVideoUrl } from "../lib/content-identity"
import { MetricsRepository, type MetricSnapshot } from "../lib/db/metrics-repository"
import { PublicationRepository } from "../lib/db/publication-repository"
import { PublicationService } from "./publication-service"

type MatchDecision = {
  status: MatchStatus
  method: MatchMethod
  publicationId?: string
  candidateIds: string[]
  explanation: string
}

export class PublicationMatcher {
  constructor(
    private readonly database: Database.Database,
    private readonly metrics = new MetricsRepository(database),
    private readonly publications = new PublicationRepository(database),
    private readonly publicationService = new PublicationService(database, publications),
  ) {}

  decide(snapshot: MetricSnapshot, candidates: Publication[]): MatchDecision {
    if (snapshot.platformVideoId) {
      const exact = candidates.find((item) => item.platformVideoId === snapshot.platformVideoId)
      if (exact) return matched("exact_video_id", exact.id, `作品 ID 精确一致：${snapshot.platformVideoId}`)
    }
    const normalizedUrl = snapshot.normalizedVideoUrl
      ?? (snapshot.videoUrl ? normalizeVideoUrl(snapshot.videoUrl) : null)
    if (normalizedUrl) {
      const exact = candidates.find((item) => item.normalizedVideoUrl === normalizedUrl)
      if (exact) return matched("exact_url", exact.id, "规范化视频链接精确一致")
    }

    const title = normalizeContentTitle(snapshot.title)
    const exactTitles = snapshot.publishedAt
      ? candidates.filter((item) => normalizeContentTitle(item.title) === title
        && insideDays(snapshot.publishedAt!, item.publishedAt, 7))
      : []
    if (exactTitles.length === 1) {
      return matched("exact_title_time", exactTitles[0].id, "标题精确一致，且发布时间位于 ±7 天窗口内")
    }
    if (exactTitles.length > 1) {
      return {
        status: "candidate", method: "exact_title_time",
        candidateIds: exactTitles.map((item) => item.id).sort(),
        explanation: `发现 ${exactTitles.length} 个同标题时间候选，需要人工确认`,
      }
    }

    const similar = snapshot.publishedAt
      ? candidates
        .filter((item) => insideDays(snapshot.publishedAt!, item.publishedAt, 30))
        .map((item) => ({ item, score: dice(title, normalizeContentTitle(item.title)) }))
        .filter(({ score }) => score >= 0.72)
        .sort((left, right) => right.score - left.score
          || timeDistance(snapshot.publishedAt!, left.item.publishedAt) - timeDistance(snapshot.publishedAt!, right.item.publishedAt)
          || left.item.id.localeCompare(right.item.id))
        .slice(0, 3)
      : []
    if (similar.length) {
      return {
        status: "candidate", method: "similarity_candidate",
        candidateIds: similar.map(({ item }) => item.id),
        explanation: `标题 Dice 相似度候选：${similar.map(({ score }) => score.toFixed(2)).join("、")}；仅供人工确认`,
      }
    }
    return {
      status: "unmatched", method: "similarity_candidate", candidateIds: [],
      explanation: "未找到作品 ID、链接、唯一同标题时间或高相似度候选",
    }
  }

  matchBatch(context: TenantAccessContext, batchId: string) {
    const { scope } = this.metrics.requireBatchScope(batchId, context.tenantId)
    requireTenantCapability(context, "metrics.import", { ipId: scope.ipId, contentAccountId: scope.contentAccountId })
    const candidates = this.publications.listActiveByScope(scope)
    const snapshots = this.metrics.listSnapshotModels(batchId)
    const persist = this.database.transaction(() => {
      for (const snapshot of snapshots) {
        if (this.metrics.currentMatchForSnapshot(snapshot.id)) continue
        const decision = this.decide(snapshot, candidates)
        this.metrics.appendMatch({
          id: randomUUID(), snapshot, publicationId: decision.publicationId ?? null,
          candidateIds: decision.candidateIds, method: decision.method, status: decision.status,
          explanation: decision.explanation, version: 1, createdAt: new Date().toISOString(),
        })
      }
      const current = this.metrics.listCurrentMatches(batchId)
      const counts = {
        candidates: current.filter((item) => item.status === "candidate").length,
        unmatched: current.filter((item) => item.status === "unmatched").length,
      }
      this.metrics.updateMatchProgress(batchId, { status: "matched", ...counts })
      return this.metrics.updateMatchProgress(batchId, { status: "review_ready", ...counts })
    })
    return persist()
  }

  confirmCandidate(
    context: TenantAccessContext,
    matchId: string,
    publicationId: string,
    expectedVersion: number,
  ) {
    const current = this.metrics.requireCurrentMatch(matchId)
    this.requireMatchAccess(context, current)
    if (current.version !== expectedVersion) throw new Error("MATCH_VERSION_CONFLICT")
    if (current.status !== "candidate" || !current.candidateIds.includes(publicationId)) {
      throw new Error("MATCH_CANDIDATE_INVALID")
    }
    const scope = scopeOf(current)
    this.publications.requireById(scope, publicationId)
    const now = new Date().toISOString()
    const append = this.database.transaction(() => {
      const snapshot = this.metrics.requireSnapshot(current.snapshotId)
      const match = this.metrics.appendMatch({
        id: randomUUID(), snapshot, publicationId, candidateIds: current.candidateIds,
        method: "manual_existing", status: "matched", explanation: "由有权限的用户确认已有发布记录",
        version: current.version + 1, confirmedByUserId: context.userId, confirmedAt: now, createdAt: now,
      })
      this.audit(context, "metrics.match.confirmed", match.id, {
        snapshotId: current.snapshotId, publicationId, previousMatchId: current.id,
      }, now)
      return match
    })
    return append()
  }

  rejectCandidateAndCreateExternal(context: TenantAccessContext, matchId: string, expectedVersion: number) {
    const current = this.metrics.requireCurrentMatch(matchId)
    this.requireMatchAccess(context, current)
    if (current.version !== expectedVersion) throw new Error("MATCH_VERSION_CONFLICT")
    const snapshot = this.metrics.requireSnapshot(current.snapshotId)
    if (!snapshot.publishedAt) throw new Error("PUBLICATION_TIME_REQUIRED")
    const publication = this.publicationService.createExternal(context, {
      contentAccountId: snapshot.contentAccountId,
      platformVideoId: snapshot.platformVideoId ?? undefined,
      videoUrl: snapshot.videoUrl ?? undefined,
      title: snapshot.title,
      publishedAt: snapshot.publishedAt,
    })
    const now = new Date().toISOString()
    const append = this.database.transaction(() => {
      const match = this.metrics.appendMatch({
        id: randomUUID(), snapshot, publicationId: publication.id, candidateIds: current.candidateIds,
        method: "manual_external_created", status: "matched", explanation: "由有权限的用户创建外部发布记录并关联",
        version: current.version + 1, confirmedByUserId: context.userId, confirmedAt: now, createdAt: now,
      })
      this.audit(context, "metrics.match.external_created", match.id, {
        snapshotId: current.snapshotId, publicationId: publication.id, previousMatchId: current.id,
      }, now)
      return match
    })
    return append()
  }

  private requireMatchAccess(context: TenantAccessContext, match: { tenantId: string; ipId: string; contentAccountId: string }) {
    if (match.tenantId !== context.tenantId) throw new Error("MATCH_NOT_FOUND")
    requireTenantCapability(context, "metrics.import", { ipId: match.ipId, contentAccountId: match.contentAccountId })
  }

  private audit(context: TenantAccessContext, action: string, resourceId: string, detail: Record<string, unknown>, now: string) {
    this.database.prepare(`INSERT INTO audit_logs
      (id,tenant_id,actor_user_id,action,resource_type,resource_id,detail_json,created_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(
      randomUUID(), context.tenantId, context.userId, action, "publication_match", resourceId,
      JSON.stringify(detail), now,
    )
  }
}

function matched(method: MatchMethod, publicationId: string, explanation: string): MatchDecision {
  return { status: "matched", method, publicationId, candidateIds: [], explanation }
}

function insideDays(left: string, right: string, days: number) {
  return timeDistance(left, right) <= days * 24 * 60 * 60 * 1_000
}

function timeDistance(left: string, right: string) {
  return Math.abs(Date.parse(left) - Date.parse(right))
}

function dice(left: string, right: string) {
  if (left === right) return 1
  const leftPairs = bigrams(left)
  const rightPairs = bigrams(right)
  if (!leftPairs.length || !rightPairs.length) return 0
  const counts = new Map<string, number>()
  rightPairs.forEach((pair) => counts.set(pair, (counts.get(pair) ?? 0) + 1))
  let overlap = 0
  leftPairs.forEach((pair) => {
    const remaining = counts.get(pair) ?? 0
    if (remaining > 0) { overlap += 1; counts.set(pair, remaining - 1) }
  })
  return (2 * overlap) / (leftPairs.length + rightPairs.length)
}

function bigrams(value: string) {
  const characters = Array.from(value.replace(/\s+/g, ""))
  return characters.slice(0, -1).map((character, index) => character + characters[index + 1])
}

function scopeOf(value: { tenantId: string; ipId: string; contentAccountId: string; platform: string }) {
  return {
    tenantId: value.tenantId, ipId: value.ipId,
    contentAccountId: value.contentAccountId, platform: value.platform,
  }
}
