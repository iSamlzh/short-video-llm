# Tenant Identity and Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add independent local user accounts, tenant memberships, role presets, IP/content-account scopes, and server-enforced authorization to the prototype.

**Architecture:** Keep authentication local and replaceable through an `IdentityProvider` interface. Store password hashes, sessions, memberships, capabilities, IP profiles, and content-account scopes in SQLite; resolve every customer request to an `AccessContext` before a service is called. Platform operator sessions use a distinct audience and cannot be treated as tenant sessions.

**Tech Stack:** Next.js 16 Route Handlers and async cookies API, Node `crypto.scrypt`, SQLite/better-sqlite3, Zod, Vitest, Testing Library, Playwright.

## Global Constraints

- Read `prototype/AGENTS.md`, `prototype/node_modules/next/dist/docs/01-app/02-guides/authentication.md`, `prototype/node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md`, and `prototype/node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` before editing.
- Do not add an authentication dependency for the prototype.
- Session cookies are HttpOnly, SameSite=Lax, Path=/, Secure in production, and contain only an opaque token.
- Store only SHA-256 session-token hashes and scrypt password hashes; never store raw tokens or passwords.
- Effective access is membership AND capability AND resource scope.
- A tenant actor can never satisfy a platform operator guard.
- Keep each repository and service focused; do not add tenant logic to `RunService` until the result-first creation plan.
- Follow TDD and commit after every task.

---

### Task 1: Add Access Contracts and Additive SQLite Migrations

**Files:**
- Create: `prototype/src/domain/access.ts`
- Create: `prototype/src/domain/access-schemas.ts`
- Create: `prototype/src/lib/db/migrations.ts`
- Create: `prototype/src/lib/db/migrations/002_tenant_access.sql`
- Modify: `prototype/src/lib/db/database.ts`
- Test: `prototype/tests/unit/access-domain.test.ts`
- Test: `prototype/tests/unit/migrations.test.ts`

**Interfaces:**
- Produces: `Capability`, `ActorAudience`, `AccessContext`, `ResourceScope`, `applyMigrations(database)`.
- Consumes: existing `openDatabase(path)`.

- [ ] **Step 1: Write failing contract and migration tests**

```ts
it("rejects a tenant context without a tenant id", () => {
  expect(() => accessContextSchema.parse({
    audience: "tenant", userId: "user-1", membershipId: "member-1",
    capabilities: ["content.create"], ipIds: [], contentAccountIds: [],
  })).toThrow()
})

it("applies tenant migration exactly once", () => {
  const db = new Database(":memory:")
  applyMigrations(db)
  applyMigrations(db)
  expect(db.prepare("SELECT COUNT(*) count FROM schema_migrations WHERE version = 2").get()).toEqual({ count: 1 })
})
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `npm test -- access-domain.test.ts migrations.test.ts`

Expected: FAIL because the schemas and migration runner do not exist.

- [ ] **Step 3: Define exact access contracts**

```ts
export const capabilities = [
  "ip.view", "content.create", "content.edit", "content.lock",
  "metrics.import", "review.generate", "review.view", "team.manage",
] as const
export type Capability = typeof capabilities[number]

export type AccessContext =
  | { audience: "tenant"; userId: string; tenantId: string; membershipId: string; capabilities: Capability[]; ipIds: string[]; contentAccountIds: string[] }
  | { audience: "platform"; userId: string; platformRole: "platform_operator" | "platform_admin" }
```

- [ ] **Step 4: Implement ordered additive migrations**

`002_tenant_access.sql` creates `users`, `sessions`, `tenants`, `memberships`, `membership_capabilities`, `ip_profiles`, `content_accounts`, `membership_ip_scopes`, `membership_account_scopes`, `user_current_context`, `invitations`, and `audit_logs`. Add unique constraints on normalized email, active membership per user/tenant, one current context per user/tenant, platform account identity, and token hash. Use foreign keys and indexes on every tenant/resource lookup. Seedable business tables include `data_origin` with allowed values `demo` and `formal`.

```ts
export function applyMigrations(db: Database.Database) {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)")
  for (const migration of MIGRATIONS) {
    const exists = db.prepare("SELECT 1 FROM schema_migrations WHERE version = ?").get(migration.version)
    if (!exists) db.transaction(() => { db.exec(migration.sql); db.prepare("INSERT INTO schema_migrations VALUES (?, ?)").run(migration.version, new Date().toISOString()) })()
  }
}
```

- [ ] **Step 5: Call `applyMigrations` from `openDatabase` and verify GREEN**

Run: `npm test -- access-domain.test.ts migrations.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add prototype/src/domain/access.ts prototype/src/domain/access-schemas.ts prototype/src/lib/db/database.ts prototype/src/lib/db/migrations.ts prototype/src/lib/db/migrations/002_tenant_access.sql prototype/tests/unit/access-domain.test.ts prototype/tests/unit/migrations.test.ts
git commit -m "feat: add tenant access contracts and migrations"
```

### Task 2: Implement Local Identity Provider and Server Sessions

**Files:**
- Create: `prototype/src/lib/auth/password.ts`
- Create: `prototype/src/lib/auth/identity-provider.ts`
- Create: `prototype/src/lib/auth/local-identity-provider.ts`
- Create: `prototype/src/lib/auth/session.ts`
- Create: `prototype/src/lib/db/identity-repository.ts`
- Create: `prototype/src/app/api/auth/login/route.ts`
- Create: `prototype/src/app/api/auth/logout/route.ts`
- Create: `prototype/src/app/api/auth/session/route.ts`
- Test: `prototype/tests/unit/identity.test.ts`
- Test: `prototype/tests/unit/session.test.ts`

**Interfaces:**
- Consumes: `AccessContext`, `openDatabase`.
- Produces: `IdentityProvider.authenticate(email, password)`, `createSession(userId, audience)`, `resolveSession(request)`, `destroySession(request)`.

- [ ] **Step 1: Write failing password and session tests**

```ts
it("stores an opaque token hash and resolves the original token", async () => {
  const raw = await sessions.create("user-1", "tenant")
  expect(raw).not.toContain("user-1")
  expect(await sessions.resolve(raw)).toMatchObject({ userId: "user-1", audience: "tenant" })
})

