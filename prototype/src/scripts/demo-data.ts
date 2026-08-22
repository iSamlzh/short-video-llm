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
    { id: "user-firsttime", email: "firsttime@example.test", displayName: "首次体验团长", audience: "tenant" as const },
    { id: "user-operator", email: "operator@example.test", displayName: "小周", audience: "tenant" as const },
    { id: "user-reviewer", email: "reviewer@example.test", displayName: "阿雅", audience: "tenant" as const },
    { id: "user-platform", email: "platform@example.test", displayName: "陈默", audience: "platform" as const, platformRole: "platform_admin" as const },
  ]
  for (const user of users) {
    if (!identities.findByEmail(user.email)) {
      await provider.createUser({ ...user, password, dataOrigin: "demo" })
    }
  }

  database.transaction(() => {
    const createdAt = now()
    database.prepare("UPDATE users SET platform_role='platform_admin' WHERE id='user-platform' AND data_origin='demo'").run()
    database.prepare("INSERT OR IGNORE INTO tenants (id,name,status,data_origin,created_at) VALUES (?,?,?,?,?)")
      .run("tenant-linjie", "林姐内容团队", "active", "demo", createdAt)
    database.prepare("INSERT OR IGNORE INTO tenants (id,name,status,data_origin,created_at) VALUES (?,?,?,?,?)")
      .run("tenant-firsttime", "首次使用验证团队", "active", "demo", createdAt)
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
      (id,tenant_id,ip_profile_id,platform,account_name,platform_account_id,status,data_origin,is_default,created_at)
      VALUES (?,?,?,?,?,?,'active','demo',?,?)`)
    accountInsert.run("account-linjie-wechat", "tenant-linjie", "ip-linjie", "wechat_channels", "林姐说团购", "linjie-wechat", 1, createdAt)
    accountInsert.run("account-linjie-douyin", "tenant-linjie", "ip-linjie", "douyin", "林姐聊团购", "linjie-douyin", 0, createdAt)
    accountInsert.run("account-wangjie-douyin", "tenant-linjie", "ip-wangjie", "douyin", "王姐本地生活", "wangjie-douyin", 1, createdAt)

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
    database.prepare(`INSERT OR IGNORE INTO memberships
      (id,tenant_id,user_id,role_key,status,data_origin,created_at)
      VALUES ('membership-firsttime','tenant-firsttime','user-firsttime','owner','active','demo',?)`).run(createdAt)
    for (const capability of roleCapabilities.owner) capabilityInsert.run("membership-firsttime", capability)

    const sampleInsert = database.prepare(`INSERT OR IGNORE INTO platform_content_samples
      (id,title,source_platform,source_text,rights_note,status,data_origin,created_by_user_id,created_at)
      VALUES (?,?,?,?,?,'reviewed','demo','user-platform',?)`)
    sampleInsert.run("sample-neighbor", "楼道里的邻里约定", "wechat_channels", "从一个真实邻里场景切入，讲清信任如何靠小事建立。", "内部授权演示样本", createdAt)
    sampleInsert.run("sample-failure", "我做团长踩过的坑", "douyin", "从失败经历切入，说明认知转折与可执行方法。", "内部授权演示样本", createdAt)
    sampleInsert.run("sample-boundary", "我为什么不承诺收益", "douyin", "用边界声明筛选长期合作对象。", "内部授权演示样本", createdAt)

    const demoSamples = [
      {
        id: "sample-neighbor",
        transcript: "我做社区团购这些年，最难忘的是一次邻居收到坏果。那天我先上门核验，当场补发，再把同批次商品全部复查。后来我明白，信任不是一句承诺，而是每次问题发生时都把责任扛起来。",
        analysisId: "analysis-neighbor-v1",
        analysis: {
          summary: "以真实售后冲突建立注意，通过处理动作形成可信度，最后落到长期责任原则。",
          nodes: [
            { kind: "hook", instruction: "以一次真实售后冲突开场", required: true, evidenceRefs: ["e1"] },
            { kind: "action", instruction: "说明核验、补发和复查动作", required: true, evidenceRefs: ["e2"] },
            { kind: "principle", instruction: "收束到长期责任原则", required: true, evidenceRefs: ["e3"] },
          ],
          reusablePatterns: ["冲突—处理—原则"],
          nonReusableFacts: ["坏果品类和当事邻居身份"],
          applicability: { ipTags: ["社区团购选品、社群维护与团长培训"], audiences: ["想做本地生意的宝妈和小店主"], goals: ["团长招商获客"] },
          riskNotes: ["不得把个案写成收益保证"],
          evidenceRefs: [
            { id: "e1", quote: "一次邻居收到坏果", start: 15, end: 23 },
            { id: "e2", quote: "先上门核验，当场补发，再把同批次商品全部复查", start: 26, end: 48 },
            { id: "e3", quote: "每次问题发生时都把责任扛起来", start: 67, end: 82 },
          ],
          suggestedDecision: "create_new",
        },
      },
      {
        id: "sample-failure",
        transcript: "刚做团长时我也急着追爆款，结果推过自己没有试吃的商品，邻居反馈一般。后来我给选品定了三条底线：自己先试、看真实反馈、售后能负责。踩坑不可怕，可怕的是不把经验变成下一次更稳的判断。",
        analysisId: "analysis-failure-v1",
        analysis: {
          summary: "用失败经历降低说教感，经由认知转折给出可执行方法。",
          nodes: [
            { kind: "failure", instruction: "承认一次可核实的失败判断", required: true, evidenceRefs: ["e1"] },
            { kind: "method", instruction: "给出从失败提炼的具体方法", required: true, evidenceRefs: ["e2"] },
          ],
          reusablePatterns: ["失败—转折—方法"],
          nonReusableFacts: ["具体商品名称和邻居身份"],
          applicability: { ipTags: ["社区团购选品、社群维护与团长培训"], audiences: ["想做本地生意的宝妈和小店主"], goals: ["团长招商获客"] },
          riskNotes: ["不得虚构失败结果"],
          evidenceRefs: [
            { id: "e1", quote: "推过自己没有试吃的商品", start: 17, end: 28 },
            { id: "e2", quote: "自己先试、看真实反馈、售后能负责", start: 48, end: 65 },
          ],
          suggestedDecision: "merge_existing",
        },
      },
      {
        id: "sample-boundary",
        transcript: "有人问我做团长能不能保证赚到钱，我的回答一直是不能。每个小区、每个人投入的时间都不同。我能讲清的是怎么选品、怎么服务邻居、怎么少踩坑，但不会用一个无法验证的数字换你的信任。",
        analysisId: "analysis-boundary-v1",
        analysis: {
          summary: "从高频疑问切入，用事实边界筛选愿意长期合作的受众。",
          nodes: [
            { kind: "question", instruction: "直接复述受众最关心的问题", required: true, evidenceRefs: ["e1"] },
            { kind: "boundary", instruction: "明确能提供与不能承诺的边界", required: true, evidenceRefs: ["e2"] },
          ],
          reusablePatterns: ["疑问—事实—边界"],
          nonReusableFacts: ["具体收益数字"],
          applicability: { ipTags: ["社区团购选品、社群维护与团长培训"], audiences: ["想做本地生意的宝妈和小店主"], goals: ["团长招商获客"] },
          riskNotes: ["禁止收益承诺"],
          evidenceRefs: [
            { id: "e1", quote: "做团长能不能保证赚到钱", start: 4, end: 16 },
            { id: "e2", quote: "能讲清的是怎么选品、怎么服务邻居、怎么少踩坑", start: 48, end: 70 },
          ],
          suggestedDecision: "merge_existing",
        },
      },
    ] as const
    const revisionInsert = database.prepare(`INSERT OR IGNORE INTO platform_content_sample_revisions
      (id,sample_id,version,transcript,content_hash,created_by_user_id,created_at) VALUES (?,?,?,?,?,'user-platform',?)`)
    const analysisInsert = database.prepare(`INSERT OR IGNORE INTO platform_content_analysis_versions
      (id,sample_id,revision_id,version,payload_json,model,prompt_version,status,created_by_user_id,
       reviewed_by_user_id,reviewed_at,review_note,created_at)
      VALUES (?,?,?,?,?,'demo-seed',1,'reviewed','user-platform','user-platform',?,'演示基线已人工复核',?)`)
    for (const sample of demoSamples) {
      const revisionId = `${sample.id}-revision-1`
      const contentHash = createHash("sha256").update(sample.transcript.normalize("NFKC").replace(/\s+/g, " ").trim()).digest("hex")
      revisionInsert.run(revisionId, sample.id, 1, sample.transcript, contentHash, createdAt)
      analysisInsert.run(sample.analysisId, sample.id, revisionId, 1, JSON.stringify(sample.analysis), createdAt, createdAt)
      database.prepare(`UPDATE platform_content_samples SET source_text=?,status='reviewed',current_revision_version=1,
        workflow_status=?,updated_at=? WHERE id=? AND data_origin='demo'`)
        .run(sample.transcript, sample.id === "sample-neighbor" ? "candidate_ready" : "reviewed", createdAt, sample.id)
    }

    const candidatePayload = {
      decision: "create_new",
      targetTemplateId: null,
      name: "真实冲突—处理动作—责任原则",
      applicability: { ipTags: ["社区团购选品、社群维护与团长培训"], audiences: ["想做本地生意的宝妈和小店主"], goals: ["团长招商获客"] },
      nodes: [
        { kind: "hook", instruction: "以一次真实冲突开场", required: true },
        { kind: "action", instruction: "交代核验和处理动作", required: true },
        { kind: "principle", instruction: "收束到可长期坚持的责任原则", required: true },
      ],
      qualityRules: ["至少包含一个具体处理动作"],
      riskRules: ["不得承诺收益", "不得虚构客户反馈"],
      similarities: ["与通用信任结构都强调真实经历"],
      differences: ["强化冲突处理动作与责任归因"],
      confidence: "medium",
    }
    database.prepare(`INSERT OR IGNORE INTO platform_structure_candidates
      (id,candidate_key,sample_id,version,decision,target_template_id,payload_json,status,data_origin,created_by_user_id,created_at,updated_at)
      VALUES ('candidate-neighbor-v1','sample-neighbor:create_new:真实冲突—处理动作—责任原则','sample-neighbor',1,'create_new',NULL,?,'activation_required','demo','user-platform',?,?)`)
      .run(JSON.stringify(candidatePayload), createdAt, createdAt)
    database.prepare(`INSERT OR IGNORE INTO platform_candidate_source_links
      (candidate_id,analysis_id,created_at) VALUES ('candidate-neighbor-v1','analysis-neighbor-v1',?)`).run(createdAt)
    const previewPayload = {
      topic: "一次售后如何建立长期信任",
      script: "一次坏果售后让我明白，团长最重要的不是把问题说小，而是先核验、马上补发、复查同批次商品。信任来自每次问题发生时都把责任扛起来。",
      nodeMappings: [
        { node: "真实冲突", excerpt: "一次坏果售后" },
        { node: "处理动作", excerpt: "先核验、马上补发、复查同批次商品" },
        { node: "责任原则", excerpt: "把责任扛起来" },
      ],
      qualityChecks: [{ rule: "至少包含一个具体处理动作", passed: true }],
      riskChecks: [{ rule: "不得承诺收益", passed: true }],
    }
    database.prepare(`INSERT OR IGNORE INTO platform_structure_previews
      (id,candidate_id,candidate_version,payload_json,model,created_by_user_id,created_at)
      VALUES ('preview-neighbor-v1','candidate-neighbor-v1',1,?,'demo-seed','user-platform',?)`)
      .run(JSON.stringify(previewPayload), createdAt)
    const templateInsert = database.prepare(`INSERT OR IGNORE INTO platform_template_versions
      (id,template_id,version,name,payload_json,status,is_general,data_origin,created_by_user_id,created_at,activated_at)
      VALUES (?,?,?,?,?,'active',?,'demo','user-platform',?,?)`)
    templateInsert.run("template-trust-v1", "template-trust", 1, "真实场景—认知转折—行动方法", JSON.stringify({ applicability: { ipTags: [], audiences: [], goals: [] }, nodes: ["真实场景", "认知转折", "三步方法", "价值观收束"], qualityRules: ["包含真实经历与具体动作"], riskRules: ["不得虚构案例或承诺收益"] }), 1, createdAt, createdAt)
    templateInsert.run("template-failure-v1", "template-failure", 1, "失败经历—经验提炼—价值筛选", JSON.stringify({ applicability: { ipTags: ["社区团购选品、社群维护与团长培训"], audiences: [], goals: ["团长招商获客"] }, nodes: ["身份反差", "失败经历", "经验提炼", "价值筛选"], qualityRules: ["失败必须来自已确认经历"], riskRules: ["不得夸大结果"] }), 0, createdAt, createdAt)
    templateInsert.run("template-question-v1", "template-question", 1, "客户疑问—事实回应—边界说明", JSON.stringify({ applicability: { ipTags: ["社区团购选品、社群维护与团长培训"], audiences: [], goals: ["团长招商获客"] }, nodes: ["客户疑问", "事实回应", "边界说明", "轻行动引导"], qualityRules: ["明确回答受众问题"], riskRules: ["不得承诺收益"] }), 0, createdAt, createdAt)

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

export function seedE2ERealPublications(database: Database.Database, allowed: boolean) {
  if (!allowed) throw new Error("E2E_FIXTURE_NOT_ALLOWED")
  const createdAt = now()
  const insert = database.prepare(`INSERT OR IGNORE INTO publications
    (id,tenant_id,ip_profile_id,content_account_id,platform,source,run_id,locked_script_version,
     locked_script_selection_version,title,platform_video_id,video_url,normalized_video_url,
     published_at,status,created_by_user_id,created_at)
    VALUES (?,'tenant-linjie','ip-linjie','account-linjie-wechat','wechat_channels','external',NULL,NULL,
      NULL,?,?,NULL,NULL,?,'active','user-owner',?)`)
  const publications = [
    ["e2e-publication-2", "邻居愿意长期信任的三个细节", "wx-real-002", "2026-08-11T02:00:00.000Z"],
    ["e2e-publication-3", "一次售后让我重新理解团长", "wx-real-003", "2026-08-12T02:00:00.000Z"],
    ["e2e-publication-4", "不熟悉的货为什么不能急着推", "wx-real-004", "2026-08-13T02:00:00.000Z"],
    ["e2e-publication-5", "先把小事做好再谈长期生意", "wx-real-005", "2026-08-14T02:00:00.000Z"],
  ] as const
  for (const publication of publications) insert.run(...publication, createdAt)
}

export function clearDemoData(database: Database.Database, allowed: boolean) {
  if (!allowed) throw new Error("DEMO_CLEAR_NOT_ALLOWED")
  database.transaction(() => {
    database.exec(`
      DELETE FROM review_evidence_links
        WHERE review_id IN (SELECT id FROM content_review_versions WHERE tenant_id IN (SELECT id FROM tenants WHERE data_origin='demo'));
      DELETE FROM review_generation_checkpoints WHERE tenant_id IN (SELECT id FROM tenants WHERE data_origin='demo');
      DELETE FROM tenant_memory_versions WHERE tenant_id IN (SELECT id FROM tenants WHERE data_origin='demo');
      DELETE FROM content_review_versions WHERE tenant_id IN (SELECT id FROM tenants WHERE data_origin='demo');
      DELETE FROM publication_match_versions WHERE tenant_id IN (SELECT id FROM tenants WHERE data_origin='demo');
      DELETE FROM real_metric_snapshots WHERE tenant_id IN (SELECT id FROM tenants WHERE data_origin='demo');
      DELETE FROM metric_import_row_errors
        WHERE batch_id IN (SELECT id FROM metric_import_batches WHERE tenant_id IN (SELECT id FROM tenants WHERE data_origin='demo'));
      DELETE FROM metric_import_batches WHERE tenant_id IN (SELECT id FROM tenants WHERE data_origin='demo');
      DELETE FROM publications WHERE tenant_id IN (SELECT id FROM tenants WHERE data_origin='demo');

      DELETE FROM commands WHERE run_id IN (SELECT run_id FROM creation_run_context WHERE tenant_id IN (SELECT id FROM tenants WHERE data_origin='demo'));
      DELETE FROM step_errors WHERE run_id IN (SELECT run_id FROM creation_run_context WHERE tenant_id IN (SELECT id FROM tenants WHERE data_origin='demo'));
      DELETE FROM reviews WHERE run_id IN (SELECT run_id FROM creation_run_context WHERE tenant_id IN (SELECT id FROM tenants WHERE data_origin='demo'));
      DELETE FROM metric_snapshots WHERE run_id IN (SELECT run_id FROM creation_run_context WHERE tenant_id IN (SELECT id FROM tenants WHERE data_origin='demo'));
      DELETE FROM locked_scripts WHERE run_id IN (SELECT run_id FROM creation_run_context WHERE tenant_id IN (SELECT id FROM tenants WHERE data_origin='demo'));
      DELETE FROM quality_reports WHERE run_id IN (SELECT run_id FROM creation_run_context WHERE tenant_id IN (SELECT id FROM tenants WHERE data_origin='demo'));
      DELETE FROM script_selections WHERE run_id IN (SELECT run_id FROM creation_run_context WHERE tenant_id IN (SELECT id FROM tenants WHERE data_origin='demo'));
      DELETE FROM script_batches WHERE run_id IN (SELECT run_id FROM creation_run_context WHERE tenant_id IN (SELECT id FROM tenants WHERE data_origin='demo'));
      DELETE FROM topic_selections WHERE run_id IN (SELECT run_id FROM creation_run_context WHERE tenant_id IN (SELECT id FROM tenants WHERE data_origin='demo'));
      DELETE FROM topic_batches WHERE run_id IN (SELECT run_id FROM creation_run_context WHERE tenant_id IN (SELECT id FROM tenants WHERE data_origin='demo'));
      DELETE FROM runs WHERE id IN (SELECT run_id FROM creation_run_context WHERE tenant_id IN (SELECT id FROM tenants WHERE data_origin='demo'));
      DELETE FROM creation_run_context WHERE tenant_id IN (SELECT id FROM tenants WHERE data_origin='demo');

      DELETE FROM platform_template_activation_events
        WHERE candidate_id IN (SELECT id FROM platform_structure_candidates WHERE data_origin='demo')
           OR template_version_id IN (SELECT id FROM platform_template_versions WHERE data_origin='demo');
      DELETE FROM platform_structure_previews
        WHERE candidate_id IN (SELECT id FROM platform_structure_candidates WHERE data_origin='demo');
      DELETE FROM platform_candidate_source_links
        WHERE candidate_id IN (SELECT id FROM platform_structure_candidates WHERE data_origin='demo');
      DELETE FROM platform_structure_candidates WHERE data_origin='demo';
      DELETE FROM platform_content_analysis_versions
        WHERE sample_id IN (SELECT id FROM platform_content_samples WHERE data_origin='demo');
      DELETE FROM platform_content_sample_revisions
        WHERE sample_id IN (SELECT id FROM platform_content_samples WHERE data_origin='demo');
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
