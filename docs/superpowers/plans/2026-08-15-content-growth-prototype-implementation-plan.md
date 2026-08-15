# Content Growth Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在独立 `prototype/` 目录中交付一个本地可运行的 AI-native 内容增长纵向原型，真实调用大模型跑通“最小 IP → 方向 → 同方向三篇文案 → 独立 QA → 锁稿 → 模拟指标 → 真实模型复盘”。

**Architecture:** 使用单个 Next.js 15 应用承载 React UI、Route Handlers、确定性原型状态机和 SQLite。模型通过 OpenAI-compatible Adapter 调用，所有结构化输出经 Zod 校验并最多修复一次；发布表现由带明确模拟标识的确定性模拟器生成。原型不依赖也不修改正式首版应用目录，后续只评审迁移 Schema、Prompt、交互组件和 Evals。

**Tech Stack:** Next.js 15、React 19、TypeScript 5、Zod、SQLite、better-sqlite3、Vitest、Testing Library、Playwright、原生 `fetch`。

## Global Constraints

- [ ] 所有原型代码只写入 `prototype/`；不得修改正式首版规格、正式实施计划或未来 `apps/`、`packages/`、`ops/` 代码。
- [ ] 原型真实调用大模型；Fake LLM 只允许测试使用，不能在正常界面静默替代失败的真实模型。
- [ ] 每个 Run 严格先生成 3～5 个方向，用户选择唯一方向后，再生成该方向下恰好 3 篇完整文案。
- [ ] QA 使用独立 `qa` operation 和 Prompt；不得复用文案生成响应中的自评分。
- [ ] 每个正常 Run 默认 4 个业务模型调用：topics、scripts、qa、review；结构修复最多额外调用一次。
- [ ] 所有模型输出必须通过 Zod；修复仍失败时保存错误和检查点，用户只重试当前步骤。
- [ ] 所有模拟指标包含 `isSimulated=true`、scenario、simulatorVersion 和 seedHash；UI 固定展示“模拟数据，不代表真实平台表现”。
- [ ] 不实现登录、租户、五类角色、队列、平台 API、正式数据导入、数字人或正式系统基线包。
- [ ] API Key 只在服务器读取，不进入客户端 bundle、SQLite、导出文件或日志。
- [ ] 本地 SQLite 支持刷新恢复；原型 schema 只保证删除数据库后可重建，不建设正式迁移兼容。
- [ ] Windows 路径和 Next.js 路由目录不得使用冒号等非法文件名字符。
- [ ] 所有实现使用 TDD：先写失败测试、确认失败、实现最小代码、确认通过后提交。

## File Structure

```text
prototype/
├── package.json
├── tsconfig.json
├── next-env.d.ts
├── next.config.ts
├── vitest.config.ts
├── playwright.config.ts
├── .env.example
├── .gitignore
├── README.md
├── src/
│   ├── app/
│   │   ├── api/prototype/[...segments]/route.ts
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── components/
│   │   ├── PrototypeWorkspace.tsx
│   │   ├── DecisionCards.tsx
│   │   ├── QualityAndLock.tsx
│   │   ├── SimulationAndReview.tsx
│   │   └── ContextDrawer.tsx
│   ├── domain/
│   │   ├── models.ts
│   │   ├── schemas.ts
│   │   └── state-machine.ts
│   ├── lib/
│   │   ├── api-client.ts
│   │   ├── db/database.ts
│   │   ├── db/repository.ts
│   │   ├── db/schema.sql
│   │   ├── llm/adapter.ts
│   │   ├── llm/fake.ts
│   │   ├── llm/structured.ts
│   │   └── simulation/metric-simulator.ts
│   ├── prompts/index.ts
│   ├── presets/index.ts
│   └── services/run-service.ts
└── tests/
    ├── setup.ts
    ├── unit/domain.test.ts
    ├── unit/llm.test.ts
    ├── unit/run-service.test.ts
    ├── unit/workspace.test.tsx
    ├── e2e/content-loop.spec.ts
    └── live/live-model-smoke.ts
```

---

### Task 1: 建立独立 Next.js 原型基座

**Files:**
- Create: `prototype/package.json`
- Create: `prototype/tsconfig.json`
- Create: `prototype/next-env.d.ts`
- Create: `prototype/next.config.ts`
- Create: `prototype/vitest.config.ts`
- Create: `prototype/playwright.config.ts`
- Create: `prototype/.env.example`
- Create: `prototype/.gitignore`
- Create: `prototype/src/app/layout.tsx`
- Create: `prototype/src/app/page.tsx`
- Create: `prototype/src/app/globals.css`
- Create: `prototype/tests/setup.ts`
- Create: `prototype/tests/unit/workspace.test.tsx`

**Interfaces:**
- Consumes: 无；此任务建立隔离原型运行环境。
- Produces: `npm --prefix prototype run dev|test|test:e2e|typecheck`，以及最小 `HomePage`。

- [ ] **Step 1: 创建包和脚本定义**

`prototype/package.json` 定义：

```json
{
  "name": "content-growth-prototype",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "test:live": "tsx tests/live/live-model-smoke.ts"
  }
}
```