it("does not authenticate a wrong password", async () => {
  await identities.createUser("owner@example.test", "correct horse battery staple")
  await expect(provider.authenticate("owner@example.test", "wrong password")).rejects.toThrow("INVALID_CREDENTIALS")
})
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- identity.test.ts session.test.ts`

Expected: FAIL because auth modules do not exist.

- [ ] **Step 3: Implement scrypt hashing and opaque sessions**

```ts
export interface IdentityProvider {
  authenticate(email: string, password: string): Promise<{ userId: string }>
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16)
  const derived = await scryptAsync(password, salt, 64) as Buffer
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`
}
```

Generate 32-byte session tokens, store only `sha256(token)`, include `expires_at`, `revoked_at`, and `audience`, and rotate by deleting the previous login session for the same browser only.

- [ ] **Step 4: Implement Next.js Route Handlers using async cookies**

```ts
const jar = await cookies()
jar.set("prototype_session", token, {
  httpOnly: true, sameSite: "lax", path: "/",
  secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 12,
})
```

Validate request bodies with Zod. Return 401 for invalid credentials and never reveal whether an email exists.

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test -- identity.test.ts session.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add prototype/src/lib/auth prototype/src/lib/db/identity-repository.ts prototype/src/app/api/auth prototype/tests/unit/identity.test.ts prototype/tests/unit/session.test.ts
git commit -m "feat: add local identity and secure sessions"
```

### Task 3: Resolve Access Context and Enforce Capabilities and Scopes

**Files:**
- Create: `prototype/src/lib/auth/access-context.ts`
- Create: `prototype/src/lib/auth/guards.ts`
- Create: `prototype/src/lib/db/access-repository.ts`
- Create: `prototype/src/services/access-service.ts`
- Test: `prototype/tests/unit/access-service.test.ts`

**Interfaces:**
- Consumes: `resolveSession`, access tables.
- Produces: `resolveAccessContext(request)`, `requireTenantCapability(context, capability, resource)`, `requirePlatformOperator(context)`.

- [ ] **Step 1: Write failing authorization tests**

```ts
it("requires capability and assigned account", () => {
  const context = tenantContext({ capabilities: ["review.view"], contentAccountIds: ["account-1"] })
  expect(() => requireTenantCapability(context, "review.view", { contentAccountId: "account-2" })).toThrow("ACCOUNT_SCOPE_FORBIDDEN")
})

