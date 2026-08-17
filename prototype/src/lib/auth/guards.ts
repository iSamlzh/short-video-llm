import type { AccessContext, Capability, TenantAccessContext } from "../../domain/access"
import { AccessError } from "../../domain/access"

export function requireTenantCapability(
  context: AccessContext,
  capability: Capability,
  resource: { ipId?: string; contentAccountId?: string } = {},
): TenantAccessContext {
  if (context.audience !== "tenant") throw new AccessError("TENANT_AUDIENCE_REQUIRED")
  if (!context.capabilities.includes(capability)) throw new AccessError("CAPABILITY_FORBIDDEN")
  if (resource.ipId && !context.ipIds.includes(resource.ipId)) throw new AccessError("IP_SCOPE_FORBIDDEN")
  if (resource.contentAccountId && !context.contentAccountIds.includes(resource.contentAccountId)) {
    throw new AccessError("ACCOUNT_SCOPE_FORBIDDEN")
  }
  return context
}

export function requirePlatformOperator(context: AccessContext) {
  if (context.audience !== "platform") throw new AccessError("PLATFORM_AUDIENCE_REQUIRED")
  return context
}
