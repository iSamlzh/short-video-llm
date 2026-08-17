# 真实发布、复盘与私有记忆闭环实施计划

> **面向执行 Agent：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，逐任务执行本计划。所有步骤使用复选框（`- [ ]`）跟踪进度。

**目标：** 完成首版内容增长闭环：从不可变锁稿出发，经过真实发布凭证、确定性指标匹配、有证据边界的复盘、人工确认的租户私有记忆，并在下一次创作 Run 中可追溯地复用该记忆。

**架构：** 保留现有 Next.js Node 进程和 SQLite 数据库，将新增行为拆分为发布、导入、匹配、复盘、记忆和创作上下文模块。文件导入与模型复盘在进程内执行并持久化检查点；匹配与证据计算保持确定性，LLM 只总结服务端批准的证据集合。

**技术栈：** Next.js 16 Route Handlers、React 19、TypeScript 5.9、SQLite/better-sqlite3、Zod 4、用于 CSV/XLSX 输入的 ExcelJS 4.4.0、现有厂商中立的结构化 LLM 客户端、Vitest、Testing Library 和 Playwright。

## 全局约束

- 除非某一步明确指向仓库根目录文档，否则所有命令都在 `prototype/` 中执行。
- 生产链路固定为：`锁稿 → 发布记录 → 真实指标快照 → 确定性匹配 → 复盘版本 → 已确认记忆版本 → 下一次创作 Run`。
- 首版保持单个 Next.js Node 进程和一个 SQLite 持久卷，可部署在 4 核 8 GB 服务器上。
- 不引入 Redis、外部队列、独立 Worker、对象存储、平台 OAuth、平台数据 API、数字人生成或多实例协调。
- 单次上传严格限制为 10 MB、10,000 行数据，仅接受 `.csv` 和 `.xlsx`。
- 请求处理结束后删除上传字节；只持久化批次元数据和脱敏行错误，不保存原文件。
- 正式复盘链路拒绝模拟指标；开发 Fixture 仅在现有测试模式开关下可用。
- 匹配只能发生在完全相同的租户、IP、内容账号和平台作用域内。LLM 不得选择或修改发布匹配关系。
- 横向复盘对每条独立发布只取最新快照，同时保留全部不可变历史快照用于增长趋势分析。
- 样本分层固定为：0–2 条 `facts_only`；3–4 条 `tentative`；5 条及以上 `memory_eligible`。
- 只有当前、未失效且属于 `memory_eligible` 的复盘可以确认；只有 `review.confirm` 能力可以创建记忆。
- 已确认记忆不可变，严格限定在租户 + IP + 内容账号作用域，绝不写入平台内容大脑表。
- 创作只接收 `version`、`keep`、`avoid` 和 `nextContentSignals`；不得传入原始指标、员工身份、完整复盘历史或隐藏模型推理。
- 保留 `src/app/globals.css` 中已确认的编辑型视觉系统：结果优先、低圆角、单一强调色、无仪表盘卡片网格，并在 1100 px 和 760 px 断点正确响应。
- 全程遵守 TDD：先写聚焦的失败测试并验证 RED，再实现最小完整行为并验证 GREEN，最后提交。
- 本计划取代 `docs/superpowers/plans/2026-08-17-real-metrics-review-implementation-plan.md`；旧计划的表结构与权限假设早于已确认的详细设计。

## 文件与职责映射

| 文件 | 职责 |
|---|---|
| `src/domain/growth-loop.ts` | 发布、导入、匹配、复盘和记忆的共享类型 |
| `src/domain/growth-loop-schemas.ts` | 严格的 Zod 输入/输出 Schema 与稳定枚举 |
| `src/lib/db/migrations/007_real_publication_review_memory.sql` | 增量版本 7 表结构与谱系字段 |
| `src/lib/db/current-scope-repository.ts` | 解析并验证当前租户/IP/账号/平台作用域 |
| `src/lib/db/publication-repository.ts` | 发布记录持久化与锁稿查询 |
| `src/lib/db/metrics-repository.ts` | 批次、行错误、快照和匹配版本持久化 |
| `src/lib/db/review-memory-repository.ts` | 复盘检查点、复盘证据和不可变记忆版本 |
| `src/lib/import/spreadsheet-parser.ts` | 仅负责受限 CSV/XLSX 解析和字段归一化 |
| `src/services/publication-service.ts` | 发布授权、谱系校验和幂等 |
| `src/services/metric-import-service.ts` | 文件策略、解析、部分成功持久化和批次摘要 |
| `src/services/publication-matcher.ts` | 确定性匹配和带审计的人工处理 |
| `src/services/account-baseline-service.ts` | 同账号中位数、区间、最新快照选择和样本层级 |
| `src/services/review-service.ts` | 带检查点和证据边界的复盘生成及失效处理 |
| `src/services/tenant-memory-service.ts` | 人工确认和不可变私有记忆 |
| `src/services/creation-context-provider.ts` | 为创作 Run 获取最小化已确认记忆 |
| `src/app/api/app/publications/route.ts` | 锁稿发布回执 API |
| `src/app/api/app/metrics/[...segments]/route.ts` | Multipart 导入、批次结果和匹配处理 API |
| `src/app/api/app/reviews/[...segments]/route.ts` | 当前复盘、生成和确认 API |
| `src/components/creation/PublicationReceipt.tsx` | 已确认的锁稿正文下方内联发布回执 |
| `src/components/review/ImportOutcome.tsx` | 结果优先的批次摘要与仅异常处理队列 |
| `src/components/review/ReviewBriefView.tsx` | 事实、假设、边界和私有记忆预览 |

---

### 任务 1：增加版本 7 契约、能力项和增量表结构

**文件：**
- 新建： `prototype/src/domain/growth-loop.ts`
- 新建： `prototype/src/domain/growth-loop-schemas.ts`
- 新建： `prototype/src/lib/db/current-scope-repository.ts`
- 新建： `prototype/src/lib/db/migrations/007_real_publication_review_memory.sql`
- 修改： `prototype/src/lib/db/migrations.ts`
- 修改： `prototype/src/lib/db/database.ts`
- 修改： `prototype/src/domain/access.ts`
- 修改： `prototype/src/scripts/demo-data.ts`
- 测试： `prototype/tests/unit/growth-loop-domain.test.ts`
- 修改： `prototype/tests/unit/migrations.test.ts`
- 修改： `prototype/tests/unit/access-domain.test.ts`
- 修改： `prototype/tests/unit/demo-seed.test.ts`

**接口：**
- 输入：现有 `TenantAccessContext`、`creation_run_context`、`tenant_memory_versions`、锁稿表、当前 IP/账号上下文和迁移执行器。
- 输出：`GrowthScope`、`Publication`、`MetricImportRow`、`MetricImportResult`、`PublicationMatch`、`ContentReviewVersion`、`TenantMemoryVersion`、严格 Schema、`CurrentScopeRepository.get(context)`，以及 `publication.record`、`review.confirm` 能力项。

- [ ] **步骤 1：编写失败的契约和迁移测试**

```ts
it("adds the two explicit capabilities", () => {
  expect(capabilities).toContain("publication.record")
  expect(capabilities).toContain("review.confirm")
})

it("applies version 7 exactly once and adds creation memory lineage", () => {
  const db = openDatabase(":memory:")
  applyMigrations(db)
  applyMigrations(db)
  expect(db.prepare("SELECT COUNT(*) count FROM schema_migrations WHERE version=7").get()).toEqual({ count: 1 })
  expect((db.prepare("PRAGMA table_info(creation_run_context)").all() as Array<{ name: string }>).map(row => row.name))
    .toContain("tenant_memory_version")
  expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='publications'").get()).toBeTruthy()
  expect(db.pragma("busy_timeout", { simple: true })).toBe(5000)
})

it("keeps review confirmation out of the reviewer preset", async () => {
  const db = openDatabase(":memory:")
  await seedDemoData(db, "demo-password")
  const capabilities = db.prepare(`SELECT capability FROM membership_capabilities
    WHERE membership_id='membership-reviewer' ORDER BY capability`).all()
  expect(capabilities).not.toContainEqual({ capability: "review.confirm" })
  expect(capabilities).toContainEqual({ capability: "review.generate" })
})
```

- [ ] **步骤 2：运行聚焦测试并验证 RED**

运行：`npm test -- growth-loop-domain.test.ts migrations.test.ts access-domain.test.ts demo-seed.test.ts`

预期：FAIL，因为版本 7、新契约和两个能力项尚不存在。

- [ ] **步骤 3：定义精确的共享契约和 Schema**

