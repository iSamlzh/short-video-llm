# Real Metrics Review and Tenant Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let authorized employees import real CSV/XLSX video data, match it to published content, receive evidence-bounded Agent reviews, and confirm tenant-private memory for future creation.

**Architecture:** Import is an asynchronous-looking checkpointed service executed in-process for the single-server prototype. Parsers normalize CSV/XLSX rows into immutable metric snapshots, a deterministic matcher links them to publications or a manual-resolution queue, and `ReviewService` generates account-relative findings. Only human-confirmed findings produce a versioned tenant-memory record consumed by creation.

**Tech Stack:** Next.js Route Handlers, SQLite, Zod, `exceljs` for CSV/XLSX parsing, existing structured LLM client, React, Vitest, Playwright.

## Global Constraints

- Execute after tenant access and result-first creation plans.
- Import and review require both capability and content-account scope.
- Store raw import metadata and row errors, but never store uploaded file bytes after processing.
- Metric snapshots are append-only and keyed by platform video ID plus captured-at time.
- Unmatched rows are never auto-bound.
- Reviews compare against the same account and compatible content type; avoid universal “viral” thresholds.
- Clearly separate supported observations, hypotheses, and evidence limits.
- Confirmed memory is tenant/IP/account-private and never changes platform templates.
- Simulation data is rejected by real import/review services.
- Follow TDD and commit after every task.

---

### Task 1: Add Real Metrics Contracts, Parser, and Persistence

**Files:**
- Modify: `prototype/package.json`
- Modify: `prototype/package-lock.json`
- Create: `prototype/src/domain/metrics.ts`
- Create: `prototype/src/domain/metrics-schemas.ts`
- Create: `prototype/src/lib/db/migrations/005_real_metrics_review.sql`
- Create: `prototype/src/lib/import/spreadsheet-parser.ts`
- Create: `prototype/src/lib/db/metrics-repository.ts`
- Test: `prototype/tests/unit/spreadsheet-parser.test.ts`
- Test: `prototype/tests/unit/metrics-repository.test.ts`
- Create: `prototype/tests/fixtures/metrics-valid.csv`
- Create: `prototype/tests/fixtures/metrics-partial.xlsx`

**Interfaces:**
- Consumes: content-account IDs and migration runner.
- Produces: `parseMetricFile(buffer, filename)`, `MetricImportRow`, `RealMetricSnapshot`, `MetricImportReport`, `MetricsRepository`.

- [ ] **Step 1: Install the spreadsheet parser dependency**

Run: `npm install exceljs`

Expected: `exceljs` is added to dependencies and the lockfile is updated.

- [ ] **Step 2: Write failing CSV/XLSX parser tests**

```ts
it("normalizes Chinese CSV headers", async () => {
  const rows = await parseMetricFile(readFixture("metrics-valid.csv"), "metrics-valid.csv")
  expect(rows[0]).toMatchObject({ platformVideoId: "wx-001", plays: 1800, capturedAt: "2026-08-17T08:00:00.000Z" })
})

it("returns row errors without rejecting valid rows", async () => {
  const result = await parseMetricFile(readFixture("metrics-partial.xlsx"), "metrics-partial.xlsx")
  expect(result.validRows).toHaveLength(2)
  expect(result.errors).toEqual([expect.objectContaining({ rowNumber: 4, code: "PLAYS_INVALID" })])
})
```

- [ ] **Step 3: Run and verify RED**

Run: `npm test -- spreadsheet-parser.test.ts metrics-repository.test.ts`

Expected: FAIL because parser, contracts, and tables do not exist.

- [ ] **Step 4: Implement normalized contracts and parser**

```ts
export type RealMetricSnapshot = {
  contentAccountId: string
  platformVideoId: string
  capturedAt: string
  impressions?: number
  plays: number
  completions?: number
  likes?: number
  comments?: number
  saves?: number
  shares?: number
  inquiries?: number
  isSimulated: false
}
```

Map accepted aliases such as `视频ID`, `作品ID`, `播放`, `播放量`, and `采集时间` to canonical fields. Reject negative counts, invalid dates, missing video ID, unsupported extensions, files above the configured prototype limit, and rows with `isSimulated=true`.

