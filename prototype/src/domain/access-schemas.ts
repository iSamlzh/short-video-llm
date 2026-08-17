import { z } from "zod"
import { capabilities } from "./access"

const tenantContextSchema = z.object({
  audience: z.literal("tenant"),
  userId: z.string().min(1),
  tenantId: z.string().min(1),
  membershipId: z.string().min(1),
  capabilities: z.array(z.enum(capabilities)),
  ipIds: z.array(z.string().min(1)),
  contentAccountIds: z.array(z.string().min(1)),
})

const platformContextSchema = z.object({
  audience: z.literal("platform"),
  userId: z.string().min(1),
  platformRole: z.enum(["platform_operator", "platform_admin"]),
})

export const accessContextSchema = z.discriminatedUnion("audience", [
  tenantContextSchema,
  platformContextSchema,
])
