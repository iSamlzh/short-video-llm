# Draft Save and Finalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist manual script revisions and make “确认定稿” and “复制并去拍” lock exactly the QA-validated version the user sees.

**Architecture:** Keep the existing deterministic Run state machine, SQLite repository, provider-neutral LLM adapter, and result-first page. Generation stops at `WAITING_LOCK_CONFIRMATION`; manual saves create immutable script-selection revisions, QA binds to one revision, and a server-side finalization application service conditionally saves, runs QA, and locks. The React page remains result-first and uses its existing controls as thin clients of those server operations.

**Tech Stack:** Next.js 16.3.1, React 19.2.8, TypeScript 5.9.3, SQLite via better-sqlite3 13.0.3, Zod 4.4.3, Vitest 4.1.10, Testing Library 16.3.2, Playwright 1.62.1.

## Global Constraints

- The approved specification is `docs/superpowers/specs/2026-08-17-draft-save-finalization-design.md`.
- 模型生成和首次 QA 完成后，Run 停留在 `WAITING_LOCK_CONFIRMATION`，页面显示“待确认”，不自动锁稿。
- “完成本段编辑”和“完成整篇编辑”均保存当前完整口播稿；服务器按内容哈希判断无变化时不创建空版本。
- 人工修改创建新的不可变 Script Batch 与 Script Selection，旧版本不覆盖、不删除。
- 人工修改会使旧质量报告失效，Run 回到 `READY_FOR_QA`。
- 未修改的生成稿在确认时复用已有 QA，不重复产生模型成本。
- 修改后的稿件在最终动作中重新执行 QA；只有硬门槛通过才能锁稿。
- “确认定稿”和“复制并去拍”使用同一个服务端 finalization 流程；复制只在 finalization 成功后执行。
- 保存和定稿必须校验 tenant、IP、content account scope 与 `expectedRevision`，禁止静默覆盖。
- 页面不增加新工作台、弹窗、保存工具栏或逐字自动保存。
- 现有 provider-neutral LLM adapter、SQLite checkpoint、内部内容结构隔离与首版单机边界保持不变。
- 每项生产代码修改使用 TDD：先运行会因缺失行为而失败的测试，再写最小实现。
- 实现前阅读 `prototype/AGENTS.md` 以及 `prototype/node_modules/next/dist/docs/01-app/03-building-your-application/01-routing/13-route-handlers.mdx`。

---

## File Structure

```text
prototype/src/domain/models.ts
  Add SAVE_SCRIPT_REVISION command only.
prototype/src/domain/state-machine.ts
  Own valid revision transitions.
prototype/src/domain/schemas.ts
  Validate editable paragraph payloads.
prototype/src/lib/db/migrations/006_script_revision_lineage.sql
  Bind QA and locks to script-selection revisions.
prototype/src/lib/db/migrations.ts
  Register migration 6.
prototype/src/lib/db/repository.ts
  Persist and read QA/lock lineage; provide lock idempotency lookup.
prototype/src/services/run-service.ts
  Save immutable revisions, bind QA, and lock idempotently.
prototype/src/services/auto-creation-orchestrator.ts
  Return QA-passed drafts without auto-locking.
prototype/src/services/creation-presenter.ts
  Present selected draft or locked revision with explicit status.
prototype/src/services/creation-app-service.ts
  Authorize and orchestrate save/finalize.
prototype/src/app/api/app/creation/[...segments]/route.ts
  Expose PUT draft and POST finalize commands.
prototype/src/components/creation/DailyCreationWorkspace.tsx
  Own network state and clipboard sequencing.
prototype/src/components/creation/DailyCreationView.tsx
  Submit paragraphs from existing edit/finalize controls.
prototype/tests/unit/*.test.ts(x)
  Prove state, lineage, service, presenter, and component contracts.
prototype/tests/e2e/content-loop.spec.ts
  Prove save survives refresh and finalization locks the visible version.
prototype/README.md
  Document draft/final semantics and current test totals.
```

---

### Task 1: Persist QA and lock lineage

**Files:**
- Create: `prototype/src/lib/db/migrations/006_script_revision_lineage.sql`
- Modify: `prototype/src/lib/db/migrations.ts`
- Modify: `prototype/src/lib/db/repository.ts`
- Modify: `prototype/tests/unit/migrations.test.ts`
- Modify: `prototype/tests/unit/run-service.test.ts`

