# AI-native 每日创作界面 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有原型改造成以持久化当前 IP 为上下文的 AI-native 每日创作台，并让用户确认选题后自动得到同方向的 3 篇口播稿。

**Architecture:** 保留现有 Next.js、SQLite、确定性状态机和真实模型适配器。服务层新增组合用例，把“保存选题 + 生成口播稿”作为一次用户意图处理；客户端只负责提交选择、展示生成状态和刷新 Run。原型用浏览器本地存储模拟当前 IP 持久化，Run 继续保存不可变 `ipProfile` 快照，保证切换当前 IP 不改变历史任务。

**Tech Stack:** Next.js 16、React 19、TypeScript 5.9、Vitest、Testing Library、Playwright、SQLite、原生 CSS。

## Global Constraints

- [ ] 不新增 UI 框架、图标库、字体包或动画依赖。
- [ ] 默认入口使用当前 IP，只有本地不存在 IP 时才显示一次性初始化表单。
- [ ] 选题方向保持 1 对多：先选一个方向，再生成该方向下恰好 3 篇完整口播稿。
- [ ] 正常流程不显示“生成文案”按钮；选题选择成功后立即进入可恢复的生成状态。
- [ ] Run 内的 `ipProfile` 是创建时快照；更新当前 IP 只影响新 Run。
- [ ] 保留真实模型调用、失败重试、模拟发布数据和复盘能力。
- [ ] 界面采用已确认的“内容编辑台”视觉：暖白纸面、深色文字、单一朱红强调色、垂直内容列表、无传统 SaaS 卡片宫格。
- [ ] 可见中文不使用英文后台术语，不向普通用户显示 tenant、Agent mode、Run state 等内部概念。
- [ ] 所有行为变更先写失败测试并确认 RED，再写最小实现。

## File Structure

```text
prototype/
  src/
    components/
      PrototypeWorkspace.tsx       # 页面状态编排与 API 调用，不承载大段展示结构
      CurrentIpContext.tsx          # 当前 IP 摘要、切换面板和新增入口
      DailyProgress.tsx             # 选题、口播稿、质检、定稿四阶段映射
      TopicDirectionList.tsx        # 垂直选题列表
      ScriptCandidateList.tsx       # 单选候选稿与确认动作
      QualityAndLock.tsx            # 编辑台式质量报告与锁稿
    lib/
      current-ip-store.ts           # 原型用 localStorage 当前 IP 仓储
    services/
      run-service.ts                # 组合“选题并生成稿件”用例
    app/
      api/prototype/[...segments]/route.ts
      globals.css
  tests/
    unit/
      current-ip-store.test.ts
      run-service.test.ts
      workspace.test.tsx
    e2e/
      content-loop.spec.ts
  design-qa.md
```

---

### Task 1: 选题确认后自动生成口播稿

**Files:**
- Modify: `prototype/tests/unit/run-service.test.ts`
- Modify: `prototype/src/services/run-service.ts`
- Modify: `prototype/src/app/api/prototype/[...segments]/route.ts`

**Interfaces:**
- Consumes: `RunService.selectTopic(runId, batchVersion, topicId)` 和 `RunService.generateScripts(runId, inputVersion)`。
- Produces: `RunService.selectTopicAndGenerateScripts(runId: string, batchVersion: number, topicId: string, inputVersion: number): Promise<VersionedBatch<ScriptCandidate>>`。
- `POST /api/prototype/runs/{runId}/topics/select` 请求体固定为 `{ batchVersion, topicId, inputVersion }`，成功时直接返回生成后的 `VersionedBatch<ScriptCandidate>`。

- [ ] **Step 1: 写组合用例失败测试**

