# Content Loop MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付一个面向运营团队与团长的招商内容增长 MVP，跑通“团长 IP → 内容情报 → 招商策略 → 文案 → 质检/审批 → 人工发布记录 → 数据导入 → 复盘/记忆升级”的完整内容闭环。

**Architecture:** 使用模块化单体承载权威业务状态，FastAPI API 与 Celery Worker 共享领域模块，PostgreSQL + pgvector 保存权威数据和检索索引，Redis 只承担队列与短期协调。Next.js 以“对话 + 活文档”呈现持久 Agent Run；所有模型和外部工具通过受控 Gateway，Run 采用显式状态机、检查点与 Outbox 保证可恢复。

**Tech Stack:** Python 3.12、FastAPI、Pydantic v2、SQLAlchemy 2、Alembic、Celery 5、PostgreSQL 16 + pgvector、Redis 7、Next.js 15、React 19、TypeScript 5、Zod、TanStack Query、SSE、S3 兼容对象存储、OpenTelemetry、Docker Compose、pytest、Vitest、Playwright。

## Global Constraints

- 第一版仅实现内容闭环；不得创建 MiniMax、HeyGen、VoiceProfile、AvatarProfile、音频、视频、成片页面、自动发布或平台 API 相关代码、表、接口、事件和测试。
- 第一版业务只覆盖招商内容；带货策略包不进入实现。
- 运营端可访问内部内容情报；团长端永远不能读取爆款原文、内部策略评分或其他租户数据。
- 所有租户业务表必须有不可为空的 `tenant_id`，应用授权与 PostgreSQL Row-Level Security 双重隔离。
- 事实、策略、公开文案和长期记忆必须经过明确审批；事实或合规阻断不得由 Agent 绕过。
- 权威状态先写 PostgreSQL，再通过 Transactional Outbox 发布；Redis 丢失不能导致业务状态丢失。
- 模型、搜索和对象存储只能通过端口适配器调用；Domain 层不得依赖 FastAPI、SQLAlchemy、Redis 或供应商 SDK。
- 首版部署目标为单台 4 vCPU / 8GB RAM / 200GB SSD，无 GPU；正常活跃 Agent 步骤 10、突发 20、单租户默认 2、月内容任务容量 5,000。
- 核心领域单元测试行覆盖率至少 90%，整体至少 80%；跨租户、状态恢复、审批版本冲突、导入去重/回滚必须有端到端测试。
- 代码中不得出现未落地占位符；每个任务结束时测试通过并形成独立提交。

---

## File Structure

```text
apps/
  api/
    pyproject.toml                 # Python 依赖、测试和静态检查配置
    alembic.ini                    # 数据库迁移入口
    alembic/                       # 版本化迁移
    app/
      main.py                      # FastAPI 组装，不放业务规则
      settings.py                  # 环境配置
      shared/                      # 数据库、鉴权、Outbox、对象存储、遥测
      modules/
        identity/                  # 租户、成员和角色
        ip_core/                   # IP 档案、事实、证据、快照和记忆提案
        intelligence/              # 内部来源、拆解、模式和策略版本
        runtime/                   # Goal、Run、Step、状态机和上下文装配
        artifacts/                 # 活文档、版本、QA、批注和审批
        publications/              # 人工发布记录
        analytics/                 # 导入批次、统一指标、实验和复盘
        audit/                     # 审计、通知、预算和成本账本
      worker.py                    # Celery 入口，只注册应用服务任务
    tests/                         # 单元、集成、契约和端到端测试
  web/
    package.json                   # Web 依赖和命令
    src/
      app/                         # Next.js 路由与布局
      features/                    # task-stream、live-doc、approval、ip、import、review
      shared/                      # API client、SSE、schema、design tokens
    tests/                         # Vitest 与 Playwright
packages/
  contracts/
    openapi.json                   # API 生成快照
    ui-blocks.schema.json          # Agent UI Block 版本化 Schema
ops/
  compose.yaml                     # 单机生产拓扑
  env.example                      # 无密钥的配置契约
  nginx/nginx.conf                 # TLS 终止后的反向代理与 SSE 设置
  scripts/backup.sh                # PostgreSQL 与对象清单备份
  scripts/restore-drill.sh         # 新环境恢复演练
  runbooks/single-node-recovery.md # 单机中断恢复手册
.github/workflows/ci.yml           # 类型、测试、迁移和镜像质量门禁
```

---

### Task 1: 可运行基座与健康闭环

**Files:**
- Create: `apps/api/pyproject.toml`
- Create: `apps/api/app/main.py`
- Create: `apps/api/app/settings.py`
- Create: `apps/api/app/shared/db.py`
- Create: `apps/api/tests/test_health.py`
- Create: `apps/web/package.json`
- Create: `apps/web/src/app/page.tsx`
- Create: `apps/web/src/app/api/health/route.ts`
- Create: `apps/web/tests/home.test.tsx`
- Create: `ops/compose.yaml`
- Create: `ops/env.example`

**Interfaces:**
- Consumes: 无。
- Produces: `GET /health/live`、`GET /health/ready`；`Settings`；统一的 API、Web 与 Compose 开发命令。

- [ ] **Step 1: 写健康接口失败测试**

```python
# apps/api/tests/test_health.py
from fastapi.testclient import TestClient
from app.main import create_app

def test_live_health_has_stable_contract() -> None:
    response = TestClient(create_app()).get("/health/live")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "content-growth-api"}
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `cd apps/api; uv run pytest tests/test_health.py -q`

Expected: FAIL，提示 `app.main` 不存在。

- [ ] **Step 3: 实现最小 FastAPI 基座**

```python
# apps/api/app/main.py
from fastapi import FastAPI

def create_app() -> FastAPI:
    app = FastAPI(title="Content Growth API", version="1.0.0")

    @app.get("/health/live", tags=["health"])
    async def live() -> dict[str, str]:
        return {"status": "ok", "service": "content-growth-api"}

    return app

