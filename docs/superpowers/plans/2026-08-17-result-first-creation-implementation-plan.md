# Result-First Daily Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current selection-first wizard with a permission-aware Agent run that automatically produces one QA-checked usable script and supports reversible topic, structure, and script changes.

**Architecture:** `AutoCreationOrchestrator` snapshots tenant/IP/account context, retrieves active private structures, runs topic and script generation, accepts the model-recommended script, runs independent QA, and performs at most one automatic revision. The UI renders the usable result first; adjustment commands create downstream versions through a dedicated revision service.

**Tech Stack:** Existing LLM adapter, Zod structured outputs, SQLite version repositories, Next.js/React, Vitest, Testing Library, Playwright.

## Global Constraints

- Execute after tenant access and platform content-brain plans.
- The default path requires no topic, structure, or script selection.
- Generate 3-5 topics and exactly 3 scripts for one selected topic; the generator marks one script as recommended.
- Independent QA remains a separate model operation.
- A failed hard gate triggers at most one automatic revision; a second failure becomes `NEEDS_ATTENTION`.
- Every Run stores tenant, actor, IP snapshot, content-account ID, tenant-memory version, template-version ID, model, Prompt schema, and downstream versions.
- A rewind never deletes a prior batch or locked script.
- Customer responses expose a suitability explanation but no template body/source/internal Prompt.
- Production UI/API contain no simulation actions.
- Follow TDD and commit after every task.

---

### Task 1: Add Auto-Creation Contracts, Lineage, and Run Migration

**Files:**
- Modify: `prototype/src/domain/models.ts`
- Modify: `prototype/src/domain/schemas.ts`
- Create: `prototype/src/domain/creation.ts`
- Create: `prototype/src/lib/db/migrations/004_creation_lineage.sql`
- Modify: `prototype/src/lib/db/repository.ts`
- Test: `prototype/tests/unit/creation-lineage.test.ts`
- Test: `prototype/tests/unit/domain.test.ts`

**Interfaces:**
- Consumes: tenant/IP/account identifiers and `TemplatePackage`.
- Produces: `AutoCreationInput`, `CreationResult`, `GenerationLineage`, new Run states, repository lineage/version methods.

- [ ] **Step 1: Write failing contract tests**

```ts
it("requires tenant, actor, IP snapshot and template version lineage", () => {
  expect(() => generationLineageSchema.parse({ runId: "run-1" })).toThrow()
})

it("accepts exactly one recommended script", () => {
  const scripts = makeScripts("topic-1").map((script, index) => ({ ...script, recommended: index === 0 }))
  expect(scriptBatchSchema.parse(scripts)).toHaveLength(3)
  expect(() => scriptBatchSchema.parse(scripts.map(script => ({ ...script, recommended: false })))).toThrow()
})
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- creation-lineage.test.ts domain.test.ts`

Expected: FAIL because lineage and recommendation constraints are absent.

- [ ] **Step 3: Define result-first Run states and contracts**

```ts
export type RunState = "AUTO_PREPARING" | "READY_DRAFT" | "NEEDS_ATTENTION" | "LOCKED"

export type AutoCreationInput = {
  tenantId: string
  actorUserId: string
  ipProfileId: string
  contentAccountId?: string
}

export type CreationResult = {
  runId: string
  state: "READY_DRAFT" | "NEEDS_ATTENTION"
  topic: TopicDirectionCandidate
  script: ScriptCandidate
  qualityReport: QualityReport
  suitabilityExplanation: string[]
}
```

Keep legacy state parsing only for restoring existing local prototype runs; new Runs use the four result-first states.

- [ ] **Step 4: Add lineage tables and additive run columns**

Migration 004 adds nullable `tenant_id`, `actor_user_id`, `ip_profile_id`, `content_account_id` to legacy `runs`, plus `generation_lineage`, `script_revision_versions`, and `publications`. A publication stores tenant, content account, optional Run/locked version, platform video ID, normalized URL, title, published time, creator, and source (`generated` or `external`). New Run creation requires tenant columns; legacy rows remain readable. Repository methods append batches/reports and mark current versions without deleting history.

- [ ] **Step 5: Verify and commit**

Run: `npm test -- creation-lineage.test.ts domain.test.ts`

Expected: PASS.