```ts
it("generates scripts immediately after a topic is selected", async () => {
  const repository = new PrototypeRepository(":memory:")
  const adapter = new FakeLlmAdapter([{ json: topics }])
  const service = new RunService(repository, new StructuredLlmClient(adapter))
  const run = service.createRun(minimumIpInput)
  const topicBatch = await service.generateTopics(run.id, run.inputVersion)
  adapter.enqueue({ json: makeScripts(topics[0].id) })

  const scriptBatch = await service.selectTopicAndGenerateScripts(
    run.id,
    topicBatch.version,
    topics[0].id,
    run.inputVersion,
  )

  expect(scriptBatch.items).toHaveLength(3)
  expect(service.getRun(run.id).state).toBe("WAITING_SCRIPT_SELECTION")
})
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `npm test -- run-service.test.ts`

Expected: FAIL，提示 `selectTopicAndGenerateScripts is not a function`。

- [ ] **Step 3: 实现最小组合用例**

```ts
async selectTopicAndGenerateScripts(
  runId: string,
  batchVersion: number,
  topicId: string,
  inputVersion: number,
) {
  this.selectTopic(runId, batchVersion, topicId)
  return this.generateScripts(runId, inputVersion)
}
```

路由中的 `topics/select` 分支改为 `await service.selectTopicAndGenerateScripts(...)`，并传入 `inputVersion`。保留 `scripts/generate` 端点只作为失败后的恢复入口，不在正常界面展示。

- [ ] **Step 4: 增加失败恢复测试**

```ts
it("keeps the selected topic and exposes the script retry checkpoint when generation fails", async () => {
  const repository = new PrototypeRepository(":memory:")
  const adapter = new FakeLlmAdapter([{ json: topics }])
  const service = new RunService(repository, new StructuredLlmClient(adapter))
  const run = service.createRun(minimumIpInput)
  const topicBatch = await service.generateTopics(run.id, run.inputVersion)

  await expect(service.selectTopicAndGenerateScripts(
    run.id,
    topicBatch.version,
    topics[0].id,
    run.inputVersion,
  )).rejects.toThrow("FAKE_LLM_RESPONSE_MISSING")

  expect(repository.getCurrentTopicSelection(run.id)?.topicId).toBe(topics[0].id)
  expect(service.getRun(run.id).state).toBe("READY_FOR_SCRIPTS")
})
```

- [ ] **Step 5: 运行服务测试确认 GREEN**

Run: `npm test -- run-service.test.ts`

Expected: PASS，正常路径直接到 `WAITING_SCRIPT_SELECTION`，失败路径停在 `READY_FOR_SCRIPTS`。

- [ ] **Step 6: Commit**

```bash
git add prototype/src/services/run-service.ts prototype/src/app/api/prototype/[...segments]/route.ts prototype/tests/unit/run-service.test.ts
git commit -m "feat: generate scripts after topic selection"
```

---

### Task 2: 持久化当前 IP 并把建档移出每日流程

**Files:**
- Create: `prototype/src/lib/current-ip-store.ts`
- Create: `prototype/tests/unit/current-ip-store.test.ts`
- Modify: `prototype/src/components/PrototypeWorkspace.tsx`
- Modify: `prototype/tests/unit/workspace.test.tsx`

**Interfaces:**
- Produces: `loadCurrentIp(): IpProfile | null`、`saveCurrentIp(profile: IpProfile): void`、`clearCurrentIp(): void`。
- `content-prototype-current-ip-v1` 只保存通过 `ipProfileSchema` 校验的 JSON；损坏数据返回 `null` 并被清除。
- `PrototypeWorkspace` 创建 Run 时始终复制当前 IP 数据，后续本地存储改变不修改已有 Run。

- [ ] **Step 1: 写当前 IP 仓储失败测试**

```ts
it("persists and reloads the current IP", () => {
  saveCurrentIp(minimumIpInput)
  expect(loadCurrentIp()).toEqual(minimumIpInput)
})

it("removes malformed current IP data", () => {
  localStorage.setItem(CURRENT_IP_KEY, "{broken")
  expect(loadCurrentIp()).toBeNull()
  expect(localStorage.getItem(CURRENT_IP_KEY)).toBeNull()
})
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `npm test -- current-ip-store.test.ts`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现最小本地仓储**

```ts
export const CURRENT_IP_KEY = "content-prototype-current-ip-v1"

export function loadCurrentIp(): IpProfile | null {
  const raw = window.localStorage.getItem(CURRENT_IP_KEY)
  if (!raw) return null
  const result = ipProfileSchema.safeParse(JSON.parse(raw))
  if (result.success) return result.data
  window.localStorage.removeItem(CURRENT_IP_KEY)
  return null
}

export function saveCurrentIp(profile: IpProfile) {
  window.localStorage.setItem(CURRENT_IP_KEY, JSON.stringify(ipProfileSchema.parse(profile)))
}
```

实现时用 `try/catch` 包裹 JSON 解析，解析异常也清理键并返回 `null`。

- [ ] **Step 4: 写每日入口失败测试**