app = create_app()
```

在 `settings.py` 定义 `DATABASE_URL`、`REDIS_URL`、`OBJECT_STORAGE_*`、`MODEL_GATEWAY_*`，全部从环境读取；`ops/env.example` 只提供非敏感示例值。Compose 启动 `web`、`api`、`worker`、`postgres:16`、`redis:7` 和 OpenTelemetry Collector，并为各容器设置 CPU/内存上限，总和不超过单机 8GB。

- [ ] **Step 4: 增加 Web 冒烟测试与极简入口**

```tsx
// apps/web/src/app/page.tsx
export default function Home() {
  return (
    <main>
      <p>内容增长 Agent</p>
      <h1>今天要推进哪个招商目标？</h1>
      <form aria-label="创建内容目标">
        <textarea name="goal" aria-label="目标描述" />
        <button type="submit">开始规划</button>
      </form>
    </main>
  );
}
```

Run: `cd apps/web; npm test -- --run`

Expected: PASS，首页存在目标输入框与“开始规划”按钮。

- [ ] **Step 5: 验证单机基座**

Run: `docker compose -f ops/compose.yaml config`

Expected: 配置解析成功，未出现 MiniMax、HeyGen、GPU 或视频服务。

Run: `cd apps/api; uv run pytest -q`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add apps/api apps/web ops
git commit -m "feat: establish content loop application baseline"
```

---

### Task 2: 租户身份、角色授权与数据库隔离

**Files:**
- Create: `apps/api/app/shared/auth.py`
- Create: `apps/api/app/shared/tenant.py`
- Create: `apps/api/app/shared/ports.py`
- Create: `apps/api/app/modules/identity/domain/models.py`
- Create: `apps/api/app/modules/identity/application/service.py`
- Create: `apps/api/app/modules/identity/adapters/sql.py`
- Create: `apps/api/alembic/versions/0001_identity_and_rls.py`
- Create: `apps/api/tests/identity/test_tenant_isolation.py`

**Interfaces:**
- Consumes: `session_scope()` from Task 1。
- Produces: `ActorContext(user_id: UUID, tenant_id: UUID, roles: frozenset[Role])`；`require_roles(*roles)`；`set_tenant_context(session, tenant_id)`。

- [ ] **Step 1: 写跨租户访问失败测试**

```python
async def test_member_cannot_read_another_tenant(session, identity_service) -> None:
    tenant_a, tenant_b = await seed_two_tenants(session)
    actor = ActorContext(tenant_a.user_id, tenant_a.id, frozenset({Role.OPERATOR}))
    result = await identity_service.get_membership(actor, tenant_b.membership_id)
    assert result is None
```

- [ ] **Step 2: 运行单测并确认失败**

Run: `cd apps/api; uv run pytest tests/identity/test_tenant_isolation.py -q`

Expected: FAIL，提示 `ActorContext` 或 `IdentityService` 不存在。

- [ ] **Step 3: 实现角色与租户上下文**

```python
class Role(StrEnum):
    LEADER = "leader"
    OPERATOR = "operator"
    INTELLIGENCE = "intelligence"
    ADMIN = "admin"

@dataclass(frozen=True)
class ActorContext:
    user_id: UUID
    tenant_id: UUID
    roles: frozenset[Role]
```

```python
# apps/api/app/shared/ports.py
class AuditPort(Protocol):
    async def record(self, event_type: str, actor: ActorContext, payload: dict[str, object]) -> None: ...

class ObjectStoragePort(Protocol):
    async def put(self, tenant_id: UUID, object_key: str, body: AsyncIterator[bytes], sha256: str) -> str: ...
    async def signed_get_url(self, tenant_id: UUID, object_key: str, ttl_seconds: int = 300) -> str: ...
```

本任务提供内存 `AuditPort` 和本地开发 `ObjectStoragePort` 适配器；后续模块只依赖协议，Task 13 再将审计端口接入持久审计表。

迁移创建 `tenants`、`users`、`memberships`，所有业务表 RLS 策略统一读取 `current_setting('app.tenant_id', true)`；数据库会话开始事务后执行 `SET LOCAL app.tenant_id = :tenant_id`。未设置租户上下文的业务查询必须返回空或失败关闭。

- [ ] **Step 4: 增加角色矩阵测试**

```python
def test_leader_cannot_access_internal_intelligence() -> None:
    actor = ActorContext(uuid4(), uuid4(), frozenset({Role.LEADER}))
    with pytest.raises(ForbiddenError):
        require_roles(Role.OPERATOR, Role.INTELLIGENCE)(actor)
```

Run: `cd apps/api; uv run pytest tests/identity -q`

Expected: PASS。

- [ ] **Step 5: 验证迁移和 RLS**

Run: `cd apps/api; uv run alembic upgrade head; uv run pytest -m integration tests/identity/test_tenant_isolation.py -q`

Expected: 两个租户使用真实 PostgreSQL 时互不可见；越权对象表现为 404。

- [ ] **Step 6: 提交**

```bash
git add apps/api/app/shared apps/api/app/modules/identity apps/api/alembic apps/api/tests/identity
git commit -m "feat: enforce tenant and role isolation"
```

---

### Task 3: 团长 IP 事实、证据、快照与记忆提案

**Files:**
- Create: `apps/api/app/modules/ip_core/domain/models.py`
- Create: `apps/api/app/modules/ip_core/domain/policies.py`
- Create: `apps/api/app/modules/ip_core/application/commands.py`
- Create: `apps/api/app/modules/ip_core/application/service.py`
- Create: `apps/api/app/modules/ip_core/adapters/sql.py`
- Create: `apps/api/app/modules/ip_core/api.py`
- Create: `apps/api/alembic/versions/0002_ip_core.py`
- Create: `apps/api/tests/ip_core/test_fact_approval.py`
- Create: `apps/api/tests/ip_core/test_snapshot.py`

**Interfaces:**
- Consumes: `ActorContext`、租户数据库会话。
- Produces: `FactClaim`、`EvidenceRef`、`IPSnapshot`、`MemoryProposal`；`publish_snapshot(actor, profile_id, expected_version)`；`publish_memory_proposal(actor, proposal_id, expected_version)`。

- [ ] **Step 1: 写“未经确认事实不可进快照”测试**

```python
async def test_snapshot_rejects_unconfirmed_claim(ip_service, actor) -> None:
    profile = await ip_service.create_profile(actor, display_name="王团长")
    await ip_service.propose_fact(actor, profile.id, "服务过300个品牌", evidence_ids=[])
    with pytest.raises(UnverifiedFactError):
        await ip_service.publish_snapshot(actor, profile.id, expected_version=0)
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `cd apps/api; uv run pytest tests/ip_core/test_fact_approval.py -q`

Expected: FAIL，提示 IP Core 服务未定义。

- [ ] **Step 3: 实现领域模型与乐观锁**

```python
class FactStatus(StrEnum):
    PROPOSED = "proposed"
    CONFIRMED = "confirmed"
    REJECTED = "rejected"
    REVOKED = "revoked"

