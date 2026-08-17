import type Database from "better-sqlite3"
import type { GrowthScope, Publication } from "../../domain/growth-loop"

type AccountScopeRow = {
  tenant_id: string
  ip_profile_id: string
  content_account_id: string
  platform: string
}

type PublicationRow = {
  id: string
  tenant_id: string
  ip_profile_id: string
  content_account_id: string
  platform: string
  source: "system" | "external"
  run_id: string | null
  locked_script_version: number | null
  locked_script_selection_version: number | null
  title: string
  platform_video_id: string | null
  video_url: string | null
  normalized_video_url: string | null
  published_at: string
  status: "active" | "disabled"
  created_by_user_id: string
  created_at: string
}

export type LockedScriptRecord = {
  version: number
  selectionVersion: number
  title: string
}

export class PublicationRepository {
  constructor(private readonly database: Database.Database) {}

  accountScope(tenantId: string, contentAccountId: string): GrowthScope | null {
    const row = this.database.prepare(`SELECT tenant_id, ip_profile_id, id content_account_id, platform
      FROM content_accounts WHERE id = ? AND tenant_id = ? AND status = 'active'`)
      .get(contentAccountId, tenantId) as AccountScopeRow | undefined
    return row ? this.mapScope(row) : null
  }

  runScope(runId: string) {
    return this.database.prepare(`SELECT tenant_id, ip_profile_id, content_account_id
      FROM creation_run_context WHERE run_id = ?`).get(runId) as {
        tenant_id: string
        ip_profile_id: string
        content_account_id: string | null
      } | undefined
  }

  lockedScript(runId: string, version: number): LockedScriptRecord | null {
    const row = this.database.prepare(`SELECT version, script_selection_version, payload_json
      FROM locked_scripts WHERE run_id = ? AND version = ?`).get(runId, version) as {
        version: number
        script_selection_version: number | null
        payload_json: string
      } | undefined
    if (!row?.script_selection_version) return null
    const payload = JSON.parse(row.payload_json) as { title?: unknown }
    if (typeof payload.title !== "string" || !payload.title.trim()) return null
    return { version: row.version, selectionVersion: row.script_selection_version, title: payload.title }
  }

  insert(input: {
    id: string
    scope: GrowthScope
    source: "system" | "external"
    runId: string | null
    lockedVersion: number | null
    lockedSelectionVersion: number | null
    title: string
    platformVideoId: string | null
    videoUrl: string | null
    normalizedVideoUrl: string | null
    publishedAt: string
    createdByUserId: string
    createdAt: string
  }) {
    this.database.prepare(`INSERT INTO publications
      (id,tenant_id,ip_profile_id,content_account_id,platform,source,run_id,locked_script_version,
       locked_script_selection_version,title,platform_video_id,video_url,normalized_video_url,published_at,
       status,created_by_user_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?,?)`).run(
      input.id, input.scope.tenantId, input.scope.ipId, input.scope.contentAccountId, input.scope.platform,
      input.source, input.runId, input.lockedVersion, input.lockedSelectionVersion, input.title,
      input.platformVideoId, input.videoUrl, input.normalizedVideoUrl, input.publishedAt,
      input.createdByUserId, input.createdAt,
    )
    return this.requireById(input.scope, input.id)
  }

  findActiveByVideoId(scope: GrowthScope, platformVideoId: string) {
    const row = this.database.prepare(`SELECT * FROM publications
      WHERE tenant_id=? AND ip_profile_id=? AND content_account_id=? AND platform=?
        AND platform_video_id=? AND status='active' LIMIT 1`).get(
      scope.tenantId, scope.ipId, scope.contentAccountId, scope.platform, platformVideoId,
    ) as PublicationRow | undefined
    return row ? this.map(row) : null
  }

