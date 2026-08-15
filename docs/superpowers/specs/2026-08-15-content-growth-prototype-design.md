# 内容增长 Agent 快速原型设计

**日期：** 2026-08-15
**状态：** 设计确认
**定位：** 在不修改正式首版架构和实施计划的前提下，用 5 个工作日左右完成可本地演示的真实模型纵向切片。

## 1. 原型目的

原型只验证三个问题：

1. 团长是否能在 AI-native 单页面中自然完成“填 IP → 选方向 → 选文案 → 看 QA → 锁稿 → 看模拟效果 → 看复盘”；
2. IP 属性、选题方向和爆款结构能否稳定约束大模型生成同方向、可选择的完整文案；
3. 业务人员是否认可“先确定今天拍什么，再选择具体文案”的产品流程。

原型不是正式首版的提前实现。正式规格和正式实施计划保持不变；原型放在独立 `prototype/` 目录，允许在验证结束后整体删除。

## 2. 已确认边界

### 2.1 必须实现

- 真实调用大模型；
- 本地保存 IP、任务状态、候选方向、候选文案、QA、锁稿、模拟指标和复盘；
- 先生成 3～5 个方向，用户选择一个后再生成该方向下 3 篇完整文案；
- 使用独立 QA Prompt，生成者不能在同一次模型输出中自我评分；
- 发布与平台表现使用明确标识的模拟数据；
- 复盘由真实模型根据模拟指标生成；
- 页面刷新后可以继续当前任务；
- 本地运行，不部署公网。

### 2.2 明确不实现

- 用户登录、五类角色、租户和权限；
- PostgreSQL、Redis、Celery、Outbox、RLS 和正式数据库迁移体系；
- 正式 `SystemBaselineBundle`、租户默认继承和 DEMO 清理机制；
- 爆款原文库、内部内容采集流水线和 20～30 个正式爆款结构；
- 真实发布、CSV/XLSX 导入和平台 API；
- 质量标准自主提案、影子评测和长期记忆审批；
- 数字人口播、MiniMax、HeyGen 和视频成片；
- 公网部署、监控告警、备份、灾备和高可用。

## 3. 方案选择

采用独立纵向切片，而不是静态原型或精简正式系统。

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| 静态交互原型 | 1～2 天可展示 | 不能验证真实生成质量和失败恢复 | 不采用 |
| 独立纵向切片 | 真实模型、完整体验、代码量可控 | 部分基础设施代码未来丢弃 | 采用 |
| 精简正式系统 | 复用率高 | 需要提前建设权限、队列、迁移和部署，周期长 | 不采用 |

## 4. 技术架构

```text
Browser
  │
  ▼
Next.js Prototype
├── AI-native Workspace
├── Prototype API Routes
├── Deterministic Prototype State Machine
├── OpenAI-compatible LLM Adapter
├── Zod Output Validation / One Repair Attempt
├── Deterministic Metric Simulator
└── SQLite Repository
```

### 4.1 技术选型

| 层 | 技术 | 说明 |
|---|---|---|
| 应用 | Next.js 15 + React 19 + TypeScript 5 | 单仓单进程，避免单独建设 Python API |
| 数据 | SQLite + `better-sqlite3` | 本地持久化、同步事务、零外部依赖 |
| Schema | Zod | 同时验证 API 输入、模型输出和 SQLite JSON 字段 |
| 模型 | OpenAI-compatible HTTP Adapter | 通过环境变量切换 OpenAI、DeepSeek、通义或其他兼容服务 |
| 测试 | Vitest + Playwright | 单元验证状态和模拟器，E2E 验证完整流程 |
| 样式 | CSS Variables + 少量原生组件 | 不引入大型后台 UI 框架，保持 AI-native 体验 |

### 4.2 环境变量

```dotenv
LLM_BASE_URL=https://provider.example/v1
LLM_API_KEY=replace-locally
LLM_MODEL=model-name
LLM_TIMEOUT_SECONDS=60
PROTOTYPE_DB_PATH=.data/prototype.sqlite
PROTOTYPE_DEMO_CONTROLS=false
```

API Key 仅在服务器 Route Handler 中读取，不进入浏览器、SQLite、导出文件或日志。

## 5. 目录与职责

```text
prototype/
├── src/app/
│   ├── page.tsx
│   └── api/prototype/runs/       # 每个状态命令的 Route Handler
├── src/components/
│   ├── workspace/                # 单页面任务流和当前上下文抽屉
│   ├── ip/                       # 最小 IP 输入
│   ├── topics/                   # 方向候选卡片
│   ├── scripts/                  # 三篇文案对比与选择
│   ├── quality/                  # QA 卡和锁稿
│   └── review/                   # 模拟指标与复盘
├── src/domain/
│   ├── models.ts                 # 可迁移的核心类型
│   ├── schemas.ts                # 可迁移的 Zod Schema
│   └── state-machine.ts          # 原型确定性状态转换
├── src/lib/
│   ├── db/                       # SQLite schema 和 repository
│   ├── llm/                      # Provider-neutral Adapter
│   └── simulation/               # 可复现指标模拟器
├── src/prompts/                  # 四个独立 Prompt
├── src/presets/                  # 原型目标、6 个结构和质量规则
├── tests/
│   ├── unit/
│   ├── e2e/
│   └── fixtures/
└── README.md
```

