import type { ActorAudience } from "../domain/access"
import { AccessRepository } from "../lib/db/access-repository"

export class AccessService {
  constructor(private readonly access: AccessRepository) {}

  resolve(userId: string, audience: ActorAudience) {
    if (audience === "platform") {
      const platform = this.access.resolvePlatform(userId)
      if (!platform?.platform_role) throw new Error("PLATFORM_ACCOUNT_REQUIRED")
      return {
        audience: "platform" as const,
        userId,
        platformRole: platform.platform_role,
      }
    }

    const tenant = this.access.resolveTenant(userId)
    if (!tenant) throw new Error("ACTIVE_MEMBERSHIP_REQUIRED")
    return {
      audience: "tenant" as const,
      userId,
      tenantId: tenant.tenantId,
      membershipId: tenant.membershipId,
      capabilities: tenant.capabilities,
      ipIds: tenant.ipIds,
      contentAccountIds: tenant.contentAccountIds,
    }
  }
}
