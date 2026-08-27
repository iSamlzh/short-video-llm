import type Database from "better-sqlite3"
import type { TenantAccessContext } from "../domain/access"
import { scriptToSegments } from "../domain/creation-contracts"
import type { IpProfile } from "../domain/models"
import type { ScriptCandidate, TopicDirectionCandidate } from "../domain/schemas"
import { requireTenantCapability } from "../lib/auth/guards"

export type ContentHistoryStatus = "topic_ready" | "draft" | "locked" | "published" | "reviewed"

export type ContentHistoryQuery = {
  page?: number
  pageSize?: number
  ipId?: string
  accountId?: string
  status?: ContentHistoryStatus
  from?: string
  to?: string
  keyword?: string
}

type HistoryRow = {
  run_id: string
  business_date: string
  created_at: string
  ip_profile_id: string
  ip_profile_version: number | null
  ip_name: string
  content_account_id: string | null
  account_name: string | null
  platform: string | null
  tenant_memory_version: number | null
  structure_version_ids_json: string
  trigger_type: "manual" | "review_followup"
  source_review_id: string | null
  run_state: string
  ip_profile_json: string
  topic_item_id: string | null
  topic_payload_json: string | null
  script_selection_version: number | null
  script_item_id: string | null
  script_payload_json: string | null
  locked_version: number | null
  publication_count: number
  review_count: number
}

export class ContentHistoryService {
  constructor(private readonly database: Database.Database) {}

  list(context: TenantAccessContext, input: ContentHistoryQuery = {}) {
    requireTenantCapability(context, "ip.view")
    const scope = this.scope(context)
    const page = positiveInteger(input.page, 1)
    const pageSize = Math.min(100, positiveInteger(input.pageSize, 20))
    this.assertFilters(scope, input)
    if (!scope.ipIds.length) return { items: [], page, pageSize, total: 0, totalPages: 0, filters: this.filterOptions(scope) }

    const clauses = [`c.tenant_id = ?`, `c.ip_profile_id IN (${placeholders(scope.ipIds)})`]
    const parameters: unknown[] = [context.tenantId, ...scope.ipIds]
    if (input.ipId) { clauses.push("c.ip_profile_id = ?"); parameters.push(input.ipId) }
    if (input.accountId) { clauses.push("c.content_account_id = ?"); parameters.push(input.accountId) }
    if (input.from) { clauses.push("c.business_date >= ?"); parameters.push(input.from) }
    if (input.to) { clauses.push("c.business_date <= ?"); parameters.push(input.to) }
    if (scope.accountIds.length) {
      clauses.push(`(c.content_account_id IS NULL OR c.content_account_id IN (${placeholders(scope.accountIds)}))`)
      parameters.push(...scope.accountIds)
    } else {
      clauses.push("c.content_account_id IS NULL")
    }

    const rows = this.database.prepare(`${historySelectSql()} WHERE ${clauses.join(" AND ")}
      ORDER BY c.created_at DESC, c.rowid DESC`).all(...parameters) as HistoryRow[]
    const keyword = input.keyword?.trim().toLocaleLowerCase("zh-CN")
    const mapped = rows.map(mapHistoryRow).filter((item) => {
      if (input.status && item.status !== input.status) return false
      if (!keyword) return true
      return [item.title, item.topicTitle, item.ipName, item.accountLabel]
        .some((value) => value.toLocaleLowerCase("zh-CN").includes(keyword))
    })
    const total = mapped.length
    const start = (page - 1) * pageSize
    return {
      items: mapped.slice(start, start + pageSize),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      filters: this.filterOptions(scope),
    }
  }

