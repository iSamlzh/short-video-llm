# Real Publication, Review, and Private Memory Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the first-version growth loop from an immutable locked script through real publication evidence, deterministic metric matching, evidence-bounded review, human-confirmed tenant-private memory, and traceable reuse of that memory in the next creation run.

**Architecture:** Keep the existing Next.js Node process and SQLite database, but separate the new behavior into publication, import, matching, review, memory, and creation-context modules. File import and model review execute in-process with persisted checkpoints; matching and evidence calculations remain deterministic, while the LLM only summarizes a server-approved evidence set.

**Tech Stack:** Next.js 16 Route Handlers, React 19, TypeScript 5.9, SQLite/better-sqlite3, Zod 4, ExcelJS 4.4.0 for CSV/XLSX input, the existing provider-neutral structured LLM client, Vitest, Testing Library, and Playwright.

## Global Constraints

- Work from `prototype/` unless a step names a repository-root document.
- The production path is `locked script → publication → real metric snapshot → deterministic match → review version → confirmed memory version → next creation run`.
- Keep the first version deployable as one Next.js Node process with one SQLite persistent volume on a 4-core, 8-GB server.
- Do not add Redis, an external queue, a worker process, object storage, platform OAuth, platform data APIs, digital-human generation, or multi-instance coordination.
- Limit each upload to exactly 10 MB and 10,000 data rows; accept only `.csv` and `.xlsx`.
- Delete uploaded bytes after the request finishes; persist batch metadata and redacted row errors, never the original file.
- Reject simulated metrics from the formal review path; development fixtures remain available only under existing test-mode gates.
- Match only inside the exact tenant, IP, content-account, and platform scope. The LLM never chooses or changes a publication match.
- Use the latest snapshot per unique publication for horizontal review while retaining all immutable snapshots for historical growth.
- Use sample tiers exactly as follows: 0–2 `facts_only`; 3–4 `tentative`; 5+ `memory_eligible`.
- Only `memory_eligible`, current, non-superseded reviews can be confirmed; only `review.confirm` can create memory.
- Confirmed memory is immutable and scoped to tenant + IP + content account. It never writes to platform content-brain tables.
- Creation receives only `version`, `keep`, `avoid`, and `nextContentSignals`; do not pass raw metrics, employee identity, full review history, or hidden model reasoning.
- Preserve the approved editorial visual system in `src/app/globals.css`: result-first hierarchy, low-radius controls, one accent, no dashboard card grid, and responsive behavior at 1100 px and 760 px.
- Follow TDD: write a focused failing test, verify RED, implement the minimum coherent behavior, verify GREEN, then commit.
- This plan supersedes `docs/superpowers/plans/2026-08-17-real-metrics-review-implementation-plan.md`, whose schema and permission assumptions predate the approved detailed design.

## File and Responsibility Map

| File | Responsibility |
|---|---|
| `src/domain/growth-loop.ts` | Shared publication, import, match, review, and memory types |
| `src/domain/growth-loop-schemas.ts` | Strict Zod input/output schemas and stable enums |
| `src/lib/db/migrations/007_real_publication_review_memory.sql` | Additive version-7 schema and lineage columns |
| `src/lib/db/current-scope-repository.ts` | Resolve and validate the current tenant/IP/account/platform scope |
| `src/lib/db/publication-repository.ts` | Publication persistence and locked-script lookups |
| `src/lib/db/metrics-repository.ts` | Batch, row-error, snapshot, and match-version persistence |
| `src/lib/db/review-memory-repository.ts` | Review checkpoints, review evidence, and immutable memory versions |
| `src/lib/import/spreadsheet-parser.ts` | Bounded CSV/XLSX parsing and field normalization only |
| `src/services/publication-service.ts` | Publication authorization, lineage validation, and idempotency |
| `src/services/metric-import-service.ts` | File policy, parsing, partial-success persistence, and batch summary |
| `src/services/publication-matcher.ts` | Deterministic matching and audited human resolution |
| `src/services/account-baseline-service.ts` | Same-account medians, ranges, latest-snapshot selection, and sample tier |
| `src/services/review-service.ts` | Checkpointed evidence-bounded review generation and supersession |
| `src/services/tenant-memory-service.ts` | Human confirmation and immutable private memory |
| `src/services/creation-context-provider.ts` | Minimal confirmed-memory retrieval for a creation run |
| `src/app/api/app/publications/route.ts` | Locked-script publication receipt API |
| `src/app/api/app/metrics/[...segments]/route.ts` | Multipart import, batch result, and match-resolution API |
| `src/app/api/app/reviews/[...segments]/route.ts` | Current review, generation, and confirmation API |
| `src/components/creation/PublicationReceipt.tsx` | Approved inline publication receipt below a locked script |
| `src/components/review/ImportOutcome.tsx` | Result-first batch summary and anomaly-only resolution queue |
| `src/components/review/ReviewBriefView.tsx` | Facts, hypotheses, limits, and private-memory preview |

---

### Task 1: Add Version-7 Contracts, Capabilities, and Additive Schema