```ts
export type GrowthScope = {
  tenantId: string
  ipId: string
  contentAccountId: string
  platform: string
}

export type SampleTier = "facts_only" | "tentative" | "memory_eligible"
export type MatchMethod =
  | "exact_video_id" | "exact_url" | "exact_title_time"
  | "similarity_candidate" | "manual_existing" | "manual_external_created"
export type MatchStatus = "matched" | "candidate" | "unmatched" | "rejected"

export type ConfirmedCreationMemory = {
  version: number
  keep: string[]
  avoid: string[]
  nextContentSignals: string[]
}
```

为两类发布输入、导入行归一化、带 `expectedVersion` 的候选确认、真实复盘输出和记忆确认定义严格 Zod Schema。面向 HTTP 的对象使用 `.strict()`。拒绝空字符串、无效 ISO 时间、负指标、超出 `0..1` 的完播率，以及 `isSimulated !== false`。

- [ ] **步骤 4：增加完整的增量迁移**

迁移 007 使用以下完整表与索引契约：

```sql
CREATE TABLE publications (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  ip_profile_id TEXT NOT NULL REFERENCES ip_profiles(id),
  content_account_id TEXT NOT NULL REFERENCES content_accounts(id),
  platform TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('system','external')),
  run_id TEXT,
  locked_script_version INTEGER,
  locked_script_selection_version INTEGER,
  title TEXT NOT NULL,
  platform_video_id TEXT,
  video_url TEXT,
  normalized_video_url TEXT,
  published_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','disabled')),
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  CHECK(source='external' OR (run_id IS NOT NULL AND locked_script_version IS NOT NULL AND locked_script_selection_version IS NOT NULL))
);
CREATE UNIQUE INDEX uq_publication_video_id ON publications(tenant_id,content_account_id,platform,platform_video_id)
  WHERE platform_video_id IS NOT NULL AND status='active';
CREATE UNIQUE INDEX uq_publication_url ON publications(tenant_id,content_account_id,platform,normalized_video_url)
  WHERE normalized_video_url IS NOT NULL AND status='active';

CREATE TABLE metric_import_batches (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  ip_profile_id TEXT NOT NULL REFERENCES ip_profiles(id),
  content_account_id TEXT NOT NULL REFERENCES content_accounts(id),
  platform TEXT NOT NULL,
  filename TEXT NOT NULL,
  file_sha256 TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('processing','parsed','matched','review_ready','completed','failed')),
  total_rows INTEGER NOT NULL DEFAULT 0,
  inserted_rows INTEGER NOT NULL DEFAULT 0,
  duplicate_rows INTEGER NOT NULL DEFAULT 0,
  error_rows INTEGER NOT NULL DEFAULT 0,
  candidate_rows INTEGER NOT NULL DEFAULT 0,
  unmatched_rows INTEGER NOT NULL DEFAULT 0,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id,content_account_id,file_sha256)
);

CREATE TABLE metric_import_row_errors (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES metric_import_batches(id),
  row_number INTEGER NOT NULL,
  error_code TEXT NOT NULL,
  message TEXT NOT NULL,
  redacted_reference TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(batch_id,row_number,error_code)
);

CREATE TABLE real_metric_snapshots (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  ip_profile_id TEXT NOT NULL REFERENCES ip_profiles(id),
  content_account_id TEXT NOT NULL REFERENCES content_accounts(id),
  platform TEXT NOT NULL,
  platform_content_key TEXT NOT NULL,
  platform_video_id TEXT,
  video_url TEXT,
  normalized_video_url TEXT,
  title TEXT NOT NULL,
  published_at TEXT,
  captured_at TEXT NOT NULL,
  impressions INTEGER CHECK(impressions IS NULL OR impressions>=0),
  plays INTEGER CHECK(plays IS NULL OR plays>=0),
  completions INTEGER CHECK(completions IS NULL OR completions>=0),
  completion_rate REAL CHECK(completion_rate IS NULL OR (completion_rate>=0 AND completion_rate<=1)),
  likes INTEGER CHECK(likes IS NULL OR likes>=0),
  comments INTEGER CHECK(comments IS NULL OR comments>=0),
  saves INTEGER CHECK(saves IS NULL OR saves>=0),
  shares INTEGER CHECK(shares IS NULL OR shares>=0),
  inquiries INTEGER CHECK(inquiries IS NULL OR inquiries>=0),
  negative_feedback INTEGER CHECK(negative_feedback IS NULL OR negative_feedback>=0),
  is_simulated INTEGER NOT NULL CHECK(is_simulated=0),
  source_batch_id TEXT NOT NULL REFERENCES metric_import_batches(id),
  source_row_number INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(tenant_id,content_account_id,platform_content_key,captured_at)
);

CREATE TABLE publication_match_versions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  ip_profile_id TEXT NOT NULL REFERENCES ip_profiles(id),
  content_account_id TEXT NOT NULL REFERENCES content_accounts(id),
  snapshot_id TEXT NOT NULL REFERENCES real_metric_snapshots(id),
  publication_id TEXT REFERENCES publications(id),
  candidate_ids_json TEXT NOT NULL,
  method TEXT NOT NULL CHECK(method IN ('exact_video_id','exact_url','exact_title_time','similarity_candidate','manual_existing','manual_external_created')),
  status TEXT NOT NULL CHECK(status IN ('matched','candidate','unmatched','rejected')),
  explanation TEXT NOT NULL,
  version INTEGER NOT NULL,
  is_current INTEGER NOT NULL CHECK(is_current IN (0,1)),
  confirmed_by_user_id TEXT REFERENCES users(id),
  confirmed_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(snapshot_id,version)
);
CREATE UNIQUE INDEX uq_current_publication_match ON publication_match_versions(snapshot_id) WHERE is_current=1;

CREATE TABLE review_generation_checkpoints (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  ip_profile_id TEXT NOT NULL REFERENCES ip_profiles(id),
  content_account_id TEXT NOT NULL REFERENCES content_accounts(id),
  evidence_set_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','running','completed','failed')),
  review_id TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id,ip_profile_id,content_account_id,evidence_set_hash)
);

CREATE TABLE content_review_versions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  ip_profile_id TEXT NOT NULL REFERENCES ip_profiles(id),
  content_account_id TEXT NOT NULL REFERENCES content_accounts(id),
  version INTEGER NOT NULL,
  sample_tier TEXT NOT NULL CHECK(sample_tier IN ('facts_only','tentative','memory_eligible')),
  evidence_cutoff_at TEXT NOT NULL,
  evidence_set_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  model TEXT,
  prompt_version INTEGER NOT NULL,
  token_usage_json TEXT,
  status TEXT NOT NULL CHECK(status IN ('generated','superseded','confirmed')),
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE(tenant_id,ip_profile_id,content_account_id,version),
  UNIQUE(tenant_id,ip_profile_id,content_account_id,evidence_set_hash)
);

CREATE TABLE review_evidence_links (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL REFERENCES content_review_versions(id),
  publication_id TEXT NOT NULL REFERENCES publications(id),
  snapshot_id TEXT NOT NULL REFERENCES real_metric_snapshots(id),
  purpose TEXT NOT NULL CHECK(purpose IN ('observation','hypothesis_for','hypothesis_against','baseline')),
  created_at TEXT NOT NULL,
  UNIQUE(review_id,snapshot_id,purpose)
);

ALTER TABLE tenant_memory_versions ADD COLUMN source_review_id TEXT;
ALTER TABLE tenant_memory_versions ADD COLUMN content_hash TEXT;
ALTER TABLE tenant_memory_versions ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE creation_run_context ADD COLUMN tenant_memory_version INTEGER;

CREATE UNIQUE INDEX uq_memory_review_hash ON tenant_memory_versions(source_review_id,content_hash)
  WHERE source_review_id IS NOT NULL AND content_hash IS NOT NULL;
CREATE INDEX idx_publications_scope_time ON publications(tenant_id,ip_profile_id,content_account_id,platform,published_at);
CREATE INDEX idx_snapshots_scope_time ON real_metric_snapshots(tenant_id,ip_profile_id,content_account_id,captured_at);
CREATE INDEX idx_batches_scope_time ON metric_import_batches(tenant_id,ip_profile_id,content_account_id,created_at);
CREATE INDEX idx_reviews_scope_version ON content_review_versions(tenant_id,ip_profile_id,content_account_id,version);
```

保留现有 `imported_content_metrics` 数据。当前演示行缺少可靠的平台内容键和发布时间，因此版本 7 不得把它们迁入正式快照/复盘链路。在 `openDatabase` 中，除现有 WAL 和外键设置外，再设置 `database.pragma("busy_timeout = 5000")`。

- [ ] **步骤 5：增加当前作用域解析和角色默认能力**