  detail(context: TenantAccessContext, runId: string) {
    requireTenantCapability(context, "ip.view")
    const scope = this.scope(context)
    const row = this.database.prepare(`${historySelectSql()} WHERE c.run_id = ? AND c.tenant_id = ? LIMIT 1`)
      .get(runId, context.tenantId) as HistoryRow | undefined
    if (!row || !scope.ipIds.includes(row.ip_profile_id)
      || (row.content_account_id && !scope.accountIds.includes(row.content_account_id))) throw notFound()

    const summary = mapHistoryRow(row)
    const profile = safeObject<IpProfile>(row.ip_profile_json)
    const locks = this.database.prepare(`SELECT version,script_selection_version,sha256,created_at
      FROM locked_scripts WHERE run_id=? ORDER BY version`).all(runId) as Array<{
        version: number; script_selection_version: number | null; sha256: string; created_at: string
      }>
    const lockBySelection = new Map(locks.map((item) => [item.script_selection_version, item]))
    const revisions = (this.database.prepare(`SELECT ss.version,ss.batch_version,ss.item_id,ss.is_current,ss.created_at,sb.payload_json
      FROM script_selections ss JOIN script_batches sb ON sb.run_id=ss.run_id AND sb.version=ss.batch_version
      WHERE ss.run_id=? ORDER BY ss.version DESC`).all(runId) as Array<{
        version: number; batch_version: number; item_id: string; is_current: number; created_at: string; payload_json: string
      }>).flatMap((item) => {
        const script = findPayloadItem<ScriptCandidate>(item.payload_json, item.item_id)
        if (!script) return []
        const lock = lockBySelection.get(item.version)
        return [{
          revision: item.version,
          title: script.title,
          createdAt: item.created_at,
          isCurrent: Boolean(item.is_current),
          locked: Boolean(lock),
          lockedVersion: lock?.version ?? null,
          lockedAt: lock?.created_at ?? null,
          segments: scriptToSegments(script),
        }]
      })
    const publications = this.publications(runId)
    const reviewIds = publications.length ? this.database.prepare(`SELECT DISTINCT review_id id
      FROM review_evidence_links WHERE publication_id IN (${placeholders(publications.map((item) => item.id))})`)
      .all(...publications.map((item) => item.id)) as Array<{ id: string }> : []
    const reviews = reviewIds.map(({ id }) => this.database.prepare(`SELECT id,version,sample_tier,status,payload_json,created_at
      FROM content_review_versions WHERE id=? AND tenant_id=?`).get(id, context.tenantId) as {
        id: string; version: number; sample_tier: string; status: string; payload_json: string; created_at: string
      } | undefined).filter(Boolean).map((review) => ({
        id: review!.id,
        version: review!.version,
        sampleTier: review!.sample_tier,
        status: review!.status,
        summary: safeObject<{ summary?: string }>(review!.payload_json)?.summary ?? "复盘已生成",
        createdAt: review!.created_at,
      }))
    const memory = row.tenant_memory_version && row.content_account_id
      ? this.database.prepare(`SELECT id,version,payload_json,source_review_id,created_at FROM tenant_memory_versions
          WHERE tenant_id=? AND ip_profile_id=? AND content_account_id=? AND version=?`).get(
          context.tenantId, row.ip_profile_id, row.content_account_id, row.tenant_memory_version,
        ) as { id: string; version: number; payload_json: string; source_review_id: string | null; created_at: string } | undefined
      : undefined
    const structureVersionIds = parseStringArray(row.structure_version_ids_json)
    const templates = structureVersionIds.length ? this.database.prepare(`SELECT id,name,version,status
      FROM platform_template_versions WHERE id IN (${placeholders(structureVersionIds)})`).all(...structureVersionIds) as Array<{
        id: string; name: string; version: number; status: string
      }> : []

    return {
      ...summary,
      profileSnapshot: profile ? {
        displayName: profile.displayName,
        industryCategory: profile.industryCategory ?? null,
        experience: profile.experience,
        expertise: profile.expertise,
        audience: profile.audience,
        voiceStyle: profile.voiceStyle,
        boundaries: profile.boundaries,
      } : null,
      lineage: {
        profileVersion: row.ip_profile_version,
        structureVersions: structureVersionIds.map((id) => {
          const template = templates.find((item) => item.id === id)
          return { id, name: template?.name ?? "历史结构模板", version: template?.version ?? null, status: template?.status ?? "snapshot" }
        }),
        memory: memory ? {
          id: memory.id,
          version: memory.version,
          sourceReviewId: memory.source_review_id,
          payload: safeObject(memory.payload_json),
          createdAt: memory.created_at,
        } : null,
        triggerType: row.trigger_type,
        sourceReviewId: row.source_review_id,
      },
      revisions,
      publications,
      reviews,
      canDownload: summary.status !== "topic_ready" && locks.length > 0 && context.capabilities.includes("content.create")
        && context.ipIds.includes(row.ip_profile_id) && (!row.content_account_id || context.contentAccountIds.includes(row.content_account_id)),
      canRecreate: revisions.length > 0 && context.capabilities.includes("content.create")
        && context.ipIds.includes(row.ip_profile_id) && (!row.content_account_id || context.contentAccountIds.includes(row.content_account_id)),
      canOpenReview: reviews.length > 0 && Boolean(row.content_account_id)
        && context.ipIds.includes(row.ip_profile_id) && Boolean(row.content_account_id && context.contentAccountIds.includes(row.content_account_id))
        && context.capabilities.includes("review.view"),
    }
  }