**Files:**
- Create: `prototype/src/domain/growth-loop.ts`
- Create: `prototype/src/domain/growth-loop-schemas.ts`
- Create: `prototype/src/lib/db/current-scope-repository.ts`
- Create: `prototype/src/lib/db/migrations/007_real_publication_review_memory.sql`
- Modify: `prototype/src/lib/db/migrations.ts`
- Modify: `prototype/src/lib/db/database.ts`
- Modify: `prototype/src/domain/access.ts`
- Modify: `prototype/src/scripts/demo-data.ts`
- Test: `prototype/tests/unit/growth-loop-domain.test.ts`
- Modify: `prototype/tests/unit/migrations.test.ts`
- Modify: `prototype/tests/unit/access-domain.test.ts`
- Modify: `prototype/tests/unit/demo-seed.test.ts`

**Interfaces:**
- Consumes: existing `TenantAccessContext`, `creation_run_context`, `tenant_memory_versions`, locked-script tables, current IP/account context, and migration runner.
- Produces: `GrowthScope`, `Publication`, `MetricImportRow`, `MetricImportResult`, `PublicationMatch`, `ContentReviewVersion`, `TenantMemoryVersion`, strict schemas, `CurrentScopeRepository.get(context)`, and capabilities `publication.record` and `review.confirm`.

- [ ] **Step 1: Write failing contract and migration tests**

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

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npm test -- growth-loop-domain.test.ts migrations.test.ts access-domain.test.ts demo-seed.test.ts`

Expected: FAIL because version 7, the new contracts, and the two capabilities do not exist.

- [ ] **Step 3: Define exact shared contracts and schemas**

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

Define strict Zod schemas for both publication inputs, import row normalization, candidate confirmation with `expectedVersion`, real-review output, and memory confirmation. Use `.strict()` on HTTP-facing objects. Reject empty strings, invalid ISO timestamps, negative metrics, completion rates outside `0..1`, and `isSimulated !== false`.

- [ ] **Step 4: Add the complete additive migration**

Migration 007 uses the following complete table and index contract:

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

Keep existing `imported_content_metrics` rows in place. Current demo rows lack a reliable platform key and publication time, so version 7 must not promote them into the formal snapshot/review path. In `openDatabase`, set `database.pragma("busy_timeout = 5000")` in addition to the existing WAL and foreign-key settings.

- [ ] **Step 5: Add current-scope resolution and role defaults**

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

Owner gets both new capabilities; Operator gets `publication.record`; Reviewer keeps import/generate/view but does not get `review.confirm`. Preserve the existing ability for Owner to delegate `review.confirm` through `TeamService`.

- [ ] **Step 6: Verify GREEN and commit**

Run: `npm test -- growth-loop-domain.test.ts migrations.test.ts access-domain.test.ts demo-seed.test.ts`

Expected: PASS, including double migration and idempotent demo seeding.

```bash
git add src/domain/growth-loop.ts src/domain/growth-loop-schemas.ts src/domain/access.ts src/lib/db/current-scope-repository.ts src/lib/db/database.ts src/lib/db/migrations.ts src/lib/db/migrations/007_real_publication_review_memory.sql src/scripts/demo-data.ts tests/unit/growth-loop-domain.test.ts tests/unit/migrations.test.ts tests/unit/access-domain.test.ts tests/unit/demo-seed.test.ts
git commit -m "feat: add real growth loop contracts and schema"
```

### Task 2: Record System and External Publications with Locked-Script Lineage

**Files:**
- Create: `prototype/src/lib/db/publication-repository.ts`
- Create: `prototype/src/services/publication-service.ts`
- Test: `prototype/tests/unit/publication-service.test.ts`

**Interfaces:**
- Consumes: `CurrentScopeRepository`, `requireTenantCapability`, `locked_scripts`, `creation_run_context`, `content_accounts`, and `audit_logs`.
- Produces: `PublicationService.recordSystem(context, input)`, `createExternal(context, input)`, `supplementIdentity(context, publicationId, input)`, `disable(context, publicationId, reason)`, `getByCurrentLock(context, runId, lockedVersion)`, and repository lookups used by matching.

- [ ] **Step 1: Write failing publication-lineage tests**

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

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- publication-service.test.ts`

Expected: FAIL because the repository and service are absent.

- [ ] **Step 3: Implement publication persistence and URL normalization**

```ts
export function normalizeVideoUrl(value: string) {
  const url = new URL(value)
  url.hostname = url.hostname.toLowerCase()
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) url.searchParams.delete(key)
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/$/, "")
  return url.toString()
}
```

Do not resolve or expand short URLs. `PublicationRepository` returns active candidates only, exposes exact ID/URL/title-window queries, and stores all writes inside one local transaction. On unique conflicts, load and return the identical record; if the same identity points at another lock/publication, throw `PUBLICATION_ID_CONFLICT` or `PUBLICATION_URL_CONFLICT`.

- [ ] **Step 4: Implement system and external publication policies**