每个目录只承担一种职责。UI 不直接调用模型，模型 Adapter 不读取 SQLite，状态机不依赖 React 或供应商 SDK。

## 6. 用户界面

### 6.1 主界面

整个原型只有一个主要页面：

```text
┌──────────────────────────────────────────────────────┐
│ 内容增长 Agent                当前阶段 · 已保存       │
├──────────────────────────────────┬───────────────────┤
│                                  │ 当前任务（默认折叠）│
│  对话与动态决策卡                │ IP 摘要             │
│                                  │ 所选方向            │
│  [IP 输入]                       │ 所选文案            │
│  [方向候选 3～5]                 │ 模型/模拟标识        │
│  [文案候选 3]                    │                     │
│  [QA 与锁稿]                     │                     │
│  [模拟数据与复盘]                │                     │
│                                  │                     │
└──────────────────────────────────┴───────────────────┘
```

- 主视觉始终是当前需要用户处理的一张决策卡；
- 不使用传统 SaaS 的多级侧栏、数据大盘和模块宫格；
- 已完成步骤折叠为对话历史，可展开查看；
- 右侧上下文抽屉默认折叠，移动端改为底部抽屉；
- 模型生成期间显示当前动作和已耗时，不显示虚假的思维过程；
- 所有模拟指标固定显示“模拟数据，不代表真实平台表现”。

### 6.2 最小 IP 输入

必填字段只有：

- 称呼；
- 真实经历；
- 擅长领域；
- 目标人群；
- 表达特点；
- 不能说或不愿公开的内容。

默认业务目标为“团长招商获客”，用户可以编辑目标受众、平台和行动引导。原型不进行资料上传、证据核验或三次正式校准。

## 7. 端到端流程

```text
输入最小 IP
  → 生成 3～5 个方向
  → 用户选择一个方向
  → 生成该方向下 3 篇完整文案
  → 用户选择一篇
  → 独立 QA
  → 用户确认锁稿
  → 生成 7 日模拟发布数据
  → 真实模型复盘
  → REVIEWED
```

### 7.1 原型状态机

```text
EDITING_IP
  → READY_FOR_TOPICS
  → GENERATING_TOPICS
  → WAITING_TOPIC_SELECTION
  → GENERATING_SCRIPTS
  → WAITING_SCRIPT_SELECTION
  → RUNNING_QA
  → WAITING_LOCK_CONFIRMATION
  → LOCKED
  → SIMULATING_PUBLICATION
  → WAITING_REVIEW
  → REVIEWING
  → REVIEWED
```

错误不创建独立永久状态。每个生成步骤保存 `last_error_code`、`last_error_message` 和 `retry_from_state`，失败后回到对应等待状态。重复点击通过 `run_id + command + input_version` 幂等处理。

## 8. 核心数据模型

```ts
type PrototypeRun = {
  id: string
  state: PrototypeRunState
  ipProfile: IPProfile
  goal: GoalContract
  selectedTopicId?: string
  selectedScriptId?: string
  lockedScriptVersion?: number
  simulationScenario?: "normal" | "breakout" | "underperform"
  createdAt: string
  updatedAt: string
}

type TopicDirectionCandidate = {
  id: string
  title: string
  angle: string
  audienceTension: string
  ipFitEvidence: string[]
  structureId: string
  riskNotes: string[]
}

type ScriptCandidate = {
  id: string
  topicDirectionId: string
  title: string
  openingHook: string
  body: string
  callToAction: string
  structureId: string
}

type QualityReport = {
  hardGatePassed: boolean
  hardGateFindings: QualityFinding[]
  scores: {
    ipFit: number
    hook: number
    credibility: number
    structure: number
    callToAction: number
  }
  revisionSuggestions: string[]
}

type MetricSnapshot = {
  isSimulated: true
  scenario: "normal" | "breakout" | "underperform"
  impressions: number
  plays: number
  completionRate: number
  likes: number
  comments: number
  saves: number
  shares: number
  inquiries: number
  generatedAt: string
}
```

SQLite 使用关系列保存 Run、版本、选择和状态，候选结果与报告同时保存 schema 版本和 JSON。覆盖写只用于当前 UI 草稿；候选、选择、QA、锁稿和复盘均新增版本记录。

## 9. 模型调用

每个完整 Run 默认调用模型 4 次：