  private publications(runId: string) {
    const rows = this.database.prepare(`SELECT id,platform,title,platform_video_id,video_url,published_at,status
      FROM publications WHERE run_id=? ORDER BY published_at DESC,id`).all(runId) as Array<{
        id: string; platform: string; title: string; platform_video_id: string | null; video_url: string | null;
        published_at: string; status: string
      }>
    return rows.map((row) => {
      const metric = this.database.prepare(`SELECT s.captured_at,s.plays,s.completion_rate,s.likes,s.comments,s.saves,s.shares,s.inquiries
        FROM publication_match_versions m JOIN real_metric_snapshots s ON s.id=m.snapshot_id
        WHERE m.publication_id=? AND m.is_current=1 AND m.status='matched'
        ORDER BY s.captured_at DESC LIMIT 1`).get(row.id) as Record<string, unknown> | undefined
      return {
        id: row.id,
        platform: row.platform,
        title: row.title,
        platformVideoId: row.platform_video_id,
        videoUrl: row.video_url,
        publishedAt: row.published_at,
        status: row.status,
        metrics: metric ? {
          capturedAt: String(metric.captured_at),
          plays: nullableNumber(metric.plays),
          completionRate: nullableNumber(metric.completion_rate),
          likes: nullableNumber(metric.likes),
          comments: nullableNumber(metric.comments),
          saves: nullableNumber(metric.saves),
          shares: nullableNumber(metric.shares),
          inquiries: nullableNumber(metric.inquiries),
        } : null,
      }
    })
  }

  private scope(context: TenantAccessContext) {
    const ipIds = (this.database.prepare(`SELECT s.ip_profile_id id FROM membership_ip_scopes s
      JOIN ip_profiles i ON i.id=s.ip_profile_id WHERE s.membership_id=? AND i.tenant_id=?`)
      .all(context.membershipId, context.tenantId) as Array<{ id: string }>).map((item) => item.id)
    const accountIds = (this.database.prepare(`SELECT s.content_account_id id FROM membership_account_scopes s
      JOIN content_accounts a ON a.id=s.content_account_id WHERE s.membership_id=? AND a.tenant_id=?`)
      .all(context.membershipId, context.tenantId) as Array<{ id: string }>).map((item) => item.id)
    return { ipIds, accountIds }
  }

  private assertFilters(scope: { ipIds: string[]; accountIds: string[] }, input: ContentHistoryQuery) {
    if (input.ipId && !scope.ipIds.includes(input.ipId)) throw notFound()
    if (input.accountId && !scope.accountIds.includes(input.accountId)) throw notFound()
    if (input.from && !/^\d{4}-\d{2}-\d{2}$/.test(input.from)) throw invalidQuery()
    if (input.to && !/^\d{4}-\d{2}-\d{2}$/.test(input.to)) throw invalidQuery()
    if (input.from && input.to && input.from > input.to) throw invalidQuery()
    if (input.status && !(["topic_ready", "draft", "locked", "published", "reviewed"] as string[]).includes(input.status)) throw invalidQuery()
  }

  private filterOptions(scope: { ipIds: string[]; accountIds: string[] }) {
    const ips = scope.ipIds.length ? this.database.prepare(`SELECT id,display_name label,status FROM ip_profiles
      WHERE id IN (${placeholders(scope.ipIds)}) ORDER BY status,created_at,id`).all(...scope.ipIds) as Array<{
        id: string; label: string; status: string
      }> : []
    const accounts = scope.accountIds.length ? this.database.prepare(`SELECT id,ip_profile_id ipId,platform,account_name label,status
      FROM content_accounts WHERE id IN (${placeholders(scope.accountIds)}) ORDER BY status,created_at,id`).all(...scope.accountIds) as Array<{
        id: string; ipId: string; platform: string; label: string; status: string
      }> : []
    return { ips, accounts }
  }
}