@dataclass(frozen=True)
class FactClaim:
    id: UUID
    tenant_id: UUID
    profile_id: UUID
    statement: str
    status: FactStatus
    evidence_ids: tuple[UUID, ...]
    version: int
```

快照只复制 `CONFIRMED` 事实、表达规则、边界、Offer 和案例引用；更新条件必须包含 `version = expected_version`，冲突返回 HTTP 409。团长可以确认/撤销自己的事实，运营可以提出和核验证据，但不能替团长确认公开表达。

- [ ] **Step 4: 实现 API 与审计写入**

路由固定包含 `POST /v1/ip/profiles`、`POST /v1/ip/profiles/{id}/evidence`、`POST /v1/ip/profiles/{id}/interview-turns`、`POST /v1/ip/profiles/{id}/facts`、`POST /v1/ip/facts/{id}/decisions`、`POST /v1/ip/profiles/{id}/snapshots`、`POST /v1/ip/memory-proposals/{id}/publish`。证据上传保存对象地址、SHA-256、来源、采集时间和可验证状态；访谈轮次区分用户原话与 Agent 问题。每个写操作在同一事务写审计事件，记录 actor、旧版本、新版本和理由。

- [ ] **Step 5: 验证快照不可变和撤销**

Run: `cd apps/api; uv run pytest tests/ip_core -q`

Expected: PASS；已发布快照不原地修改，撤销生成新版本且历史任务仍能引用旧快照。

- [ ] **Step 6: 提交**

```bash
git add apps/api/app/modules/ip_core apps/api/alembic apps/api/tests/ip_core
git commit -m "feat: add governed group leader IP memory"
```

---

### Task 4: 内部内容情报与招商策略版本

**Files:**
- Create: `apps/api/app/modules/intelligence/domain/models.py`
- Create: `apps/api/app/modules/intelligence/domain/leakage.py`
- Create: `apps/api/app/modules/intelligence/application/service.py`
- Create: `apps/api/app/modules/intelligence/adapters/sql.py`
- Create: `apps/api/app/modules/intelligence/api.py`
- Create: `apps/api/alembic/versions/0003_content_intelligence.py`
- Create: `apps/api/tests/intelligence/test_visibility.py`
- Create: `apps/api/tests/intelligence/test_strategy_version.py`

**Interfaces:**
- Consumes: `ActorContext`、审计写入端口。
- Produces: `SourceItem`、`ContentDecomposition`、`Pattern`、`StrategyVersion`；`search_patterns(actor, query, platform, limit) -> list[PatternSummary]`；`publish_strategy(actor, draft_id) -> StrategyVersion`。

- [ ] **Step 1: 写团长不可读取原文的失败测试**

```python
async def test_leader_response_never_contains_source_text(client, leader_token, source_item) -> None:
    response = await client.get("/v1/intelligence/patterns", headers=leader_token)
    assert response.status_code == 404
    assert source_item.raw_text not in response.text
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `cd apps/api; uv run pytest tests/intelligence/test_visibility.py -q`

Expected: FAIL，接口或模块不存在。

- [ ] **Step 3: 实现内部资产与发布策略**

`SourceItem.raw_text` 与拆解详情仅授予 `INTELLIGENCE`、`OPERATOR`；面向 Runtime 的 `PatternSummary` 只能含抽象结构、适用平台、受众、钩子类型、CTA 类型、风险和有效期，不含可还原原文的连续片段。策略发布后不可修改，修订创建新 `StrategyVersion`。

内部情报 API 固定包含 `POST /v1/intelligence/sources`、`POST /v1/intelligence/sources/{id}/decompositions`、`POST /v1/intelligence/patterns`、`POST /v1/intelligence/strategies/{id}/publish` 和运营专用搜索。来源保存 URL、平台、发布时间、采集时间、原文哈希和授权/使用范围；7 日窗口以发布时间过滤，过期来源不参与新策略检索但保留审计。

```python
@dataclass(frozen=True)
class PatternSummary:
    pattern_id: UUID
    structure: tuple[str, ...]
    audience: str
    hook_type: str
    cta_type: str
    risk_tags: tuple[str, ...]
    valid_until: date
```

- [ ] **Step 4: 加入泄露检测**

```python
def assert_no_source_leak(output: str, protected_ngrams: set[str]) -> None:
    normalized = normalize_text(output)
    leaked = sorted(token for token in protected_ngrams if token in normalized)
    if leaked:
        raise SourceLeakageError(leaked[:5])
```

Run: `cd apps/api; uv run pytest tests/intelligence -q`

Expected: PASS；团长接口无原文，策略输出命中保护片段时阻断。

- [ ] **Step 5: 提交**

```bash
git add apps/api/app/modules/intelligence apps/api/alembic apps/api/tests/intelligence
git commit -m "feat: add private content intelligence library"
```

---

### Task 5: Goal Contract、持久 Run 状态机与 Outbox

**Files:**
- Create: `apps/api/app/modules/runtime/domain/state.py`
- Create: `apps/api/app/modules/runtime/domain/models.py`
- Create: `apps/api/app/modules/runtime/application/service.py`
- Create: `apps/api/app/modules/runtime/application/tasks.py`
- Create: `apps/api/app/modules/runtime/adapters/sql.py`
- Create: `apps/api/app/modules/runtime/api.py`
- Create: `apps/api/app/shared/outbox.py`
- Create: `apps/api/alembic/versions/0004_runtime_outbox.py`
- Create: `apps/api/tests/runtime/test_state_machine.py`
- Create: `apps/api/tests/runtime/test_recovery.py`

**Interfaces:**
- Consumes: IP 快照 ID、策略检索端口、Celery。
- Produces: `create_goal(actor, GoalInput) -> GoalPreview`；`start_run(actor, goal_id, idempotency_key) -> AgentRun`；`transition(run_id, expected_state, target_state, payload)`；`dispatch_outbox_batch(limit)`。

- [ ] **Step 1: 写非法跳转与幂等测试**

