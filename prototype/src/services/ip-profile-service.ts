import { randomUUID } from "node:crypto"
import type Database from "better-sqlite3"
import type { TenantAccessContext } from "../domain/access"
import { ipPortraitDraftSchema, ipProfileSchema } from "../domain/schemas"
import { requireTenantCapability } from "../lib/auth/guards"

export class IpProfileService {
  constructor(private readonly database: Database.Database) {}

  createAndSelect(context: TenantAccessContext, input: { profile: unknown; account: { platform: string; name: string } }) {
    requireTenantCapability(context, "content.create")
    const profile = ipProfileSchema.parse(input.profile)
    if (!input.account.platform || !input.account.name.trim()) throw new Error("ACCOUNT_REQUIRED")
    const ipId = randomUUID()
    const accountId = randomUUID()
    const now = new Date().toISOString()
    const tenant = this.database.prepare("SELECT data_origin FROM tenants WHERE id=? AND status='active'").get(context.tenantId) as { data_origin: "demo" | "formal" } | undefined
    if (!tenant) throw new Error("TENANT_NOT_FOUND")
    this.database.transaction(() => {
      this.database.prepare(`INSERT INTO ip_profiles
        (id,tenant_id,display_name,profile_json,verification_status,version,status,data_origin,created_at,updated_at)
        VALUES (?,?,?,?,'verified',1,'active',?,?,?)`).run(ipId, context.tenantId, profile.displayName, JSON.stringify(profile), tenant.data_origin, now, now)
      this.database.prepare(`INSERT INTO ip_profile_versions
        (id,tenant_id,ip_profile_id,version,display_name,profile_json,change_summary,created_by_user_id,created_at)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(randomUUID(), context.tenantId, ipId, 1, profile.displayName, JSON.stringify(profile), "首次创建 IP 画像", context.userId, now)
      this.database.prepare(`INSERT INTO content_accounts
        (id,tenant_id,ip_profile_id,platform,account_name,platform_account_id,status,data_origin,is_default,created_at)
        VALUES (?,?,?,?,?,NULL,'active',?,1,?)`).run(accountId, context.tenantId, ipId, input.account.platform, input.account.name.trim(), tenant.data_origin, now)
      this.database.prepare("INSERT INTO membership_ip_scopes (membership_id,ip_profile_id) VALUES (?,?)").run(context.membershipId, ipId)
      this.database.prepare("INSERT INTO membership_account_scopes (membership_id,content_account_id) VALUES (?,?)").run(context.membershipId, accountId)
      this.database.prepare(`INSERT INTO user_current_context (user_id,tenant_id,ip_profile_id,content_account_id,updated_at)
        VALUES (?,?,?,?,?) ON CONFLICT(user_id,tenant_id) DO UPDATE SET
        ip_profile_id=excluded.ip_profile_id,content_account_id=excluded.content_account_id,updated_at=excluded.updated_at`)
        .run(context.userId, context.tenantId, ipId, accountId, now)
    })()
    return { ipId, accountId, profile }
  }

  confirmOnboarding(
    context: TenantAccessContext,
    input: { sessionId: string; portraitDraftVersion: number },
  ) {
    requireTenantCapability(context, "content.create")
    const ipId = randomUUID()
    const accountId = randomUUID()
    const now = new Date().toISOString()

    return this.database.transaction(() => {
      const session = this.database.prepare(`SELECT portrait_draft_json, portrait_draft_version, state
        FROM ip_onboarding_sessions
        WHERE id = ? AND tenant_id = ? AND creator_user_id = ?`)
        .get(input.sessionId, context.tenantId, context.userId) as {
          portrait_draft_json: string | null
          portrait_draft_version: number
          state: string
        } | undefined
      if (!session) throw new Error("ONBOARDING_SESSION_NOT_FOUND")
      if (!session.portrait_draft_json || session.state !== "PORTRAIT_PREVIEW") {
        throw new Error("PORTRAIT_DRAFT_REQUIRED")
      }
      if (session.portrait_draft_version !== input.portraitDraftVersion) {
        throw new Error("PORTRAIT_DRAFT_VERSION_CONFLICT")
      }

      const draft = ipPortraitDraftSchema.parse(JSON.parse(session.portrait_draft_json))
      const profile = ipProfileSchema.parse({
        ...draft.profile,
        industryCategory: draft.contentPortrait.industryCategory,
        contentPortrait: draft.contentPortrait,
      })
      const tenant = this.database.prepare("SELECT data_origin FROM tenants WHERE id=? AND status='active'")
        .get(context.tenantId) as { data_origin: "demo" | "formal" } | undefined
      if (!tenant) throw new Error("TENANT_NOT_FOUND")

      this.database.prepare(`INSERT INTO ip_profiles
        (id,tenant_id,display_name,profile_json,verification_status,version,status,data_origin,created_at,updated_at)
        VALUES (?,?,?,?,'verified',1,'active',?,?,?)`)
        .run(ipId, context.tenantId, profile.displayName, JSON.stringify(profile), tenant.data_origin, now, now)
      this.database.prepare(`INSERT INTO ip_profile_versions
        (id,tenant_id,ip_profile_id,version,display_name,profile_json,change_summary,created_by_user_id,created_at)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(randomUUID(), context.tenantId, ipId, 1, profile.displayName, JSON.stringify(profile), "完成首次建档", context.userId, now)
      this.database.prepare(`INSERT INTO content_accounts
        (id,tenant_id,ip_profile_id,platform,account_name,platform_account_id,status,data_origin,is_default,created_at)
        VALUES (?,?,?,?,?,NULL,'active',?,1,?)`)
        .run(accountId, context.tenantId, ipId, draft.account.platform, draft.account.name.trim(), tenant.data_origin, now)
      this.database.prepare("INSERT INTO membership_ip_scopes (membership_id,ip_profile_id) VALUES (?,?)")
        .run(context.membershipId, ipId)
      this.database.prepare("INSERT INTO membership_account_scopes (membership_id,content_account_id) VALUES (?,?)")
        .run(context.membershipId, accountId)
      this.database.prepare(`INSERT INTO user_current_context (user_id,tenant_id,ip_profile_id,content_account_id,updated_at)
        VALUES (?,?,?,?,?) ON CONFLICT(user_id,tenant_id) DO UPDATE SET
        ip_profile_id=excluded.ip_profile_id,content_account_id=excluded.content_account_id,updated_at=excluded.updated_at`)
        .run(context.userId, context.tenantId, ipId, accountId, now)
      const confirmed = this.database.prepare(`UPDATE ip_onboarding_sessions
        SET state='CONFIRMED', current_question_id=NULL, version=version+1,
          confirmed_at=?, updated_at=?
        WHERE id=? AND tenant_id=? AND creator_user_id=?
          AND state='PORTRAIT_PREVIEW' AND portrait_draft_version=?`)
        .run(now, now, input.sessionId, context.tenantId, context.userId, input.portraitDraftVersion)
      if (confirmed.changes !== 1) throw new Error("PORTRAIT_DRAFT_VERSION_CONFLICT")

      return { ipId, accountId, profile }
    })()
  }
}