function historySelectSql() {
  return `SELECT c.run_id,c.business_date,c.created_at,c.ip_profile_id,c.ip_profile_version,
    i.display_name ip_name,c.content_account_id,a.account_name,a.platform,c.tenant_memory_version,
    c.structure_version_ids_json,c.trigger_type,c.source_review_id,r.state run_state,r.ip_profile_json,
    ts.item_id topic_item_id,tb.payload_json topic_payload_json,
    ss.version script_selection_version,ss.item_id script_item_id,sb.payload_json script_payload_json,
    (SELECT MAX(ls.version) FROM locked_scripts ls WHERE ls.run_id=c.run_id) locked_version,
    (SELECT COUNT(*) FROM publications p WHERE p.run_id=c.run_id AND p.status='active') publication_count,
    (SELECT COUNT(DISTINCT rel.review_id) FROM publications rp
      JOIN review_evidence_links rel ON rel.publication_id=rp.id WHERE rp.run_id=c.run_id) review_count
    FROM creation_run_context c
    JOIN runs r ON r.id=c.run_id
    JOIN ip_profiles i ON i.id=c.ip_profile_id
    LEFT JOIN content_accounts a ON a.id=c.content_account_id
    LEFT JOIN topic_selections ts ON ts.run_id=c.run_id AND ts.is_current=1
    LEFT JOIN topic_batches tb ON tb.run_id=ts.run_id AND tb.version=ts.batch_version
    LEFT JOIN script_selections ss ON ss.run_id=c.run_id AND ss.is_current=1
    LEFT JOIN script_batches sb ON sb.run_id=ss.run_id AND sb.version=ss.batch_version`
}

function mapHistoryRow(row: HistoryRow) {
  const topic = row.topic_item_id && row.topic_payload_json
    ? findPayloadItem<TopicDirectionCandidate>(row.topic_payload_json, row.topic_item_id) : null
  const script = row.script_item_id && row.script_payload_json
    ? findPayloadItem<ScriptCandidate>(row.script_payload_json, row.script_item_id) : null
  const status: ContentHistoryStatus = row.review_count > 0 ? "reviewed"
    : row.publication_count > 0 ? "published"
      : row.locked_version ? "locked"
        : script ? "draft" : "topic_ready"
  return {
    runId: row.run_id,
    title: script?.title ?? topic?.title ?? "待选择选题",
    topicTitle: topic?.title ?? "尚未选择选题",
    businessDate: row.business_date,
    createdAt: row.created_at,
    ipId: row.ip_profile_id,
    ipName: row.ip_name,
    accountId: row.content_account_id,
    accountLabel: row.account_name ? `${platformLabel(row.platform)}｜${row.account_name}` : "未绑定账号",
    currentRevision: row.script_selection_version,
    lockedVersion: row.locked_version,
    publicationCount: row.publication_count,
    reviewCount: row.review_count,
    status,
  }
}

function findPayloadItem<T extends { id: string }>(payload: string, id: string) {
  try {
    const items = JSON.parse(payload) as unknown
    return Array.isArray(items) ? items.find((item): item is T => Boolean(item && typeof item === "object" && (item as T).id === id)) ?? null : null
  } catch { return null }
}

function parseStringArray(value: string) {
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [] }
  catch { return [] }
}

function safeObject<T = Record<string, unknown>>(value: string) {
  try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as T : null }
  catch { return null }
}

function positiveInteger(value: number | undefined, fallback: number) {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback
}

function placeholders(items: unknown[]) { return items.map(() => "?").join(",") }
function nullableNumber(value: unknown) { return value == null ? null : Number(value) }
function platformLabel(value: string | null) {
  if (value === "wechat_channels") return "视频号"
  if (value === "douyin") return "抖音"
  if (value === "xiaohongshu") return "小红书"
  if (value === "kuaishou") return "快手"
  return value ?? "账号"
}
function notFound() { return Object.assign(new Error("CONTENT_HISTORY_NOT_FOUND"), { code: "CONTENT_HISTORY_NOT_FOUND", status: 404 }) }
function invalidQuery() { return Object.assign(new Error("CONTENT_HISTORY_QUERY_INVALID"), { code: "CONTENT_HISTORY_QUERY_INVALID", status: 400 }) }