- [ ] **Step 5: Add import and snapshot tables**

Migration 005 creates `metric_import_batches`, `metric_import_row_errors`, `real_metric_snapshots`, `publication_matches`, `content_reviews`, `review_evidence_links`, and `tenant_memory_versions`. Unique snapshot constraint: `(tenant_id, content_account_id, platform_video_id, captured_at)`.

- [ ] **Step 6: Verify and commit**

Run: `npm test -- spreadsheet-parser.test.ts metrics-repository.test.ts`

Expected: PASS.

```bash
git add prototype/package.json prototype/package-lock.json prototype/src/domain/metrics.ts prototype/src/domain/metrics-schemas.ts prototype/src/lib/db/migrations/005_real_metrics_review.sql prototype/src/lib/import/spreadsheet-parser.ts prototype/src/lib/db/metrics-repository.ts prototype/tests/unit/spreadsheet-parser.test.ts prototype/tests/unit/metrics-repository.test.ts prototype/tests/fixtures
git commit -m "feat: import real video metric snapshots"
```

### Task 2: Match Imports to Publications with Manual Resolution

**Files:**
- Create: `prototype/src/services/metric-import-service.ts`
- Create: `prototype/src/services/publication-matcher.ts`
- Test: `prototype/tests/unit/metric-import-service.test.ts`
- Test: `prototype/tests/unit/publication-matcher.test.ts`

**Interfaces:**
- Consumes: parser, metrics repository, tenant access guard, publication repository.
- Produces: `MetricImportService.import(context, input)`, `PublicationMatcher.match(row)`, `resolveMatch(context, rowId, publicationId)`.

- [ ] **Step 1: Write failing access, duplicate, and matching tests**

```ts
it("rejects import outside assigned account scope", async () => {
  await expect(service.import(reviewerContext, { contentAccountId: "unassigned", file })).rejects.toThrow("ACCOUNT_SCOPE_FORBIDDEN")
})

it("does not auto-bind an ambiguous title match", () => {
  expect(matcher.match(rowWithTitleOnly, [similarPublicationOne, similarPublicationTwo])).toEqual({ status: "unmatched", reason: "AMBIGUOUS_TITLE" })
})

it("returns duplicate snapshots in the report", async () => {
  const first = await service.import(reviewerContext, input)
  const second = await service.import(reviewerContext, input)
  expect(first.inserted).toBe(3)
  expect(second.duplicates).toBe(3)
})
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- metric-import-service.test.ts publication-matcher.test.ts`

Expected: FAIL because import/matcher services are absent.

- [ ] **Step 3: Implement deterministic matching priority**

Match in order: exact platform video ID, normalized exact URL, then unique normalized title within a seven-day publication window. Anything else remains unmatched. Manual resolution requires `metrics.import` and account scope and writes an audit event. The resolver can link an existing publication or call `PublicationService.createExternal` with the row's platform identity, title, and published time before linking it.

- [ ] **Step 4: Implement partial-success transactions**

Create the batch first, validate rows independently, insert valid non-duplicates, save row errors and unmatched state, then finalize counters. A parser-level fatal error marks the batch failed without inserting snapshots; one invalid row never rolls back valid rows.

- [ ] **Step 5: Verify and commit**

Run: `npm test -- metric-import-service.test.ts publication-matcher.test.ts`

Expected: PASS.

```bash
git add prototype/src/services/metric-import-service.ts prototype/src/services/publication-matcher.ts prototype/tests/unit/metric-import-service.test.ts prototype/tests/unit/publication-matcher.test.ts
git commit -m "feat: match imported metrics to published content"
```

### Task 3: Generate Evidence-Bounded Reviews and Confirm Tenant Memory

**Files:**
- Modify: `prototype/src/domain/schemas.ts`
- Create: `prototype/src/prompts/real-review.ts`
- Create: `prototype/src/services/account-baseline-service.ts`
- Create: `prototype/src/services/review-service.ts`
- Create: `prototype/src/services/tenant-memory-service.ts`
- Modify: `prototype/src/lib/llm/adapter.ts`
- Modify: `prototype/src/lib/llm/fake.ts`
- Test: `prototype/tests/unit/review-service.test.ts`
- Test: `prototype/tests/unit/tenant-memory-service.test.ts`