```tsx
it("uses the persisted current IP without showing onboarding again", async () => {
  saveCurrentIp(minimumIpInput)
  const run = {
    id: "run-daily",
    state: "WAITING_TOPIC_SELECTION",
    inputVersion: 1,
    ipProfile: minimumIpInput,
    topicBatch: { version: 1, items: topics },
  }
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith("/runs") && init?.method === "POST") {
      return new Response(JSON.stringify({ ...run, state: "READY_FOR_TOPICS" }), { status: 201 })
    }
    if (url.includes("topics/generate")) {
      return new Response(JSON.stringify(run.topicBatch), { status: 200 })
    }
    return new Response(JSON.stringify(run), { status: 200 })
  }) as typeof fetch
  render(<PrototypeWorkspace />)

  expect(screen.queryByLabelText("称呼")).not.toBeInTheDocument()
  expect(await screen.findByText("选择今天拍什么")).toBeVisible()
  expect(screen.getByText("示例团长")).toBeVisible()
})
```

- [ ] **Step 5: 修改工作台初始化顺序**

固定顺序为：恢复现有 Run；没有 Run 时读取当前 IP；存在当前 IP 则自动创建今日 Run 并生成选题；没有当前 IP 才展示初始化表单。初始化表单成功后先 `saveCurrentIp(profile)`，再创建首个 Run。

- [ ] **Step 6: 运行仓储和工作台测试确认 GREEN**

Run: `npm test -- current-ip-store.test.ts workspace.test.tsx`

Expected: PASS，已有当前 IP 时不再出现建档字段。

- [ ] **Step 7: Commit**

```bash
git add prototype/src/lib/current-ip-store.ts prototype/src/components/PrototypeWorkspace.tsx prototype/tests/unit/current-ip-store.test.ts prototype/tests/unit/workspace.test.tsx
git commit -m "feat: persist current IP for daily creation"
```

---

### Task 3: 按已确认视觉稿重构每日创作工作台

**Files:**
- Create: `prototype/src/components/CurrentIpContext.tsx`
- Create: `prototype/src/components/DailyProgress.tsx`
- Create: `prototype/src/components/TopicDirectionList.tsx`
- Create: `prototype/src/components/ScriptCandidateList.tsx`
- Modify: `prototype/src/components/PrototypeWorkspace.tsx`
- Modify: `prototype/src/components/QualityAndLock.tsx`
- Modify: `prototype/src/components/SimulationAndReview.tsx`
- Modify: `prototype/src/app/globals.css`
- Modify: `prototype/tests/unit/workspace.test.tsx`

**Interfaces:**
- `CurrentIpContext({ profile, runProfile, onStartNewIp })` 只展示当前 IP 和“新增 IP”入口；当当前 IP 与 Run 快照不同时显示“切换将在新任务生效”。
- `DailyProgress({ state })` 把内部状态映射为 `确定选题`、`选择口播稿`、`质量检查`、`定稿交接`，不显示内部状态名。
- `TopicDirectionList({ items, pending, onSelect })` 使用垂直分隔行；点击方向立即触发 `onSelect`。
- `ScriptCandidateList({ items, pending, onConfirm })` 先本地单选，再用一个主按钮确认。

- [ ] **Step 1: 写选题后无中间按钮的失败测试**

