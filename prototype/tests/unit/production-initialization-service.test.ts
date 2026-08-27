import { afterEach, describe, expect, it } from "vitest"
import type Database from "better-sqlite3"
import { openDatabase } from "../../src/lib/db/database"
import { IdentityRepository } from "../../src/lib/db/identity-repository"
import { LocalIdentityProvider } from "../../src/lib/auth/local-identity-provider"
import { ProductionInitializationService } from "../../src/services/production-initialization-service"

let database: Database.Database | undefined
afterEach(() => database?.close())

describe("生产环境初始化", () => {
  it("一次性创建平台管理员、租户 Owner 和完整 Owner 权限", async () => {
    database = openDatabase(":memory:")
    const service = new ProductionInitializationService(database)
    await service.initialize({
      platformAdminEmail: "admin@example.com", platformAdminName: "平台管理员", platformAdminPassword: "AdminPassword2026",
      tenantName: "首个内容团队", ownerEmail: "owner@example.com", ownerName: "首位团长", ownerPassword: "OwnerPassword2026",
    })

    const identities = new LocalIdentityProvider(new IdentityRepository(database))
    await expect(identities.authenticate("admin@example.com", "AdminPassword2026")).resolves.toMatchObject({ audience: "platform" })
    await expect(identities.authenticate("owner@example.com", "OwnerPassword2026")).resolves.toMatchObject({ audience: "tenant" })
    expect(database.prepare("SELECT COUNT(*) count FROM membership_capabilities").get()).toEqual({ count: 11 })
    await expect(service.initialize({
      platformAdminEmail: "admin2@example.com", platformAdminName: "另一个管理员", platformAdminPassword: "AdminPassword2027",
      tenantName: "另一个团队", ownerEmail: "owner2@example.com", ownerName: "另一位团长", ownerPassword: "OwnerPassword2027",
    })).rejects.toThrow("PRODUCTION_ALREADY_INITIALIZED")
  })
})
