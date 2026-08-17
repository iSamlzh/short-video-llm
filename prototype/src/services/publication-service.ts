import { randomUUID } from "node:crypto"
import type Database from "better-sqlite3"
import type { TenantAccessContext } from "../domain/access"
import type { CreateExternalPublicationInput, RecordSystemPublicationInput } from "../domain/growth-loop-schemas"
import {
  createExternalPublicationInputSchema,
  recordSystemPublicationInputSchema,
} from "../domain/growth-loop-schemas"
import type { GrowthScope, Publication } from "../domain/growth-loop"
import { requireTenantCapability } from "../lib/auth/guards"
import { normalizeVideoUrl } from "../lib/content-identity"
import { PublicationRepository } from "../lib/db/publication-repository"

export class PublicationService {
  constructor(
    private readonly database: Database.Database,
    private readonly publications = new PublicationRepository(database),
  ) {}

  recordSystem(context: TenantAccessContext, rawInput: RecordSystemPublicationInput) {
    const input = recordSystemPublicationInputSchema.parse(rawInput)
    const scope = this.requireTargetScope(context, input.contentAccountId, "publication.record")
    const run = this.publications.runScope(input.runId)
    if (!run || run.tenant_id !== scope.tenantId || run.ip_profile_id !== scope.ipId) {
      throw new Error("RUN_NOT_FOUND")
    }
    const locked = this.publications.lockedScript(input.runId, input.lockedVersion)
    if (!locked) throw new Error("LOCKED_SCRIPT_NOT_FOUND")
    const identity = this.identity(input.platformVideoId, input.videoUrl)
    const existing = this.resolveExisting(scope, identity)
    if (existing) {
      if (existing.source === "system" && existing.runId === input.runId && existing.lockedVersion === input.lockedVersion) {
        return existing
      }
      throw new Error(existing.platformVideoId === identity.platformVideoId
        ? "PUBLICATION_ID_CONFLICT" : "PUBLICATION_URL_CONFLICT")
    }
    const publication = this.publications.insert({
      id: randomUUID(), scope, source: "system", runId: input.runId,
      lockedVersion: locked.version, lockedSelectionVersion: locked.selectionVersion,
      title: locked.title, ...identity, publishedAt: input.publishedAt,
      createdByUserId: context.userId, createdAt: new Date().toISOString(),
    })
    this.audit(context, "publication.recorded", publication, {})
    return publication
  }

  createExternal(context: TenantAccessContext, rawInput: CreateExternalPublicationInput) {
    const input = createExternalPublicationInputSchema.parse(rawInput)
    const scope = this.requireTargetScope(context, input.contentAccountId, "metrics.import")
    const identity = this.identity(input.platformVideoId, input.videoUrl)
    const existing = this.resolveExisting(scope, identity)
    if (existing) {
      if (existing.source === "external" && existing.title === input.title && existing.publishedAt === input.publishedAt) {
        return existing
      }
      throw new Error(existing.platformVideoId === identity.platformVideoId
        ? "PUBLICATION_ID_CONFLICT" : "PUBLICATION_URL_CONFLICT")
    }
    const publication = this.publications.insert({
      id: randomUUID(), scope, source: "external", runId: null,
      lockedVersion: null, lockedSelectionVersion: null, title: input.title,
      ...identity, publishedAt: input.publishedAt,
      createdByUserId: context.userId, createdAt: new Date().toISOString(),
    })
    this.audit(context, "publication.external_created", publication, {})
    return publication
  }

  supplementIdentity(
    context: TenantAccessContext,
    publicationId: string,
    input: { platformVideoId?: string; videoUrl?: string },
  ) {
    const scope = this.scopeForPublication(context, publicationId, "metrics.import")
    const publication = this.publications.requireById(scope, publicationId)
    if (publication.source !== "external" || publication.status !== "active") throw new Error("PUBLICATION_NOT_EDITABLE")
    const identity = this.identity(input.platformVideoId, input.videoUrl)
    if (!identity.platformVideoId && !identity.normalizedVideoUrl) throw new Error("PUBLICATION_IDENTITY_REQUIRED")
    const conflict = this.resolveExisting(scope, identity)
    if (conflict && conflict.id !== publication.id) {
      throw new Error(conflict.platformVideoId === identity.platformVideoId
        ? "PUBLICATION_ID_CONFLICT" : "PUBLICATION_URL_CONFLICT")
    }
    const updated = this.publications.supplementIdentity(scope, publicationId, identity)
    this.audit(context, "publication.identity_supplemented", updated, {
      hasPlatformVideoId: Boolean(identity.platformVideoId), hasVideoUrl: Boolean(identity.normalizedVideoUrl),
    })
    return updated
  }