**Interfaces:**
- Consumes: matched real snapshots, publication lineage, access guards, structured LLM client.
- Produces: `ReviewService.generate(context, contentAccountId, publicationId)`, `TenantMemoryService.confirm(context, reviewId, edits)` and `getCurrentMemory(tenantId, ipId, accountId?)`.

- [ ] **Step 1: Write failing review boundary tests**

```ts
it("rejects review when only simulated metrics exist", async () => {
  await expect(service.generate(context, accountId, publicationId)).rejects.toThrow("REAL_METRICS_REQUIRED")
})

it("separates observations, hypotheses, and limits", async () => {
  const review = await service.generate(context, accountId, publicationId)
  expect(review.observations.length).toBeGreaterThan(0)
  expect(review.hypotheses.every(item => item.confidence !== "certain")).toBe(true)
  expect(review.evidenceLimits).toContain("账号历史")
})

it("does not create memory until a human confirms", async () => {
  await service.generate(context, accountId, publicationId)
  expect(memory.getCurrentMemory(tenantId, ipId, accountId)).toBeNull()
})
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- review-service.test.ts tenant-memory-service.test.ts`

Expected: FAIL because real review/memory services are absent.

- [ ] **Step 3: Implement account-relative baseline inputs**

Calculate medians and percentile bands from the same content account and compatible content type. Include sample size and missing fields. Do not infer causation from a single metric or compare absolute platform totals across unrelated accounts.

```ts
export type RealContentReview = {
  observations: Array<{ text: string; evidenceSnapshotIds: string[] }>
  hypotheses: Array<{ text: string; confidence: "low" | "medium"; evidenceFor: string[]; evidenceAgainst: string[] }>
  keep: string[]
  improve: string[]
  nextContent: string
  evidenceLimits: string
}
```

- [ ] **Step 4: Implement human-confirmed private memory**

`confirm` validates `review.generate` capability and account scope, saves operator edits plus source review/version, and creates a new immutable `tenant_memory_versions` payload for the exact tenant/IP/account. The platform template service has no dependency on this repository. The creation context provider reads the latest confirmed memory only.

- [ ] **Step 5: Verify and commit**

Run: `npm test -- review-service.test.ts tenant-memory-service.test.ts`

Expected: PASS.

```bash
git add prototype/src/domain/schemas.ts prototype/src/prompts/real-review.ts prototype/src/services/account-baseline-service.ts prototype/src/services/review-service.ts prototype/src/services/tenant-memory-service.ts prototype/src/lib/llm/adapter.ts prototype/src/lib/llm/fake.ts prototype/tests/unit/review-service.test.ts prototype/tests/unit/tenant-memory-service.test.ts
git commit -m "feat: create evidence-bounded private review memory"
```

### Task 4: Add Secure Import/Review APIs and AI-Native Review Workspace

**Files:**
- Create: `prototype/src/app/api/app/metrics/[...segments]/route.ts`
- Create: `prototype/src/app/api/app/reviews/[...segments]/route.ts`
- Create: `prototype/src/app/app/review/page.tsx`
- Create: `prototype/src/components/review/ReviewWorkspace.tsx`
- Create: `prototype/src/components/review/ImportPanel.tsx`
- Create: `prototype/src/components/review/AgentFindings.tsx`
- Create: `prototype/src/components/review/UnmatchedRows.tsx`
- Modify: `prototype/src/app/globals.css`
- Test: `prototype/tests/unit/review-route.test.ts`
- Test: `prototype/tests/unit/review-ui.test.tsx`
- Test: `prototype/tests/e2e/real-review.spec.ts`

**Interfaces:**
- Consumes: metric import, matcher, review, and tenant-memory services.
- Produces: `/app/review` authorized workflow and import/review endpoints.

- [ ] **Step 1: Write failing route and UI tests**