**Interfaces:**
- Consumes: current Script Selection version from `PrototypeRepository.getCurrentScriptSelection(runId)`.
- Produces: `saveQualityReport(runId, report, scriptSelectionVersion)`, `getLatestQualityReport(runId)` with `scriptSelectionVersion`, `lockSelectedScript(runId, scriptSelectionVersion)`, and `getLockedScriptForSelection(runId, scriptSelectionVersion)`.

- [ ] **Step 1: Write failing migration and repository lineage tests**

Add this migration assertion to `migrations.test.ts`:

```ts
it("adds script-selection lineage to quality reports and locked scripts", () => {
  database = openDatabase(":memory:")
  const qualityColumns = database.prepare("PRAGMA table_info(quality_reports)").all() as Array<{ name: string }>
  const lockColumns = database.prepare("PRAGMA table_info(locked_scripts)").all() as Array<{ name: string }>
  expect(qualityColumns.map((column) => column.name)).toContain("script_selection_version")
  expect(lockColumns.map((column) => column.name)).toContain("script_selection_version")
  expect(database.prepare("SELECT COUNT(*) count FROM schema_migrations WHERE version = 6").get()).toEqual({ count: 1 })
})
```

Extend the QA fixture test in `run-service.test.ts`:

```ts
it("binds QA and locked output to the selected script revision", async () => {
  const { repository, service, adapter, run } = await selectedScriptFixture()
  const selection = repository.getCurrentScriptSelection(run.id)!
  adapter.enqueue({ json: qualityReport(true) })
  await service.runQa(run.id, run.inputVersion)
  const report = repository.getLatestQualityReport(run.id)
  expect(report?.scriptSelectionVersion).toBe(selection.version)
  service.lockScript(run.id)
  expect(repository.getLatestLockedScript(run.id)?.scriptSelectionVersion).toBe(selection.version)
})
```

- [ ] **Step 2: Run the focused tests and verify the expected failures**

Run:

```powershell
npm test -- --run tests/unit/migrations.test.ts tests/unit/run-service.test.ts
```

Expected: FAIL because migration 6 and `scriptSelectionVersion` do not exist.

- [ ] **Step 3: Add migration 6 and register it**

Create `006_script_revision_lineage.sql`:

```sql
ALTER TABLE quality_reports ADD COLUMN script_selection_version INTEGER;
ALTER TABLE locked_scripts ADD COLUMN script_selection_version INTEGER;
CREATE INDEX IF NOT EXISTS idx_quality_report_lineage
  ON quality_reports(run_id, script_selection_version, version);
CREATE UNIQUE INDEX IF NOT EXISTS idx_locked_script_selection
  ON locked_scripts(run_id, script_selection_version)
  WHERE script_selection_version IS NOT NULL;
```

Append to the `migrations` array:

```ts
{ version: 6, filename: "006_script_revision_lineage.sql" },
```

- [ ] **Step 4: Make repository lineage explicit**

Change repository writes and reads to use the exact signatures:

```ts
saveQualityReport(runId: string, report: QualityReport, scriptSelectionVersion: number)
lockSelectedScript(runId: string, scriptSelectionVersion: number)
getLockedScriptForSelection(runId: string, scriptSelectionVersion: number)
```

New rows always write the revision. Existing rows with `NULL` remain readable but cannot satisfy current-revision lock idempotency.

- [ ] **Step 5: Re-run the focused tests**

Run:

```powershell
npm test -- --run tests/unit/migrations.test.ts tests/unit/run-service.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the lineage slice**

```powershell
git add prototype/src/lib/db/migrations prototype/src/lib/db/migrations.ts prototype/src/lib/db/repository.ts prototype/tests/unit/migrations.test.ts prototype/tests/unit/run-service.test.ts
git commit -m "feat: bind quality checks to script revisions"
```

---

### Task 2: Stop auto-locking and save immutable script revisions

**Files:**
- Modify: `prototype/src/domain/models.ts`
- Modify: `prototype/src/domain/state-machine.ts`
- Modify: `prototype/src/domain/schemas.ts`
- Modify: `prototype/src/services/run-service.ts`
- Modify: `prototype/src/services/auto-creation-orchestrator.ts`
- Modify: `prototype/tests/unit/domain.test.ts`
- Modify: `prototype/tests/unit/run-service.test.ts`
- Modify: `prototype/tests/unit/auto-creation-orchestrator.test.ts`

**Interfaces:**
- Consumes: repository lineage methods from Task 1 and current `ScriptCandidate`.
- Produces: `RunService.saveScriptRevision(runId, expectedRevision, paragraphs)` returning `{ saved, revision, runView }`; generated drafts end in `WAITING_LOCK_CONFIRMATION`; `RunService.lockScript(runId)` is current-revision idempotent.

- [ ] **Step 1: Write failing state and lifecycle tests**

Change the first orchestrator test to assert:

```ts
expect(result.run.state).toBe("WAITING_LOCK_CONFIRMATION")
expect(result.lockedScript).toBeNull()
expect(result.scriptSelection?.scriptId).toBe("script-1")
expect(result.qualityReport?.hardGatePassed).toBe(true)
```

Add revision tests to `run-service.test.ts`:

```ts
it("saves an edited script as a new immutable selection", async () => {
  const { repository, service, adapter, run } = await selectedScriptFixture()
  adapter.enqueue({ json: qualityReport(true) })
  await service.runQa(run.id, run.inputVersion)
  const before = repository.getCurrentScriptSelection(run.id)!
  const result = service.saveScriptRevision(run.id, before.version, ["新开头", "新正文", "新结尾"])
  expect(result.saved).toBe(true)
  expect(result.revision).toBe(before.version + 1)
  expect(service.getRun(run.id).state).toBe("READY_FOR_QA")
  expect(repository.listScriptBatches(run.id)).toHaveLength(2)
})

it("rejects a save based on a stale script revision", async () => {
  const { repository, service, adapter, run } = await selectedScriptFixture()
  adapter.enqueue({ json: qualityReport(true) })
  await service.runQa(run.id, run.inputVersion)
  const before = repository.getCurrentScriptSelection(run.id)!
  service.saveScriptRevision(run.id, before.version, ["版本二开头", "版本二正文", "版本二结尾"])
  expect(() => service.saveScriptRevision(run.id, before.version, ["冲突开头", "冲突正文", "冲突结尾"]))
    .toThrow("SCRIPT_VERSION_CONFLICT")
})

it("does not create a revision when paragraphs are unchanged", async () => {
  const { repository, service, adapter, run } = await selectedScriptFixture()
  adapter.enqueue({ json: qualityReport(true) })
  await service.runQa(run.id, run.inputVersion)
  const selection = repository.getCurrentScriptSelection(run.id)!
  const script = repository.getSelectedScript(run.id)!
  const result = service.saveScriptRevision(run.id, selection.version, [script.hook, script.body, script.callToAction])
  expect(result).toMatchObject({ saved: false, revision: selection.version })
  expect(repository.listScriptBatches(run.id)).toHaveLength(1)
})
```

- [ ] **Step 2: Run focused lifecycle tests and verify they fail**

```powershell
npm test -- --run tests/unit/domain.test.ts tests/unit/run-service.test.ts tests/unit/auto-creation-orchestrator.test.ts
```

Expected: FAIL because generation still locks and no revision command/service exists.

- [ ] **Step 3: Add the revision command and paragraph schema**

Add `SAVE_SCRIPT_REVISION` to `RunCommand`. Add these transitions:

```ts
WAITING_LOCK_CONFIRMATION: { LOCK: "LOCKED", SAVE_SCRIPT_REVISION: "READY_FOR_QA" },
READY_FOR_QA: { RUN_QA: "RUNNING_QA", SAVE_SCRIPT_REVISION: "READY_FOR_QA" },
LOCKED: { SIMULATE_PUBLICATION: "SIMULATING_PUBLICATION", SAVE_SCRIPT_REVISION: "READY_FOR_QA" },
```

Add the schema:

```ts
export const scriptRevisionParagraphsSchema = z.array(z.string().trim().min(1)).min(2).max(30)
```

- [ ] **Step 4: Implement `saveScriptRevision()`**

Use this exact public signature:

```ts
saveScriptRevision(runId: string, expectedRevision: number, paragraphsInput: string[]) {
  // validate current selection version before any write
  // map first → hook, last → callToAction, middle → body
  // return saved:false when normalized content is unchanged
  // save one-item script batch and select its new script ID
  // transition with SAVE_SCRIPT_REVISION and return the latest run view
}
```

Generate the new ID with `randomUUID()`. Estimate seconds as:

```ts
Math.max(15, Math.ceil([hook, body, callToAction].join("").length / 4.5))
```

Normalize paragraphs with trim before comparing or saving.

- [ ] **Step 5: Bind QA and make locking idempotent**

`runQa()` passes the current Script Selection version to `saveQualityReport()`. `lockScript()` must:

1. require the latest QA to match the current selection version;
2. throw `QA_RESULT_STALE` if it does not;
3. return `getLockedScriptForSelection()` when that revision is already locked;
4. otherwise create one lock and transition from `WAITING_LOCK_CONFIRMATION` to `LOCKED`.

Remove `this.lockScript(runId)` from both automatic generation methods.

- [ ] **Step 6: Re-run lifecycle tests**

```powershell
npm test -- --run tests/unit/domain.test.ts tests/unit/run-service.test.ts tests/unit/auto-creation-orchestrator.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit the lifecycle slice**

