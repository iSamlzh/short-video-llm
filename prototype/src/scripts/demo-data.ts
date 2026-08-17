import type Database from "better-sqlite3"
import { IdentityRepository } from "../lib/db/identity-repository"
import { LocalIdentityProvider } from "../lib/auth/local-identity-provider"
import type { Capability } from "../domain/access"
import { createHash, randomUUID } from "node:crypto"

const now = () => new Date().toISOString()

const roleCapabilities: Record<string, Capability[]> = {
  owner: [
    "ip.view", "content.create", "content.edit", "content.lock",
    "publication.record", "metrics.import", "review.generate", "review.view", "review.confirm", "team.manage",
  ],
  operator: ["ip.view", "content.create", "content.edit", "publication.record"],
  reviewer: ["ip.view", "metrics.import", "review.generate", "review.view"],
}

export async function seedDemoData(database: Database.Database, password: string) {
  const identities = new IdentityRepository(database)
  const provider = new LocalIdentityProvider(identities)
  const users = [
    { id: "user-owner", email: "owner@example.test", displayName: "林姐", audience: "tenant" as const },
    { id: "user-operator", email: "operator@example.test", displayName: "小周", audience: "tenant" as const },
    { id: "user-reviewer", email: "reviewer@example.test", displayName: "阿雅", audience: "tenant" as const },
    { id: "user-platform", email: "platform@example.test", displayName: "陈默", audience: "platform" as const, platformRole: "platform_operator" as const },
  ]
  for (const user of users) {
    if (!identities.findByEmail(user.email)) {
      await provider.createUser({ ...user, password, dataOrigin: "demo" })
    }
  }

  database.transaction(() => {
    const createdAt = now()
    database.prepare("INSERT OR IGNORE INTO tenants (id,name,status,data_origin,created_at) VALUES (?,?,?,?,?)")
      .run("tenant-linjie", "林姐内容团队", "active", "demo", createdAt)
    const profiles = [
      {
        id: "ip-linjie",
        name: "林姐",
        profile: {
          displayName: "林姐",
          experience: "七年社区团购与团长运营经历，服务过十二个小区",
          expertise: "社区团购选品、社群维护与团长培训",
          audience: "想做本地生意的宝妈和小店主",
          voiceStyle: "直白、温和、讲真实案例",
          boundaries: "不承诺收益，不虚构成功案例，不贬低其他平台",
        },
      },
      {
        id: "ip-wangjie",
        name: "王姐",
        profile: {
          displayName: "王姐",
          experience: "四年本地生活服务运营经验",
          expertise: "社区生活服务",
          audience: "本地家庭用户",
          voiceStyle: "清楚、务实",
          boundaries: "不夸大效果",
        },
      },
    ]
    const profileInsert = database.prepare(`INSERT OR IGNORE INTO ip_profiles
      (id,tenant_id,display_name,profile_json,verification_status,version,status,data_origin,created_at,updated_at)
      VALUES (?,?,?,?,'verified',1,'active','demo',?,?)`)
    for (const profile of profiles) {
      profileInsert.run(profile.id, "tenant-linjie", profile.name, JSON.stringify(profile.profile), createdAt, createdAt)
    }

    const accountInsert = database.prepare(`INSERT OR IGNORE INTO content_accounts
      (id,tenant_id,ip_profile_id,platform,account_name,platform_account_id,status,data_origin,created_at)
      VALUES (?,?,?,?,?,?,'active','demo',?)`)
    accountInsert.run("account-linjie-wechat", "tenant-linjie", "ip-linjie", "wechat_channels", "林姐说团购", "linjie-wechat", createdAt)
    accountInsert.run("account-linjie-douyin", "tenant-linjie", "ip-linjie", "douyin", "林姐聊团购", "linjie-douyin", createdAt)
    accountInsert.run("account-wangjie-douyin", "tenant-linjie", "ip-wangjie", "douyin", "王姐本地生活", "wangjie-douyin", createdAt)

    const memberships = [
      { id: "membership-owner", userId: "user-owner", role: "owner", ips: ["ip-linjie", "ip-wangjie"], accounts: ["account-linjie-wechat", "account-linjie-douyin", "account-wangjie-douyin"] },
      { id: "membership-operator", userId: "user-operator", role: "operator", ips: ["ip-linjie"], accounts: ["account-linjie-wechat"] },
      { id: "membership-reviewer", userId: "user-reviewer", role: "reviewer", ips: ["ip-linjie"], accounts: ["account-linjie-wechat"] },
    ]
    const membershipInsert = database.prepare(`INSERT OR IGNORE INTO memberships
      (id,tenant_id,user_id,role_key,status,data_origin,created_at) VALUES (?,'tenant-linjie',?,?,'active','demo',?)`)
    const capabilityInsert = database.prepare("INSERT OR IGNORE INTO membership_capabilities (membership_id,capability) VALUES (?,?)")
    const ipInsert = database.prepare("INSERT OR IGNORE INTO membership_ip_scopes (membership_id,ip_profile_id) VALUES (?,?)")
    const accountScopeInsert = database.prepare("INSERT OR IGNORE INTO membership_account_scopes (membership_id,content_account_id) VALUES (?,?)")
    const currentInsert = database.prepare(`INSERT OR IGNORE INTO user_current_context
      (user_id,tenant_id,ip_profile_id,content_account_id,updated_at) VALUES (?,'tenant-linjie','ip-linjie','account-linjie-wechat',?)`)
    for (const membership of memberships) {
      membershipInsert.run(membership.id, membership.userId, membership.role, createdAt)
      for (const capability of roleCapabilities[membership.role]) capabilityInsert.run(membership.id, capability)
      for (const ipId of membership.ips) ipInsert.run(membership.id, ipId)
      for (const accountId of membership.accounts) accountScopeInsert.run(membership.id, accountId)
      currentInsert.run(membership.userId, createdAt)
    }

    const sampleInsert = database.prepare(`INSERT OR IGNORE INTO platform_content_samples
      (id,title,source_platform,source_text,rights_note,status,data_origin,created_by_user_id,created_at)
      VALUES (?,?,?,?,?,'reviewed','demo','user-platform',?)`)
    sampleInsert.run("sample-neighbor", "楼道里的邻里约定", "wechat_channels", "从一个真实邻里场景切入，讲清信任如何靠小事建立。", "内部授权演示样本", createdAt)
    sampleInsert.run("sample-failure", "我做团长踩过的坑", "douyin", "从失败经历切入，说明认知转折与可执行方法。", "内部授权演示样本", createdAt)
    sampleInsert.run("sample-boundary", "我为什么不承诺收益", "douyin", "用边界声明筛选长期合作对象。", "内部授权演示样本", createdAt)
    const templateInsert = database.prepare(`INSERT OR IGNORE INTO platform_template_versions
      (id,template_id,version,name,payload_json,status,is_general,data_origin,created_by_user_id,created_at,activated_at)
      VALUES (?,?,?,?,?,'active',?,'demo','user-platform',?,?)`)
    templateInsert.run("template-trust-v1", "template-trust", 1, "真实场景—认知转折—行动方法", JSON.stringify({ nodes: ["真实场景", "认知转折", "三步方法", "价值观收束"] }), 1, createdAt, createdAt)
    templateInsert.run("template-failure-v1", "template-failure", 1, "失败经历—经验提炼—价值筛选", JSON.stringify({ nodes: ["身份反差", "失败经历", "经验提炼", "价值筛选"] }), 0, createdAt, createdAt)
    templateInsert.run("template-question-v1", "template-question", 1, "客户疑问—事实回应—边界说明", JSON.stringify({ nodes: ["客户疑问", "事实回应", "边界说明", "轻行动引导"] }), 0, createdAt, createdAt)

    const metricInsert = database.prepare(`INSERT OR IGNORE INTO imported_content_metrics
      (id,tenant_id,ip_profile_id,content_account_id,content_title,published_at,plays,completion_rate,likes,comments,shares,negative_feedback,source_hash,data_origin,created_at)
      VALUES (?,'tenant-linjie','ip-linjie','account-linjie-wechat',?,NULL,?,?,?,?,?,?,?,'demo',?)`)
    const demoMetrics = [
      ["楼道里的一份邻里约定，暖到心里", 12800, 0.54, 430, 86, 75, 2],
      ["小区里的暖心接力，太治愈了", 9600, 0.47, 320, 58, 51, 3],
      ["关于车位矛盾，我们这样解决", 4100, 0.21, 66, 29, 8, 24],
    ] as const
    for (const [title, plays, completion, likes, comments, shares, negative] of demoMetrics) {
      const hash = createHash("sha256").update(`${title}|${[plays, completion, likes, comments, shares, negative].join("|")}`).digest("hex")
      metricInsert.run(randomUUID(), title, plays, completion, likes, comments, shares, negative, hash, createdAt)
    }
  })()
}

