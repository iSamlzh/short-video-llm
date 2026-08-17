# AI-Native Team Content Agent Implementation Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this roadmap plan-by-plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved prototype as four independently testable subsystems and one cross-system acceptance gate.

**Architecture:** Extend the existing Next.js 16 + SQLite vertical slice without replacing the working LLM adapter. Build server-enforced tenant access first, then the private platform content brain, then result-first creation, then real metrics review and tenant memory. Each subsystem exposes a narrow service interface consumed by later plans.

**Tech Stack:** Next.js 16.3.1, React 19.2.8, TypeScript 5.9.3, SQLite via better-sqlite3, Zod 4.4.3, Vitest 4.1.10, Playwright 1.62.1.

## Global Constraints

- The approved specification is `docs/superpowers/specs/2026-08-16-ai-native-team-content-agent-prototype-design.md`.
- Customer and platform operations are separate authorization domains; hiding navigation is never authorization.
- Each person signs in with an independent user account; shared credentials are not supported.
- Effective access is membership AND capability AND IP/content-account scope.
- Customer responses never expose platform samples, template bodies, internal prompts, source links, or operator notes.
- Real review data remains tenant-private and never updates platform templates automatically.
- Simulation is development/test-only and unavailable from production UI and API.
- Default creation produces one QA-checked usable script without requiring topic or script selection.
- Every rewind creates a new downstream version and never overwrites locked history.
- No platform API, OAuth, SSO, autonomous template activation, or digital-human video in this prototype.
- Preserve the provider-neutral LLM adapter and SQLite checkpoint behavior.
- Read `prototype/AGENTS.md` and the relevant Next.js 16 docs under `prototype/node_modules/next/dist/docs/` before implementation.
- Use TDD for every behavior change and commit after each independently passing task.

## Plan Order

1. `2026-08-17-tenant-identity-access-implementation-plan.md`
2. `2026-08-17-platform-content-brain-implementation-plan.md`
3. `2026-08-17-result-first-creation-implementation-plan.md`
4. `2026-08-17-real-metrics-review-implementation-plan.md`
5. Cross-system acceptance in this roadmap

Later plans consume interfaces defined by earlier plans. Do not execute plans 2-4 in parallel against the same working tree.

### Task 1: Run Cross-System Acceptance

**Files:**
- Create: `prototype/tests/e2e/tenant-boundaries.spec.ts`
- Create: `prototype/tests/e2e/platform-content-brain.spec.ts`
- Modify: `prototype/tests/e2e/content-loop.spec.ts`
- Modify: `prototype/playwright.config.ts`
- Modify: `prototype/README.md`

**Interfaces:**
- Consumes: `requireTenantCapability`, `requirePlatformOperator`, `PlatformTemplateRetriever.retrieve`, `AutoCreationOrchestrator.createUsableDraft`, `MetricImportService.import`, `ReviewService.generate`.
- Produces: complete browser acceptance evidence and final operator documentation.

- [ ] **Step 1: Write failing end-to-end boundary tests**

```ts
test("tenant member cannot open platform content brain", async ({ page }) => {
  await loginAs(page, "operator@example.test")
  await page.goto("/platform/content-brain")
  await expect(page.getByText("无权访问平台运营空间")).toBeVisible()
})

test("reviewer only sees assigned content account", async ({ page }) => {
  await loginAs(page, "reviewer@example.test")
  await page.goto("/app/review")
  await expect(page.getByText("林姐视频号")).toBeVisible()
  await expect(page.getByText("王姐抖音")).toHaveCount(0)
})
```

- [ ] **Step 2: Run the new tests and verify they fail before all plans are integrated**

Run: `npm run test:e2e -- tenant-boundaries.spec.ts platform-content-brain.spec.ts`

Expected: FAIL because the final login helpers and protected pages are not all wired together.

- [ ] **Step 3: Update the existing content-loop E2E to exercise the approved default path**

```ts
await loginAs(page, "owner@example.test")
await page.goto("/app/today")
await expect(page.getByRole("heading", { name: "今日可用口播稿" })).toBeVisible()
await expect(page.getByRole("button", { name: "换一个选题" })).toBeVisible()
await expect(page.getByText("模拟发布表现")).toHaveCount(0)
```

- [ ] **Step 4: Run the full verification suite**

Run: `npm test`

Expected: all unit tests PASS.

Run: `npm run typecheck`

Expected: PASS with no TypeScript errors.

Run: `npm run build`

Expected: PASS using `.env.local` without exposing secrets.

Run: `npm run test:e2e`

Expected: all creation, access, content-brain, import, review, refresh, and production-simulation boundary tests PASS.

- [ ] **Step 5: Update operator documentation**

Document exact commands for `seed:demo` and guarded `seed:demo:clear`, local account credentials, real-model configuration, CSV/XLSX sample format, production simulation lockout, database location, and the verification query proving all `data_origin=demo` rows were removed without changing formal rows.

- [ ] **Step 6: Commit**

```bash
git add prototype/tests/e2e prototype/playwright.config.ts prototype/README.md
git commit -m "test: verify AI-native team content agent boundaries"
```