`recordSystem` requires `publication.record`, assigned IP/account, one of video ID or URL, an accessible `creation_run_context`, and the exact `locked_scripts(run_id, version)`. It copies title and `script_selection_version` from the lock. `createExternal` requires `metrics.import`, title + published time, and at least video ID, URL, or the explicit title/time external identity. `supplementIdentity` adds an ID or URL to the same external record after conflict checks. `disable` keeps the row and lineage but removes it from active matching. Create, supplement, and disable actions write redacted `audit_logs` records.

- [ ] **Step 5: Verify GREEN and commit**

Run: `npm test -- publication-service.test.ts creation-lineage.test.ts`

Expected: PASS with no changes to existing creation lineage behavior.

```bash
git add src/lib/db/publication-repository.ts src/services/publication-service.ts tests/unit/publication-service.test.ts
git commit -m "feat: record published locked scripts"
```

### Task 3: Parse Bounded CSV/XLSX Imports and Persist Partial Success

**Files:**
- Modify: `prototype/package.json`
- Modify: `prototype/package-lock.json`
- Create: `prototype/src/lib/import/spreadsheet-parser.ts`
- Create: `prototype/src/lib/db/metrics-repository.ts`
- Create: `prototype/src/services/metric-import-service.ts`
- Test: `prototype/tests/unit/spreadsheet-parser.test.ts`
- Test: `prototype/tests/unit/metric-import-service.test.ts`

**Interfaces:**
- Consumes: exact `GrowthScope`, `metrics.import`, request file bytes, and version-7 batch/snapshot/error tables.
- Produces: `parseMetricFile(input): Promise<ParsedMetricFile>`, `MetricImportService.import(context, input): Promise<MetricImportResult>`, and immutable real snapshots for matching.

- [ ] **Step 1: Install the pinned spreadsheet dependency**

Run: `npm install --save-exact exceljs@4.4.0`