| 调用 | 输入 | 输出 | 关键约束 |
|---|---|---|---|
| 方向生成 | IP、Goal、6 个抽象结构 | 3～5 个 `TopicDirectionCandidate` | 每个方向引用 IP 适配证据；不得生成完整文案 |
| 文案生成 | IP、Goal、唯一已选方向、所选结构 | 3 个 `ScriptCandidate` | 三篇 `topicDirectionId` 完全相同 |
| 发布前 QA | IP、Goal、选中文案、原型质量规则 | `QualityReport` | 独立 Prompt；不能重写原文或降低硬门禁 |
| 发布后复盘 | IP、方向、锁定稿、QA、模拟指标 | `ContentReview` | 明确指标为模拟；禁止表述为真实因果结论 |

### 9.1 Provider-neutral Adapter

```ts
interface LlmAdapter {
  generateStructured<T>(request: {
    operation: "topics" | "scripts" | "qa" | "review"
    systemPrompt: string
    input: unknown
    schema: z.ZodType<T>
    timeoutMs: number
  }): Promise<ModelResult<T>>
}
```

Adapter 记录 operation、模型名、耗时、输入/输出 token、错误码和重试次数，不记录 API Key。原型默认不保存完整 Prompt 日志；页面可展示模型名和耗时。

### 9.2 结构修复

1. 第一次输出先提取 JSON 并执行 Zod 校验；
2. 校验失败时，把最小错误列表和原始响应提交一次结构修复调用；
3. 修复仍失败时保存 `MODEL_SCHEMA_INVALID`，用户可重试当前步骤；
4. 不使用 fixture 或静态内容冒充真实模型结果。

## 10. 模拟发布数据

### 10.1 原则

- 指标是演示数据，不训练、不写入正式资产，也不用于宣称真实效果；
- 同一个锁定稿、场景和模拟器版本得到相同结果，便于重复演示；
- 指标与 QA 有方向性关联，但保留可控波动，避免表现成确定性因果；
- 普通界面只使用 `normal`，隐藏演示控制在 `PROTOTYPE_DEMO_CONTROLS=true` 时允许选择 `breakout` 或 `underperform`。

### 10.2 计算方法

```text
quality_index =
  0.30 × hook
  + 0.25 × ip_fit
  + 0.20 × credibility
  + 0.15 × structure
  + 0.10 × call_to_action

scenario_multiplier:
  underperform = 0.55
  normal       = 1.00
  breakout     = 2.50

seed = SHA-256(run_id + locked_script_version + simulator_version + scenario)
```

曝光以 `5,000 × scenario_multiplier` 为中心加入确定性波动；播放率主要受 hook 影响，完播率主要受 structure 影响，互动率受 IP fit 与 credibility 影响，咨询率受 call-to-action 与 credibility 影响。所有比率设置合理上下限，最终由整数一致性校验保证 `plays ≤ impressions`、互动数不为负。

`MetricSnapshot` 固定保存 `isSimulated=true`、场景、模拟器版本、seed 哈希和生成时间。复盘 Prompt 必须包含“这些是模拟指标，只能用于验证分析流程”。

## 11. SQLite 与 API

### 11.1 最小数据表

- `prototype_runs`
- `ip_profile_versions`
- `topic_candidate_batches`
- `topic_selections`
- `script_candidate_batches`
- `script_selections`
- `quality_reports`
- `locked_scripts`
- `metric_snapshots`
- `content_reviews`
- `model_calls`

SQLite 初始化使用一份原型专用 SQL schema；原型升级只保证删除本地数据库后可重建，不承诺正式迁移兼容。

### 11.2 API Routes

| Route | 行为 |
|---|---|
| `POST /api/prototype/runs` | 创建 Run 并保存最小 IP/Goal |
| `GET /api/prototype/runs/{id}` | 返回当前状态和当前决策卡 |
| `POST /api/prototype/runs/{id}/topics/generate` | 真实模型生成方向 |
| `POST /api/prototype/runs/{id}/topics/select` | 选择唯一方向 |
| `POST /api/prototype/runs/{id}/scripts/generate` | 真实模型生成同方向三篇文案 |
| `POST /api/prototype/runs/{id}/scripts/select` | 选择一篇文案 |
| `POST /api/prototype/runs/{id}/qa/run` | 独立模型 QA |
| `POST /api/prototype/runs/{id}/lock` | 确认锁稿 |
| `POST /api/prototype/runs/{id}/publication/simulate` | 生成模拟指标 |
| `POST /api/prototype/runs/{id}/review/generate` | 真实模型复盘 |
| `GET /api/prototype/runs/{id}/export` | 导出脱敏任务 JSON |

所有命令携带 `inputVersion`。版本过期返回 409 并要求刷新，不在客户端猜测合并。

## 12. 错误与恢复