```ts
export class CurrentScopeRepository {
  constructor(private readonly database: Database.Database) {}
  get(context: TenantAccessContext): GrowthScope {
    const row = this.database.prepare(`SELECT c.ip_profile_id, c.content_account_id, a.platform
      FROM user_current_context c JOIN content_accounts a ON a.id=c.content_account_id
      WHERE c.user_id=? AND c.tenant_id=? AND a.status='active'`).get(context.userId, context.tenantId) as {
        ip_profile_id: string
        content_account_id: string
        platform: string
      } | undefined
    if (!row) throw Object.assign(new Error("CURRENT_ACCOUNT_REQUIRED"), { code: "CURRENT_ACCOUNT_REQUIRED" })
    requireTenantCapability(context, "ip.view", { ipId: row.ip_profile_id, contentAccountId: row.content_account_id })
    return { tenantId: context.tenantId, ipId: row.ip_profile_id, contentAccountId: row.content_account_id, platform: row.platform }
  }
}
```

Owner 获得两个新能力；Operator 获得 `publication.record`；Reviewer 保留导入、生成和查看能力，但默认不获得 `review.confirm`。继续允许 Owner 通过 `TeamService` 把 `review.confirm` 委派给指定成员。

- [ ] **步骤 6：验证 GREEN 并提交**

运行：`npm test -- growth-loop-domain.test.ts migrations.test.ts access-domain.test.ts demo-seed.test.ts`

预期：PASS，包括重复执行迁移和演示数据幂等初始化。

```bash
git add src/domain/growth-loop.ts src/domain/growth-loop-schemas.ts src/domain/access.ts src/lib/db/current-scope-repository.ts src/lib/db/database.ts src/lib/db/migrations.ts src/lib/db/migrations/007_real_publication_review_memory.sql src/scripts/demo-data.ts tests/unit/growth-loop-domain.test.ts tests/unit/migrations.test.ts tests/unit/access-domain.test.ts tests/unit/demo-seed.test.ts
git commit -m "feat: add real growth loop contracts and schema"
```

### 任务 2：记录带锁稿谱系的系统发布和外部发布

**文件：**
- 新建： `prototype/src/lib/db/publication-repository.ts`
- 新建： `prototype/src/services/publication-service.ts`
- 测试： `prototype/tests/unit/publication-service.test.ts`

**接口：**
- 输入：`CurrentScopeRepository`、`requireTenantCapability`、`locked_scripts`、`creation_run_context`、`content_accounts` 和 `audit_logs`。
- 输出：`PublicationService.recordSystem(context, input)`、`createExternal(context, input)`、`supplementIdentity(context, publicationId, input)`、`disable(context, publicationId, reason)`、`getByCurrentLock(context, runId, lockedVersion)`，以及匹配模块所需的仓储查询。

- [ ] **步骤 1：编写失败的发布谱系测试**

```ts
it("reads the title from the exact locked version and ignores client title", () => {
  const publication = service.recordSystem(owner, {
    runId: "run-1", lockedVersion: 2, contentAccountId: accountId,
    platformVideoId: "wx-100", publishedAt: "2026-08-17T08:00:00.000Z",
  })
  expect(publication).toMatchObject({ source: "system", title: "锁稿第二版", lockedVersion: 2 })
})

it("returns the same record for the same account and video id", () => {
  const first = service.recordSystem(owner, validInput)
  const second = service.recordSystem(owner, validInput)
  expect(second.id).toBe(first.id)
})

it("allows one lock to be recorded on two assigned platform accounts", () => {
  expect(service.recordSystem(owner, { ...validInput, contentAccountId: wechatId }).id)
    .not.toBe(service.recordSystem(owner, { ...validInput, contentAccountId: douyinId, platformVideoId: "dy-1" }).id)
})

it("rejects an operator without publication.record or outside the run scope", () => {
  expect(() => service.recordSystem({ ...operator, capabilities: [] }, validInput)).toThrow("CAPABILITY_FORBIDDEN")
  expect(() => service.recordSystem({ ...operator, ipIds: [] }, validInput)).toThrow("RUN_NOT_FOUND")
})

it("supplements a title/time external record without changing its id", () => {
  const external = service.createExternal(reviewer, titleTimeInput)
  const supplemented = service.supplementIdentity(reviewer, external.id, { platformVideoId: "wx-history-1" })
  expect(supplemented).toMatchObject({ id: external.id, platformVideoId: "wx-history-1" })
})

it("excludes a disabled publication from future matching", () => {
  const publication = service.recordSystem(owner, validInput)
  service.disable(owner, publication.id, "平台作品已删除")
  expect(repository.findActiveByVideoId(scope, "wx-100")).toBeNull()
})
```

- [ ] **步骤 2：运行并验证 RED**

运行：`npm test -- publication-service.test.ts`

预期：FAIL，因为仓储和服务尚不存在。

- [ ] **步骤 3：实现发布持久化和 URL 规范化**

```ts
export function normalizeVideoUrl(value: string) {
  const url = new URL(value)
  url.hostname = url.hostname.toLowerCase()
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) url.searchParams.delete(key)
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/$/, "")
  return url.toString()
}
```

不得解析或展开短链接。`PublicationRepository` 只返回有效候选，提供精确 ID、URL 和标题时间窗查询，并把相关写入放入一个本地事务。发生唯一键冲突时，如请求完全相同则读取并返回已有记录；如同一身份指向另一锁稿或发布记录，则抛出 `PUBLICATION_ID_CONFLICT` 或 `PUBLICATION_URL_CONFLICT`。

- [ ] **步骤 4：实现系统发布和外部发布策略**

`recordSystem` 要求 `publication.record`、已授权 IP/账号、视频 ID 或 URL 之一、可访问的 `creation_run_context`，以及精确的 `locked_scripts(run_id, version)`。标题和 `script_selection_version` 必须从锁稿复制。`createExternal` 要求 `metrics.import`、标题 + 发布时间，并至少具备视频 ID、URL 或明确的标题/时间外部身份。`supplementIdentity` 在冲突校验后为同一外部记录补充 ID 或 URL。`disable` 保留数据与谱系，但把记录排除在有效匹配之外。创建、补充和停用均写入脱敏 `audit_logs`。

- [ ] **步骤 5：验证 GREEN 并提交**

运行：`npm test -- publication-service.test.ts creation-lineage.test.ts`

预期：PASS，且现有创作谱系行为不发生变化。

```bash
git add src/lib/db/publication-repository.ts src/services/publication-service.ts tests/unit/publication-service.test.ts
git commit -m "feat: record published locked scripts"
```

### 任务 3：解析受限 CSV/XLSX 并持久化部分成功结果

**文件：**
- 修改： `prototype/package.json`
- 修改： `prototype/package-lock.json`
- 新建： `prototype/src/lib/import/spreadsheet-parser.ts`
- 新建： `prototype/src/lib/db/metrics-repository.ts`
- 新建： `prototype/src/services/metric-import-service.ts`
- 测试： `prototype/tests/unit/spreadsheet-parser.test.ts`
- 测试： `prototype/tests/unit/metric-import-service.test.ts`

**接口：**
- 输入：精确 `GrowthScope`、`metrics.import`、请求文件字节和版本 7 的批次/快照/错误表。
- 输出：`parseMetricFile(input): Promise<ParsedMetricFile>`、`MetricImportService.import(context, input): Promise<MetricImportResult>`，以及供匹配使用的不可变真实快照。

- [ ] **步骤 1：安装固定版本的表格解析依赖**

运行：`npm install --save-exact exceljs@4.4.0`

