import { z } from "zod"
import { getAppDatabase } from "../lib/db/app-database"
import { resolveAppEnvironment } from "../lib/runtime-features"
import { ProductionInitializationService } from "../services/production-initialization-service"

if (resolveAppEnvironment(process.env) !== "production") throw new Error("PRODUCTION_ENVIRONMENT_REQUIRED")

const input = z.object({
  platformAdminEmail: z.string().email(), platformAdminName: z.string().min(2), platformAdminPassword: z.string().min(12),
  tenantName: z.string().min(2), ownerEmail: z.string().email(), ownerName: z.string().min(2), ownerPassword: z.string().min(12),
}).parse({
  platformAdminEmail: process.env.INIT_PLATFORM_ADMIN_EMAIL,
  platformAdminName: process.env.INIT_PLATFORM_ADMIN_NAME,
  platformAdminPassword: process.env.INIT_PLATFORM_ADMIN_PASSWORD,
  tenantName: process.env.INIT_TENANT_NAME,
  ownerEmail: process.env.INIT_OWNER_EMAIL,
  ownerName: process.env.INIT_OWNER_NAME,
  ownerPassword: process.env.INIT_OWNER_PASSWORD,
})

const result = await new ProductionInitializationService(getAppDatabase()).initialize(input)
console.log("生产环境初始化完成", { tenantId: result.tenantId, ownerId: result.ownerId, platformAdminId: result.platformAdminId })
