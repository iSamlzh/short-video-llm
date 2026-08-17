# Platform Content Brain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a platform-private content brain that turns imported high-performing samples into human-approved, versioned structures retrievable by the creation Agent.

**Architecture:** Platform operators work in one three-pane task surface. Raw samples, AI analysis versions, candidate structures, and activated template versions live in platform-only tables. `PlatformTemplateRetriever` returns a redacted internal package to the creation orchestrator; no tenant API serializes sample or template bodies.

**Tech Stack:** Existing Next.js/TypeScript/SQLite/Zod/LLM adapter, Vitest, Testing Library, Playwright.

## Global Constraints

- Execute after `2026-08-17-tenant-identity-access-implementation-plan.md`.
- Require `AccessContext.audience === "platform"` for every platform page and API.
- A tenant session receives 403 or a generic access page, never platform data.
- Operators do not create production templates from a blank prompt form; candidates originate from analyzed samples.
- Only activated immutable versions are retrievable by creation.
- Edits to an activated template create a new draft version.
- Template activation is human-confirmed and atomic; failure leaves the previous version active.
- Customer responses contain only an allowed suitability explanation, not template/source internals.
- Keep system prompts and model secrets separate from business structures.
- Follow TDD and commit after every task.

---

### Task 1: Add Platform Content-Brain Contracts and Persistence

**Files:**
- Create: `prototype/src/domain/content-brain.ts`
- Create: `prototype/src/domain/content-brain-schemas.ts`
- Create: `prototype/src/lib/db/migrations/003_platform_content_brain.sql`
- Create: `prototype/src/lib/db/content-brain-repository.ts`
- Test: `prototype/tests/unit/content-brain-repository.test.ts`

**Interfaces:**
- Consumes: migration runner from plan 1.
- Produces: `ContentSample`, `ContentAnalysis`, `TemplateCandidate`, `TemplateVersion`, `ContentBrainRepository`.

- [ ] **Step 1: Write failing repository tests**

```ts
it("keeps immutable analysis versions for one sample", () => {
  const first = repository.saveAnalysis(sampleId, analysisInput)
  const second = repository.saveAnalysis(sampleId, { ...analysisInput, hookType: "反常识" })
  expect(repository.listAnalyses(sampleId).map(item => item.version)).toEqual([1, 2])
  expect(first.version).toBe(1)
  expect(second.version).toBe(2)
})

it("retrieves only the active template version", () => {
  repository.saveTemplateVersion(templateId, draftOne)
  const v2 = repository.saveTemplateVersion(templateId, draftTwo)
  repository.activateTemplateVersion(v2.id, platformActor)
  expect(repository.listActiveTemplates()).toEqual([expect.objectContaining({ version: 2 })])
})
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- content-brain-repository.test.ts`

Expected: FAIL because contracts and tables do not exist.

- [ ] **Step 3: Define structured sample and template contracts**

```ts
export type ContentAnalysis = {
  audienceTension: string
  hookType: string
  structureNodes: Array<{ kind: "hook" | "conflict" | "evidence" | "method" | "cta"; instruction: string }>
  evidenceTypes: string[]
  emotionalProgression: string[]
  reusablePatterns: string[]
  nonReusableFacts: string[]
  riskNotes: string[]
  applicableIpTags: string[]
}

export type TemplateStatus = "draft" | "active" | "inactive"
```

- [ ] **Step 4: Add platform-only tables and repository transactions**

Create `platform_content_samples`, `platform_content_analysis_versions`, `platform_structure_templates`, `platform_template_versions`, `platform_template_source_links`, and `platform_template_activations`. Store source metadata, rights note, `data_origin`, authoring user, schema version, timestamps, and immutable version payloads. Enforce one active version per template with a transaction that deactivates the prior activation only after the new version validates.

- [ ] **Step 5: Run tests and commit**

Run: `npm test -- content-brain-repository.test.ts`

Expected: PASS.

```bash
git add prototype/src/domain/content-brain.ts prototype/src/domain/content-brain-schemas.ts prototype/src/lib/db/migrations/003_platform_content_brain.sql prototype/src/lib/db/content-brain-repository.ts prototype/tests/unit/content-brain-repository.test.ts
git commit -m "feat: persist platform content brain versions"
```

### Task 2: Add AI Sample Analysis and Candidate Extraction