预期：依赖中出现 `exceljs: "4.4.0"`，锁文件同步更新。使用[官方 ExcelJS v4.4.0 Workbook API](https://github.com/exceljs/exceljs/releases/tag/v4.4.0)，不得把上传文件写入磁盘。

- [ ] **步骤 2：编写失败的解析和部分成功测试**

```ts
it("normalizes Chinese CSV headers and percentage values", async () => {
  const result = await parseMetricFile({ filename: "视频号.csv", mimeType: "text/csv", bytes: Buffer.from(
    "作品ID,标题,发布时间,采集时间,播放量,完播率\nwx-1,邻里约定,2026-08-10 10:00,2026-08-17 10:00,1200,35%",
  ) })
  expect(result.validRows[0]).toMatchObject({ platformVideoId: "wx-1", title: "邻里约定", plays: 1200, completionRate: 0.35, isSimulated: false })
})

it("accepts valid XLSX rows and reports a negative metric by row", async () => {
  const bytes = await makeWorkbookBuffer([
    ["视频链接", "标题", "发布时间", "播放量"],
    ["https://example.test/v/1", "真实经历", "2026-08-10T08:00:00+08:00", 300],
    ["https://example.test/v/2", "错误行", "2026-08-10T08:00:00+08:00", -1],
  ])
  const result = await parseMetricFile({ filename: "metrics.xlsx", mimeType: xlsxMime, bytes })
  expect(result.validRows).toHaveLength(1)
  expect(result.errors).toEqual([expect.objectContaining({ rowNumber: 3, code: "PLAYS_INVALID" })])
})

it("persists valid rows when another row is invalid", async () => {
  const result = await service.import(reviewer, mixedFile)
  expect(result).toMatchObject({ inserted: 1, errors: 1, status: "parsed" })
  expect(repository.listSnapshots(result.batchId)).toHaveLength(1)
})
```

- [ ] **步骤 3：运行并验证 RED**

运行：`npm test -- spreadsheet-parser.test.ts metric-import-service.test.ts`

预期：FAIL，因为解析和持久化模块尚不存在。

- [ ] **步骤 4：实现精确的文件和行级策略**

`parseMetricFile` 必须：

- 在解析 Workbook 之前，字节数超过 `10 * 1024 * 1024` 时返回 `FILE_TOO_LARGE`；
- 扩展名不是 `.csv` 或 `.xlsx` 时返回 `FILE_TYPE_UNSUPPORTED`；
- 接受 MIME：`text/csv`、`application/csv`、`application/vnd.ms-excel` 和 `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`；浏览器发送空 MIME 或通用 MIME 时，必须同时满足有效扩展名和解析器签名，不能只信任 MIME；
- 数据行超过 10,000 时返回 `ROW_LIMIT_EXCEEDED`；
- 归一化已确认详细设计第 6 节中的字段别名；
- 每行必须有标题，并具备一种身份形式：ID、URL 或标题 + 发布时间；
- 计数仅接受非负整数，比率接受 `0.35` 或 `35%`；
- 日期统一转换为 UTC ISO，同时为错误保留脱敏的原始引用；
- 在服务层以 `platform|accountId|normalizedTitle|publishedAt` 的 SHA-256 生成仅标题/时间键，但该键永远不得作为自动匹配依据。

返回以下精确结构：

```ts
type ParsedMetricFile = {
  validRows: MetricImportRow[]
  errors: Array<{ rowNumber: number; code: string; message: string; redactedReference: string }>
  totalRows: number
}
```

- [ ] **步骤 5：实现批次幂等和不可变快照**

`MetricImportService.import` 必须在解析字节前校验当前账号的 `metrics.import`。服务计算文件哈希；相同账号 + SHA-256 返回已有批次；新批次以 `processing` 创建；有效快照以 `is_simulated=0` 写入；重复和行错误分别记录；最后转为 `parsed`；任何时候都不保存 `bytes`。解析器级致命错误把批次转为 `failed`，行级错误不得回滚有效快照。

- [ ] **步骤 6：验证 GREEN 并提交**

运行：`npm test -- spreadsheet-parser.test.ts metric-import-service.test.ts`

预期：CSV、XLSX、大小/类型/行数限制、重复导入和部分成功测试全部 PASS。

```bash
git add package.json package-lock.json src/lib/import/spreadsheet-parser.ts src/lib/db/metrics-repository.ts src/services/metric-import-service.ts tests/unit/spreadsheet-parser.test.ts tests/unit/metric-import-service.test.ts
git commit -m "feat: import immutable real metric snapshots"
```

### 任务 4：确定性匹配指标并审计人工处理

**文件：**
- 新建： `prototype/src/services/publication-matcher.ts`
- 修改： `prototype/src/services/metric-import-service.ts`
- 修改： `prototype/src/lib/db/metrics-repository.ts`
- 修改： `prototype/src/lib/db/publication-repository.ts`
- 测试： `prototype/tests/unit/publication-matcher.test.ts`
- 修改： `prototype/tests/unit/metric-import-service.test.ts`

**接口：**
- 输入：已归一化快照、有效发布候选、`PublicationService.createExternal` 和 `expectedVersion`。
- 输出：`PublicationMatcher.matchBatch(context, batchId)`、`confirmCandidate(context, matchId, publicationId, expectedVersion)` 和 `rejectCandidateAndCreateExternal(context, matchId, expectedVersion)`。

- [ ] **步骤 1：编写失败的优先级、歧义和并发测试**

```ts
it("uses ID, then URL, then one exact title inside ±7 days", () => {
  expect(matcher.decide(idRow, candidates).method).toBe("exact_video_id")
  expect(matcher.decide(urlRow, candidates).method).toBe("exact_url")
  expect(matcher.decide(titleRow, oneCandidateInsideWindow).method).toBe("exact_title_time")
})

it("never auto-binds two exact-title candidates", () => {
  expect(matcher.decide(titleRow, twoCandidatesInsideWindow)).toMatchObject({ status: "candidate" })
})

it("keeps similarity as a human candidate", () => {
  expect(matcher.decide({ ...titleRow, title: "楼道邻里之间的一份约定" }, candidates)).toMatchObject({
    status: "candidate", method: "similarity_candidate",
  })
})

it("rejects a stale human confirmation", () => {
  expect(() => matcher.confirmCandidate(reviewer, matchId, publicationId, 1)).toThrow("MATCH_VERSION_CONFLICT")
})
```

- [ ] **步骤 2：运行并验证 RED**

运行：`npm test -- publication-matcher.test.ts metric-import-service.test.ts`

预期：FAIL，因为匹配决策和版本化确认尚未实现。

- [ ] **步骤 3：实现精确归一化和决策顺序**

标题采用 Unicode NFKC、拉丁字符小写、空白折叠，并且只移除首尾标点。精确标题匹配要求在包含边界的 ±7 天窗口内只有一个有效候选。相似度对双字符 Shingle 计算确定性 Dice 分数；±30 天内分数不低于 `0.72` 时最多给出三个排序候选，但永远不能直接成为 `matched`。没有候选时才进入 `unmatched`。

```ts
type MatchDecision = {
  status: MatchStatus
  method: MatchMethod
  publicationId?: string
  candidateIds: string[]
  explanation: string
}
```

- [ ] **步骤 4：持久化只追加的匹配版本并审计人工变更**

对每个快照，在同一事务中把旧行标记为 `is_current=0` 并追加下一版本。人工处理要求 `metrics.import` 和正确作用域，比较 `expectedVersion`，并向 `audit_logs` 写入 `metrics.match.confirmed` 或 `metrics.match.external_created`。候选可以绑定已有有效发布，也可以基于不可变导入身份创建外部发布记录。

- [ ] **步骤 5：连接导入完成与匹配，且不阻断有效行**

解析完成后，`MetricImportService.import` 调用 `matchBatch`、更新计数，并依次转为 `matched` 和 `review_ready`。候选和未匹配行保持可见，精确匹配数据继续向复盘推进。单条匹配失败只写入行级错误，不得撤销其他已匹配快照。

- [ ] **步骤 6：验证 GREEN 并提交**

运行：`npm test -- publication-matcher.test.ts metric-import-service.test.ts publication-service.test.ts`

预期：优先级、歧义、相似候选、外部创建、审计、版本冲突和部分继续全部 PASS。

```bash
git add src/services/publication-matcher.ts src/services/metric-import-service.ts src/lib/db/metrics-repository.ts src/lib/db/publication-repository.ts tests/unit/publication-matcher.test.ts tests/unit/metric-import-service.test.ts
git commit -m "feat: match imported metrics deterministically"
```

### 任务 5：生成带检查点和证据边界的真实复盘

**文件：**
- 修改： `prototype/src/domain/schemas.ts`
- 新建： `prototype/src/prompts/real-review.ts`
- 修改： `prototype/src/prompts/index.ts`
- 修改： `prototype/src/lib/llm/adapter.ts`
- 修改： `prototype/src/lib/llm/structured.ts`
- 修改： `prototype/src/lib/llm/fake.ts`
- 新建： `prototype/src/services/account-baseline-service.ts`
- 新建： `prototype/src/lib/db/review-memory-repository.ts`
- 新建： `prototype/src/services/review-service.ts`
- 修改： `prototype/src/lib/db/metrics-repository.ts`
- 测试： `prototype/tests/unit/account-baseline-service.test.ts`
- 测试： `prototype/tests/unit/real-review-schema.test.ts`
- 测试： `prototype/tests/unit/review-service.test.ts`
- 修改： `prototype/tests/unit/llm.test.ts`

**接口：**
- 输入：每条发布的最新已匹配真实快照、IP 表达边界、结构化 LLM 和复盘检查点。
- 输出：`AccountBaselineService.build(scope)`、LLM 操作 `real_review`、`StructuredLlmResult<T>`、`ReviewService.generateCurrent(context, contentAccountId)`、`getCurrent(context, contentAccountId)`、`getHistory(context, contentAccountId)` 和不可变证据链接。

- [ ] **步骤 1：编写失败的基线、层级、证据和重试测试**

```ts
it.each([[2, "facts_only"], [3, "tentative"], [4, "tentative"], [5, "memory_eligible"]])(
  "%i unique publications produce %s", (count, tier) => expect(buildBaseline(count).sampleTier).toBe(tier),
)

it("uses only the latest snapshot of each publication for horizontal review", () => {
  const baseline = service.build(scopeWithTwoSnapshotsForOnePublication)
  expect(baseline.latestSnapshots).toEqual([expect.objectContaining({ capturedAt: latestTime })])
  expect(baseline.history).toHaveLength(2)
})

it("does not call the model for facts_only", async () => {
  const review = await reviews.generateCurrent(owner, accountId)
  expect(review.sampleTier).toBe("facts_only")
  expect(adapter.calls).toHaveLength(0)
})

it("rejects an evidence id that was not in the server input", async () => {
  adapter.enqueue({ json: reviewFixture({ evidenceSnapshotIds: ["invented"] }) })
  await expect(reviews.generateCurrent(owner, accountId)).rejects.toMatchObject({ code: "MODEL_EVIDENCE_INVALID" })
})

it("reuses an existing review with the same evidence-set hash", async () => {
  const first = await reviews.generateCurrent(owner, accountId)
  const second = await reviews.generateCurrent(owner, accountId)
  expect(second.id).toBe(first.id)
  expect(adapter.calls.filter(call => call.operation === "real_review")).toHaveLength(1)
})

it("keeps immutable review history after a newer evidence set arrives", async () => {
  const first = await reviews.generateCurrent(owner, accountId)
  appendNewMatchedSnapshot()
  const second = await reviews.generateCurrent(owner, accountId)
  expect(reviews.getHistory(owner, accountId).map(item => item.id)).toEqual([second.id, first.id])
})
```

- [ ] **步骤 2：运行并验证 RED**

运行：`npm test -- account-baseline-service.test.ts real-review-schema.test.ts review-service.test.ts llm.test.ts`

预期：FAIL，因为真实复盘操作、元数据结果、检查点和服务尚不存在。

- [ ] **步骤 3：增加精确的真实复盘 Schema 和 Prompt**

```ts
export const realContentReviewSchema = z.object({
  headline: z.string().min(5),
  observations: z.array(z.object({ text: z.string().min(5), evidenceSnapshotIds: z.array(z.string().min(1)).min(1) })),
  hypotheses: z.array(z.object({
    text: z.string().min(5), confidence: z.enum(["low", "medium"]),
    evidenceFor: z.array(z.string()), evidenceAgainst: z.array(z.string()),
  })),
  keep: z.array(z.string().min(2)),
  avoid: z.array(z.string().min(2)),
  nextContentSignals: z.array(z.string().min(2)),
  evidenceLimits: z.string().min(10),
}).strict()
```

把 `real_review` 加入 `LlmOperation` 和 `prompts`。System Prompt 必须要求只返回 JSON，禁止因果断言、禁止编造缺失指标、把证据 ID 限定在输入白名单内，并将假设置信度限制为 `low|medium`。

- [ ] **步骤 4：在不破坏现有调用方的前提下保留模型与 Token 元数据**

```ts
export type StructuredLlmResult<T> = { data: T; model: string; usage?: TokenUsage }

type GenerateOptions<T> = {
  adapter: LlmAdapter
  operation: Exclude<LlmOperation, "repair">
  input: unknown
  schema: z.ZodType<T>
  timeoutMs: number
  jsonRoot?: "object" | "array"
}

function combineUsage(first?: TokenUsage, repaired?: TokenUsage): TokenUsage | undefined {
  if (!first && !repaired) return undefined
  return {
    promptTokens: (first?.promptTokens ?? 0) + (repaired?.promptTokens ?? 0),
    completionTokens: (first?.completionTokens ?? 0) + (repaired?.completionTokens ?? 0),
    totalTokens: (first?.totalTokens ?? 0) + (repaired?.totalTokens ?? 0),
  }
}

export async function generateStructuredResult<T>(options: GenerateOptions<T>): Promise<StructuredLlmResult<T>> {
  const first = await options.adapter.generate({
    operation: options.operation, systemPrompt: prompts[options.operation], input: options.input,
    timeoutMs: options.timeoutMs, jsonRoot: options.jsonRoot,
  })
  const checked = validate(options.schema, first.text)
  if (checked.success) return { data: checked.data, model: first.model, usage: first.usage }
  const repaired = await options.adapter.generate({
    operation: "repair", systemPrompt: "只修复 JSON 结构，使其满足字段约束；不要添加解释。",
    input: { original: first.text, issues: checked.issues }, timeoutMs: options.timeoutMs, jsonRoot: options.jsonRoot,
  })
  const repairedChecked = validate(options.schema, repaired.text)
  if (!repairedChecked.success) throw Object.assign(new Error("模型结构化输出修复失败"), { code: "MODEL_SCHEMA_INVALID", retryable: true })
  return { data: repairedChecked.data, model: repaired.model, usage: combineUsage(first.usage, repaired.usage) }
}

export async function generateStructured<T>(options: GenerateOptions<T>): Promise<T> {
  return (await generateStructuredResult(options)).data
}
```

增加 `StructuredLlmClient.generateStructuredResult`；保留现有 `generateStructured` 签名，避免影响创作测试。发生 Repair 时，保存最终模型和合并后的可用 Usage，而不是无效原始响应。

- [ ] **步骤 5：实现确定性基线与证据集合哈希**

只使用当前账号和兼容内容类型计算中位数与分位区间。结果包含缺失字段标记、独立发布数量、最新快照、完整历史快照，以及对排序后 `publicationId:snapshotId` 计算的 SHA-256。分母缺失时不得计算转化率。

- [ ] **步骤 6：实现检查点、生成、复用和失效**

`generateCurrent` 要求 `review.generate`，拒绝任何模拟快照；0–2 条样本只返回确定性事实而不调用 LLM；其他层级按证据哈希创建或复用检查点。保存模型、Prompt 版本、Token Usage、证据截止时间、Payload 和逐条证据链接。新数据或匹配变更导致哈希变化时，把未确认旧复盘标记为 `superseded`。复盘持久化后，把同作用域内符合条件的 `review_ready` 批次标记为 `completed`；超时、Schema 或证据错误时保持 `review_ready`，检查点保存稳定错误码，重试不需要重新上传。`getCurrent` 和 `getHistory` 要求 `review.view`，不得返回跨作用域数据。

- [ ] **步骤 7：验证 GREEN 并提交**

运行：`npm test -- account-baseline-service.test.ts real-review-schema.test.ts review-service.test.ts llm.test.ts`

预期：全部层级、最新快照选择、模型边界、证据白名单、单次 Repair、检查点复用、重试和失效测试均 PASS。

```bash
git add src/domain/schemas.ts src/prompts/real-review.ts src/prompts/index.ts src/lib/llm/adapter.ts src/lib/llm/structured.ts src/lib/llm/fake.ts src/services/account-baseline-service.ts src/lib/db/metrics-repository.ts src/lib/db/review-memory-repository.ts src/services/review-service.ts tests/unit/account-baseline-service.test.ts tests/unit/real-review-schema.test.ts tests/unit/review-service.test.ts tests/unit/llm.test.ts
git commit -m "feat: generate evidence-bounded real reviews"
```

### 任务 6：确认不可变记忆，并把精确版本回流到创作

**文件：**
- 新建： `prototype/src/services/tenant-memory-service.ts`
- 新建： `prototype/src/services/creation-context-provider.ts`
- 修改： `prototype/src/lib/db/review-memory-repository.ts`
- 修改： `prototype/src/lib/db/creation-lineage-repository.ts`
- 修改： `prototype/src/services/creation-app-service.ts`
- 修改： `prototype/src/services/auto-creation-orchestrator.ts`
- 修改： `prototype/src/services/run-service.ts`
- 修改： `prototype/src/services/creation-presenter.ts`
- 修改： `prototype/src/lib/llm/fake.ts`
- 测试： `prototype/tests/unit/tenant-memory-service.test.ts`
- 测试： `prototype/tests/unit/creation-memory-integration.test.ts`
- 修改： `prototype/tests/unit/creation-lineage.test.ts`
- 修改： `prototype/tests/unit/creation-app-service.test.ts`

**接口：**
- 输入：`review.confirm`、当前 `memory_eligible` 复盘、`CreationContextProvider.getCurrent/getVersion` 和现有创作链路。
- 输出：不可变 `TenantMemoryVersion`、创作输入 `tenantMemory`、持久化的 `tenant_memory_version` 和轻量 `memoryInfluence` 展示对象。

- [ ] **步骤 1：编写失败的确认和创作谱系测试**

```ts
it("requires review.confirm and at least five unique matched videos", () => {
  expect(() => memory.confirm(reviewerWithoutConfirm, validInput)).toThrow("CAPABILITY_FORBIDDEN")
  expect(() => memory.confirm(owner, tentativeReviewInput)).toThrow("MEMORY_SAMPLE_INSUFFICIENT")
})

it("is idempotent for one review and one edited payload", () => {
  const first = memory.confirm(owner, validInput)
  const second = memory.confirm(owner, validInput)
  expect(second.id).toBe(first.id)
})

it("passes only confirmed minimal memory to the next creation call", async () => {
  await creation.create(owner)
  expect(adapter.calls.find(call => call.operation === "auto_draft")?.input).toMatchObject({
    tenantMemory: { version: 2, keep: expect.any(Array), avoid: expect.any(Array), nextContentSignals: expect.any(Array) },
  })
  expect(JSON.stringify(adapter.calls[0].input)).not.toContain("rawMetrics")
})

it("pins the memory version used by the run", async () => {
  const created = await creation.create(owner)
  expect(lineage.get(created.runId).tenantMemoryVersion).toBe(2)
  confirmMemoryVersion3()
  expect(lineage.get(created.runId).tenantMemoryVersion).toBe(2)
})
```

- [ ] **步骤 2：运行并验证 RED**

运行：`npm test -- tenant-memory-service.test.ts creation-memory-integration.test.ts creation-lineage.test.ts creation-app-service.test.ts`

预期：FAIL，因为确认服务和创作记忆上下文尚不存在。

- [ ] **步骤 3：实现带权限保护的不可变确认**

`TenantMemoryService.confirm` 在同一事务中校验 `review.confirm`、精确作用域、`memory_eligible`、`generated` 状态和当前证据集合哈希。只接受对 `keep`、`avoid` 和 `nextContentSignals` 的编辑；`evidenceLimits` 从复盘复制；计算稳定内容哈希；同一复盘 + 哈希返回已有行，否则分配下一作用域版本、把复盘标记为 `confirmed`，并向 `audit_logs` 写入 `review.memory.confirmed`。

- [ ] **步骤 4：增加最小化记忆读取和固定 Run 谱系**

```ts
export class CreationContextProvider {
  getCurrent(scope: GrowthScope): ConfirmedCreationMemory | null
  getVersion(scope: GrowthScope, version: number): ConfirmedCreationMemory | null
}
```

扩展 `CreationLineageRepository.attach` 及其映射结果，增加 `tenantMemoryVersion: number | null`。该值只在 Run 绑定时写入一次，之后不得回填或更新。

- [ ] **步骤 5：把记忆传入生成链路，但不耦合平台模板**

把函数签名精确调整为：

```ts
AutoCreationOrchestrator.createUsableDraft(profile, adjustment?, tenantMemory?: ConfirmedCreationMemory)
RunService.generateAutoDraft(runId, inputVersion, tenantMemory?: ConfirmedCreationMemory)
RunService.generateTopicDraft(runId, inputVersion, topics, selectedTopicId, adjustment, tenantMemory?: ConfirmedCreationMemory)
```

只在 LLM 输入中把 `tenantMemory` 放在 IP 画像旁；不得修改内容大脑仓储或平台模板排序表。`CreationAppService` 在生成前读取记忆，在 Run 创建后绑定其版本，并在展示历史 Run 时通过 `getVersion` 读取当时使用的版本。

- [ ] **步骤 6：展示轻量且真实的影响摘要**

`presentCreationDraft(view, memory?)` 返回：

```ts
memoryInfluence: memory ? {
  version: memory.version,
  summary: [...memory.keep.slice(0, 1), ...memory.nextContentSignals.slice(0, 1)].join("；"),
} : null
```

除非 `keep` 或 Signal 摘要能够支持，否则展示层不得声称记忆影响了某个具体词句。

- [ ] **步骤 7：验证 GREEN 并提交**

运行：`npm test -- tenant-memory-service.test.ts creation-memory-integration.test.ts creation-lineage.test.ts creation-app-service.test.ts auto-creation-orchestrator.test.ts`

预期：权限、样本门槛、失效复盘拒绝、幂等、最小 Prompt 输入、精确 Run 谱系和平台模板零写入测试均 PASS。

```bash
git add src/services/tenant-memory-service.ts src/services/creation-context-provider.ts src/lib/db/review-memory-repository.ts src/lib/db/creation-lineage-repository.ts src/services/creation-app-service.ts src/services/auto-creation-orchestrator.ts src/services/run-service.ts src/services/creation-presenter.ts src/lib/llm/fake.ts tests/unit/tenant-memory-service.test.ts tests/unit/creation-memory-integration.test.ts tests/unit/creation-lineage.test.ts tests/unit/creation-app-service.test.ts
git commit -m "feat: apply confirmed private memory to creation"
```

### 任务 7：提供严格的发布、导入、匹配、复盘和记忆 API

**文件：**
- 新建： `prototype/src/services/growth-loop-service-factory.ts`
- 新建： `prototype/src/app/api/app/publications/route.ts`
- 新建： `prototype/src/app/api/app/metrics/[...segments]/route.ts`
- 新建： `prototype/src/app/api/app/reviews/[...segments]/route.ts`
- 测试： `prototype/tests/unit/growth-loop-routes.test.ts`

**接口：**
- 输入：六个聚焦服务、`resolveCurrentAccess`、严格 Zod Schema 和当前作用域。
- 输出：已确认且具有稳定错误码的 HTTP 契约。现有单数 `/api/app/review/*` 路由保留到任务 9 替换其 UI 调用方，确保每个中间提交都维持可用的复盘页面。

- [ ] **步骤 1：编写失败的先鉴权、严格请求体和冲突路由测试**

```ts
it("rejects metric import before reading an unauthorized body", async () => {
  let bodyRead = false
  const request = requestWhoseFormDataSets(() => { bodyRead = true })
  const response = await handlers.import(request, reviewerWithoutImport)
  expect(response.status).toBe(403)
  expect(bodyRead).toBe(false)
})

it("rejects unknown publication fields", async () => {
  const response = await handlers.publications(jsonRequest({ ...validPublication, clientTitle: "不能覆盖锁稿" }), owner)
  expect(response.status).toBe(400)
  expect(await response.json()).toMatchObject({ errorCode: "PUBLICATION_INPUT_INVALID" })
})

it("returns 409 for stale match and review confirmation", async () => {
  expect((await handlers.confirmMatch(staleMatchRequest, owner)).status).toBe(409)
  expect((await handlers.confirmReview(staleReviewRequest, owner)).status).toBe(409)
})
```

- [ ] **步骤 2：运行并验证 RED**

运行：`npm test -- growth-loop-routes.test.ts`

预期：FAIL，因为生产路由和依赖工厂尚不存在。

- [ ] **步骤 3：建立生产服务工厂，但不合并模块职责**

`growth-loop-service-factory.ts` 连接仓储、服务、现有结构化 LLM 客户端和当前应用数据库。允许按进程缓存依赖图，但各服务仍应独立导出以便单元测试。不得把业务规则移入 Route 文件。

- [ ] **步骤 4：实现发布与 Multipart 指标端点**

- `POST /api/app/publications`
- `GET /api/app/publications?runId={id}&lockedVersion={n}`
- `POST /api/app/metrics/imports` using one `file` part
- `GET /api/app/metrics/imports/{batchId}`
- `POST /api/app/metrics/matches/{matchId}/confirm`
- `POST /api/app/metrics/matches/{matchId}/external`

在调用 `request.formData()` 或 `request.json()` 前解析 Session、租户 Audience、能力项和当前账号作用域。字节超限返回 413，版本/身份冲突返回 409，超出作用域资源返回 404，其他已知失败返回脱敏稳定错误。

- [ ] **步骤 5：实现复盘与确认端点**

- `GET /api/app/reviews/current?contentAccountId={id}`
- `POST /api/app/reviews/generate` with `{ contentAccountId }`
- `POST /api/app/reviews/{reviewId}/confirm` with editable memory fields

查看要求 `review.view`，生成要求 `review.generate`，确认要求 `review.confirm`。响应包含样本层级、证据边界、是否可确认、版本谱系和可重试状态，绝不返回 Prompt 原文或模型推理。

已知失败按以下规则精确映射：

```ts
const statusByCode: Record<string, number> = {
  UNAUTHENTICATED: 401,
  TENANT_AUDIENCE_REQUIRED: 403,
  CAPABILITY_FORBIDDEN: 403,
  IP_SCOPE_FORBIDDEN: 404,
  ACCOUNT_SCOPE_FORBIDDEN: 404,
  FILE_TOO_LARGE: 413,
  ROW_LIMIT_EXCEEDED: 400,
  FILE_TYPE_UNSUPPORTED: 400,
  METRIC_HEADERS_INVALID: 400,
  PUBLICATION_ID_CONFLICT: 409,
  PUBLICATION_URL_CONFLICT: 409,
  MATCH_VERSION_CONFLICT: 409,
  REAL_METRICS_REQUIRED: 400,
  MEMORY_SAMPLE_INSUFFICIENT: 409,
  REVIEW_SUPERSEDED: 409,
  LLM_TIMEOUT: 503,
  MODEL_SCHEMA_INVALID: 502,
}
```

- [ ] **步骤 6：验证新路由，同时保持中间 UI 可用**

运行：`npm test -- growth-loop-routes.test.ts access-domain.test.ts runtime-features.test.ts`

预期：新的复数 `/reviews` 和 `/metrics` 契约 PASS；旧单数路由只在任务 9 完成最终调用方切换后删除。

```bash
git add src/services/growth-loop-service-factory.ts src/app/api/app/publications/route.ts src/app/api/app/metrics src/app/api/app/reviews tests/unit/growth-loop-routes.test.ts
git commit -m "feat: expose secure real growth loop APIs"
```

### 任务 8：在今日创作增加已确认的内联发布回执和记忆影响

**文件：**
- 新建： `prototype/src/components/creation/PublicationReceipt.tsx`
- 修改： `prototype/src/components/creation/DailyCreationView.tsx`
- 修改： `prototype/src/components/creation/DailyCreationWorkspace.tsx`
- 修改： `prototype/src/app/globals.css`
- 修改： `prototype/src/presets/product-demo.ts`
- 测试： `prototype/tests/unit/publication-receipt-ui.test.tsx`
- 修改： `prototype/tests/unit/ai-native-pages.test.tsx`

**接口：**
- 输入：已锁稿的 `runId + lockedVersion`、发布 API 和 `draft.memoryInfluence`。
- 输出：锁稿正文下方已确认的 A 版布局，以及创作依据中轻量、可追溯的记忆使用说明。

- [ ] **步骤 1：编写失败的交互和层级测试**

```tsx
it("does not interrupt copying or appear before a script is locked", () => {
  render(<DailyCreationView draft={{ ...draft, status: "ready_to_confirm" }} />)
  expect(screen.queryByText("这条视频已经发布了吗？")).not.toBeInTheDocument()
  expect(screen.getByRole("button", { name: "复制并去拍" })).toBeVisible()
})

it("shows one light receipt after the locked document", async () => {
  render(<DailyCreationView draft={{ ...draft, status: "locked", lockedVersion: 2 }} />)
  expect(screen.getByText("这条视频已经发布了吗？")).toBeVisible()
  await userEvent.click(screen.getByRole("button", { name: "记录已发布" }))
  expect(screen.getByLabelText("作品 ID 或视频链接")).toBeVisible()
})

it("keeps a failed receipt editable and collapses a successful one", async () => {
  render(<PublicationReceipt {...props} save={saveOnceFailThenSucceed} />)
  await submit("wx-100")
  expect(screen.getByDisplayValue("wx-100")).toBeVisible()
  await userEvent.click(screen.getByRole("button", { name: "重新保存" }))
  expect(await screen.findByText(/已关联发布/)).toBeVisible()
})

it("shows memory version without a selector or weight control", () => {
  render(<DailyCreationView draft={{ ...draft, memoryInfluence: { version: 1, summary: "保留真实邻里场景；开头更快进入冲突" } }} />)
  expect(screen.getByText(/记忆 v1/)).toBeVisible()
  expect(screen.queryByText(/权重|选择记忆|是否使用记忆/)).not.toBeInTheDocument()
})
```

- [ ] **步骤 2：运行并验证 RED**

运行：`npm test -- publication-receipt-ui.test.tsx ai-native-pages.test.tsx`

预期：FAIL，因为发布回执和记忆使用视图尚不存在。

- [ ] **步骤 3：实现已确认的精确 A 版交互**

仅当 `status === "locked"` 时，在文稿脚注之后渲染 `PublicationReceipt`。折叠状态显示“这条视频已经发布了吗？”和一个次级“记录已发布”操作。展开表单包含一个身份字段、一个可编辑发布时间、保存/取消、内联校验，并在失败后保留输入。成功后折叠为平台 + 时间 +“已关联发布”；另设轻量操作用于增加其他账号发布，不能覆盖第一条记录。

- [ ] **步骤 4：把自动生效的记忆影响加入现有依据层级**

在 Lead 下方增加一句话，并在“创作依据（摘要）”中增加一项：`已参考上次确认的复盘：{summary} · 记忆 v{version}`。不得增加设置面板、开关、弹窗或生成前额外步骤。

- [ ] **步骤 5：保持响应式和无障碍行为**

使用现有衬线字体、颜色 Token、按钮类、可见焦点、移动端最小 44 px 点击区域和 760 px 单列断点。发布回执在 390 × 844 下不得产生横向溢出，并通过 `role="status"` 暴露状态。

- [ ] **步骤 6：验证 GREEN 并提交**

运行：`npm test -- publication-receipt-ui.test.tsx ai-native-pages.test.tsx daily-ui.test.tsx`

预期：锁定/未锁定、失败保留、多发布状态、记忆追踪及无额外配置 UI 测试均 PASS。

```bash
git add src/components/creation/PublicationReceipt.tsx src/components/creation/DailyCreationView.tsx src/components/creation/DailyCreationWorkspace.tsx src/app/globals.css src/presets/product-demo.ts tests/unit/publication-receipt-ui.test.tsx tests/unit/ai-native-pages.test.tsx
git commit -m "feat: add inline publication receipt to creation"
```

### 任务 9：以结果优先导入、异常处理和记忆预览替换复盘页面

**文件：**
- 新建： `prototype/src/components/review/ImportOutcome.tsx`
- 新建： `prototype/src/components/review/MatchResolutionList.tsx`
- 新建： `prototype/src/components/review/MemoryPreview.tsx`
- 修改： `prototype/src/components/review/ReviewWorkspace.tsx`
- 修改： `prototype/src/components/review/ReviewBriefView.tsx`
- 修改： `prototype/src/app/app/review/page.tsx`
- 删除： `prototype/src/app/api/app/review/[...segments]/route.ts`
- 修改： `prototype/src/app/globals.css`
- 修改： `prototype/src/presets/product-demo.ts`
- 测试： `prototype/tests/unit/review-workspace-ui.test.tsx`
- 修改： `prototype/tests/unit/ai-native-pages.test.tsx`

**接口：**
- 输入：Multipart 导入、批次/匹配 API、当前/生成/确认复盘 API、样本层级和当前能力状态。
- 输出：已确认的 A 版复盘流程：结论优先、只展开异常、自动继续复盘，以及带权限保护的私有记忆确认。

- [ ] **步骤 1：编写失败的结果优先和层级门槛测试**

```tsx
it("summarizes success first and expands only candidate matches", () => {
  render(<ImportOutcome result={mixedImportResult} />)
  expect(screen.getByRole("heading", { name: "已处理 8 条，5 条已关联" })).toBeVisible()
  expect(screen.getAllByRole("button", { name: /确认关联/ })).toHaveLength(2)
  expect(screen.queryByText("批次管理")).not.toBeInTheDocument()
})

it("continues to review while candidate rows remain", async () => {
  render(<ReviewWorkspace api={apiReturningMixedImport} />)
  await upload("metrics.xlsx")
  expect(apiReturningMixedImport.generateReview).toHaveBeenCalledOnce()
  expect(await screen.findByText(/能确定什么/)).toBeVisible()
})

it.each([
  ["facts_only", "当前只有 2 条可关联视频，只展示事实"],
  ["tentative", "样本较少，暂不能形成长期记忆"],
])("disables confirmation for %s", (sampleTier, message) => {
  render(<ReviewBriefView brief={{ ...review, sampleTier, canConfirm: false }} />)
  expect(screen.getByText(message)).toBeVisible()
  expect(screen.queryByRole("button", { name: "确认并用于后续创作" })).not.toBeInTheDocument()
})

it("shows editable memory fields but keeps evidence limits read-only", () => {
  render(<ReviewBriefView brief={{ ...review, sampleTier: "memory_eligible", canConfirm: true }} />)
  expect(screen.getByLabelText("继续保留")).toBeVisible()
  expect(screen.getByLabelText("尽量避免")).toBeVisible()
  expect(screen.getByText(review.evidenceLimits)).toBeVisible()
})
```

- [ ] **步骤 2：运行并验证 RED**

运行：`npm test -- review-workspace-ui.test.tsx ai-native-pages.test.tsx`

预期：FAIL，因为页面仍使用旧 CSV Brief 和无权限保护的确认行为。

- [ ] **步骤 3：实现可持久化恢复的 Multipart 导入**

`ReviewWorkspace` 从服务端页面接收当前账号 ID/能力，提交 `FormData`，显示已持久化的批次结果，然后调用复盘生成。刷新时重新读取最新批次/复盘，而不是依赖组件内存。接受 `.csv,.xlsx`；不得通过 `file.text()` 读取 XLSX。调用方切换后删除单数 `/api/app/review/*` 路由，确保生产环境无法访问旧的演示/正式混合实现。

- [ ] **步骤 4：实现仅异常处理**

首句直接说明已处理、已匹配、候选、未匹配、重复和错误数量。只展开候选行。每行显示导入标题/时间、最多三个带解释的确定性候选，以及确认已有发布或创建外部记录的操作。重复和错误放在折叠的次级说明中，包含行号和修复提示。

- [ ] **步骤 5：实现已确认的结论 + 证据 + 记忆组合**

主栏依次渲染：Headline、“能确定什么”“比较可能但不能确定”“不能推断什么”和“下一轮建议”。每条观察链接到允许的证据快照；假设显示低/中置信度，不伪装成因果。右侧栏包含可编辑的 `keep`、`avoid` 和 `nextContentSignals`、只读证据边界、精确团队/IP/账号作用域，并且只有样本层级和能力同时满足时才显示确认操作。

- [ ] **步骤 6：保持 AI Native 视觉契约**

不得增加指标仪表盘、批次表格、筛选栏、图表、通用统计卡片网格或模板管理入口。复用现有文档/证据侧栏、Phosphor 图标、低圆角控件、当前断点、加载文案和内联重试状态。

- [ ] **步骤 7：验证 GREEN 并提交**

运行：`npm test -- review-workspace-ui.test.tsx ai-native-pages.test.tsx app-shell.test.tsx`

预期：Multipart 上传、部分成功、自动复盘、候选处理、全部样本层级、权限感知确认和响应式层级测试均 PASS。

```bash
git add src/components/review/ImportOutcome.tsx src/components/review/MatchResolutionList.tsx src/components/review/MemoryPreview.tsx src/components/review/ReviewWorkspace.tsx src/components/review/ReviewBriefView.tsx src/app/app/review/page.tsx src/app/globals.css src/presets/product-demo.ts tests/unit/review-workspace-ui.test.tsx tests/unit/ai-native-pages.test.tsx
git rm "src/app/api/app/review/[...segments]/route.ts"
git commit -m "feat: deliver result-first real review workspace"
```

### 任务 10：验证完整真实数据闭环并记录单机运维方案

**文件：**
- 新建： `prototype/tests/e2e/fixtures/real-metrics.csv`
- 新建： `prototype/tests/e2e/real-growth-loop.spec.ts`
- 修改： `prototype/tests/e2e/content-loop.spec.ts`
- 修改： `prototype/src/scripts/e2e-server.ts`
- 修改： `prototype/src/scripts/demo-data.ts`
- 修改： `prototype/src/scripts/clear-demo.ts`
- 修改： `prototype/README.md`
- 修改： `prototype/.env.example`
- 新建： `prototype/docs/operations/real-growth-loop.md`

**接口：**
- 输入：已完成的 API/UI 和现有 Fixture 模型测试开关。
- 输出：完整闭环的浏览器证据、干净的演示数据清理能力，以及精确的首版部署/备份说明。

- [ ] **步骤 1：编写失败的端到端场景**

浏览器测试必须执行以下精确断言：

```ts
test("real publication data becomes confirmed memory for the next creation run", async ({ page }) => {
  await login(page, "owner@example.test")
  await finalizeCurrentDraft(page)
  await page.getByRole("button", { name: "记录已发布" }).click()
  await page.getByLabel("作品 ID 或视频链接").fill("wx-real-001")
  await page.getByRole("button", { name: "保存发布记录" }).click()
  await importFiveRealVideos(page, "tests/e2e/fixtures/real-metrics.csv")
  await expect(page.getByText(/5 条已关联/)).toBeVisible()
  await expect(page.getByRole("button", { name: "确认并用于后续创作" })).toBeVisible()
  await page.getByRole("button", { name: "确认并用于后续创作" }).click()
  await page.goto("/app/today")
  await page.getByRole("button", { name: "换选题" }).click()
  await expect(page.getByText(/记忆 v1/)).toBeVisible()
})
```

另外增加浏览器检查：4 条样本不能确认；缺少 `review.confirm` 的 Reviewer 不能确认；有效/重复/错误/候选混合行仍继续复盘；刷新后批次/复盘/记忆保持；平台用户不能读取租户端点；390 × 844 无横向溢出。

- [ ] **步骤 2：运行新 E2E 测试并验证 RED**

运行：`npm run build && npm run test:e2e -- real-growth-loop.spec.ts`

预期：在第一个缺失的集成行为处 FAIL；构建本身应成功，或明确指出必须先修复的类型不一致。

- [ ] **步骤 3：让测试 Fixture 仅走真实链路且可清理**

只有 `PROTOTYPE_TEST_MODE=true` 和 `PLAYWRIGHT_TEST_MODE=true` 同时成立时，E2E Server 才能初始化形式上真实的发布/指标 Fixture；生产启动永远不能初始化这些数据。扩展 `clear-demo.ts`：只有关联租户/用户/批次的 `data_origin=demo` 时才删除版本 7 数据；正式发布、快照、复盘和记忆必须保留。

- [ ] **步骤 4：记录精确的首版运维要求**

`README.md`、`.env.example` 和 `docs/operations/real-growth-loop.md` 必须说明：

- 一个 Node 进程、一个持久化 SQLite 路径、4 CPU / 8 GB RAM 基线；
- `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`、`LLM_TIMEOUT_SECONDS`、`PROTOTYPE_DB_PATH`；
- 反向代理请求上限高于 10 MB 但低于 12 MB，使应用能够返回自己的 10 MB 错误；
- SQLite WAL、外键、Busy Timeout、每日文件备份、恢复测试和磁盘空间监控；
- 禁止多个实例同时使用同一个 SQLite 文件启动；
- 生产环境不得启用 `PROTOTYPE_TEST_MODE`、`PLAYWRIGHT_TEST_MODE` 或演示控制项；
- 平台 API、队列、PostgreSQL 和负载均衡属于二期扩展接口，不是首版依赖。

- [ ] **步骤 5：运行完整验证矩阵**

运行：`npm test`

预期：全部单元/组件测试 PASS。

运行：`npm run typecheck`

预期：PASS，且无 TypeScript 错误。

运行：`npm run build`

预期：生产构建 PASS，三个新 Route Handler 均在 Node Runtime 下编译成功。

运行：`npm run test:e2e`

预期：现有创作/团队/平台测试和新的真实增长闭环测试均 PASS，浏览器 Console 无错误。

- [ ] **步骤 6：人工验证已确认视觉状态并提交**

在桌面端 1487 × 1058 和移动端 390 × 844 下，把运行状态与已确认 A 版原型对比：锁稿回执、混合导入结果、带记忆预览的复盘，以及带记忆影响的下一次创作。检查层级、裁切、Padding、焦点、错误恢复和溢出。只修复已确认设计范围内的可见偏差，不创造新视觉方向。

```bash
git add tests/e2e/fixtures/real-metrics.csv tests/e2e/real-growth-loop.spec.ts tests/e2e/content-loop.spec.ts src/scripts/e2e-server.ts src/scripts/demo-data.ts src/scripts/clear-demo.ts README.md .env.example docs/operations/real-growth-loop.md
git commit -m "test: verify real publication review memory loop"
```

## 完成门槛

只有以下条件同时成立，实施才算完成：

1. 发布记录能够追溯到精确锁稿版本或明确外部记录。
2. 每条正式指标行要么成为不可变真实快照，要么成为已持久化的脱敏错误；上传字节已经清除。
3. 每条自动匹配都能由 ID、规范化 URL 或 ±7 天内唯一精确标题候选解释。
4. 每个复盘都绑定精确证据集合哈希和精确快照链接。
5. 只有当前、5 条及以上样本的复盘能够创建有作用域的不可变记忆版本。
6. 后续创作 Run 保存并展示其实际使用的精确记忆版本。
7. 租户、IP、账号、能力和平台 Audience 隔离通过服务、路由和浏览器测试。
8. 单元测试、Typecheck、生产构建、完整 E2E、桌面视觉 QA 和移动端溢出 QA 全部通过。