```bash
git add prototype/src/domain/models.ts prototype/src/domain/schemas.ts prototype/src/domain/creation.ts prototype/src/lib/db/migrations/004_creation_lineage.sql prototype/src/lib/db/repository.ts prototype/tests/unit/creation-lineage.test.ts prototype/tests/unit/domain.test.ts
git commit -m "feat: add result-first creation lineage"
```

### Task 2: Implement Automatic Orchestration and One Revision

**Files:**
- Create: `prototype/src/services/auto-creation-orchestrator.ts`
- Create: `prototype/src/services/script-revision-service.ts`
- Modify: `prototype/src/prompts/index.ts`
- Modify: `prototype/src/services/run-service.ts`
- Modify: `prototype/src/lib/llm/fake.ts`
- Test: `prototype/tests/unit/auto-creation-orchestrator.test.ts`

**Interfaces:**
- Consumes: `PlatformTemplateRetriever.retrieve`, tenant/IP/account repository, `StructuredLlmClient`, Run repository.
- Produces: `AutoCreationOrchestrator.createUsableDraft(context, input)`, `ScriptRevisionService.reviseOnce(runId, report)`.

- [ ] **Step 1: Write failing happy-path and failure-path tests**

```ts
it("creates a QA-checked draft without user selection", async () => {
  const result = await orchestrator.createUsableDraft(ownerContext, input)
  expect(result.state).toBe("READY_DRAFT")
  expect(result.script.id).toBe("script-recommended")
  expect(result.qualityReport.hardGatePassed).toBe(true)
  expect(adapter.calls.map(call => call.operation)).toEqual(["topics", "scripts", "qa"])
})

it("revises once then stops for attention", async () => {
  adapter.enqueue({ json: qaFail }, { json: revisedScript }, { json: qaFailAgain })
  const result = await orchestrator.createUsableDraft(ownerContext, input)
  expect(result.state).toBe("NEEDS_ATTENTION")
  expect(adapter.calls.filter(call => call.operation === "script_revision")).toHaveLength(1)
})
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- auto-creation-orchestrator.test.ts`

Expected: FAIL because orchestration and revision operation are missing.

- [ ] **Step 3: Update prompts and implement orchestration**

Topic generation receives at most three redacted `TemplatePackage` values and marks one topic as recommended. Script generation receives the selected topic and selected structure and returns exactly three scripts with exactly one `recommended=true`.

```ts
async createUsableDraft(context: AccessContext, input: AutoCreationInput) {
  requireTenantCapability(context, "content.create", { ipId: input.ipProfileId, contentAccountId: input.contentAccountId })
  const snapshot = this.contexts.snapshot(input)
  const templates = await this.templates.retrieve(snapshot.query)
  const run = this.runs.createAutoRun(snapshot)
  const topics = await this.generateTopics(run, templates)
  const topic = requireRecommended(topics.items)
  const scripts = await this.generateScripts(run, topic, templates)
  const script = requireRecommended(scripts.items)
  this.runs.selectScript(run.id, scripts.version, script.id)
  const qa = await this.runQa(run)
  return qa.hardGatePassed ? this.ready(run, topic, script, qa) : this.reviseOnce(run, topic, script, qa)
}
```

- [ ] **Step 4: Preserve checkpoints and limit retries**

On LLM/schema failure, persist the last completed operation and stable error code. A user retry resumes the failed operation; it does not regenerate successful upstream output. Automatic revision count is stored per Run and enforced transactionally.

- [ ] **Step 5: Verify and commit**

Run: `npm test -- auto-creation-orchestrator.test.ts run-service.test.ts`

Expected: PASS.

```bash
git add prototype/src/services/auto-creation-orchestrator.ts prototype/src/services/script-revision-service.ts prototype/src/prompts/index.ts prototype/src/services/run-service.ts prototype/src/lib/llm/fake.ts prototype/tests/unit/auto-creation-orchestrator.test.ts
git commit -m "feat: generate a usable script automatically"
```

### Task 3: Implement Versioned Topic, Structure, and Script Revisions

**Files:**
- Create: `prototype/src/services/creation-revision-service.ts`
- Create: `prototype/src/services/publication-service.ts`
- Modify: `prototype/src/lib/db/repository.ts`
- Test: `prototype/tests/unit/creation-revision-service.test.ts`