**Files:**
- Create: `prototype/src/prompts/content-brain.ts`
- Modify: `prototype/src/lib/llm/adapter.ts`
- Modify: `prototype/src/lib/llm/fake.ts`
- Create: `prototype/src/services/content-analysis-service.ts`
- Test: `prototype/tests/unit/content-analysis-service.test.ts`

**Interfaces:**
- Consumes: `StructuredLlmClient`, content-brain schemas/repository.
- Produces: `ContentAnalysisService.analyze(sampleId)` and `ContentAnalysisService.extractCandidate(sampleIds)`.

- [ ] **Step 1: Write failing service tests**

```ts
it("extracts a candidate only from reviewed analysis versions", async () => {
  await expect(service.extractCandidate([unreviewedSampleId])).rejects.toThrow("REVIEWED_ANALYSIS_REQUIRED")
})

it("keeps source evidence on every candidate", async () => {
  adapter.enqueue({ json: candidateFixture })
  const candidate = await service.extractCandidate([sampleOne, sampleTwo, sampleThree])
  expect(candidate.sourceAnalysisIds).toHaveLength(3)
})
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- content-analysis-service.test.ts`

Expected: FAIL because the service and LLM operations are absent.

- [ ] **Step 3: Add separate structured LLM operations**

Extend the adapter operation union with `content_analysis` and `template_extraction`. `content_analysis` takes one sample and returns `ContentAnalysis`; `template_extraction` takes reviewed analyses and returns a candidate with applicability, ordered structure nodes, quality rules, risk boundaries, and evidence summary.

```ts
await llm.generateStructured({
  operation: "template_extraction",
  systemPrompt: templateExtractionPrompt,
  input: { analyses },
  schema: templateCandidateSchema,
  timeoutMs: 60_000,
})
```

- [ ] **Step 4: Implement review gates and one repair attempt**

Reuse `StructuredLlmClient` schema repair. Do not mark AI analysis reviewed automatically. `extractCandidate` rejects empty, unreviewed, inactive, or cross-version source inputs and saves source links transactionally.

- [ ] **Step 5: Verify and commit**

Run: `npm test -- content-analysis-service.test.ts`

Expected: PASS.

```bash
git add prototype/src/prompts/content-brain.ts prototype/src/lib/llm/adapter.ts prototype/src/lib/llm/fake.ts prototype/src/services/content-analysis-service.ts prototype/tests/unit/content-analysis-service.test.ts
git commit -m "feat: extract content structures from reviewed samples"
```

### Task 3: Add Activation, Preview, Retrieval, and Platform APIs

**Files:**
- Create: `prototype/src/services/platform-template-service.ts`
- Create: `prototype/src/services/platform-template-retriever.ts`
- Create: `prototype/src/app/api/platform/content-brain/[...segments]/route.ts`
- Test: `prototype/tests/unit/platform-template-service.test.ts`
- Test: `prototype/tests/unit/platform-template-retriever.test.ts`
- Test: `prototype/tests/unit/platform-route.test.ts`

**Interfaces:**
- Consumes: `requirePlatformOperator`, content-brain repository, existing script generation adapter.
- Produces: `PlatformTemplateRetriever.retrieve(query): Promise<TemplatePackage[]>`, platform-only import/analyze/extract/preview/activate/deactivate endpoints.

- [ ] **Step 1: Write failing boundary and retrieval tests**

```ts
it("never returns drafts", async () => {
  const result = await retriever.retrieve({ ipTags: ["社区团购"], audience: "本地经营者", goal: "建立信任" })
  expect(result.every(item => item.status === "active")).toBe(true)
})

it("rejects a tenant session before reading repository data", async () => {
  const response = await callPlatformRoute(tenantSession, "/samples")
  expect(response.status).toBe(403)
  expect(repository.readCount).toBe(0)
})
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- platform-template-service.test.ts platform-template-retriever.test.ts platform-route.test.ts`

Expected: FAIL because services/routes are missing.

- [ ] **Step 3: Implement redacted retrieval packages**

```ts
export type TemplatePackage = {
  templateVersionId: string
  structureId: string
  applicability: { ipTags: string[]; audiences: string[]; goals: string[] }
  nodes: Array<{ kind: string; instruction: string }>
  qualityRules: string[]
  riskRules: string[]
}
```

Filter `active` first, then deterministic applicability/risk checks, then rank by exact IP-tag, audience, goal, evidence count, and stable ID. Return at most three packages. If no specialized package matches, return an active `isGeneral=true` package; otherwise throw `NO_ACTIVE_TEMPLATE`.