it("never treats tenant owner as platform operator", () => {
  expect(() => requirePlatformOperator(tenantContext({ capabilities: allCapabilities }))).toThrow("PLATFORM_AUDIENCE_REQUIRED")
})
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- access-service.test.ts`

Expected: FAIL because guards are missing.

- [ ] **Step 3: Implement context resolution and pure guards**

```ts
export function requireTenantCapability(
  context: AccessContext,
  capability: Capability,
  resource: { ipId?: string; contentAccountId?: string } = {},
) {
  if (context.audience !== "tenant") throw new AccessError("TENANT_AUDIENCE_REQUIRED", 403)
  if (!context.capabilities.includes(capability)) throw new AccessError("CAPABILITY_FORBIDDEN", 403)
  if (resource.ipId && !context.ipIds.includes(resource.ipId)) throw new AccessError("IP_SCOPE_FORBIDDEN", 403)
  if (resource.contentAccountId && !context.contentAccountIds.includes(resource.contentAccountId)) throw new AccessError("ACCOUNT_SCOPE_FORBIDDEN", 403)
  return context
}
```

Resolve active memberships only; reject revoked users, disabled memberships, expired sessions, and disabled accounts. Return generic 403 responses without leaking target existence.

- [ ] **Step 4: Run all access tests**

Run: `npm test -- access-domain.test.ts identity.test.ts session.test.ts access-service.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add prototype/src/lib/auth/access-context.ts prototype/src/lib/auth/guards.ts prototype/src/lib/db/access-repository.ts prototype/src/services/access-service.ts prototype/tests/unit/access-service.test.ts
git commit -m "feat: enforce tenant capabilities and resource scopes"
```

### Task 4: Add Team Management, Demo Seed, Login, and Protected Shell

**Files:**
- Create: `prototype/src/services/team-service.ts`
- Create: `prototype/src/app/api/app/team/[...segments]/route.ts`
- Create: `prototype/src/app/login/page.tsx`
- Create: `prototype/src/app/app/layout.tsx`
- Create: `prototype/src/app/app/team/page.tsx`
- Create: `prototype/src/components/team/TeamAccessEditor.tsx`
- Create: `prototype/src/scripts/seed-demo.ts`
- Modify: `prototype/package.json`
- Test: `prototype/tests/unit/team-service.test.ts`
- Test: `prototype/tests/unit/team-ui.test.tsx`
- Test: `prototype/tests/e2e/team-access.spec.ts`

**Interfaces:**
- Consumes: access guards and identity repositories.
- Produces: `TeamService.invite`, `TeamService.updateAccess`, `TeamService.disableMember`, `TeamService.setCurrentContext`; seeded owner, operator, reviewer, and platform-operator accounts.

- [ ] **Step 1: Write failing team-service tests**

```ts
it("owner assigns a reviewer to exactly one account", () => {
  const invitation = service.invite(ownerContext, {
    email: "reviewer@example.test", role: "reviewer",
    ipIds: ["ip-linjie"], contentAccountIds: ["account-linjie-wechat"],
  })
  expect(invitation.capabilities).toEqual(["ip.view", "metrics.import", "review.generate", "review.view"])
})

it("makes the first accessible IP the member current context", () => {
  const member = service.acceptInvitation(invitationToken, reviewerUserId)
  expect(service.getCurrentContext(member.userId, member.tenantId)).toMatchObject({ ipProfileId: "ip-linjie" })
})

it("delegated manager cannot grant team.manage", () => {
  expect(() => service.updateAccess(managerContext, memberId, { capabilities: ["team.manage"] })).toThrow("CANNOT_GRANT_CAPABILITY")
})
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- team-service.test.ts team-ui.test.tsx`

Expected: FAIL because the service and pages do not exist.

- [ ] **Step 3: Implement deterministic role presets and invitation lifecycle**

```ts
const rolePresets = {
  owner: [...capabilities],
  manager: ["ip.view", "content.create", "content.edit", "content.lock", "metrics.import", "review.generate", "review.view"],
  operator: ["ip.view", "content.create", "content.edit"],
  reviewer: ["ip.view", "metrics.import", "review.generate", "review.view"],
} satisfies Record<string, Capability[]>
```

Generate one-time invitation tokens, store their hashes and expiry, reject reuse, and record invite, access-change, and disable events in `audit_logs`.

- [ ] **Step 4: Add protected login/team UI**

The login page posts credentials to `/api/auth/login`. The `/app` layout resolves the session server-side and redirects unauthenticated users to `/login`. `TeamAccessEditor` exposes role preset, explicit capability toggles, IP scopes, and content-account scopes; every access change requires a confirmation action.

The app shell reads `user_current_context` server-side. Switching workspace, IP, or content account validates scope before persisting the new context; subsequent `/app/today` and `/app/review` entry does not ask the user to reselect it.

- [ ] **Step 5: Add idempotent demo seed**

`npm run seed:demo` creates `owner@example.test`, `operator@example.test`, `reviewer@example.test`, `platform@example.test`, one tenant, two IPs, three content accounts, current contexts, and scoped memberships with `data_origin=demo`. The first accessible IP becomes current automatically; adding a later IP never silently replaces it. Re-running does not duplicate rows. The password is read from `PROTOTYPE_DEMO_PASSWORD` and defaults only in test mode.

Add `prototype/src/scripts/clear-demo.ts` and `npm run seed:demo:clear`. The clear command deletes only rows whose `data_origin=demo`, resolves and reports dependent demo rows first, and refuses to run if `PROTOTYPE_ALLOW_DEMO_CLEAR` is not `true`. Tests verify formal rows remain untouched.

- [ ] **Step 6: Verify unit and browser behavior**

Run: `npm test -- team-service.test.ts team-ui.test.tsx`

Expected: PASS.

Run: `npm run test:e2e -- team-access.spec.ts`

Expected: owner can change access; reviewer cannot open team management or see an unassigned account.

- [ ] **Step 7: Commit**

```bash
git add prototype/src/services/team-service.ts prototype/src/app/api/app/team prototype/src/app/login prototype/src/app/app prototype/src/components/team prototype/src/scripts/seed-demo.ts prototype/src/scripts/clear-demo.ts prototype/package.json prototype/tests/unit/team-service.test.ts prototype/tests/unit/team-ui.test.tsx prototype/tests/e2e/team-access.spec.ts
git commit -m "feat: add scoped team access management"
```