```tsx
it("leads with findings that need attention", () => {
  render(<ReviewWorkspace initialView={reviewFixture} />)
  expect(screen.getByText("3 条内容值得你看一下")).toBeVisible()
  expect(screen.queryByText("数据总览")).not.toBeInTheDocument()
})

it("shows row errors and keeps successful rows", async () => {
  render(<ImportPanel onImport={importPartialFixture} />)
  await uploadFixture("metrics-partial.xlsx")
  expect(await screen.findByText("成功导入 2 条，1 条需要处理")).toBeVisible()
})
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- review-route.test.ts review-ui.test.tsx`

Expected: FAIL because routes/components do not exist.

- [ ] **Step 3: Implement secured multipart APIs**

Resolve session and require `metrics.import` plus account scope before reading the uploaded body. Enforce content type and byte limit. Review generation and confirmation require `review.generate`; viewing history requires `review.view`. Return stable 400/403/409/413 errors without exposing file paths or cross-tenant IDs.

- [ ] **Step 4: Implement findings-first review UI**

The default page lists only authorized accounts and leads with Agent findings such as “3 条内容值得你看一下”. Import is a secondary action. Selecting a finding shows observations, hypotheses, evidence, limits, editable offline context, and explicit “确认并用于后续创作”. Unmatched rows remain a focused correction queue rather than a blocking wizard.

- [ ] **Step 5: Verify unit/E2E and commit**

Run: `npm test -- review-route.test.ts review-ui.test.tsx`

Expected: PASS.

Run: `npm run test:e2e -- real-review.spec.ts`

Expected: scoped reviewer imports a mixed-validity file, resolves one unmatched row, generates a real review, confirms memory, and cannot access an unassigned account.

```bash
git add prototype/src/app/api/app/metrics prototype/src/app/api/app/reviews prototype/src/app/app/review prototype/src/components/review prototype/src/app/globals.css prototype/tests/unit/review-route.test.ts prototype/tests/unit/review-ui.test.tsx prototype/tests/e2e/real-review.spec.ts
git commit -m "feat: add AI-native real data review workspace"
```

### Task 5: Feed Confirmed Memory into Future Creation Without Platform Leakage

**Files:**
- Modify: `prototype/src/services/auto-creation-orchestrator.ts`
- Modify: `prototype/src/services/platform-template-retriever.ts`
- Modify: `prototype/src/lib/db/repository.ts`
- Test: `prototype/tests/unit/creation-memory-integration.test.ts`

**Interfaces:**
- Consumes: `TenantMemoryService.getCurrentMemory`.
- Produces: generation lineage with tenant-memory version and tenant-local ranking adjustments.

- [ ] **Step 1: Write failing integration tests**

```ts
it("uses confirmed account memory in the next creation run", async () => {
  const result = await orchestrator.createUsableDraft(context, input)
  expect(adapter.calls.find(call => call.operation === "topics")?.input).toMatchObject({
    tenantMemory: expect.objectContaining({ version: 2 }),
  })
  expect(result.lineage.tenantMemoryVersion).toBe(2)
})

it("never writes tenant review content to platform template tables", async () => {
  await orchestrator.createUsableDraft(context, input)
  expect(contentBrainRepository.writeCount).toBe(0)
})
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- creation-memory-integration.test.ts`

Expected: FAIL because creation does not read tenant memory.

- [ ] **Step 3: Add redacted memory to creation context**

Pass only confirmed `keep`, `avoid`, and `nextContentSignals` to topic/template ranking and prompts. Do not pass raw metrics, employee notes unrelated to content, member identities, or review chain-of-thought. Save the exact memory version in `generation_lineage`.

- [ ] **Step 4: Verify and commit**

Run: `npm test -- creation-memory-integration.test.ts auto-creation-orchestrator.test.ts platform-template-retriever.test.ts`

Expected: PASS.

```bash
git add prototype/src/services/auto-creation-orchestrator.ts prototype/src/services/platform-template-retriever.ts prototype/src/lib/db/repository.ts prototype/tests/unit/creation-memory-integration.test.ts
git commit -m "feat: apply private review memory to future creation"
```