- [ ] **Step 4: Implement platform APIs with atomic activation**

Every handler resolves `AccessContext`, calls `requirePlatformOperator`, validates Zod input, and delegates to the service. Preview generates scripts without writing tenant Run, metrics, or memory records. Activation records actor, version, reason, and timestamp in audit logs.

- [ ] **Step 5: Verify and commit**

Run: `npm test -- platform-template-service.test.ts platform-template-retriever.test.ts platform-route.test.ts`

Expected: PASS.

```bash
git add prototype/src/services/platform-template-service.ts prototype/src/services/platform-template-retriever.ts prototype/src/app/api/platform/content-brain prototype/tests/unit/platform-template-service.test.ts prototype/tests/unit/platform-template-retriever.test.ts prototype/tests/unit/platform-route.test.ts
git commit -m "feat: activate and retrieve private content structures"
```

### Task 4: Build the AI-Native Three-Pane Content Brain

**Files:**
- Create: `prototype/src/app/platform/content-brain/page.tsx`
- Create: `prototype/src/app/platform/layout.tsx`
- Create: `prototype/src/components/content-brain/ContentBrainWorkspace.tsx`
- Create: `prototype/src/components/content-brain/SampleList.tsx`
- Create: `prototype/src/components/content-brain/AnalysisEditor.tsx`
- Create: `prototype/src/components/content-brain/StructureDecisionPanel.tsx`
- Modify: `prototype/src/app/globals.css`
- Test: `prototype/tests/unit/content-brain-ui.test.tsx`
- Test: `prototype/tests/e2e/platform-content-brain.spec.ts`

**Interfaces:**
- Consumes: platform APIs and platform session guard.
- Produces: one platform-only workspace for sample import, AI proposal review, preview, activation, and deactivation.

- [ ] **Step 1: Write failing UI tests**

```tsx
it("leads with Agent decisions instead of a blank template form", () => {
  render(<ContentBrainWorkspace initialView={fixture} />)
  expect(screen.getByText("Agent 建议提炼 2 个新结构")).toBeVisible()
  expect(screen.queryByText("新建空白模板")).not.toBeInTheDocument()
})

it("requires explicit confirmation before activation", async () => {
  render(<StructureDecisionPanel candidate={candidate} onActivate={onActivate} />)
  await userEvent.click(screen.getByRole("button", { name: "启用这个结构" }))
  expect(screen.getByRole("dialog", { name: "确认启用结构" })).toBeVisible()
})
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- content-brain-ui.test.tsx`

Expected: FAIL because components do not exist.

- [ ] **Step 3: Implement the three-pane task surface**

Pane 1 lists imported samples and processing state. Pane 2 shows original text beside editable AI analysis and evidence boundaries. Pane 3 leads with Agent-proposed merge/split/new-structure decisions, source evidence, generation preview, and explicit activate/deactivate actions. Do not add dashboard cards, vanity metrics, or a multi-level platform navigation.

- [ ] **Step 4: Add loading, empty, failure, keyboard, and mobile states**

Use contextual skeletons, inline retry, visible focus, semantic headings, 44px mobile targets, and a stacked mobile order of samples then analysis then decision. Never display model chain-of-thought.

- [ ] **Step 5: Extend the idempotent demo seed with a runnable content brain**

Add three `data_origin=demo` samples, reviewed analysis versions, one general structure, and one active immutable template version to `seed:demo`. The seeded structure is only for local/test execution. Formal mode never auto-activates it and returns `NO_ACTIVE_TEMPLATE` until a platform operator activates a formal version. `seed:demo:clear` removes these rows without touching formal samples or versions.

- [ ] **Step 6: Verify unit/E2E and commit**

Run: `npm test -- content-brain-ui.test.tsx`

Expected: PASS.

Run: `npm run test:e2e -- platform-content-brain.spec.ts`

Expected: platform operator can analyze, extract, preview, and activate; tenant user is denied.

```bash
git add prototype/src/app/platform prototype/src/components/content-brain prototype/src/app/globals.css prototype/src/scripts/seed-demo.ts prototype/src/scripts/clear-demo.ts prototype/tests/unit/content-brain-ui.test.tsx prototype/tests/e2e/platform-content-brain.spec.ts
git commit -m "feat: add private content brain workspace"
```