  disable(context: TenantAccessContext, publicationId: string, reason: string) {
    const scope = this.scopeForPublication(context, publicationId)
    const publication = this.publications.requireById(scope, publicationId)
    requireTenantCapability(context, publication.source === "system" ? "publication.record" : "metrics.import", {
      ipId: scope.ipId, contentAccountId: scope.contentAccountId,
    })
    const disabled = this.publications.disable(scope, publicationId)
    this.audit(context, "publication.disabled", disabled, { reason: reason.trim().slice(0, 200) })
    return disabled
  }

  getByCurrentLock(context: TenantAccessContext, runId: string, lockedVersion: number) {
    requireTenantCapability(context, "publication.record")
    const run = this.publications.runScope(runId)
    if (!run || run.tenant_id !== context.tenantId || !context.ipIds.includes(run.ip_profile_id)) {
      throw new Error("RUN_NOT_FOUND")
    }
    return this.publications.listByLock({
      tenantId: context.tenantId,
      ipId: run.ip_profile_id,
      contentAccountId: run.content_account_id ?? "",
      platform: "",
    }, runId, lockedVersion).filter((publication) => context.contentAccountIds.includes(publication.contentAccountId))
  }

  private requireTargetScope(
    context: TenantAccessContext,
    contentAccountId: string,
    capability: "publication.record" | "metrics.import",
  ) {
    const scope = this.publications.accountScope(context.tenantId, contentAccountId)
    if (!scope) throw new Error("ACCOUNT_SCOPE_FORBIDDEN")
    requireTenantCapability(context, capability, { ipId: scope.ipId, contentAccountId })
    return scope
  }

  private scopeForPublication(
    context: TenantAccessContext,
    publicationId: string,
    capability?: "publication.record" | "metrics.import",
  ) {
    const row = this.database.prepare(`SELECT content_account_id FROM publications
      WHERE id=? AND tenant_id=?`).get(publicationId, context.tenantId) as { content_account_id: string } | undefined
    if (!row) throw new Error("PUBLICATION_NOT_FOUND")
    const scope = this.publications.accountScope(context.tenantId, row.content_account_id)
    if (!scope) throw new Error("PUBLICATION_NOT_FOUND")
    if (capability) requireTenantCapability(context, capability, { ipId: scope.ipId, contentAccountId: scope.contentAccountId })
    return scope
  }

  private identity(platformVideoId?: string, videoUrl?: string) {
    const normalizedVideoUrl = videoUrl ? normalizeVideoUrl(videoUrl) : null
    return {
      platformVideoId: platformVideoId?.trim() || null,
      videoUrl: videoUrl?.trim() || null,
      normalizedVideoUrl,
    }
  }

  private resolveExisting(
    scope: GrowthScope,
    identity: { platformVideoId: string | null; normalizedVideoUrl: string | null },
  ) {
    const byId = identity.platformVideoId
      ? this.publications.findActiveByVideoId(scope, identity.platformVideoId) : null
    const byUrl = identity.normalizedVideoUrl
      ? this.publications.findActiveByNormalizedUrl(scope, identity.normalizedVideoUrl) : null
    if (byId && byUrl && byId.id !== byUrl.id) throw new Error("PUBLICATION_IDENTITY_CONFLICT")
    return byId ?? byUrl
  }

  private audit(context: TenantAccessContext, action: string, publication: Publication, detail: Record<string, unknown>) {
    const previous = this.database.prepare(`SELECT created_at FROM audit_logs
      WHERE tenant_id=? AND resource_type='publication' AND resource_id=?
      ORDER BY created_at DESC LIMIT 1`).get(
      context.tenantId,
      publication.id,
    ) as { created_at: string } | undefined
    const now = Date.now()
    const previousTime = previous ? Date.parse(previous.created_at) : Number.NaN
    const createdAt = new Date(Number.isFinite(previousTime) && previousTime >= now
      ? previousTime + 1
      : now).toISOString()
    this.database.prepare(`INSERT INTO audit_logs
      (id,tenant_id,actor_user_id,action,resource_type,resource_id,detail_json,created_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(
      randomUUID(), context.tenantId, context.userId, action, "publication", publication.id,
      JSON.stringify({ contentAccountId: publication.contentAccountId, source: publication.source, ...detail }),
      createdAt,
    )
  }
}