```powershell
git add prototype/src/domain prototype/src/services/run-service.ts prototype/src/services/auto-creation-orchestrator.ts prototype/tests/unit/domain.test.ts prototype/tests/unit/run-service.test.ts prototype/tests/unit/auto-creation-orchestrator.test.ts
git commit -m "feat: persist editable script revisions"
```

---

### Task 3: Expose authorized save and finalization application commands

**Files:**
- Modify: `prototype/src/services/creation-presenter.ts`
- Modify: `prototype/src/services/creation-app-service.ts`
- Modify: `prototype/src/app/api/app/creation/[...segments]/route.ts`
- Create: `prototype/tests/unit/creation-app-service.test.ts`
- Modify: `prototype/tests/unit/creation-presenter.test.ts`

**Interfaces:**
- Consumes: `RunService.saveScriptRevision()` and lineage access checks.
- Produces: `CreationAppService.saveDraft(context, runId, input)`, `CreationAppService.finalize(context, runId, input)`, `PUT /runs/{id}/draft`, `POST /runs/{id}/finalize`, `CreationDraftView` with `revision`, `status`, and `lockedVersion`, and `DraftMutationResult = CreationDraftView & { saved: boolean }`.

- [ ] **Step 1: Write failing presenter contract tests**

Replace the locked-only presenter fixture with a selected draft fixture and assert:

```ts
expect(draft).toMatchObject({
  runId: "run-1",
  revision: 1,
  status: "ready_to_confirm",
  lockedVersion: null,
  title: "今天这条就讲信任",
})
```

Add a second test where the current selection differs from the latest quality report lineage:

```ts
expect(draft.status).toBe("needs_qa")
expect(draft.checks).toEqual([])
```

- [ ] **Step 2: Write failing application-service tests**

Create `creation-app-service.test.ts` using an in-memory app database seeded by `seedDemoData()` and a `PrototypeFixtureLlmAdapter`. Cover these observable results:

```ts
const saved = service.saveDraft(ownerAccess, created.runId, {
  expectedRevision: created.revision,
  paragraphs: ["保存后的开头", "保存后的正文", "保存后的结尾"],
})
expect(saved).toMatchObject({ revision: created.revision + 1, status: "needs_qa" })

const finalized = await service.finalize(ownerAccess, saved.runId, {
  expectedRevision: saved.revision,
  paragraphs: saved.paragraphs,
})
expect(finalized).toMatchObject({ status: "locked", lockedVersion: 1 })
```

Also assert that a reviewer without `content.edit` and a user outside the Run lineage both receive a forbidden/not-found error without reading the draft.

- [ ] **Step 3: Run presenter and application tests and verify they fail**

```powershell
npm test -- --run tests/unit/creation-presenter.test.ts tests/unit/creation-app-service.test.ts
```

Expected: FAIL because presenter requires locked output and the application commands do not exist.

- [ ] **Step 4: Implement the new presenter contract**

Present from `getSelectedScript(runId)` plus current selection. Derive status as:

```ts
const status = lockedScript?.scriptSelectionVersion === selection.version
  ? "locked"
  : qualityReport?.scriptSelectionVersion === selection.version
    ? "ready_to_confirm"
    : "needs_qa"
```

Only include QA checks when the report matches the current revision. Use `v${revision} · 待确认`, `v${revision} · 待检查`, or `v${revision} · 已定稿` for the version label.

- [ ] **Step 5: Implement `saveDraft()` and `finalize()`**

Use these inputs:

```ts
type DraftMutationInput = { expectedRevision: number; paragraphs: string[] }
type DraftMutationResult = CreationDraftView & { saved: boolean }

saveDraft(context: TenantAccessContext, runId: string, input: DraftMutationInput): DraftMutationResult
finalize(context: TenantAccessContext, runId: string, input: DraftMutationInput): Promise<CreationDraftView>
```

