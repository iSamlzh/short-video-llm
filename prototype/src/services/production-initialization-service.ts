import { randomUUID } from "node:crypto"
import type Database from "better-sqlite3"
import { capabilities } from "../domain/access"
import { hashPassword } from "../lib/auth/password"
import { normalizeEmail } from "../lib/auth/local-identity-provider"
import { IdentityRepository } from "../lib/db/identity-repository"

export type ProductionInitializationInput = {
  platformAdminEmail: string
  platformAdminName: string
  platformAdminPassword: string
  tenantName: string
  ownerEmail: string
  ownerName: string
  ownerPassword: string
}

export class ProductionInitializationService {
  constructor(private readonly database: Database.Database) {}

  async initialize(input: ProductionInitializationInput) {
    const demoCount = Number((this.database.prepare("SELECT COUNT(*) count FROM users WHERE data_origin='demo'").get() as { count: number }).count)
    if (demoCount > 0) throw new Error("DEMO_DATA_PRESENT")
    const formalCount = Number((this.database.prepare("SELECT COUNT(*) count FROM users WHERE data_origin='formal'").get() as { count: number }).count)
    if (formalCount > 0) throw new Error("PRODUCTION_ALREADY_INITIALIZED")
    const adminHash = await hashPassword(input.platformAdminPassword)
    const ownerHash = await hashPassword(input.ownerPassword)
    const adminId = randomUUID(), ownerId = randomUUID(), tenantId = randomUUID(), membershipId = randomUUID()
    const now = new Date().toISOString()
    const identities = new IdentityRepository(this.database)

    this.database.transaction(() => {
      identities.create({ id: adminId, emailNormalized: normalizeEmail(input.platformAdminEmail), displayName: input.platformAdminName, passwordHash: adminHash, audience: "platform", platformRole: "platform_admin", dataOrigin: "formal" })
      identities.create({ id: ownerId, emailNormalized: normalizeEmail(input.ownerEmail), displayName: input.ownerName, passwordHash: ownerHash, audience: "tenant", dataOrigin: "formal" })
      this.database.prepare("INSERT INTO tenants (id,name,status,data_origin,created_at) VALUES (?,?,'active','formal',?)").run(tenantId, input.tenantName, now)
      this.database.prepare(`INSERT INTO memberships (id,tenant_id,user_id,role_key,status,data_origin,created_at)
        VALUES (?,?,?,'owner','active','formal',?)`).run(membershipId, tenantId, ownerId, now)
      const grant = this.database.prepare("INSERT INTO membership_capabilities (membership_id,capability) VALUES (?,?)")
      for (const capability of capabilities) grant.run(membershipId, capability)
      this.database.prepare("INSERT INTO user_current_tenant (user_id,tenant_id,updated_at) VALUES (?,?,?)").run(ownerId, tenantId, now)
      this.database.prepare(`INSERT INTO audit_logs
        (id,tenant_id,actor_user_id,action,resource_type,resource_id,detail_json,created_at)
        VALUES (?,?,?,?,?,?,?,?)`).run(randomUUID(), tenantId, adminId, "production.initialized", "tenant", tenantId, JSON.stringify({ ownerId, membershipId }), now)
    })()
    return { platformAdminId: adminId, tenantId, ownerId, membershipId }
  }
}