```python
def test_content_cannot_publish_before_manual_record() -> None:
    with pytest.raises(InvalidTransition):
        transition_state(RunState.CONTENT_LOCKED, RunState.PUBLISHED)

async def test_start_run_reuses_idempotency_key(runtime, actor, goal) -> None:
    first = await runtime.start_run(actor, goal.id, "goal-42")
    second = await runtime.start_run(actor, goal.id, "goal-42")
    assert second.id == first.id
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `cd apps/api; uv run pytest tests/runtime/test_state_machine.py -q`

Expected: FAIL，状态机未定义。

- [ ] **Step 3: 实现显式状态图**

```python
ALLOWED: dict[RunState, frozenset[RunState]] = {
    RunState.CREATED: frozenset({RunState.PLANNING}),
    RunState.PLANNING: frozenset({RunState.RESEARCHING}),
    RunState.RESEARCHING: frozenset({RunState.WAITING_STRATEGY_APPROVAL}),
    RunState.WAITING_STRATEGY_APPROVAL: frozenset({RunState.DRAFTING}),
    RunState.DRAFTING: frozenset({RunState.QA}),
    RunState.QA: frozenset({RunState.WAITING_CONTENT_APPROVAL}),
    RunState.WAITING_CONTENT_APPROVAL: frozenset({RunState.CONTENT_LOCKED}),
    RunState.CONTENT_LOCKED: frozenset({RunState.WAITING_MANUAL_PUBLICATION}),
    RunState.WAITING_MANUAL_PUBLICATION: frozenset({RunState.PUBLISHED}),
    RunState.PUBLISHED: frozenset({RunState.WAITING_METRICS_IMPORT}),
    RunState.WAITING_METRICS_IMPORT: frozenset({RunState.REVIEWING}),
    RunState.REVIEWING: frozenset({RunState.WAITING_MEMORY_APPROVAL}),
    RunState.WAITING_MEMORY_APPROVAL: frozenset({RunState.REVIEWED}),
    RunState.REVIEWED: frozenset({RunState.ARCHIVED}),
}
```

`BLOCKED`、`FAILED_RETRYABLE`、`CANCELLED` 作为受原因码约束的旁路状态。每次跳转同时写 `run_steps`、`outbox_events` 和审计记录；唯一约束 `(tenant_id, idempotency_key)` 防止重复 Run。

`runtime/api.py` 在本任务提供 `POST /v1/goals`、`POST /v1/goals/{id}/start` 和 `GET /v1/runs/{id}`。Goal 先返回受众、平台、目标指标、内容数量、IP 快照和预计成本的结构化预览，只有显式调用 `start` 才创建 Run 与首个队列任务。

- [ ] **Step 4: 实现 Worker 恢复协议**

Worker 领取步骤时使用数据库租约 `lease_owner`、`lease_expires_at`；写成功结果和下一事件必须同事务。进程死亡后，调度器只重新入队租约已过期且不在人工等待状态的步骤。

Run: `cd apps/api; uv run pytest tests/runtime/test_recovery.py -q`

Expected: PASS；模拟 Worker 在外部调用后死亡时，幂等工具记录阻止重复付费调用。

- [ ] **Step 5: 提交**

```bash
git add apps/api/app/modules/runtime apps/api/app/shared/outbox.py apps/api/alembic apps/api/tests/runtime
git commit -m "feat: add durable content run state machine"
```

---

### Task 6: 受控上下文、模型 Gateway、预算与追踪

**Files:**
- Create: `apps/api/app/modules/runtime/application/context.py`
- Create: `apps/api/app/modules/runtime/application/ip_interviewer.py`
- Create: `apps/api/app/modules/runtime/ports/model.py`
- Create: `apps/api/app/modules/runtime/adapters/model_gateway.py`
- Create: `apps/api/app/modules/audit/domain/cost.py`
- Create: `apps/api/app/modules/audit/application/budget.py`
- Create: `apps/api/alembic/versions/0005_tool_calls_costs.py`
- Create: `apps/api/tests/runtime/test_context_scope.py`
- Create: `apps/api/tests/runtime/test_model_gateway.py`
- Create: `apps/api/tests/ip_core/test_interview_questions.py`

**Interfaces:**
- Consumes: `IPSnapshot`、`PatternSummary`、Run 检查点。
- Produces: `ContextAssembler.build(actor, run_id, step_name, token_budget) -> ContextPacket`；`ModelPort.generate(request: ModelRequest) -> ModelResult`；`BudgetGuard.authorize(tenant_id, run_id, estimate) -> BudgetDecision`。

- [ ] **Step 1: 写上下文越权和预算阻断测试**

```python
async def test_context_contains_only_locked_versions(assembler, actor, run) -> None:
    packet = await assembler.build(actor, run.id, "draft", token_budget=6000)
    assert packet.ip_snapshot_id == run.ip_snapshot_id
    assert all(item.tenant_id == actor.tenant_id for item in packet.items)

def test_hard_budget_pauses_before_model_call(budget_guard) -> None:
    decision = budget_guard.authorize(TENANT_ID, RUN_ID, Decimal("12.00"))
    assert decision == BudgetDecision.PAUSE_FOR_APPROVAL
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `cd apps/api; uv run pytest tests/runtime/test_context_scope.py tests/runtime/test_model_gateway.py -q`

Expected: FAIL，上下文和 Gateway 未定义。

- [ ] **Step 3: 实现类型化模型端口**

```python
class ModelRequest(BaseModel):
    tenant_id: UUID
    run_id: UUID
    step_name: str
    prompt_version: str
    response_schema: dict[str, object]
    context: ContextPacket
    idempotency_key: str
    max_cost_cny: Decimal

class ModelResult(BaseModel):
    output: dict[str, object]
    provider: str
    model: str
    input_tokens: int
    output_tokens: int
    actual_cost_cny: Decimal
    trace_id: str
```

`ContextPacket` 固定包含 `tenant_id`、`run_id`、`ip_snapshot_id`、`strategy_version_ids`、带来源类型的 `items`、`token_count` 和 `assembled_at`；构造器拒绝任何 `tenant_id` 不一致的条目。

Gateway 在调用前做预算授权，在调用后校验 JSON Schema、写 `tool_calls` 和 `cost_ledger`；日志只出现 `credential_ref`。同一 `idempotency_key + input_hash` 返回已有成功结果。

`IPInterviewer` 读取已存访谈轮次与资料缺口，每轮只生成一个针对性问题；模型输出只能形成 `PROPOSED` 事实，不能直接确认。测试固定检查“缺少服务对象时追问服务对象”“缺少案例证据时追问证据”“已有答案不重复询问”。

- [ ] **Step 4: 验证上下文最小化与供应商故障**

Run: `cd apps/api; uv run pytest tests/runtime -q`