**Interfaces:**
- Consumes: current Run lineage/batches and active template retriever.
- Produces: `reviseTopic`, `reviseStructure`, `selectAlternateScript`, `editScript`, `lock`, `forkLockedDraft`, `PublicationService.recordGenerated`, and `PublicationService.createExternal`.

- [ ] **Step 1: Write failing invalidation tests**

```ts
it("changing structure keeps IP and topic but versions scripts and QA", async () => {
  const before = repository.getRunView(runId)
  await revisions.reviseStructure(context, runId, alternateStructureId)
  const after = repository.getRunView(runId)
  expect(after.lineage.ipSnapshotVersion).toBe(before.lineage.ipSnapshotVersion)
  expect(after.currentTopic.id).toBe(before.currentTopic.id)
  expect(after.scriptBatch.version).toBe(before.scriptBatch.version + 1)
  expect(after.qualityReport.version).toBe(before.qualityReport.version + 1)
})

it("editing a locked script forks a draft and preserves the lock hash", async () => {
  const locked = repository.getLatestLockedScript(runId)
  const draft = await revisions.forkLockedDraft(context, runId)
  expect(repository.getLatestLockedScript(runId)).toEqual(locked)
  expect(draft.parentLockedVersion).toBe(locked.version)
})
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- creation-revision-service.test.ts`

Expected: FAIL because revision service is absent.

- [ ] **Step 3: Implement explicit downstream invalidation matrix**

```ts
const invalidation = {
  topic: ["templateSelection", "scriptBatch", "scriptSelection", "qualityReport"],
  structure: ["scriptBatch", "scriptSelection", "qualityReport"],
  script: ["scriptSelection", "qualityReport"],
  edit: ["scriptRevision", "qualityReport"],
} as const
```

Each operation requires capability/scope, current input version, and a valid referenced candidate/version. It appends the new downstream records in one transaction and never deletes or overwrites locked rows.

`recordGenerated` binds a locked script to its content account and platform ID/link. `createExternal` lets an authorized `metrics.import` actor register a video that was not generated by this system so real imports can still be reviewed. Both reject duplicate platform IDs within the same content account and write audit events.

- [ ] **Step 4: Verify and commit**

Run: `npm test -- creation-revision-service.test.ts`

Expected: PASS.

```bash
git add prototype/src/services/creation-revision-service.ts prototype/src/services/publication-service.ts prototype/src/lib/db/repository.ts prototype/tests/unit/creation-revision-service.test.ts
git commit -m "feat: add reversible versioned creation changes"
```

### Task 4: Add Permission-Aware Creation APIs and Disable Production Simulation

**Files:**
- Create: `prototype/src/lib/runtime-features.ts`
- Create: `prototype/src/app/api/app/runs/[...segments]/route.ts`
- Create: `prototype/src/app/api/app/publications/[...segments]/route.ts`
- Modify: `prototype/src/app/api/prototype/[...segments]/route.ts`
- Test: `prototype/tests/unit/app-run-route.test.ts`
- Test: `prototype/tests/unit/runtime-features.test.ts`

**Interfaces:**
- Consumes: access context, orchestrator, revision service.
- Produces: approved `/api/app/runs` API and `RuntimeFeatures.simulationEnabled`.

- [ ] **Step 1: Write failing route and environment tests**

```ts
it("rejects auto-create outside assigned IP scope", async () => {
  const response = await callRunRoute(operatorContext, "POST", "/auto-create", { ipProfileId: "other-ip" })
  expect(response.status).toBe(403)
})

it("never enables simulation in production", () => {
  expect(resolveRuntimeFeatures({ NODE_ENV: "production", PROTOTYPE_ENABLE_SIMULATION: "true" }).simulationEnabled).toBe(false)
})
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- app-run-route.test.ts runtime-features.test.ts`

Expected: FAIL because routes/policy are missing.

- [ ] **Step 3: Implement approved commands**

Expose `POST /auto-create`, `GET /{id}`, `POST /{id}/revise-topic`, `POST /{id}/revise-structure`, `POST /{id}/revise-script`, `POST /{id}/edit`, `POST /{id}/qa`, `POST /{id}/lock`, `POST /{id}/fork`, and `POST /{id}/publication`. Add `POST /api/app/publications/external` for authorized metrics operators. Resolve/authorize before reading Run/publication details.