export function clearDemoData(database: Database.Database, allowed: boolean) {
  if (!allowed) throw new Error("DEMO_CLEAR_NOT_ALLOWED")
  database.transaction(() => {
    database.exec(`
      DELETE FROM platform_template_versions WHERE data_origin = 'demo';
      DELETE FROM platform_content_samples WHERE data_origin = 'demo';
      DELETE FROM imported_content_metrics WHERE data_origin = 'demo';
      DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE data_origin = 'demo');
      DELETE FROM user_current_context WHERE user_id IN (SELECT id FROM users WHERE data_origin = 'demo');
      DELETE FROM audit_logs WHERE actor_user_id IN (SELECT id FROM users WHERE data_origin = 'demo');
      DELETE FROM membership_account_scopes WHERE membership_id IN (SELECT id FROM memberships WHERE data_origin = 'demo');
      DELETE FROM membership_ip_scopes WHERE membership_id IN (SELECT id FROM memberships WHERE data_origin = 'demo');
      DELETE FROM membership_capabilities WHERE membership_id IN (SELECT id FROM memberships WHERE data_origin = 'demo');
      DELETE FROM invitations WHERE data_origin = 'demo';
      DELETE FROM memberships WHERE data_origin = 'demo';
      DELETE FROM content_accounts WHERE data_origin = 'demo';
      DELETE FROM ip_profiles WHERE data_origin = 'demo';
      DELETE FROM tenants WHERE data_origin = 'demo';
      DELETE FROM users WHERE data_origin = 'demo';
    `)
  })()
}