Expected: PASS；模型超时进入 `FAILED_RETRYABLE`，敏感原文和其他租户实体不进入请求录制。

- [ ] **Step 5: 提交**

```bash
git add apps/api/app/modules/runtime apps/api/app/modules/audit apps/api/alembic apps/api/tests/runtime apps/api/tests/ip_core
git commit -m "feat: add governed model and context gateway"
```

---

### Task 7: 招商策略生成、解释与运营审批

**Files:**
- Create: `apps/api/app/modules/runtime/application/strategy_step.py`
- Create: `apps/api/app/modules/artifacts/domain/strategy.py`
- Create: `apps/api/app/modules/artifacts/application/strategy_approval.py`
- Create: `apps/api/tests/artifacts/test_strategy_approval.py`
- Create: `apps/api/tests/evals/test_strategy_contract.py`

**Interfaces:**
- Consumes: `ContextAssembler.build()`、`ModelPort.generate()`、`transition()`。
- Produces: `StrategyCandidate` 三选项；`approve_strategy(actor, approval_id, candidate_id, expected_version, note)`。

- [ ] **Step 1: 写策略契约失败测试**

```python
def test_strategy_candidate_requires_hypothesis_and_risk() -> None:
    with pytest.raises(ValidationError):
        StrategyCandidate.model_validate({
            "title": "品牌招商故事",
            "audience": "区域品牌方",
            "content_angle": "团长履约案例"
        })
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `cd apps/api; uv run pytest tests/artifacts/test_strategy_approval.py -q`

Expected: FAIL，策略类型不存在。

- [ ] **Step 3: 实现策略产物**

```python
class StrategyCandidate(BaseModel):
    id: UUID
    title: str
    audience: str
    content_angle: str
    hook: str
    proof_claim_ids: list[UUID]
    cta: str
    experiment_hypothesis: str
    success_metric: str
    risks: list[str]
    source_pattern_ids: list[UUID]
```

一次策略步骤固定产出 3 个差异化候选和比较说明；若候选引用未确认事实、无证据强背书或内部原文片段则整批阻断。只有 `OPERATOR` 可批准策略，批准时校验产物版本并把 Run 推进到 `DRAFTING`。

- [ ] **Step 4: 增加黄金样本 Eval**

评测固定检查招商结构、受众清晰度、证据绑定、风险披露、原文泄露和三候选差异度；报告保存模型、提示词、策略和黄金集版本。

Run: `cd apps/api; uv run pytest tests/artifacts/test_strategy_approval.py tests/evals/test_strategy_contract.py -q`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/api/app/modules/runtime apps/api/app/modules/artifacts apps/api/tests/artifacts apps/api/tests/evals
git commit -m "feat: generate and approve招商 strategies"
```

---

### Task 8: 文案版本、自动质检与双层审批

**Files:**
- Create: `apps/api/app/modules/artifacts/domain/models.py`
- Create: `apps/api/app/modules/artifacts/domain/qa.py`
- Create: `apps/api/app/modules/artifacts/application/script_service.py`
- Create: `apps/api/app/modules/artifacts/application/approval_service.py`
- Create: `apps/api/app/modules/runtime/application/script_step.py`
- Create: `apps/api/app/modules/artifacts/api.py`
- Create: `apps/api/alembic/versions/0006_artifacts_approvals.py`
- Create: `apps/api/tests/artifacts/test_script_versioning.py`
- Create: `apps/api/tests/artifacts/test_dual_approval.py`
- Create: `apps/api/tests/artifacts/test_qa_blocking.py`

**Interfaces:**
- Consumes: 已批准 `StrategyCandidate`、`IPSnapshot`、模型 Gateway。
- Produces: `ArtifactVersion`、`QAReport`、`ApprovalDecision`；`lock_version(actor, artifact_id, version, expected_sha256) -> LockedArtifact`。

- [ ] **Step 1: 写双层审批和阻断测试**

```python
async def test_script_locks_only_after_operator_and_leader_approve(service, script) -> None:
    await service.decide(OPERATOR, script.operator_approval_id, "approve", script.version)
    assert await service.is_locked(script.id) is False
    await service.decide(LEADER, script.leader_approval_id, "approve", script.version)
    assert await service.is_locked(script.id) is True

async def test_blocking_qa_prevents_approval(service, blocked_script) -> None:
    with pytest.raises(QABlockedError):
        await service.decide(OPERATOR, blocked_script.approval_id, "approve", 1)
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `cd apps/api; uv run pytest tests/artifacts/test_dual_approval.py tests/artifacts/test_qa_blocking.py -q`

Expected: FAIL，审批服务不存在。

- [ ] **Step 3: 实现不可变文案版本和 QA**

`ArtifactVersion` 保存母稿、抖音稿、视频号稿、标题、封面文案、拍摄提示、IP 快照 ID、策略版本 ID、事实引用、模型/提示词版本和 SHA-256。编辑永远创建新版本，并让旧版本未决审批失效。

```python
class QAItem(BaseModel):
    code: str
    severity: Literal["block", "warn", "info"]
    message: str
    location: TextRange | None
    fact_claim_ids: list[UUID]

class QAReport(BaseModel):
    artifact_version_id: UUID
    items: list[QAItem]
    passed: bool