Both methods require `content.edit`, call `lineage.canAccess()`, and return `RUN_NOT_FOUND` on scope failure. `finalize()` saves conditionally, runs QA only in `READY_FOR_QA`, locks only in `WAITING_LOCK_CONFIRMATION`, and returns an existing lock when state is already `LOCKED` for the current revision.

- [ ] **Step 6: Add route dispatch**

Add:

```ts
if (request.method === "PUT" && segments[0] === "runs" && segments[1] && segments[2] === "draft")
if (request.method === "POST" && segments[0] === "runs" && segments[1] && segments[2] === "finalize")
```

Parse the request with a shared Zod object containing `expectedRevision` and `paragraphs`; malformed input returns `SCRIPT_PARAGRAPHS_INVALID` with status 400. Add an exported `PUT` handler beside the existing `GET` and `POST` handlers.

- [ ] **Step 7: Re-run service tests**

```powershell
npm test -- --run tests/unit/creation-presenter.test.ts tests/unit/creation-app-service.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit the application/API slice**

```powershell
git add prototype/src/services/creation-presenter.ts prototype/src/services/creation-app-service.ts 'prototype/src/app/api/app/creation/[...segments]/route.ts' prototype/tests/unit/creation-presenter.test.ts prototype/tests/unit/creation-app-service.test.ts
git commit -m "feat: add draft save and finalization commands"
```

---

### Task 4: Connect the existing editor and final actions

**Files:**
- Modify: `prototype/src/components/creation/DailyCreationView.tsx`
- Modify: `prototype/src/components/creation/DailyCreationWorkspace.tsx`
- Modify: `prototype/src/app/globals.css`
- Modify: `prototype/src/presets/product-demo.ts`
- Modify: `prototype/tests/unit/ai-native-pages.test.tsx`

**Interfaces:**
- Consumes: Task 3 HTTP contracts and `CreationDraftView`.
- Produces: persisted paragraph/whole-script completion, server-driven lock labels, finalization-before-copy, and recoverable error states.

- [ ] **Step 1: Write failing component save tests**

Change the component fixture to include:

```ts
{ ...demoProductData.draft, runId: "run-1", revision: 1, status: "ready_to_confirm", lockedVersion: null }
```

Add:

```ts
it("saves all paragraphs before closing one paragraph editor", async () => {
  const save = vi.fn().mockResolvedValue(undefined)
  render(<DailyCreationView draft={draft} onSave={save} />)
  await userEvent.click(screen.getByRole("button", { name: "编辑第 2 段" }))
  await userEvent.clear(screen.getByRole("textbox", { name: "第 2 段" }))
  await userEvent.type(screen.getByRole("textbox", { name: "第 2 段" }), "持久化后的第二段")
  await userEvent.click(screen.getByRole("button", { name: "完成第 2 段编辑" }))
  expect(save).toHaveBeenCalledWith([
    draft.paragraphs[0],
    "持久化后的第二段",
    ...draft.paragraphs.slice(2),
  ])
  expect(screen.queryByRole("textbox", { name: "第 2 段" })).not.toBeInTheDocument()
})

it("keeps edited text open when saving fails", async () => {
  const save = vi.fn().mockRejectedValue(new Error("保存失败"))
  render(<DailyCreationView draft={draft} onSave={save} />)
  await userEvent.click(screen.getByRole("button", { name: "编辑第 2 段" }))
  await userEvent.click(screen.getByRole("button", { name: "完成第 2 段编辑" }))
  expect(screen.getByRole("textbox", { name: "第 2 段" })).toBeVisible()
})
```

- [ ] **Step 2: Write failing finalization/copy tests**

Add:

```ts
it("finalizes the visible paragraphs before copying", async () => {
  const finalize = vi.fn().mockResolvedValue(undefined)
  render(<DailyCreationView draft={draft} onFinalize={finalize} />)
  await userEvent.click(screen.getByRole("button", { name: "复制并去拍" }))
  expect(finalize).toHaveBeenCalledWith(expect.objectContaining({ copyAfter: true }))
})

