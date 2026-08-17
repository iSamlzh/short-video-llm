import { describe, expect, it } from "vitest"
import { openDatabase } from "../../src/lib/db/database"
import { IpProfileService } from "../../src/services/ip-profile-service"

describe("IpProfileService", () => {
  it("creates an IP once and makes it the user's current context", () => {
    const database = openDatabase(":memory:")
    const now = new Date().toISOString()
    database.prepare("INSERT INTO users (id,email_normalized,display_name,password_hash,audience,status,data_origin,created_at) VALUES (?,?,?,?,?,?,?,?)").run("u1","u@test","团长","x","tenant","active","formal",now)
    database.prepare("INSERT INTO tenants (id,name,status,data_origin,created_at) VALUES (?,?,?,?,?)").run("t1","团队","active","formal",now)
    database.prepare("INSERT INTO memberships (id,tenant_id,user_id,role_key,status,data_origin,created_at) VALUES (?,?,?,?,?,?,?)").run("m1","t1","u1","owner","active","formal",now)
    const context = { audience: "tenant" as const, userId: "u1", tenantId: "t1", membershipId: "m1", capabilities: ["content.create" as const], ipIds: [], contentAccountIds: [] }
    const created = new IpProfileService(database).createAndSelect(context, {
      profile: { displayName: "林姐", experience: "七年社区团购与团长运营经历", expertise: "社区团购选品", audience: "本地经营者", voiceStyle: "直白温和", boundaries: "不承诺收益" },
      account: { platform: "wechat_channels", name: "林姐说团购" },
    })
    const current = database.prepare("SELECT ip_profile_id,content_account_id FROM user_current_context WHERE user_id='u1'").get() as any
    expect(current).toEqual({ ip_profile_id: created.ipId, content_account_id: created.accountId })
    database.close()
  })
})