Expected: `exceljs: "4.4.0"` appears in dependencies and the lockfile changes. Use the [official ExcelJS v4.4.0 workbook APIs](https://github.com/exceljs/exceljs/releases/tag/v4.4.0); do not write an upload to disk.

- [ ] **Step 2: Write failing parser and partial-success tests**

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

- [ ] **Step 3: Run and verify RED**

Run: `npm test -- spreadsheet-parser.test.ts metric-import-service.test.ts`

Expected: FAIL because parsing and persistence modules do not exist.

- [ ] **Step 4: Implement exact file and row policy**

`parseMetricFile` must:

- reject bytes above `10 * 1024 * 1024` with `FILE_TOO_LARGE` before workbook parsing;
- reject extensions other than `.csv` and `.xlsx` with `FILE_TYPE_UNSUPPORTED`;
- accept MIME types `text/csv`, `application/csv`, `application/vnd.ms-excel`, and `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`; when a browser sends an empty or generic MIME, require a valid extension and successful parser signature instead of trusting MIME alone;
- stop after 10,000 data rows with `ROW_LIMIT_EXCEEDED`;
- normalize the aliases listed in section 6 of the approved design;
- require a title and one identity form: ID, URL, or title + published time;
- accept counts as non-negative integers and rates as `0.35` or `35%`;
- convert dates to UTC ISO while preserving a redacted original reference for errors;
- derive the title/time-only key as SHA-256 of `platform|accountId|normalizedTitle|publishedAt` in the service, never as an automatic match key.

Return this exact shape:

```ts
type ParsedMetricFile = {
  validRows: MetricImportRow[]
  errors: Array<{ rowNumber: number; code: string; message: string; redactedReference: string }>
  totalRows: number
}
```

- [ ] **Step 5: Implement batch idempotency and immutable snapshots**

`MetricImportService.import` requires `metrics.import` for the current account before parsing bytes. It hashes the file, returns the existing batch for the same account + SHA-256, creates the batch as `processing`, writes valid snapshots with `is_simulated=0`, records duplicates and row errors, moves the batch to `parsed`, and never stores `bytes`. A parser-level fatal error moves the batch to `failed`; row errors do not roll back valid snapshots.

- [ ] **Step 6: Verify GREEN and commit**

Run: `npm test -- spreadsheet-parser.test.ts metric-import-service.test.ts`

Expected: PASS for CSV, XLSX, size/type/row limits, duplicate import, and partial success.

```bash
git add package.json package-lock.json src/lib/import/spreadsheet-parser.ts src/lib/db/metrics-repository.ts src/services/metric-import-service.ts tests/unit/spreadsheet-parser.test.ts tests/unit/metric-import-service.test.ts
git commit -m "feat: import immutable real metric snapshots"
```

### Task 4: Deterministically Match Metrics and Audit Human Resolution

**Files:**
- Create: `prototype/src/services/publication-matcher.ts`
- Modify: `prototype/src/services/metric-import-service.ts`
- Modify: `prototype/src/lib/db/metrics-repository.ts`
- Modify: `prototype/src/lib/db/publication-repository.ts`
- Test: `prototype/tests/unit/publication-matcher.test.ts`
- Modify: `prototype/tests/unit/metric-import-service.test.ts`

**Interfaces:**
- Consumes: normalized snapshots, active publication candidates, `PublicationService.createExternal`, and `expectedVersion`.
- Produces: `PublicationMatcher.matchBatch(context, batchId)`, `confirmCandidate(context, matchId, publicationId, expectedVersion)`, and `rejectCandidateAndCreateExternal(context, matchId, expectedVersion)`.

- [ ] **Step 1: Write failing priority, ambiguity, and concurrency tests**

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

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- publication-matcher.test.ts metric-import-service.test.ts`

Expected: FAIL because match decisions and versioned confirmation are missing.

- [ ] **Step 3: Implement exact normalization and decision order**

Normalize titles with Unicode NFKC, lowercase Latin text, collapsed whitespace, and removal of surrounding punctuation only. Exact title matching requires one active candidate inside an inclusive ±7-day window. Similarity uses a deterministic Dice score over two-character shingles; scores at or above `0.72` inside ±30 days produce at most three ranked candidates but never `matched`. No candidate becomes `unmatched`.

```ts
type MatchDecision = {
  status: MatchStatus
  method: MatchMethod
  publicationId?: string
  candidateIds: string[]
  explanation: string
}
```

- [ ] **Step 4: Persist append-only match versions and audit manual changes**

For every snapshot, mark the old row `is_current=0` and append the next version in one transaction. Human resolution requires `metrics.import` plus scope, compares `expectedVersion`, and writes `metrics.match.confirmed` or `metrics.match.external_created` to `audit_logs`. A candidate may bind an existing active publication or create an external publication from the immutable imported identity.

- [ ] **Step 5: Connect import completion to matching without blocking valid rows**

After parsing, `MetricImportService.import` invokes `matchBatch`, updates counters, and sets `matched` then `review_ready`. Candidate and unmatched rows remain visible while exact matches proceed. A failure in one match writes a row-level error and does not undo other matched snapshots.

- [ ] **Step 6: Verify GREEN and commit**

Run: `npm test -- publication-matcher.test.ts metric-import-service.test.ts publication-service.test.ts`

Expected: PASS for priority, ambiguity, similarity, external creation, audit, version conflict, and partial continuation.

```bash
git add src/services/publication-matcher.ts src/services/metric-import-service.ts src/lib/db/metrics-repository.ts src/lib/db/publication-repository.ts tests/unit/publication-matcher.test.ts tests/unit/metric-import-service.test.ts
git commit -m "feat: match imported metrics deterministically"
```

### Task 5: Generate Checkpointed, Evidence-Bounded Real Reviews

**Files:**
- Modify: `prototype/src/domain/schemas.ts`
- Create: `prototype/src/prompts/real-review.ts`
- Modify: `prototype/src/prompts/index.ts`
- Modify: `prototype/src/lib/llm/adapter.ts`
- Modify: `prototype/src/lib/llm/structured.ts`
- Modify: `prototype/src/lib/llm/fake.ts`
- Create: `prototype/src/services/account-baseline-service.ts`
- Create: `prototype/src/lib/db/review-memory-repository.ts`
- Create: `prototype/src/services/review-service.ts`
- Modify: `prototype/src/lib/db/metrics-repository.ts`
- Test: `prototype/tests/unit/account-baseline-service.test.ts`
- Test: `prototype/tests/unit/real-review-schema.test.ts`
- Test: `prototype/tests/unit/review-service.test.ts`
- Modify: `prototype/tests/unit/llm.test.ts`

**Interfaces:**
- Consumes: latest matched real snapshot per publication, IP expression boundaries, structured LLM, and review checkpoints.
- Produces: `AccountBaselineService.build(scope)`, LLM operation `real_review`, `StructuredLlmResult<T>`, `ReviewService.generateCurrent(context, contentAccountId)`, `getCurrent(context, contentAccountId)`, `getHistory(context, contentAccountId)`, and immutable evidence links.

- [ ] **Step 1: Write failing baseline, tier, evidence, and retry tests**

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

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- account-baseline-service.test.ts real-review-schema.test.ts review-service.test.ts llm.test.ts`

Expected: FAIL because the real-review operation, metadata result, checkpoints, and service do not exist.

- [ ] **Step 3: Add the exact real-review schema and prompt**

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

Add `real_review` to `LlmOperation` and `prompts`. The system prompt must require JSON only, forbid causal claims, forbid missing metrics, restrict evidence IDs to the supplied allowlist, and keep hypothesis confidence at `low|medium`.

- [ ] **Step 4: Preserve model and token metadata without breaking existing callers**

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

Add `StructuredLlmClient.generateStructuredResult`; retain the existing `generateStructured` signature so creation tests remain unchanged. When repair is used, persist the final model and combined available usage rather than the invalid raw response.

- [ ] **Step 5: Implement deterministic baseline and evidence set hashing**

Compute medians and percentile ranges only from the current account and compatible content type. Include missing-field markers, unique publication count, latest snapshots, complete historical snapshots, and a SHA-256 over sorted `publicationId:snapshotId`. Do not calculate a conversion rate when its denominator is absent.

- [ ] **Step 6: Implement checkpoints, generation, reuse, and supersession**

`generateCurrent` requires `review.generate`, rejects any simulated snapshot, returns deterministic facts without LLM for 0–2 samples, and otherwise creates/reuses a checkpoint by evidence hash. Save model, prompt version, token usage, evidence cutoff, payload, and individual evidence links. If new data or a match changes the hash, mark an unconfirmed previous review `superseded`. After a review is persisted, mark eligible `review_ready` batches in the same scope as `completed`; on timeout/schema/evidence errors they remain `review_ready`, the checkpoint keeps the stable code, and retry never requires re-upload. `getCurrent` and `getHistory` require `review.view` and never return cross-scope rows.

- [ ] **Step 7: Verify GREEN and commit**

Run: `npm test -- account-baseline-service.test.ts real-review-schema.test.ts review-service.test.ts llm.test.ts`

Expected: PASS for all tiers, latest snapshot selection, model boundaries, evidence allowlist, one repair, checkpoint reuse, retry, and supersession.

```bash
git add src/domain/schemas.ts src/prompts/real-review.ts src/prompts/index.ts src/lib/llm/adapter.ts src/lib/llm/structured.ts src/lib/llm/fake.ts src/services/account-baseline-service.ts src/lib/db/metrics-repository.ts src/lib/db/review-memory-repository.ts src/services/review-service.ts tests/unit/account-baseline-service.test.ts tests/unit/real-review-schema.test.ts tests/unit/review-service.test.ts tests/unit/llm.test.ts
git commit -m "feat: generate evidence-bounded real reviews"
```

### Task 6: Confirm Immutable Memory and Feed Its Exact Version into Creation

**Files:**
- Create: `prototype/src/services/tenant-memory-service.ts`
- Create: `prototype/src/services/creation-context-provider.ts`
- Modify: `prototype/src/lib/db/review-memory-repository.ts`
- Modify: `prototype/src/lib/db/creation-lineage-repository.ts`
- Modify: `prototype/src/services/creation-app-service.ts`
- Modify: `prototype/src/services/auto-creation-orchestrator.ts`
- Modify: `prototype/src/services/run-service.ts`
- Modify: `prototype/src/services/creation-presenter.ts`
- Modify: `prototype/src/lib/llm/fake.ts`
- Test: `prototype/tests/unit/tenant-memory-service.test.ts`
- Test: `prototype/tests/unit/creation-memory-integration.test.ts`
- Modify: `prototype/tests/unit/creation-lineage.test.ts`
- Modify: `prototype/tests/unit/creation-app-service.test.ts`

**Interfaces:**
- Consumes: `review.confirm`, a current `memory_eligible` review, `CreationContextProvider.getCurrent/getVersion`, and the existing creation pipeline.
- Produces: immutable `TenantMemoryVersion`, creation input `tenantMemory`, persisted `tenant_memory_version`, and a light `memoryInfluence` presenter object.

- [ ] **Step 1: Write failing confirmation and creation-lineage tests**

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

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- tenant-memory-service.test.ts creation-memory-integration.test.ts creation-lineage.test.ts creation-app-service.test.ts`

Expected: FAIL because confirmation and creation memory context are missing.

- [ ] **Step 3: Implement guarded immutable confirmation**

`TenantMemoryService.confirm` validates `review.confirm`, exact scope, `memory_eligible`, status `generated`, and current evidence-set hash inside one transaction. It accepts edits only to `keep`, `avoid`, and `nextContentSignals`; it copies `evidenceLimits` from the review, computes a stable content hash, returns the existing row for the same review + hash, otherwise allocates the next scoped version, marks the review `confirmed`, and writes `review.memory.confirmed` to `audit_logs`.

- [ ] **Step 4: Add minimal memory retrieval and pinned run lineage**

```ts
export class CreationContextProvider {
  getCurrent(scope: GrowthScope): ConfirmedCreationMemory | null
  getVersion(scope: GrowthScope, version: number): ConfirmedCreationMemory | null
}
```

Extend `CreationLineageRepository.attach` and its mapped row with `tenantMemoryVersion: number | null`. The value is written once when the Run is attached and is never backfilled.

- [ ] **Step 5: Thread memory through generation without coupling to platform templates**

Change the exact signatures to:

```ts
AutoCreationOrchestrator.createUsableDraft(profile, adjustment?, tenantMemory?: ConfirmedCreationMemory)
RunService.generateAutoDraft(runId, inputVersion, tenantMemory?: ConfirmedCreationMemory)
RunService.generateTopicDraft(runId, inputVersion, topics, selectedTopicId, adjustment, tenantMemory?: ConfirmedCreationMemory)
```

Add `tenantMemory` only to LLM input beside the IP profile; do not mutate the content-brain repository or platform template ranking tables. `CreationAppService` reads memory before generation, attaches its version after Run creation, and uses `getVersion` when presenting an older Run.

- [ ] **Step 6: Present a light, truthful influence summary**

`presentCreationDraft(view, memory?)` returns:

```ts
memoryInfluence: memory ? {
  version: memory.version,
  summary: [...memory.keep.slice(0, 1), ...memory.nextContentSignals.slice(0, 1)].join("；"),
} : null
```

The presenter never claims that memory affected a specific word unless that effect is represented by the supplied keep/signal summary.

- [ ] **Step 7: Verify GREEN and commit**

Run: `npm test -- tenant-memory-service.test.ts creation-memory-integration.test.ts creation-lineage.test.ts creation-app-service.test.ts auto-creation-orchestrator.test.ts`

Expected: PASS for permissions, tier gate, superseded review rejection, idempotency, minimal prompt input, exact run lineage, and no platform-template write.

```bash
git add src/services/tenant-memory-service.ts src/services/creation-context-provider.ts src/lib/db/review-memory-repository.ts src/lib/db/creation-lineage-repository.ts src/services/creation-app-service.ts src/services/auto-creation-orchestrator.ts src/services/run-service.ts src/services/creation-presenter.ts src/lib/llm/fake.ts tests/unit/tenant-memory-service.test.ts tests/unit/creation-memory-integration.test.ts tests/unit/creation-lineage.test.ts tests/unit/creation-app-service.test.ts
git commit -m "feat: apply confirmed private memory to creation"
```

### Task 7: Expose Strict Publication, Import, Match, Review, and Memory APIs

**Files:**
- Create: `prototype/src/services/growth-loop-service-factory.ts`
- Create: `prototype/src/app/api/app/publications/route.ts`
- Create: `prototype/src/app/api/app/metrics/[...segments]/route.ts`
- Create: `prototype/src/app/api/app/reviews/[...segments]/route.ts`
- Test: `prototype/tests/unit/growth-loop-routes.test.ts`

**Interfaces:**
- Consumes: all six focused services, `resolveCurrentAccess`, strict Zod schemas, and current scope.
- Produces: the approved HTTP contract with stable error codes. The existing singular `/api/app/review/*` route remains untouched until Task 9 replaces its UI consumer, so every intermediate commit still has a working review page.

- [ ] **Step 1: Write failing route tests for auth-before-body, strict bodies, and conflicts**

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

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- growth-loop-routes.test.ts`

Expected: FAIL because the production routes and dependency factory do not exist.

- [ ] **Step 3: Build one production service factory without merging responsibilities**

`growth-loop-service-factory.ts` wires repositories, services, the existing structured LLM client, and the current app database. It may cache the dependency graph per process, but services remain individually exportable for unit tests. Do not move business rules into route files.

- [ ] **Step 4: Implement publication and multipart metric endpoints**

- `POST /api/app/publications`
- `GET /api/app/publications?runId={id}&lockedVersion={n}`
- `POST /api/app/metrics/imports` using one `file` part
- `GET /api/app/metrics/imports/{batchId}`
- `POST /api/app/metrics/matches/{matchId}/confirm`
- `POST /api/app/metrics/matches/{matchId}/external`

Resolve the session, tenant audience, capability, and current account scope before calling `request.formData()` or `request.json()`. Return 413 for byte limit, 409 for version/identity conflict, 404 for out-of-scope resources, and redacted stable errors for every other known failure.

- [ ] **Step 5: Implement review and confirmation endpoints**

- `GET /api/app/reviews/current?contentAccountId={id}`
- `POST /api/app/reviews/generate` with `{ contentAccountId }`
- `POST /api/app/reviews/{reviewId}/confirm` with editable memory fields

Viewing requires `review.view`, generation requires `review.generate`, and confirmation requires `review.confirm`. The response includes tier, evidence limits, confirmation eligibility, version lineage, and retryable state, never prompt text or model reasoning.

Map known failures exactly:

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

- [ ] **Step 6: Verify the new routes while preserving the working intermediate UI**

Run: `npm test -- growth-loop-routes.test.ts access-domain.test.ts runtime-features.test.ts`

Expected: PASS for the new plural `/reviews` and `/metrics` contracts; the old singular route is removed only after Task 9 switches its final consumer.

```bash
git add src/services/growth-loop-service-factory.ts src/app/api/app/publications/route.ts src/app/api/app/metrics src/app/api/app/reviews tests/unit/growth-loop-routes.test.ts
git commit -m "feat: expose secure real growth loop APIs"
```

### Task 8: Add the Approved Inline Publication Receipt and Memory Influence to Today

**Files:**
- Create: `prototype/src/components/creation/PublicationReceipt.tsx`
- Modify: `prototype/src/components/creation/DailyCreationView.tsx`
- Modify: `prototype/src/components/creation/DailyCreationWorkspace.tsx`
- Modify: `prototype/src/app/globals.css`
- Modify: `prototype/src/presets/product-demo.ts`
- Test: `prototype/tests/unit/publication-receipt-ui.test.tsx`
- Modify: `prototype/tests/unit/ai-native-pages.test.tsx`

**Interfaces:**
- Consumes: locked draft `runId + lockedVersion`, publication APIs, and `draft.memoryInfluence`.
- Produces: the approved A-layout below the locked script and a light, traceable memory-use line in creation evidence.

- [ ] **Step 1: Write failing interaction and hierarchy tests**

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

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- publication-receipt-ui.test.tsx ai-native-pages.test.tsx`

Expected: FAIL because the receipt and memory-use view are absent.

- [ ] **Step 3: Implement the exact approved A interaction**

Render `PublicationReceipt` after the document footnote only when `status === "locked"`. Its collapsed prompt is “这条视频已经发布了吗？” with one secondary “记录已发布” action. The expanded form has one identity field, one editable publication time, save/cancel, inline validation, and retained input after failure. Success collapses to platform + time + “已关联发布”; a separate small action adds another account publication without replacing the first.

- [ ] **Step 4: Add automatic memory influence to existing evidence hierarchy**

Add one sentence beneath the lead and one item inside “创作依据（摘要）”: `已参考上次确认的复盘：{summary} · 记忆 v{version}`. Do not add a settings panel, toggle, modal, or extra pre-generation step.

- [ ] **Step 5: Preserve responsive and accessible behavior**

Use the existing serif typography, color tokens, button classes, visible focus, minimum 44 px mobile targets, and the 760 px one-column breakpoint. The receipt must not create horizontal overflow at 390 × 844 and must expose status through `role="status"`.

- [ ] **Step 6: Verify GREEN and commit**

Run: `npm test -- publication-receipt-ui.test.tsx ai-native-pages.test.tsx daily-ui.test.tsx`

Expected: PASS for locked/unlocked, failure retention, multiple publication status, memory trace, and no extra configuration UI.

```bash
git add src/components/creation/PublicationReceipt.tsx src/components/creation/DailyCreationView.tsx src/components/creation/DailyCreationWorkspace.tsx src/app/globals.css src/presets/product-demo.ts tests/unit/publication-receipt-ui.test.tsx tests/unit/ai-native-pages.test.tsx
git commit -m "feat: add inline publication receipt to creation"
```

### Task 9: Replace the Review Page with Result-First Import, Anomaly Resolution, and Memory Preview

**Files:**
- Create: `prototype/src/components/review/ImportOutcome.tsx`
- Create: `prototype/src/components/review/MatchResolutionList.tsx`
- Create: `prototype/src/components/review/MemoryPreview.tsx`
- Modify: `prototype/src/components/review/ReviewWorkspace.tsx`
- Modify: `prototype/src/components/review/ReviewBriefView.tsx`
- Modify: `prototype/src/app/app/review/page.tsx`
- Delete: `prototype/src/app/api/app/review/[...segments]/route.ts`
- Modify: `prototype/src/app/globals.css`
- Modify: `prototype/src/presets/product-demo.ts`
- Test: `prototype/tests/unit/review-workspace-ui.test.tsx`
- Modify: `prototype/tests/unit/ai-native-pages.test.tsx`

**Interfaces:**
- Consumes: multipart import, batch/match APIs, current/generate/confirm review APIs, sample tiers, and current capability state.
- Produces: the approved A review flow: conclusion first, only anomalies expanded, automatic review continuation, and guarded private-memory confirmation.

- [ ] **Step 1: Write failing result-first and tier-gate tests**

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

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- review-workspace-ui.test.tsx ai-native-pages.test.tsx`

Expected: FAIL because the page still uses the old CSV brief and unguarded confirm behavior.

- [ ] **Step 3: Implement multipart import with persisted recovery**

`ReviewWorkspace` receives current account ID/capabilities from the server page, posts `FormData`, displays the persisted batch outcome, then calls review generation. Refresh reloads the latest batch/review instead of relying on component memory. Accept `.csv,.xlsx`; never read XLSX through `file.text()`. After this consumer is switched, delete the singular `/api/app/review/*` route so production cannot reach the old demo/formal-mixing implementation.

- [ ] **Step 4: Implement anomaly-only resolution**

Lead with processed, matched, candidate, unmatched, duplicate, and error counts in one sentence. Expand candidate rows only. Each row shows the imported title/time, up to three deterministic candidates with match explanation, and actions to confirm an existing publication or create an external record. Duplicates and errors remain in a collapsed secondary disclosure with row number and repair message.

- [ ] **Step 5: Implement the approved conclusion + evidence + memory composition**

The main column renders, in order: headline, “能确定什么”, “比较可能但不能确定”, “不能推断什么”, and “下一轮建议”. Every observation links to its permitted evidence snapshots; hypotheses display low/medium confidence without pretending causality. The right rail contains editable `keep`, `avoid`, and `nextContentSignals`, a read-only evidence limit, exact team/IP/account scope, and the confirm action only when both tier and capability allow it.

- [ ] **Step 6: Preserve the AI-native visual contract**

Do not add metric dashboards, batch tables, filter bars, charts, generic stat-card grids, or a template-management entry. Reuse the existing document/evidence rail, Phosphor icons, low-radius controls, current breakpoints, loading language, and inline retry status.

- [ ] **Step 7: Verify GREEN and commit**

Run: `npm test -- review-workspace-ui.test.tsx ai-native-pages.test.tsx app-shell.test.tsx`

Expected: PASS for multipart upload, partial success, automatic review, candidate resolution, all sample tiers, permission-aware confirmation, and responsive hierarchy.

```bash
git add src/components/review/ImportOutcome.tsx src/components/review/MatchResolutionList.tsx src/components/review/MemoryPreview.tsx src/components/review/ReviewWorkspace.tsx src/components/review/ReviewBriefView.tsx src/app/app/review/page.tsx src/app/globals.css src/presets/product-demo.ts tests/unit/review-workspace-ui.test.tsx tests/unit/ai-native-pages.test.tsx
git rm "src/app/api/app/review/[...segments]/route.ts"
git commit -m "feat: deliver result-first real review workspace"
```

### Task 10: Prove the Complete Real-Data Loop and Document Single-Server Operations

**Files:**
- Create: `prototype/tests/e2e/fixtures/real-metrics.csv`
- Create: `prototype/tests/e2e/real-growth-loop.spec.ts`
- Modify: `prototype/tests/e2e/content-loop.spec.ts`
- Modify: `prototype/src/scripts/e2e-server.ts`
- Modify: `prototype/src/scripts/demo-data.ts`
- Modify: `prototype/src/scripts/clear-demo.ts`
- Modify: `prototype/README.md`
- Modify: `prototype/.env.example`
- Create: `prototype/docs/operations/real-growth-loop.md`

**Interfaces:**
- Consumes: the finished APIs/UI and existing fixture-model test gate.
- Produces: browser proof of the full loop, clean demo-data removal, and exact first-version deployment/backup guidance.

- [ ] **Step 1: Write the failing end-to-end scenario**

The browser test must perform these exact assertions:

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

Add separate browser checks for: four samples cannot confirm; a Reviewer without `review.confirm` cannot confirm; mixed valid/duplicate/error/candidate rows continue review; refresh preserves batch/review/memory; platform users cannot read tenant endpoints; 390 × 844 has no horizontal overflow.

- [ ] **Step 2: Run the new E2E test and verify RED**

Run: `npm run build && npm run test:e2e -- real-growth-loop.spec.ts`

Expected: FAIL at the first missing integrated behavior, while the build itself succeeds or identifies any type mismatch to fix before proceeding.

- [ ] **Step 3: Make test fixtures real-path-only and clearable**

The E2E server may seed formal-looking fixture publications/metrics only when both `PROTOTYPE_TEST_MODE=true` and `PLAYWRIGHT_TEST_MODE=true`. Production startup never seeds them. Extend `clear-demo.ts` to delete version-7 rows only when their linked tenant/user/batch is `data_origin=demo`; formal publication, snapshot, review, and memory rows must remain.

- [ ] **Step 4: Document exact first-version operations**

`README.md`, `.env.example`, and `docs/operations/real-growth-loop.md` must state:

- one Node process, one persistent SQLite path, 4 CPU / 8 GB RAM baseline;
- `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_TIMEOUT_SECONDS`, `PROTOTYPE_DB_PATH`;
- reverse-proxy request limit above 10 MB but below 12 MB so the app can return its own 10-MB error;
- SQLite WAL, foreign keys, busy timeout, daily file backup, restore test, and disk-space monitoring;
- no multi-instance startup against the same SQLite file;
- production cannot enable `PROTOTYPE_TEST_MODE`, `PLAYWRIGHT_TEST_MODE`, or demo controls;
- platform API, queue, PostgreSQL, and load balancing remain phase-two seams, not first-version dependencies.

- [ ] **Step 5: Run the complete verification matrix**

Run: `npm test`

Expected: all unit/component tests PASS.

Run: `npm run typecheck`

Expected: PASS with no TypeScript errors.

Run: `npm run build`

Expected: production build PASS and all three new Route Handlers compile under the Node runtime.

Run: `npm run test:e2e`

Expected: existing creation/team/platform tests and the new real-growth-loop test PASS with no browser console errors.

- [ ] **Step 6: Manually verify the approved visual states and commit**

At desktop 1487 × 1058 and mobile 390 × 844, compare the running states to the approved A prototypes: locked-script receipt, mixed import outcome, review with memory preview, and next creation with memory influence. Check hierarchy, clipping, padding, focus, error recovery, and overflow. Fix only visible mismatches within the approved design; do not invent a new visual direction.

```bash
git add tests/e2e/fixtures/real-metrics.csv tests/e2e/real-growth-loop.spec.ts tests/e2e/content-loop.spec.ts src/scripts/e2e-server.ts src/scripts/demo-data.ts src/scripts/clear-demo.ts README.md .env.example docs/operations/real-growth-loop.md
git commit -m "test: verify real publication review memory loop"
```

## Completion Gate

Implementation is complete only when all of the following are simultaneously true:

1. A publication can be traced to an exact locked-script version or an explicit external record.
2. Every formal metric row is an immutable real snapshot or a persisted redacted error; uploaded bytes are gone.
3. Every automatic match is explainable by ID, normalized URL, or one exact title candidate inside ±7 days.
4. Every review is bound to an exact evidence-set hash and exact snapshot links.
5. Only a current 5+ sample review can create a scoped immutable memory version.
6. A later creation Run stores and displays the exact memory version it actually used.
7. Tenant, IP, account, capability, and platform-audience isolation pass service, route, and browser tests.
8. Unit tests, typecheck, production build, full E2E, desktop visual QA, and mobile overflow QA all pass.