安装 Next 15、React 19、TypeScript 5、Zod、better-sqlite3、Vitest、Testing Library、Playwright 和 tsx；提交生成的 lockfile。`next.config.ts` 设置 `serverExternalPackages: ["better-sqlite3"]`。

```bash
npm --prefix prototype install next@15 react@19 react-dom@19 zod better-sqlite3 server-only
npm --prefix prototype install --save-dev typescript@5 @types/node @types/react @types/react-dom @types/better-sqlite3 vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @playwright/test tsx
```

- [ ] **Step 2: 写首页失败测试**

```tsx
import { render, screen } from "@testing-library/react"
import HomePage from "../../src/app/page"

it("renders the single content growth workspace", () => {
  render(<HomePage />)
  expect(screen.getByRole("heading", { name: "内容增长 Agent" })).toBeVisible()
  expect(screen.queryByRole("navigation")).not.toBeInTheDocument()
})
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npm --prefix prototype test -- workspace.test.tsx`
Expected: FAIL，原型页面和测试配置尚不存在。

- [ ] **Step 4: 实现最小页面和全局样式**

`page.tsx` 只渲染标题、说明和“开始创建内容”按钮。`globals.css` 定义中性色背景、高对比正文、单一强调色、圆角卡片和移动端断点；不引入后台侧栏或仪表盘布局。

```tsx
export default function HomePage() {
  return (
    <main className="prototype-shell">
      <h1>内容增长 Agent</h1>
      <p>从你的真实经历开始，确定今天拍什么。</p>
      <button type="button">开始创建内容</button>
    </main>
  )
}
```

- [ ] **Step 5: 验证基座**

Run: `npm --prefix prototype run typecheck`
Expected: PASS。

Run: `npm --prefix prototype test -- workspace.test.tsx`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add prototype
git commit -m "chore: scaffold isolated content prototype"
```

---

### Task 2: 实现领域 Schema、状态机和 SQLite 检查点

**Files:**
- Create: `prototype/src/domain/models.ts`
- Create: `prototype/src/domain/schemas.ts`
- Create: `prototype/src/domain/state-machine.ts`
- Create: `prototype/src/lib/db/schema.sql`
- Create: `prototype/src/lib/db/database.ts`
- Create: `prototype/src/lib/db/repository.ts`
- Create: `prototype/tests/unit/domain.test.ts`

**Interfaces:**
- Consumes: Task 1 的 Node/TypeScript 环境。
- Produces: `PrototypeRun`、候选/QA/指标/复盘 Schema、`transition()` 和 `PrototypeRepository`。

- [ ] **Step 1: 写状态机和持久化失败测试**

```ts
it("rejects script generation before topic selection", () => {
  expect(() => transition("WAITING_TOPIC_SELECTION", "GENERATE_SCRIPTS"))
    .toThrow("INVALID_TRANSITION")
})