Keep legacy `/api/prototype/.../publication/simulate` only when `NODE_ENV !== "production"`, `PROTOTYPE_TEST_MODE=true`, and `PLAYWRIGHT_TEST_MODE=true`; otherwise return 404 before service resolution.

- [ ] **Step 4: Verify and commit**

Run: `npm test -- app-run-route.test.ts runtime-features.test.ts`

Expected: PASS.

```bash
git add prototype/src/lib/runtime-features.ts prototype/src/app/api/app/runs prototype/src/app/api/app/publications prototype/src/app/api/prototype prototype/tests/unit/app-run-route.test.ts prototype/tests/unit/runtime-features.test.ts
git commit -m "feat: expose secure result-first creation API"
```

### Task 5: Replace the Wizard with the Usable-Script Workspace

**Files:**
- Create: `prototype/src/app/app/today/page.tsx`
- Create: `prototype/src/components/creation/UsableScriptWorkspace.tsx`
- Create: `prototype/src/components/creation/ScriptEditor.tsx`
- Create: `prototype/src/components/creation/CreationAdjustments.tsx`
- Create: `prototype/src/components/creation/GenerationEvidence.tsx`
- Modify: `prototype/src/app/page.tsx`
- Modify: `prototype/src/app/globals.css`
- Test: `prototype/tests/unit/result-first-ui.test.tsx`
- Modify: `prototype/tests/e2e/content-loop.spec.ts`

**Interfaces:**
- Consumes: `/api/app/runs` result-first API.
- Produces: `/app/today` result-first responsive user experience.

- [ ] **Step 1: Write failing result-first UI tests**

```tsx
it("shows the usable result without topic or script selection", () => {
  render(<UsableScriptWorkspace initialRun={readyDraftFixture} />)
  expect(screen.getByRole("heading", { name: "今日可用口播稿" })).toBeVisible()
  expect(screen.getByRole("button", { name: "复制口播稿" })).toBeVisible()
  expect(screen.queryByText("选择今天的口播稿")).not.toBeInTheDocument()
})

it("keeps adjustments optional and reversible", async () => {
  render(<UsableScriptWorkspace initialRun={readyDraftFixture} />)
  await userEvent.click(screen.getByRole("button", { name: "换一个选题" }))
  expect(screen.getByRole("dialog", { name: "选择其他选题" })).toBeVisible()
})
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- result-first-ui.test.tsx`

Expected: FAIL because the result-first workspace does not exist.

- [ ] **Step 3: Implement result-first information hierarchy**

The main column shows the script and QA result. Secondary actions are “换一个选题”, “换一种结构”, “换一版”, “编辑”, “重新检查”, and “确认定稿”. `GenerationEvidence` exposes only IP-fit reasons and QA evidence; it never serializes template packages.

Loading shows the current safe operation and elapsed time, not chain-of-thought. `NEEDS_ATTENTION` shows the best available draft, exact hard-gate issues, edit/retry/change-topic actions, and preserved upstream progress.

- [ ] **Step 4: Preserve current-IP entry and mobile behavior**

Keep first-use IP initialization, but move current workspace/IP/content-account persistence from browser localStorage to the scoped server-side `user_current_context` defined in the access plan. After initialization call `/auto-create` and land on the usable script. Use one light editorial theme, one accent, low radii, semantic controls, visible focus, 44px mobile targets, reduced-motion fallbacks, and no dashboard card grid.

- [ ] **Step 5: Run component and E2E tests**

Run: `npm test -- result-first-ui.test.tsx workspace.test.tsx`

Expected: PASS.

Run: `npm run test:e2e -- content-loop.spec.ts`

Expected: a logged-in assigned user reaches a usable script without selecting topic/script, changes a topic, locks a version, refreshes, and never sees simulation controls.

- [ ] **Step 6: Commit**

```bash
git add prototype/src/app/app/today prototype/src/components/creation prototype/src/app/page.tsx prototype/src/app/globals.css prototype/tests/unit/result-first-ui.test.tsx prototype/tests/unit/workspace.test.tsx prototype/tests/e2e/content-loop.spec.ts
git commit -m "feat: deliver result-first daily creation workspace"
```