  findActiveByNormalizedUrl(scope: GrowthScope, normalizedUrl: string) {
    const row = this.database.prepare(`SELECT * FROM publications
      WHERE tenant_id=? AND ip_profile_id=? AND content_account_id=? AND platform=?
        AND normalized_video_url=? AND status='active' LIMIT 1`).get(
      scope.tenantId, scope.ipId, scope.contentAccountId, scope.platform, normalizedUrl,
    ) as PublicationRow | undefined
    return row ? this.map(row) : null
  }

  findById(scope: GrowthScope, publicationId: string) {
    const row = this.database.prepare(`SELECT * FROM publications
      WHERE id=? AND tenant_id=? AND ip_profile_id=? AND content_account_id=? AND platform=? LIMIT 1`).get(
      publicationId, scope.tenantId, scope.ipId, scope.contentAccountId, scope.platform,
    ) as PublicationRow | undefined
    return row ? this.map(row) : null
  }

  requireById(scope: GrowthScope, publicationId: string) {
    const publication = this.findById(scope, publicationId)
    if (!publication) throw new Error("PUBLICATION_NOT_FOUND")
    return publication
  }

  listByLock(scope: GrowthScope, runId: string, lockedVersion: number) {
    return (this.database.prepare(`SELECT * FROM publications
      WHERE tenant_id=? AND ip_profile_id=? AND run_id=? AND locked_script_version=?
      ORDER BY created_at, id`).all(scope.tenantId, scope.ipId, runId, lockedVersion) as PublicationRow[])
      .map((row) => this.map(row))
  }

  listActiveByScope(scope: GrowthScope) {
    return (this.database.prepare(`SELECT * FROM publications
      WHERE tenant_id=? AND ip_profile_id=? AND content_account_id=? AND platform=? AND status='active'
      ORDER BY published_at, id`).all(
      scope.tenantId, scope.ipId, scope.contentAccountId, scope.platform,
    ) as PublicationRow[]).map((row) => this.map(row))
  }

  supplementIdentity(
    scope: GrowthScope,
    publicationId: string,
    identity: { platformVideoId: string | null; videoUrl: string | null; normalizedVideoUrl: string | null },
  ) {
    this.database.prepare(`UPDATE publications SET
      platform_video_id=COALESCE(?,platform_video_id),
      video_url=COALESCE(?,video_url),
      normalized_video_url=COALESCE(?,normalized_video_url)
      WHERE id=? AND tenant_id=? AND ip_profile_id=? AND content_account_id=? AND platform=?`)
      .run(identity.platformVideoId, identity.videoUrl, identity.normalizedVideoUrl, publicationId,
        scope.tenantId, scope.ipId, scope.contentAccountId, scope.platform)
    return this.requireById(scope, publicationId)
  }

  disable(scope: GrowthScope, publicationId: string) {
    const result = this.database.prepare(`UPDATE publications SET status='disabled'
      WHERE id=? AND tenant_id=? AND ip_profile_id=? AND content_account_id=? AND platform=? AND status='active'`)
      .run(publicationId, scope.tenantId, scope.ipId, scope.contentAccountId, scope.platform)
    if (!result.changes) throw new Error("PUBLICATION_NOT_FOUND")
    return this.requireById(scope, publicationId)
  }

  private mapScope(row: AccountScopeRow): GrowthScope {
    return {
      tenantId: row.tenant_id,
      ipId: row.ip_profile_id,
      contentAccountId: row.content_account_id,
      platform: row.platform,
    }
  }

  private map(row: PublicationRow): Publication {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      ipId: row.ip_profile_id,
      contentAccountId: row.content_account_id,
      platform: row.platform,
      source: row.source,
      runId: row.run_id,
      lockedVersion: row.locked_script_version,
      lockedSelectionVersion: row.locked_script_selection_version,
      title: row.title,
      platformVideoId: row.platform_video_id,
      videoUrl: row.video_url,
      normalizedVideoUrl: row.normalized_video_url,
      publishedAt: row.published_at,
      status: row.status,
      createdByUserId: row.created_by_user_id,
      createdAt: row.created_at,
    }
  }
}