it("uses server status for the locked label", () => {
  render(<DailyCreationView draft={{ ...draft, status: "locked", lockedVersion: 1 }} />)
  expect(screen.getByRole("button", { name: "已确认定稿" })).toBeDisabled()
})
```

- [ ] **Step 3: Run the component tests and verify they fail**

```powershell
npm test -- --run tests/unit/ai-native-pages.test.tsx
```

Expected: FAIL because save/finalize callbacks and server-driven status are absent.

- [ ] **Step 4: Implement view callbacks without changing page hierarchy**

Use these props:

```ts
onSave?: (paragraphs: string[]) => Promise<void>
onFinalize?: (input: { paragraphs: string[]; copyAfter: boolean }) => Promise<void>
busyAction?: "saving" | "finalizing" | null
```

Await `onSave()` before exiting paragraph or whole-script edit mode. On rejection, keep the editor open and rethrow so the workspace message remains visible. Replace local `locked` state with `draft.status === "locked"`. Starting an edit on a locked view is allowed and the next successful save changes the server-returned status to `needs_qa`.

- [ ] **Step 5: Implement workspace API sequencing**

Add `save(paragraphs)` and `finalize({ paragraphs, copyAfter })`. Both send the current `draft.revision`. `save()` updates the draft with the returned object and only shows “修改已保存，定稿前会重新检查” when `result.saved === true`. `finalize()` uses the response paragraphs for clipboard text:

```ts
const result = await fetch(`/api/app/creation/runs/${draft.runId}/finalize`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ expectedRevision: draft.revision, paragraphs }),
}).then(readJson)
setDraft(result)
if (copyAfter) await navigator.clipboard.writeText(result.paragraphs.join("\n\n"))
```

Display operation-specific notices: “正在保存修改…”, “正在检查并定稿…”, “修改已保存，定稿前会重新检查”, and errors from the API. Disable save/final buttons only during their own in-flight operation.

- [ ] **Step 6: Re-run component tests**

```powershell
npm test -- --run tests/unit/ai-native-pages.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit the UI slice**

```powershell
git add prototype/src/components/creation prototype/src/app/globals.css prototype/src/presets/product-demo.ts prototype/tests/unit/ai-native-pages.test.tsx
git commit -m "feat: save and finalize visible script edits"
```

---

### Task 5: Prove refresh persistence, lock accuracy, and regression safety

**Files:**
- Modify: `prototype/tests/e2e/content-loop.spec.ts`
- Modify: `prototype/README.md`

**Interfaces:**
- Consumes: complete server and UI flow from Tasks 1–4.
- Produces: browser acceptance evidence and updated operator documentation.

- [ ] **Step 1: Extend browser acceptance before the implementation is considered complete**

Update the existing tenant path:

```ts
await page.getByRole("button", { name: "编辑第 2 段" }).click()
await page.getByRole("textbox", { name: "第 2 段" }).fill("这是刷新后仍然存在的第二段。")
await page.getByRole("button", { name: "完成第 2 段编辑" }).click()
await expect(page.getByText("修改已保存，定稿前会重新检查")).toBeVisible()
await page.reload()
await expect(page.getByText("这是刷新后仍然存在的第二段。")).toBeVisible()
await page.getByRole("button", { name: "确认定稿" }).click()
await expect(page.getByRole("button", { name: "已确认定稿" })).toBeDisabled()
await expect(page.getByText(/已定稿/)).toBeVisible()
```

After locking, edit the second paragraph again and assert the page returns to the “待检查” state while the version label advances. Finalize the new revision and assert the UI displays the next locked version. Repository tests in Tasks 1–2 prove that the earlier locked record remains immutable.

- [ ] **Step 2: Run full unit/component verification**

```powershell
npm test
```

Expected: all test files PASS with zero failed tests.

- [ ] **Step 3: Run type and production build verification**

```powershell
npm run typecheck
npm run build
```

Expected: both commands exit 0 with no TypeScript or build errors.

- [ ] **Step 4: Run browser acceptance**

```powershell
npm run test:e2e
```

Expected: both browser paths PASS; the edit survives reload and the visible revision becomes locked.

- [ ] **Step 5: Update operator documentation**

In `prototype/README.md`, state that generated output is QA-passed but awaits user lock confirmation; completing an edit persists a revision; finalization reuses QA only when lineage matches; copying finalizes first. Replace the old test count with the count printed by Step 2.

- [ ] **Step 6: Verify the worktree and commit acceptance evidence**

```powershell
git diff --check
git status --short
git add prototype/tests/e2e/content-loop.spec.ts prototype/README.md
git commit -m "test: verify persisted draft finalization"
git status --short
```

Expected: final `git status --short` prints no output.