| 错误 | 系统行为 | 用户动作 |
|---|---|---|
| 未配置 API Key | 不发起模型调用，展示本地配置指引 | 修改 `.env.local` 后重试 |
| 模型超时或 429 | 最多自动重试一次，保存错误和检查点 | 稍后重试当前步骤 |
| 模型返回非结构化内容 | 自动进行一次 schema 修复 | 修复失败后手动重试 |
| SQLite 写入失败 | 不推进状态，返回稳定错误码 | 重试；必要时导出日志 |
| 用户重复点击 | 幂等返回同一版本结果 | 无需处理 |
| 页面刷新 | 从 SQLite 读取 Run 和当前决策 | 继续当前步骤 |
| 模拟器输入不完整 | 不生成指标 | 先完成 QA 和锁稿 |
| 复盘模型失败 | 保留模拟指标和锁定稿 | 只重试复盘，不重做前序步骤 |

模型调用超过 60 秒由 Adapter 主动终止。错误消息不展示供应商原始堆栈、API Key、完整 Prompt 或内部环境路径。

## 13. 测试

### 13.1 自动化测试

- 状态机合法/非法跳转；
- 一个候选批次只能属于一个方向；
- 模型输出 Zod 校验与一次修复；
- QA Prompt 与文案 Prompt 独立；
- 模拟器同 seed 可复现、不同场景有合理差异；
- 指标整数关系和上下限；
- 重复命令幂等；
- SQLite 刷新恢复；
- API Key 不进入客户端 bundle、数据库或导出文件；
- 使用固定 Fake LLM 的完整 E2E：从 IP 到 `REVIEWED`。

### 13.2 真实模型冒烟

真实模型测试不进入默认 CI，使用本地 API Key 手动运行：

- 方向数量为 3～5；
- 三篇文案全部绑定唯一已选方向；
- QA 输出包含硬门禁和五项评分；
- 复盘明确说明指标为模拟数据；
- 一个完整 Run 可在合理成本内完成四次模型调用。

## 14. 可迁移与丢弃边界

| 资产 | 后续处理 |
|---|---|
| 用户流程、文案和交互反馈 | 进入正式产品规格 |
| `IPProfile`、方向、文案、QA、复盘 Zod Schema | 评审后迁移到正式 contracts |
| 四个 Prompt 与真实失败样本 | 进入正式 Agent 定义和 Evals |
| 6 个原型抽象结构 | 只能作为候选，需内容负责人复核后进入正式 20～30 个结构 |
| 质量评分项 | 作为 `QualityStandardVersion v1` 的输入，不直接视为正式标准 |
| React 决策卡组件 | 通过设计评审后迁移 |
| Next.js Route Handler | 丢弃，由正式 FastAPI 接口替代 |
| SQLite repository/schema | 丢弃，不迁移到 PostgreSQL |
| 原型状态机 | 只迁移测试场景，不直接替代正式 Workflow Runtime |
| 模拟发布数据 | 全部丢弃，不导入正式指标库 |

原型代码不得被正式应用直接 import。需要迁移的资产通过评审后复制到正式目录，并保留原型来源说明和新测试。

## 15. 交付节奏与规模

| 时间 | 交付 |
|---|---|
| 第 1 天 | Next.js、SQLite、领域类型、状态机、模型 Adapter 和 Fake LLM |
| 第 2 天 | 最小 IP、方向生成、方向选择、同方向三篇文案 |
| 第 3 天 | QA、锁稿、模拟指标和真实模型复盘 |
| 第 4 天 | AI-native 单页面、响应式、错误恢复和刷新继续 |
| 第 5 天 | 自动 E2E、真实模型冒烟、Prompt 调整和演示脚本 |

预计 25～35 个文件、3,000～5,000 行代码。若真实模型兼容性或 Prompt 质量需要多轮校准，增加的是验证时间，不扩大原型基础设施范围。

## 16. 验收标准

- 本地安装依赖并执行一条开发命令即可启动；
- 未配置模型密钥时给出明确指引，不泄露或伪造结果；
- 用户只填写最小 IP 信息即可开始；
- 真实模型生成 3～5 个 IP 适配方向；
- 选择方向后真实模型生成该方向下 3 篇完整文案，跨方向混稿为 0；
- 独立 QA 给出硬门禁、五项评分和修改建议；
- 用户确认后锁定唯一文案版本；
- 生成带明确模拟标识、可复现的 7 日指标；
- 真实模型根据完整谱系生成复盘，且不把模拟结果表述为真实因果；
- 刷新页面后继续当前步骤，失败只重试当前模型调用；
- Fake LLM E2E 从创建 Run 到 `REVIEWED` 通过；
- 原型没有登录、租户、队列、平台 API、数字人或正式系统默认包代码；
- 正式首版规格和实施计划没有被修改。