```tsx
it("moves from topic selection directly into script generation", async () => {
  const user = userEvent.setup()
  const scripts = makeScripts(topics[0].id)
  const topicSelectionRun = {
    id: "run-topic",
    state: "WAITING_TOPIC_SELECTION",
    inputVersion: 1,
    ipProfile: minimumIpInput,
    topicBatch: { version: 1, items: topics },
  }
  let releaseSelection!: (response: Response) => void
  const pendingSelection = new Promise<Response>((resolve) => { releaseSelection = resolve })
  global.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes("topics/select")) return pendingSelection
    return Promise.resolve(new Response(JSON.stringify({
      ...topicSelectionRun,
      state: "WAITING_SCRIPT_SELECTION",
      scriptBatch: { version: 1, items: scripts },
    }), { status: 200 }))
  }) as typeof fetch
  render(<PrototypeWorkspace initialRun={topicSelectionRun} />)

  await user.click(screen.getAllByRole("button", { name: "选择这个方向" })[0])
  expect(screen.getByText("正在生成同方向口播稿")).toBeVisible()
  expect(screen.queryByRole("button", { name: "生成 3 篇文案" })).not.toBeInTheDocument()
  releaseSelection(new Response(JSON.stringify({ version: 1, items: scripts }), { status: 200 }))
  expect(await screen.findByText("选择今天的口播稿")).toBeVisible()
})
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `npm test -- workspace.test.tsx`

Expected: FAIL，旧界面仍进入 `READY_FOR_SCRIPTS` 并展示生成按钮。

- [ ] **Step 3: 实现四个聚焦组件**

组件只接收展示所需的最小字段和事件回调。列表使用 `<button>`、`<input type="radio">` 或等价的可访问语义；焦点态不能只依赖颜色。不要在组件内调用 API。

- [ ] **Step 4: 重构工作台编排**

`PrototypeWorkspace` 保留 `command()`、恢复、错误和 busy 状态；把正常 `READY_FOR_SCRIPTS` 仅作为错误恢复状态，文案生成失败时显示“重新生成口播稿”，正常选择后 busy 文案固定为“正在生成同方向口播稿”。删除正常流程中的“生成 3 篇文案”阶段。

- [ ] **Step 5: 落实视觉系统**

`globals.css` 使用以下固定令牌：

```css
:root {
  --paper: #f4f1e8;
  --sheet: #fbfaf6;
  --ink: #1b201c;
  --muted: #6e746e;
  --line: #cfcabf;
  --accent: #d84c31;
  --success: #2f6548;
}
```

桌面主布局为 `145px minmax(0, 1fr) 220px`，移动端小于 `900px` 折为单列。选题和文案使用整组列表与行分隔，不使用三张等宽卡片；按钮使用小圆角或直角，不使用胶囊形；删除径向渐变、玻璃背景和大面积阴影。

- [ ] **Step 6: 补齐状态测试**

覆盖 loading、error、selected、QA 通过、锁定、REVIEWED 和移动端不丢主操作。错误提示必须保留已完成进度，并只提供当前失败动作的重试。

- [ ] **Step 7: 运行单元测试确认 GREEN**

Run: `npm test -- workspace.test.tsx`

Expected: PASS，界面正常流程不出现独立生成文案按钮。

- [ ] **Step 8: Commit**

```bash
git add prototype/src/components prototype/src/app/globals.css prototype/tests/unit/workspace.test.tsx
git commit -m "feat: redesign daily creation workspace"
```

---

### Task 4: 更新完整闭环 E2E 与视觉质量门禁

**Files:**
- Modify: `prototype/tests/e2e/content-loop.spec.ts`
- Modify: `prototype/README.md`
- Create: `prototype/design-qa.md`

**Interfaces:**
- E2E 首次运行验证初始化，第二次清除 Run 但保留当前 IP，验证直接进入今日选题。
- E2E 选择方向后等待“选择今天的口播稿”，不得点击任何“生成文案”按钮。
- `design-qa.md` 必须记录桌面与移动端的布局、交互、可访问性和最终结论。

- [ ] **Step 1: 先修改 E2E 形成 RED**

```ts
await page.getByRole("button", { name: "选择这个方向" }).first().click()
await expect(page.getByText("正在生成同方向口播稿")).toBeVisible()
await expect(page.getByRole("button", { name: "生成 3 篇文案" })).toHaveCount(0)
await expect(page.getByText("选择今天的口播稿")).toBeVisible()
```

- [ ] **Step 2: 运行 E2E 确认 RED**

Run: `npm run test:e2e`

Expected: FAIL，旧流程仍需要独立点击生成文案。

- [ ] **Step 3: 更新 E2E 和 README**

README 演示顺序改为：首次初始化或读取当前 IP；生成方向；点击方向后自动生成 3 篇口播稿；选稿；QA；锁稿；模拟发布；复盘。

- [ ] **Step 4: 运行全量自动化检查**

Run: `npm test`

Expected: 全部单元和组件测试 PASS。

Run: `npm run typecheck`

Expected: PASS，无 TypeScript 错误。

Run: `npm run build`

Expected: PASS，Next.js 生产构建成功。

Run: `npm run test:e2e`

Expected: PASS，完整闭环无需“生成文案”中间点击。

- [ ] **Step 5: 进行设计 QA**

在相同桌面和移动端视口对照已确认的视觉伴侣稿，检查：当前 IP 上下文、四阶段进度、垂直选题列表、候选稿单选、生成/错误状态、QA、定稿交接、键盘焦点、对比度和响应式。将问题按 P0 到 P3 写入 `prototype/design-qa.md`，修复全部 P0/P1/P2 后把结论写为 `final result: passed`。

- [ ] **Step 6: Commit**

```bash
git add prototype/tests/e2e/content-loop.spec.ts prototype/README.md prototype/design-qa.md
git commit -m "test: verify AI-native daily creation flow"
```