```

其中 `TextRange` 为 `BaseModel(start: int, end: int)`，使用 UTF-8 解码后的 Unicode code point 偏移；`start >= 0` 且 `end > start`。

质检顺序为事实引用、招商承诺、禁用表达、IP 口吻、平台长度/结构、内部原文泄露。`block` 未解决时 API 返回 409。

`script_step.py` 使用已批准策略、锁定 IP 快照和平台规则调用模型 Gateway，一次生成母稿、抖音稿、视频号稿、标题、封面文案和拍摄提示；模型响应先过结构 Schema，再过 QA，任何失败都不能创建可审批版本。

- [ ] **Step 4: 实现审批 API 的版本冲突**

`POST /v1/approvals/{id}/decisions` 必须携带 `artifact_version`；旧版本返回 409 并包含当前版本号，不自动迁移人的决定。双层通过后计算哈希并把 Run 推进 `CONTENT_LOCKED`，随后进入 `WAITING_MANUAL_PUBLICATION`。

- [ ] **Step 5: 验证版本、QA 和角色边界**

Run: `cd apps/api; uv run pytest tests/artifacts -q`

Expected: PASS；团长只能批准自己的文案，运营不能替团长确认“像本人且愿意公开”。

- [ ] **Step 6: 提交**

```bash
git add apps/api/app/modules/artifacts apps/api/app/modules/runtime/application/script_step.py apps/api/alembic apps/api/tests/artifacts
git commit -m "feat: add governed script and approval workflow"
```

---

### Task 9: AI-native 活任务流、SSE 与主动秘书界面

**Files:**
- Create: `packages/contracts/ui-blocks.schema.json`
- Modify: `apps/api/app/modules/runtime/api.py`
- Create: `apps/api/app/modules/runtime/application/stream.py`
- Create: `apps/api/tests/runtime/test_sse_resume.py`
- Create: `apps/web/src/shared/contracts/ui-blocks.ts`
- Create: `apps/web/src/shared/api/client.ts`
- Create: `apps/web/src/shared/api/run-stream.ts`
- Create: `apps/web/src/features/task-stream/TaskWorkspace.tsx`
- Create: `apps/web/src/features/task-stream/DecisionCard.tsx`
- Create: `apps/web/src/features/live-doc/LiveDocument.tsx`
- Create: `apps/web/src/features/brief/LeaderBrief.tsx`
- Create: `apps/web/src/app/tasks/[runId]/page.tsx`
- Create: `apps/web/tests/task-workspace.test.tsx`
- Create: `apps/web/tests/task-flow.spec.ts`

**Interfaces:**
- Consumes: `GET /v1/runs/{id}`、`GET /v1/runs/{id}/stream`、审批 API。
- Produces: 版本化 `UIBlock` 联合类型；`RunStream.connect(runId, lastEventId)`；任务工作区和团长简报。

- [ ] **Step 1: 写 UI Block 未知类型拒绝测试**

```ts
it("rejects an unknown UI block type", () => {
  const result = uiBlockSchema.safeParse({ version: 1, type: "dashboard_widget", data: {} });
  expect(result.success).toBe(false);
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `cd apps/web; npm test -- --run tests/task-workspace.test.tsx`

Expected: FAIL，`uiBlockSchema` 不存在。

- [ ] **Step 3: 定义最小可扩展 UI Block 契约**

```ts
export const uiBlockSchema = z.discriminatedUnion("type", [
  z.object({ version: z.literal(1), type: z.literal("run_status"), data: runStatusSchema }),
  z.object({ version: z.literal(1), type: z.literal("strategy_options"), data: strategyOptionsSchema }),
  z.object({ version: z.literal(1), type: z.literal("script_document"), data: scriptDocumentSchema }),
  z.object({ version: z.literal(1), type: z.literal("qa_report"), data: qaReportSchema }),
  z.object({ version: z.literal(1), type: z.literal("approval_request"), data: approvalSchema }),
  z.object({ version: z.literal(1), type: z.literal("publication_form"), data: publicationSchema }),
  z.object({ version: z.literal(1), type: z.literal("metric_import"), data: metricImportSchema }),
  z.object({ version: z.literal(1), type: z.literal("review_card"), data: reviewCardSchema }),
  z.object({ version: z.literal(1), type: z.literal("memory_proposal"), data: memoryProposalSchema }),
  z.object({ version: z.literal(1), type: z.literal("error_recovery"), data: errorRecoverySchema }),
]);
```

`packages/contracts/ui-blocks.schema.json` 是后端契约源，前端类型由生成命令产出并在 CI 检查无漂移。

- [ ] **Step 4: 实现可续传 SSE**

事件存 PostgreSQL，单调递增 `sequence`；客户端发送 `Last-Event-ID` 后从下一条补发。心跳不更新业务游标，重连采用指数退避，401/403 不重试。

Run: `cd apps/api; uv run pytest tests/runtime/test_sse_resume.py -q`

Expected: PASS；断线后事件不丢、不重、不跨租户。

- [ ] **Step 5: 实现“对话 + 活文档”界面**

桌面端为单一任务画布：顶部目标和成功标准，中部事件流，活文档内嵌；只给当前决策卡视觉高优先级。团长首页显示“需要你确认”“运营正在推进”“本周结果”三段主动简报，不出现后台菜单墙、统计大盘或数字人入口。

Run: `cd apps/web; npm test -- --run; npm run test:e2e -- tests/task-flow.spec.ts`

Expected: PASS；键盘可完成策略选择、文案批注与审批，移动端 390px 无横向滚动。

- [ ] **Step 6: 提交**

```bash
git add packages/contracts apps/api/app/modules/runtime apps/api/tests/runtime apps/web
git commit -m "feat: add AI native live task workspace"
```

---

### Task 10: 人工发布记录与锁定稿追溯

**Files:**
- Create: `apps/api/app/modules/publications/domain/models.py`
- Create: `apps/api/app/modules/publications/application/service.py`
- Create: `apps/api/app/modules/publications/adapters/sql.py`
- Create: `apps/api/app/modules/publications/api.py`
- Create: `apps/api/alembic/versions/0007_publications.py`
- Create: `apps/api/tests/publications/test_record_publication.py`
- Create: `apps/web/src/features/publication/PublicationForm.tsx`
- Create: `apps/web/tests/publication-form.test.tsx`

**Interfaces:**
- Consumes: `LockedArtifact`、Run 状态机。
- Produces: `record_publication(actor, command: RecordPublication) -> Publication`；`publication.recorded.v1`。

- [ ] **Step 1: 写锁定稿版本不一致测试**

```python
async def test_publication_rejects_non_locked_version(service, run, draft_version) -> None:
    command = RecordPublication(
        run_id=run.id,
        artifact_version_id=draft_version.id,
        platform=Platform.DOUYIN,
        account_name="测试账号",
        external_content_id="douyin-123",
        content_url="https://www.douyin.com/video/123",
        published_at=datetime(2026, 8, 15, tzinfo=UTC),
    )
    with pytest.raises(ArtifactVersionMismatch):
        await service.record_publication(OPERATOR, command)
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `cd apps/api; uv run pytest tests/publications/test_record_publication.py -q`

Expected: FAIL，发布模块不存在。

- [ ] **Step 3: 实现发布记录**

唯一键优先使用 `(tenant_id, platform, account_name, external_content_id)`；没有平台 ID 时使用规范化 URL。写入前确认 Run 为 `WAITING_MANUAL_PUBLICATION`、文案是该 Run 的唯一锁定版本、操作者有运营权限。成功后同事务发布事件并推进到 `PUBLISHED` 和 `WAITING_METRICS_IMPORT`。

`Platform` 是共享领域枚举，第一版只包含 `DOUYIN = "douyin"` 和 `WECHAT_CHANNELS = "wechat_channels"`，由发布记录和指标导入共同引用。

- [ ] **Step 4: 实现任务流内发布表单**

表单字段固定为平台、账号、内容 ID、内容 URL、发布时间；旁边只读显示锁定稿版本和哈希。提交 409 时展示当前锁定版本，不静默覆盖。

Run: `cd apps/api; uv run pytest tests/publications -q; cd ../web; npm test -- --run tests/publication-form.test.tsx`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/api/app/modules/publications apps/api/alembic apps/api/tests/publications apps/web/src/features/publication apps/web/tests/publication-form.test.tsx
git commit -m "feat: record traceable manual publications"
```

---

### Task 11: CSV/XLSX 指标导入、校验、去重与回滚

**Files:**
- Create: `apps/api/app/modules/analytics/domain/imports.py`
- Create: `apps/api/app/modules/analytics/domain/metrics.py`
- Create: `apps/api/app/modules/analytics/application/import_service.py`
- Create: `apps/api/app/modules/analytics/adapters/file_parser.py`
- Create: `apps/api/app/modules/analytics/adapters/sql.py`
- Create: `apps/api/app/modules/analytics/api.py`
- Create: `apps/api/alembic/versions/0008_analytics_import.py`
- Create: `apps/api/tests/analytics/fixtures/douyin-valid.csv`
- Create: `apps/api/tests/analytics/fixtures/wechat-invalid.csv`
- Create: `apps/api/tests/analytics/test_import_preview.py`
- Create: `apps/api/tests/analytics/test_import_commit.py`
- Create: `apps/web/src/features/import/MetricImportFlow.tsx`
- Create: `apps/web/tests/metric-import.test.tsx`

**Interfaces:**
- Consumes: `Publication`、S3 对象存储端口。
- Produces: `create_import(actor, file, platform) -> ImportBatch`；`preview_import(batch_id) -> ImportPreview`；`commit_import(actor, batch_id, expected_hash) -> ImportResult`；`rollback_import(actor, batch_id)`。

- [ ] **Step 1: 写原子提交和重复导入测试**

```python
async def test_invalid_row_writes_no_authoritative_metrics(import_service, invalid_file) -> None:
    batch = await import_service.create(ACTOR, invalid_file, Platform.WECHAT_CHANNELS)
    preview = await import_service.preview(ACTOR, batch.id)
    assert preview.errors
    with pytest.raises(ImportValidationError):
        await import_service.commit(ACTOR, batch.id, batch.file_sha256)
    assert await count_metric_snapshots(batch.id) == 0

async def test_same_file_is_idempotent(import_service, valid_file) -> None:
    first = await import_service.create(ACTOR, valid_file, Platform.DOUYIN)
    second = await import_service.create(ACTOR, valid_file, Platform.DOUYIN)
    assert second.id == first.id
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `cd apps/api; uv run pytest tests/analytics/test_import_preview.py tests/analytics/test_import_commit.py -q`

Expected: FAIL，导入服务不存在。

- [ ] **Step 3: 实现安全解析和统一指标**

解析限制：CSV/XLSX 最大 20MB、最多 100,000 行、拒绝宏和外部公式；原文件流式写对象存储并计算 SHA-256。统一指标首版固定为 `views`、`likes`、`comments`、`shares`、`favorites`、`profile_visits`、`inquiries`、`valid_inquiries`、`signed_merchants`、`activated_merchants`，每项保存原字段、单位、采集窗口和口径版本。

- [ ] **Step 4: 实现预览、提交和回滚事务**

预览返回字段映射、逐行错误、重复判断和影响记录数。提交使用单批事务并写 `metrics.imported.v1`；回滚只撤销该批写入的快照并保留审计与原文件，已参与已发布复盘的批次必须先撤销复盘版本。

- [ ] **Step 5: 实现三步导入 UI**

三步固定为“上传并选平台 → 检查字段与错误 → 确认写入”。错误报告可下载，提交前显示新增/更新/忽略数量；不提供平台 API 授权入口。

Run: `cd apps/api; uv run pytest tests/analytics -q; cd ../web; npm test -- --run tests/metric-import.test.tsx`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add apps/api/app/modules/analytics apps/api/alembic apps/api/tests/analytics apps/web/src/features/import apps/web/tests/metric-import.test.tsx
git commit -m "feat: import and normalize publication metrics"
```

---

### Task 12: 复盘、洞察证据与记忆升级闭环

**Files:**
- Create: `apps/api/app/modules/analytics/domain/review.py`
- Create: `apps/api/app/modules/analytics/application/review_service.py`
- Create: `apps/api/app/modules/analytics/application/review_step.py`
- Create: `apps/api/tests/analytics/test_review_evidence.py`
- Create: `apps/api/tests/analytics/test_memory_proposal.py`
- Create: `apps/web/src/features/review/ReviewCard.tsx`
- Create: `apps/web/src/features/review/MemoryProposalCard.tsx`
- Create: `apps/web/tests/review-card.test.tsx`

**Interfaces:**
- Consumes: 文案版本、Publication、MetricSnapshot、模型 Gateway、IP MemoryProposal。
- Produces: `ReviewReport`、`Insight`、`MemoryProposal`；`generate_review(actor, run_id) -> ReviewReport`；`publish_insight(actor, insight_id, expected_version)`。

- [ ] **Step 1: 写“无证据不得升级记忆”测试**

```python
async def test_memory_proposal_requires_metric_evidence(review_service, run) -> None:
    with pytest.raises(InsufficientEvidenceError):
        await review_service.propose_memory(
            OPERATOR,
            run.id,
            statement="团长应长期使用强冲突开场",
            metric_snapshot_ids=[],
            confidence=0.91,
        )
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `cd apps/api; uv run pytest tests/analytics/test_review_evidence.py -q`

Expected: FAIL，复盘服务不存在。

- [ ] **Step 3: 实现带证据的复盘模型**

```python
class Insight(BaseModel):
    statement: str
    evidence_metric_ids: list[UUID]
    compared_publication_ids: list[UUID]
    confidence: float = Field(ge=0, le=1)
    scope: InsightScope
    limitations: list[str]
    next_experiment: str
```

`InsightScope` 固定为 `CONTENT_ONLY`、`PLATFORM_AUDIENCE`、`LEADER_PREFERENCE`、`STRATEGY_PATTERN` 四种枚举值，用来限制结论可复用范围。

复盘必须区分事实、相关性判断和实验假设；少于一个完整招商周期时只能生成低置信度观察，不能写“导致”“必然提升”。长期表达偏好由团长审批，策略记忆由运营负责人审批，发布新版本并保留撤销入口。

- [ ] **Step 4: 完成 Run 闭环**

指标存在后把 Run 从 `WAITING_METRICS_IMPORT` 推进 `REVIEWING`；生成复盘后进入 `WAITING_MEMORY_APPROVAL`；审批或明确跳过记忆提案后进入 `REVIEWED`，归档后为 `ARCHIVED`。每个状态均展示下一步和证据来源。

- [ ] **Step 5: 验证复盘 UI 和因果语言约束**

Run: `cd apps/api; uv run pytest tests/analytics/test_review_evidence.py tests/analytics/test_memory_proposal.py -q; cd ../web; npm test -- --run tests/review-card.test.tsx`

Expected: PASS；界面同时显示数据、判断、置信度、局限和下一实验，用户可批准、修改或拒绝记忆提案。

- [ ] **Step 6: 提交**

```bash
git add apps/api/app/modules/analytics apps/api/tests/analytics apps/web/src/features/review apps/web/tests/review-card.test.tsx
git commit -m "feat: close the evidence driven review loop"
```

---

### Task 13: 审计、可观测性、安全与单机恢复

**Files:**
- Create: `apps/api/app/modules/audit/domain/events.py`
- Create: `apps/api/app/modules/audit/application/service.py`
- Create: `apps/api/app/shared/telemetry.py`
- Create: `apps/api/tests/security/test_cross_tenant_e2e.py`
- Create: `apps/api/tests/security/test_prompt_injection.py`
- Create: `apps/api/tests/operations/test_worker_recovery.py`
- Create: `apps/api/tests/operations/test_backup_manifest.py`
- Create: `ops/nginx/nginx.conf`
- Create: `ops/scripts/backup.sh`
- Create: `ops/scripts/restore-drill.sh`
- Create: `ops/runbooks/single-node-recovery.md`
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: 所有模块的领域事件、Run/ToolCall/Cost 关联 ID。
- Produces: `AuditService.record()`；OpenTelemetry trace；备份清单；可重复执行的恢复演练；CI 质量门禁。

- [ ] **Step 1: 写审计不可缺字段测试**

```python
def test_audit_event_requires_full_correlation_chain() -> None:
    with pytest.raises(ValidationError):
        AuditEvent.model_validate({
            "event_type": "artifact.version.locked.v1",
            "tenant_id": str(TENANT_ID),
            "actor_id": str(USER_ID),
        })
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `cd apps/api; uv run pytest tests/security tests/operations -q`

Expected: FAIL，审计和运维校验未实现。

- [ ] **Step 3: 实现统一关联与安全过滤**

所有日志与 Span 统一带 `tenant_id → goal_id → run_id → run_step_id → tool_call_id → artifact_version_id → publication_id → import_batch_id` 中适用字段；输出日志前删除 token、Cookie、Authorization、原始证据正文和外部凭证。外部网页、导入文件和情报原文作为不可信数据段传入，不允许成为系统指令。

- [ ] **Step 4: 实现备份和恢复演练**

`backup.sh` 生成 PostgreSQL 自定义格式备份、对象存储对象清单、迁移版本、镜像 tag 和 SHA-256 清单；加密后上传异地存储。`restore-drill.sh` 只接受显式的新建演练目录和空数据库，恢复后执行租户计数、Run 状态、锁定稿哈希、发布记录和指标快照校验。恢复目标为 RPO 不超过 24 小时、RTO 不超过 4 小时。

- [ ] **Step 5: 建立 CI 门禁**

CI 顺序：Python format/lint/type → Python unit/integration/coverage → Alembic fresh upgrade → TypeScript lint/type/Vitest → Playwright → OpenAPI/UI Schema 漂移 → Compose config → 依赖和镜像高危漏洞扫描。核心领域覆盖率门槛 90%，整体 80%。

- [ ] **Step 6: 运行首版验收测试**

Run: `cd apps/api; uv run pytest -q --cov=app --cov-fail-under=80`

Expected: PASS，核心领域报告均不低于 90%。

Run: `cd apps/web; npm run lint; npm run typecheck; npm test -- --run; npm run test:e2e`

Expected: 全部 PASS。

Run: `docker compose -f ops/compose.yaml config`

Expected: PASS，部署服务中不含语音、数字人、视频、GPU、平台 API Connector。

Run: `cd apps/api; uv run pytest tests/security/test_cross_tenant_e2e.py tests/operations/test_worker_recovery.py -q`

Expected: PASS，跨租户泄露为 0，Worker 中断后从最后检查点恢复。

- [ ] **Step 7: 提交**

```bash
git add apps/api/app/modules/audit apps/api/app/shared/telemetry.py apps/api/tests/security apps/api/tests/operations ops .github/workflows/ci.yml
git commit -m "chore: harden and verify the single node MVP"
```

---

## Release Acceptance

- 使用 10 位真实团长、每人至少 10 条本人确认的表达样本建立黄金集。
- 运营独立完成至少 30 条招商内容，从 Goal 到锁定稿、人工发布记录、指标导入和复盘全程可追溯。
- 可核验事实忠实度至少 98%；未经引用的强背书、内部爆款原文泄露和跨租户实体泄露均为 0。
- 10 位试点团长分别完成 IP 事实确认、文案审批和记忆提案处理；平均每个任务需处理的决策卡不超过 3 张。
- 两个完整招商周期完成统一指标回流，至少形成一个带证据、置信度、适用范围和下一实验的策略洞察。
- 单台 4C8G 在正常活跃 Agent 步骤 10、突发 20 的边界内稳定运行；超出边界排队而不是压垮数据库或 Web。
- Worker 杀进程、Redis 重启、重复导入、SSE 断线、审批版本冲突和单机恢复演练全部通过。
- 上线前书面确认爆款素材使用规范、招商指标口径、黄金样本集和备份恢复责任人。

## Explicitly Deferred

数字人口播短视频、MiniMax、HeyGen、音频/视频资产、成片交付页面、自动发布、抖音/视频号 API、带货策略包、微信小程序、任务星图、多实例高可用均不属于本计划。任一项开始实施前必须单独完成业务价值、供应商、合规、成本和架构评审。
