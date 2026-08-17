export const capabilities = [
  "ip.view",
  "content.create",
  "content.edit",
  "content.lock",
  "publication.record",
  "metrics.import",
  "review.generate",
  "review.view",
  "review.confirm",
  "team.manage",
] as const

export type Capability = typeof capabilities[number]
export type ActorAudience = "tenant" | "platform"

export type TenantAccessContext = {
  audience: "tenant"
  userId: string
  tenantId: string
  membershipId: string
  capabilities: Capability[]
  ipIds: string[]
  contentAccountIds: string[]
}

export type PlatformAccessContext = {
  audience: "platform"
  userId: string
  platformRole: "platform_operator" | "platform_admin"
}

export type AccessContext = TenantAccessContext | PlatformAccessContext

export class AccessError extends Error {
  constructor(public readonly code: string, public readonly status = 403) {
    super(code)
    this.name = "AccessError"
  }
}