it("restores the current run after reopening SQLite", () => {
  const first = createTestRepository(dbPath)
  const run = first.createRun(minimumIpInput)
  first.close()

  const reopened = createTestRepository(dbPath)
  expect(reopened.getRun(run.id)?.state).toBe("READY_FOR_TOPICS")
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm --prefix prototype test -- domain.test.ts`
Expected: FAIL，领域类型、状态机和 repository 尚不存在。

- [ ] **Step 3: 实现 Zod Schema 和类型**

`schemas.ts` 导出：

```ts
export const ipProfileSchema = z.object({
  displayName: z.string().min(1),
  experience: z.string().min(10),
  expertise: z.string().min(2),
  audience: z.string().min(2),
  voiceStyle: z.string().min(2),
  boundaries: z.string().min(2),
})

export const topicDirectionCandidateSchema = z.object({
  id: z.string(),
  title: z.string().min(4),
  angle: z.string().min(10),
  audienceTension: z.string().min(5),
  ipFitEvidence: z.array(z.string()).min(1),
  structureId: z.string(),
  riskNotes: z.array(z.string()),
})
```

同时定义恰好 3 篇文案的 batch Schema、五项 0～100 QA 分数、`MetricSnapshot` 的 `isSimulated: z.literal(true)` 和 `ContentReview`。

- [ ] **Step 4: 实现显式状态转换**

`transition(current, command)` 只允许规格第 7.1 节的顺序；生成失败调用 `recordStepError(runId, error, retryFromState)`，不覆盖已完成候选或选择。`run_id + command + input_version` 作为命令幂等键。

```ts
const transitions = {
  READY_FOR_TOPICS: { GENERATE_TOPICS: "GENERATING_TOPICS" },
  WAITING_TOPIC_SELECTION: { SELECT_TOPIC: "READY_FOR_SCRIPTS" },
  READY_FOR_SCRIPTS: { GENERATE_SCRIPTS: "GENERATING_SCRIPTS" },
  WAITING_SCRIPT_SELECTION: { SELECT_SCRIPT: "READY_FOR_QA" },
  READY_FOR_QA: { RUN_QA: "RUNNING_QA" },
  WAITING_LOCK_CONFIRMATION: { LOCK: "LOCKED" },
  LOCKED: { SIMULATE_PUBLICATION: "SIMULATING_PUBLICATION" },
  WAITING_REVIEW: { GENERATE_REVIEW: "REVIEWING" },
} as const
```

- [ ] **Step 5: 实现 SQLite schema 和 repository**

创建规格列出的 11 张表；所有候选、选择、QA、锁稿、指标和复盘记录包含 `run_id`、`version`、`schema_version`、`created_at`。`PrototypeRepository` 至少提供：

```ts
createRun(input: CreateRunInput): PrototypeRun
getRun(runId: string): PrototypeRunView | null
saveTopicBatch(runId: string, inputVersion: number, items: TopicDirectionCandidate[]): number
selectTopic(runId: string, batchVersion: number, topicId: string): TopicSelection
saveScriptBatch(runId: string, inputVersion: number, items: ScriptCandidate[]): number
selectScript(runId: string, batchVersion: number, scriptId: string): ScriptSelection
saveQualityReport(runId: string, report: QualityReport): number
lockSelectedScript(runId: string): LockedScript
saveMetricSnapshot(runId: string, snapshot: MetricSnapshot): number
saveReview(runId: string, review: ContentReview): number
recordStepError(runId: string, error: StepError): void
```

- [ ] **Step 6: 验证状态与刷新恢复**

Run: `npm --prefix prototype test -- domain.test.ts`
Expected: PASS，包括非法跳转、版本冲突、重复命令和重新打开数据库。

- [ ] **Step 7: Commit**

```bash
git add prototype/src/domain prototype/src/lib/db prototype/tests/unit/domain.test.ts
git commit -m "feat: add prototype state and SQLite checkpoints"
```

---

### Task 3: 实现 OpenAI-compatible Adapter 与结构修复

**Files:**
- Create: `prototype/src/lib/llm/adapter.ts`
- Create: `prototype/src/lib/llm/structured.ts`
- Create: `prototype/src/lib/llm/fake.ts`
- Create: `prototype/src/prompts/index.ts`
- Create: `prototype/tests/unit/llm.test.ts`

**Interfaces:**
- Consumes: Task 2 的 Zod Schema。
- Produces: `LlmAdapter`、`OpenAiCompatibleAdapter`、`FakeLlmAdapter` 和 `generateStructured()`。

- [ ] **Step 1: 写真实配置隔离和一次修复失败测试**

```ts
it("repairs invalid structured output only once", async () => {
  const adapter = new FakeLlmAdapter([
    { text: "not-json" },
    { json: validTopicBatch },
  ])
  const result = await generateStructured({
    adapter,
    operation: "topics",
    input: topicInput,
    schema: topicBatchSchema,
    timeoutMs: 60_000,
  })
  expect(result).toEqual(validTopicBatch)
  expect(adapter.calls.map(call => call.operation)).toEqual(["topics", "repair"])
})

it("never exposes the API key in model call records", async () => {
  const record = sanitizeModelCall({ apiKey: "secret-key", operation: "topics" })
  expect(JSON.stringify(record)).not.toContain("secret-key")
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm --prefix prototype test -- llm.test.ts`
Expected: FAIL，Adapter 和结构修复尚不存在。

- [ ] **Step 3: 实现模型接口和供应商适配器**

```ts
export interface LlmAdapter {
  generate(request: {
    operation: "topics" | "scripts" | "qa" | "review" | "repair"
    systemPrompt: string
    input: unknown
    timeoutMs: number
  }): Promise<{ text: string; model: string; usage?: TokenUsage }>
}

export class StructuredLlmClient {
  constructor(private readonly adapter: LlmAdapter) {}

  generateStructured<T>(
    operation: "topics" | "scripts" | "qa" | "review",
    input: unknown,
    schema: z.ZodType<T>,
  ): Promise<T> {
    return generateStructured({
      adapter: this.adapter,
      operation,
      input,
      schema,
      timeoutMs: 60_000,
    })
  }
}
```

`OpenAiCompatibleAdapter` 使用服务器端 `fetch` 请求 `${LLM_BASE_URL}/chat/completions`，从环境读取 key/model，使用 `AbortController` 在 60 秒终止。只对 429、连接中断和 5xx 自动重试一次；4xx 配置错误不重试。

- [ ] **Step 4: 实现 Zod 解析与一次修复**

`generateStructured()` 提取 JSON、执行目标 Schema；失败时把 Zod issue 的 path/code/message 和原始响应提交 `repair` operation。第二次仍失败抛出稳定 `MODEL_SCHEMA_INVALID`，错误对象不包含 API Key 和完整系统 Prompt。

```ts
const first = await adapter.generate(request)
const parsed = parseJson(first.text)
const checked = schema.safeParse(parsed)
if (checked.success) return checked.data
const repaired = await adapter.generate(makeRepairRequest(request, first.text, checked.error.issues))
return schema.parse(parseJson(repaired.text))
```

- [ ] **Step 5: 定义四个独立 Prompt**

`prompts/index.ts` 导出 `topicPrompt`、`scriptPrompt`、`qaPrompt`、`reviewPrompt`。QA Prompt 明确“只检查、不改写”；review Prompt 明确“指标为模拟数据，不得推断真实因果”。每个 Prompt 指定对应 JSON 字段，不包含供应商语法。

```ts
export const prompts = {
  topics: topicPrompt,
  scripts: scriptPrompt,
  qa: qaPrompt,
  review: reviewPrompt,
} as const
```

- [ ] **Step 6: 验证模型契约**

Run: `npm --prefix prototype test -- llm.test.ts`
Expected: PASS，最多一次 repair，超时/429 语义稳定，密钥不进入记录。

- [ ] **Step 7: Commit**

```bash
git add prototype/src/lib/llm prototype/src/prompts prototype/tests/unit/llm.test.ts
git commit -m "feat: add provider-neutral structured LLM calls"
```

---

### Task 4: 跑通最小 IP 与选题方向生成

**Files:**
- Create: `prototype/src/presets/index.ts`
- Create: `prototype/src/services/run-service.ts`
- Create: `prototype/src/app/api/prototype/[...segments]/route.ts`
- Create: `prototype/tests/unit/run-service.test.ts`

**Interfaces:**
- Consumes: Task 2 的 repository/state machine，Task 3 的 topics operation。
- Produces: `RunService.createRun()`、`generateTopics()`、`selectTopic()` 和对应 API Routes。

- [ ] **Step 1: 写方向数量、IP 证据和状态失败测试**

```ts
it("creates three to five IP-fit topic directions", async () => {
  const run = service.createRun(minimumIpInput)
  const result = await service.generateTopics(run.id, run.inputVersion)
  expect(result.items.length).toBeGreaterThanOrEqual(3)
  expect(result.items.length).toBeLessThanOrEqual(5)
  expect(result.items.every(item => item.ipFitEvidence.length > 0)).toBe(true)
  expect(service.getRun(run.id).state).toBe("WAITING_TOPIC_SELECTION")
})

it("keeps exactly one current topic selection", async () => {
  const first = service.selectTopic(run.id, batch.version, batch.items[0].id)
  const second = service.selectTopic(run.id, batch.version, batch.items[1].id)
  expect(first.isCurrent).toBe(false)
  expect(second.isCurrent).toBe(true)
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm --prefix prototype test -- run-service.test.ts -t "topic"`
Expected: FAIL，Preset、RunService 和 API route 尚不存在。

- [ ] **Step 3: 实现原型 Preset**

默认 Goal 为“团长招商获客”，包含目标受众、视频号/抖音、咨询 CTA 和禁止无依据强承诺。定义 6 个抽象结构：身份反差、失败转折、误区纠正、案例拆解、清单方法、价值观筛选；不保存或引用爆款原文。

```ts
export const prototypePreset = {
  version: "prototype-v1",
  goal: { name: "团长招商获客", platforms: ["douyin", "wechat_channels"] },
  structures: ["identity-contrast", "failure-turn", "myth-correction", "case-breakdown", "method-list", "value-filter"],
} as const
```

- [ ] **Step 4: 实现 RunService 的创建、生成和选择**

`createRun()` 校验六个最小 IP 字段并进入 `READY_FOR_TOPICS`。`generateTopics()` 固定保存 IP/Goal/Preset 版本，调用 topics operation，验证 3～5 个方向后保存 batch。`selectTopic()` 校验 batch version 和候选归属，创建新 current selection 并使旧选择失效。

```ts
async generateTopics(runId: string, inputVersion: number) {
  const run = this.repository.requireVersion(runId, inputVersion)
  const items = await this.llm.generateStructured(
    "topics",
    buildTopicInput(run),
    topicBatchSchema,
  )
  if (items.length < 3 || items.length > 5) throw domainError("TOPIC_COUNT_INVALID")
  return this.repository.saveTopicBatch(runId, inputVersion, items)
}
```

- [ ] **Step 5: 实现 Catch-all Route Handler**

`route.ts` 设置 `runtime = "nodejs"`，解析安全路径段，只映射：

- `POST /api/prototype/runs`
- `GET /api/prototype/runs/{id}`
- `POST /api/prototype/runs/{id}/topics/generate`
- `POST /api/prototype/runs/{id}/topics/select`

未知命令返回 404；过期 `inputVersion` 返回 409；领域异常转换为 `{errorCode,message,retryable}`，不返回堆栈。

```ts
export const runtime = "nodejs"
const routeKey = `${request.method} /${segments.join("/")}`
const handler = routeTable[routeKey]
if (!handler) return Response.json({ errorCode: "NOT_FOUND" }, { status: 404 })
return handler(request)
```

- [ ] **Step 6: 验证方向纵向切片**

Run: `npm --prefix prototype test -- run-service.test.ts -t "topic"`
Expected: PASS，方向数量、IP 证据、唯一选择、幂等和 409 均通过。

- [ ] **Step 7: Commit**

```bash
git add prototype/src/presets prototype/src/services prototype/src/app/api prototype/tests/unit/run-service.test.ts
git commit -m "feat: add minimum IP and topic generation"
```

---

### Task 5: 实现同方向三篇文案生成与选择

**Files:**
- Modify: `prototype/src/services/run-service.ts`
- Modify: `prototype/src/app/api/prototype/[...segments]/route.ts`
- Modify: `prototype/tests/unit/run-service.test.ts`

**Interfaces:**
- Consumes: Task 4 的 current `TopicSelection`，Task 3 的 scripts operation。
- Produces: `RunService.generateScripts()`、`selectScript()` 和文案 Routes。

- [ ] **Step 1: 写恰好三篇和同方向失败测试**

```ts
it("stores exactly three scripts for the selected direction", async () => {
  const batch = await service.generateScripts(run.id, selectedTopic.inputVersion)
  expect(batch.items).toHaveLength(3)
  expect(new Set(batch.items.map(item => item.topicDirectionId)))
    .toEqual(new Set([selectedTopic.topicId]))
})

it("rejects the whole batch when one script changes direction", async () => {
  fakeLlm.queue(scriptBatchWithOneForeignDirection)
  await expect(service.generateScripts(run.id, selectedTopic.inputVersion))
    .rejects.toMatchObject({ code: "SCRIPT_DIRECTION_MISMATCH" })
  expect(repository.listScriptBatches(run.id)).toHaveLength(0)
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm --prefix prototype test -- run-service.test.ts -t "script"`
Expected: FAIL，文案方法和路由尚不存在。

- [ ] **Step 3: 实现文案生成和服务端方向覆盖**

`generateScripts()` 只装配当前 IP、Goal、唯一 TopicSelection 和对应抽象结构；要求模型返回恰好 3 篇。服务端不信任模型 ID，对每篇覆盖当前 `topicDirectionId` 前先检查模型声明是否一致；不一致整批拒绝，避免静默掩盖 Prompt 漂移。

```ts
const scripts = scriptBatchSchema.parse(modelResult)
if (scripts.some(item => item.topicDirectionId !== selection.topicId)) {
  throw domainError("SCRIPT_DIRECTION_MISMATCH")
}
return repository.saveScriptBatch(runId, inputVersion, scripts)
```

- [ ] **Step 4: 实现文案选择和版本失效**

`selectScript()` 校验 script 属于 current topic/current batch，创建唯一 current selection。重新选择方向时，所有旧文案 batch 和选择保留历史但标记 `superseded=true`，不能进入 QA。

```ts
if (script.topicDirectionId !== currentTopic.topicId || scriptBatch.superseded) {
  throw domainError("SCRIPT_SELECTION_STALE")
}
return repository.selectScript(runId, scriptBatch.version, script.id)
```

- [ ] **Step 5: 暴露文案 Routes**

- `POST /api/prototype/runs/{id}/scripts/generate`
- `POST /api/prototype/runs/{id}/scripts/select`

重复生成命令使用相同幂等键返回原 batch；明确“换一批”时客户端递增 `inputVersion` 才创建新 batch。

- [ ] **Step 6: 验证文案切片**

Run: `npm --prefix prototype test -- run-service.test.ts -t "script"`
Expected: PASS，恰好三篇、同方向、跨方向拒绝和选择版本约束通过。

- [ ] **Step 7: Commit**

```bash
git add prototype/src/services/run-service.ts prototype/src/app/api/prototype prototype/tests/unit/run-service.test.ts
git commit -m "feat: add same-direction script choices"
```

---

### Task 6: 实现独立 QA、锁稿与确定性模拟指标

**Files:**
- Create: `prototype/src/lib/simulation/metric-simulator.ts`
- Modify: `prototype/src/services/run-service.ts`
- Modify: `prototype/src/app/api/prototype/[...segments]/route.ts`
- Create: `prototype/tests/unit/simulation.test.ts`
- Modify: `prototype/tests/unit/run-service.test.ts`

**Interfaces:**
- Consumes: Task 5 的 current `ScriptSelection`，Task 3 的 qa operation。
- Produces: `runQa()`、`lockScript()`、`simulatePublication()` 和 `simulateMetrics()`。

- [ ] **Step 1: 写 QA 隔离和锁稿门禁失败测试**

```ts
it("uses a separate QA model operation", async () => {
  await service.runQa(run.id, selectedScript.inputVersion)
  expect(fakeLlm.calls.at(-1)?.operation).toBe("qa")
})

it("does not lock a script that fails a hard gate", async () => {
  fakeLlm.queue(qualityReport({ hardGatePassed: false }))
  await service.runQa(run.id, selectedScript.inputVersion)
  expect(() => service.lockScript(run.id, currentVersion))
    .toThrow("QA_HARD_GATE_BLOCKED")
})
```

- [ ] **Step 2: 写模拟器可复现和约束失败测试**

```ts
it("reproduces metrics for the same locked script and scenario", () => {
  const first = simulateMetrics(input, "normal")
  const second = simulateMetrics(input, "normal")
  expect(second).toEqual(first)
  expect(first.isSimulated).toBe(true)
  expect(first.plays).toBeLessThanOrEqual(first.impressions)
})

it("changes scale across explicit demo scenarios", () => {
  expect(simulateMetrics(input, "breakout").impressions)
    .toBeGreaterThan(simulateMetrics(input, "underperform").impressions)
})
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npm --prefix prototype test -- simulation.test.ts run-service.test.ts -t "QA|lock|simulat"`
Expected: FAIL，QA、锁稿和模拟器尚不存在。

- [ ] **Step 4: 实现独立 QA 与不可变锁稿**

QA 输入只含 IP、Goal、选中文案和原型质量规则，输出硬门禁、五项 0～100 分数和修改建议。硬门禁通过才能锁稿；锁稿复制选中文案为不可变版本并计算 SHA-256。修改或重选文案后必须创建新 QA，不能复用旧报告。

```ts
const report = await this.llm.generateStructured(
  "qa",
  buildQaInput(run),
  qualityReportSchema,
)
this.repository.saveQualityReport(runId, report)
if (!report.hardGatePassed) throw domainError("QA_HARD_GATE_BLOCKED")
```

- [ ] **Step 5: 实现指标模拟器**

按规格公式计算 `qualityIndex`，场景倍率为 underperform 0.55、normal 1.00、breakout 2.50；seed 使用 `runId + lockedScriptVersion + simulatorVersion + scenario` 的 SHA-256。使用 seed 驱动确定性 PRNG，生成曝光、播放、完播、点赞、评论、收藏、分享和咨询，执行非负、比率上下限和 `plays ≤ impressions` 校验。

```ts
const qualityIndex = 0.30 * scores.hook + 0.25 * scores.ipFit
  + 0.20 * scores.credibility + 0.15 * scores.structure
  + 0.10 * scores.callToAction
const multiplier = { underperform: 0.55, normal: 1, breakout: 2.5 }[scenario]
```

- [ ] **Step 6: 限制演示场景控制**

正常请求忽略客户端 scenario 并固定 `normal`。只有服务器环境 `PROTOTYPE_DEMO_CONTROLS=true` 时接受 `breakout|underperform`；响应和 SQLite 永远写 `isSimulated=true`。未完成 QA/锁稿返回 409。

```ts
const effectiveScenario = process.env.PROTOTYPE_DEMO_CONTROLS === "true"
  ? requestedScenario
  : "normal"
```

- [ ] **Step 7: 暴露 QA、锁稿和模拟 Routes**

- `POST /api/prototype/runs/{id}/qa/run`
- `POST /api/prototype/runs/{id}/lock`
- `POST /api/prototype/runs/{id}/publication/simulate`

- [ ] **Step 8: 验证 QA 和模拟器**

Run: `npm --prefix prototype test -- simulation.test.ts run-service.test.ts`
Expected: PASS，QA operation 独立、硬门禁有效、锁稿不可变、模拟可复现且明确标识。

- [ ] **Step 9: Commit**

```bash
git add prototype/src/lib/simulation prototype/src/services/run-service.ts prototype/src/app/api/prototype prototype/tests/unit
git commit -m "feat: add independent QA and simulated metrics"
```

---

### Task 7: 实现真实模型复盘与 AI-native 单页面

**Files:**
- Create: `prototype/src/lib/api-client.ts`
- Create: `prototype/src/components/PrototypeWorkspace.tsx`
- Create: `prototype/src/components/DecisionCards.tsx`
- Create: `prototype/src/components/QualityAndLock.tsx`
- Create: `prototype/src/components/SimulationAndReview.tsx`
- Create: `prototype/src/components/ContextDrawer.tsx`
- Modify: `prototype/src/app/page.tsx`
- Modify: `prototype/src/app/globals.css`
- Modify: `prototype/src/services/run-service.ts`
- Modify: `prototype/src/app/api/prototype/[...segments]/route.ts`
- Modify: `prototype/tests/unit/workspace.test.tsx`
- Modify: `prototype/tests/unit/run-service.test.ts`

**Interfaces:**
- Consumes: Task 2–6 的完整 Run API、模拟指标和 review operation。
- Produces: `generateReview()`、统一 `PrototypeWorkspace` 和从最小 IP 到 REVIEWED 的交互。

- [ ] **Step 1: 写复盘模拟标识与因果语言失败测试**

```ts
it("passes simulated lineage to the review operation", async () => {
  await service.generateReview(run.id, metricSnapshot.version)
  const call = fakeLlm.calls.at(-1)
  expect(call?.operation).toBe("review")
  expect(JSON.stringify(call?.input)).toContain('"isSimulated":true')
})

it("rejects a review that presents simulation as real causation", async () => {
  fakeLlm.queue(reviewResult({ claimsRealCausation: true }))
  await expect(service.generateReview(run.id, metricSnapshot.version))
    .rejects.toMatchObject({ code: "REVIEW_CAUSALITY_VIOLATION" })
})
```

- [ ] **Step 2: 写单页面决策顺序失败测试**

```tsx
it("reveals one decision stage at a time", async () => {
  render(<PrototypeWorkspace initialRun={readyForTopicsRun} />)
  expect(screen.getByRole("button", { name: "生成选题方向" })).toBeVisible()
  expect(screen.queryByText("选择今天的文案")).not.toBeInTheDocument()
  await user.click(screen.getByRole("button", { name: "生成选题方向" }))
  expect(await screen.findByText("选择今天拍什么")).toBeVisible()
})

it("always labels the publication metrics as simulated", () => {
  render(<SimulationAndReview snapshot={metricSnapshot} />)
  expect(screen.getByText("模拟数据，不代表真实平台表现")).toBeVisible()
})
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npm --prefix prototype test -- workspace.test.tsx run-service.test.ts -t "review|decision|simulated"`
Expected: FAIL，复盘方法和工作台组件尚不存在。

- [ ] **Step 4: 实现真实模型复盘**

`generateReview()` 固定传入 IP、Goal、TopicSelection、LockedScript、QualityReport 和带 `isSimulated=true` 的 MetricSnapshot。输出包括表现摘要、可保留部分、待改进部分、下一条内容建议、证据限制。Schema 包含 `claimsRealCausation: false` 字面量；不满足时拒绝保存。

```ts
const review = await this.llm.generateStructured(
  "review",
  buildReviewInput(lineage),
  contentReviewSchema,
)
if (review.claimsRealCausation !== false) {
  throw domainError("REVIEW_CAUSALITY_VIOLATION")
}
return this.repository.saveReview(runId, review)
```

- [ ] **Step 5: 实现状态驱动 API Client**

`api-client.ts` 导出 create/get/command 方法，所有命令携带 `inputVersion`。对 409 自动重新获取 Run，但不自动重放写命令；对 retryable 模型错误展示“重试当前步骤”；不把服务器堆栈渲染到页面。

```ts
export async function postCommand<T>(url: string, inputVersion: number, body = {}) {
  const response = await fetch(url, { method: "POST", body: JSON.stringify({ ...body, inputVersion }) })
  if (response.status === 409) throw new VersionConflict(await response.json())
  if (!response.ok) throw new PrototypeApiError(await response.json())
  return response.json() as Promise<T>
}
```

- [ ] **Step 6: 实现 AI-native 工作台**

`PrototypeWorkspace` 根据服务器返回 state 只展示当前决策：最小 IP、方向卡、文案卡、QA/锁稿、模拟数据/复盘。完成步骤进入可展开历史。`ContextDrawer` 默认折叠，显示 IP 摘要、所选方向、所选文案和模型耗时；不显示 chain-of-thought、API Key 或完整 Prompt。

```tsx
switch (run.state) {
  case "READY_FOR_TOPICS": return <GenerateTopicsCard run={run} />
  case "WAITING_TOPIC_SELECTION": return <TopicChoices run={run} />
  case "READY_FOR_SCRIPTS": return <GenerateScriptsCard run={run} />
  case "WAITING_SCRIPT_SELECTION": return <ScriptChoices run={run} />
  case "READY_FOR_QA": return <RunQaCard run={run} />
  case "WAITING_LOCK_CONFIRMATION": return <QualityAndLock run={run} />
  case "WAITING_REVIEW":
  case "REVIEWED": return <SimulationAndReview run={run} />
}
```

- [ ] **Step 7: 实现等待、错误和响应式状态**

模型调用期间显示具体动作和计时；按钮禁用防止重复提交。失败卡显示稳定错误消息、重试当前步骤和保留进度说明。桌面使用主流 + 折叠上下文，移动端使用单列和底部抽屉；键盘可以选择卡片和确认。

- [ ] **Step 8: 暴露复盘和导出 Routes**

- `POST /api/prototype/runs/{id}/review/generate`
- `GET /api/prototype/runs/{id}/export`

导出 JSON 删除 model raw response、环境配置和错误堆栈，只保留用户输入、版本化产物、模拟标识和模型元数据。

- [ ] **Step 9: 验证复盘和界面**

Run: `npm --prefix prototype test -- workspace.test.tsx run-service.test.ts`
Expected: PASS，复盘明确模拟限制，UI 只展示当前决策，错误可重试且模拟标识始终存在。

- [ ] **Step 10: Commit**

```bash
git add prototype/src/lib/api-client.ts prototype/src/components prototype/src/app prototype/src/services/run-service.ts prototype/tests/unit
git commit -m "feat: complete AI-native prototype workflow"
```

---

### Task 8: 完成 E2E、真实模型冒烟与本地交付

**Files:**
- Create: `prototype/tests/e2e/content-loop.spec.ts`
- Create: `prototype/tests/live/live-model-smoke.ts`
- Create: `prototype/README.md`
- Modify: `prototype/playwright.config.ts`
- Modify: `prototype/.env.example`
- Modify: `prototype/package.json`

**Interfaces:**
- Consumes: Task 1–7 的完整原型。
- Produces: 可重复 Fake LLM E2E、可选真实模型冒烟、一条命令启动说明和原型验收证据。

- [ ] **Step 1: 写完整 Fake LLM E2E**

```ts
test("runs from minimum IP to reviewed", async ({ page }) => {
  await page.goto("/")
  await page.getByLabel("称呼").fill("示例团长")
  await page.getByLabel("真实经历").fill("三年社区团购运营经历")
  await page.getByLabel("擅长领域").fill("社区团购运营")
  await page.getByLabel("目标人群").fill("希望拓展本地业务的人")
  await page.getByLabel("表达特点").fill("直接、实在、有案例")
  await page.getByLabel("不能说的内容").fill("不承诺确定收益")
  await page.getByRole("button", { name: "生成选题方向" }).click()
  await page.getByRole("button", { name: "选择这个方向" }).first().click()
  await page.getByRole("button", { name: "生成 3 篇文案" }).click()
  await page.getByRole("button", { name: "选为今天拍摄稿" }).first().click()
  await page.getByRole("button", { name: "运行发布前 QA" }).click()
  await page.getByRole("button", { name: "确认锁稿" }).click()
  await page.getByRole("button", { name: "生成模拟发布数据" }).click()
  await page.getByRole("button", { name: "生成复盘" }).click()
  await expect(page.getByText("本次内容复盘")).toBeVisible()
  await expect(page.getByText("模拟数据，不代表真实平台表现")).toBeVisible()
})
```

- [ ] **Step 2: 配置仅测试可用的 Fake LLM**

Playwright webServer 设置 `NODE_ENV=test` 和 `PROTOTYPE_TEST_MODE=true`。应用只有同时满足两者才实例化 `FakeLlmAdapter`；普通 `npm run dev` 即使用户手工设置 `PROTOTYPE_TEST_MODE=true` 也不能绕过真实模型配置。

```ts
const allowFake = process.env.NODE_ENV === "test"
  && process.env.PROTOTYPE_TEST_MODE === "true"
export const llmAdapter = allowFake ? new FakeLlmAdapter() : new OpenAiCompatibleAdapter()
```

- [ ] **Step 3: 运行 E2E 确认失败**

Run: `npm --prefix prototype run test:e2e`
Expected: FAIL，E2E fixture 和测试模式接线尚未完成。

- [ ] **Step 4: 完成 E2E fixture 与刷新恢复断言**

Fake LLM 按 topics/scripts/qa/review 返回固定合法结果。E2E 在方向选择后刷新页面，确认仍处于同一 Run；对重复生成按钮验证只产生一个 batch；对模型错误 fixture 验证只重试当前步骤。

- [ ] **Step 5: 实现真实模型冒烟脚本**

`live-model-smoke.ts` 检查 `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`，创建临时 SQLite，依次执行四个 operation，并断言：方向 3～5、文案恰好 3 且同方向、QA 五项评分、复盘 `claimsRealCausation=false`。脚本最后打印模型、四次耗时和 token，不打印内容正文或密钥；缺少环境变量时以退出码 2 明确跳过。

- [ ] **Step 6: 编写本地运行和演示手册**

README 包含 Node/npm 前置条件、安装、复制 `.env.example`、启动、重置 `.data/prototype.sqlite`、运行单元/E2E/真实冒烟、演示步骤、模拟数据声明，以及可迁移/必须丢弃清单。正常启动命令固定为：

```bash
npm --prefix prototype install
npm --prefix prototype run dev
```

- [ ] **Step 7: 执行完整验证**

Run: `npm --prefix prototype run typecheck`
Expected: PASS。

Run: `npm --prefix prototype test`
Expected: PASS，所有单元和组件测试无失败。

Run: `npm --prefix prototype run test:e2e`
Expected: PASS，从最小 IP 到 REVIEWED，刷新恢复、幂等和模型失败恢复通过。

Run: `npm --prefix prototype run build`
Expected: PASS，客户端 bundle 不包含 `LLM_API_KEY` 或测试 Fake LLM 数据。

Run: `npm --prefix prototype run test:live`
Expected: 配置真实模型环境时 PASS；未配置时退出码 2 并输出明确跳过原因，不计为自动测试失败。

- [ ] **Step 8: Commit**

```bash
git add prototype
git commit -m "test: verify and document local content prototype"
```

---

## Prototype Acceptance

- [ ] `npm --prefix prototype run dev` 在本地启动，不依赖 PostgreSQL、Redis、Python 或 Docker。
- [ ] 未配置真实模型时正常界面明确阻断，不用 Fake LLM 或静态内容冒充结果。
- [ ] 最小 IP 输入后真实模型返回 3～5 个带 IP 证据的方向。
- [ ] 选择唯一方向后真实模型返回该方向下恰好 3 篇完整文案，跨方向混稿为 0。
- [ ] QA 使用独立 operation，包含硬门禁、五项分数和修改建议；硬门禁失败不能锁稿。
- [ ] 锁稿不可变，修改或重选后必须重新 QA。
- [ ] 模拟指标可复现，始终带 `isSimulated=true` 并在 UI 显著标识。
- [ ] 真实模型复盘接收完整谱系，明确模拟限制，不声称真实因果。
- [ ] 页面刷新恢复当前 Run；重复点击幂等；模型失败只重试当前步骤。
- [ ] API Key 不进入客户端、数据库、导出或日志。
- [ ] Fake LLM E2E 从创建 Run 到 REVIEWED 通过；真实模型冒烟覆盖四个 operation。
- [ ] 原型保持单页面 AI-native 体验，没有登录、租户、后台导航或传统 SaaS 仪表盘。
- [ ] 正式首版规格和实施计划在原型开发过程中无改动。

## Explicitly Disposable

- Next.js Route Handler；
- SQLite schema、repository 和原型数据库；
- 原型简化状态机；
- Fake LLM fixture；
- 所有模拟指标和由其生成的复盘内容；
- 原型专用错误和幂等实现。

## Candidate Assets for Formal Review

- IP、方向、文案、QA、指标和复盘 Zod Schema；
- 四个 Prompt 及真实失败样本；
- 6 个抽象结构候选；
- 决策卡、等待、错误恢复和上下文抽屉交互；
- 模型 Adapter 的供应商兼容经验；
- E2E 用户路径和 Agent Eval 样本。

候选资产不能被正式系统直接 import。正式实施时逐项评审、复制到正式模块、绑定正式版本和补充正式测试。
