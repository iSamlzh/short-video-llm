# Content Loop MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付一个面向运营团队与团长的 IP 内容增长 MVP，跑通“团长 IP → 选题方向选择 → 同方向候选文案选择 → 动态质量标准 → 确认锁稿 → 人工发布记录 → 数据导入 → 复盘与质量进化”的完整闭环，首个业务验证场景为团长招商获客。

**Architecture:** 使用模块化单体承载权威业务状态，FastAPI API 与 Celery Worker 共享领域模块，PostgreSQL + pgvector 保存权威数据和检索索引，Redis 只承担队列与短期协调。受保护爆款原文经人工拆解形成版本化爆款结构；系统以 IP 属性匹配选题方向，用户选定一个方向后才生成该方向下的多篇完整候选稿。动态质量引擎从爆款库、黄金样本和发布效果自主提案与评测新标准，内容负责人确认后启用，所有 Run 通过显式状态机、检查点与 Outbox 保证可恢复。

**Tech Stack:** Python 3.12、FastAPI、Pydantic v2、SQLAlchemy 2、Alembic、Celery 5、PostgreSQL 16 + pgvector、Redis 7、Next.js 15、React 19、TypeScript 5、Zod、TanStack Query、SSE、S3 兼容对象存储、OpenTelemetry、Docker Compose、pytest、Vitest、Playwright。

## Global Constraints

- 第一版仅实现内容闭环；不得创建 MiniMax、HeyGen、VoiceProfile、AvatarProfile、音频、视频、成片页面、自动发布或平台 API 相关代码、表、接口、事件和测试。
- 第一版以团长招商获客作为验证场景，但选题、爆款结构、文案和质量引擎不得与招商强绑定；带货模板包不进入实现。
- 运营端可访问内部内容情报；团长端和生成模型永远不能读取爆款原文、内部结构评分或其他租户数据。
- 所有租户业务表必须有不可为空的 `tenant_id`，应用授权与 PostgreSQL Row-Level Security 双重隔离。
- 用户必须先从 3～5 个 IP 适配方向中选择一个，再从该方向默认 3 篇完整候选稿中选择今天拍摄稿；一个候选批次不得混入多个方向。
- 事实、公开文案、长期记忆和新质量标准启用必须经过明确确认；事实、合规、租户隔离和原文泄露门槛不得由 Agent 降低。
- 质量引擎自主发现、提炼、离线评测和影子评分；新版本必须满足 10 条独立来源、3 个创作者、30 条历史稿件、综合质量提升至少 5% 且硬门槛零退化，内容负责人确认后才能启用。
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
        intelligence/              # 受保护来源、拆解、模式和爆款结构版本
        quality/                   # 质量标准、提案、离线/影子评测和回滚
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
      <h1>今天想围绕这个 IP 拍什么内容？</h1>
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

### Task 4: 受保护爆款库与人工爆款结构版本

**Files:**
- Create: `apps/api/app/modules/intelligence/domain/models.py`
- Create: `apps/api/app/modules/intelligence/domain/leakage.py`
- Create: `apps/api/app/modules/intelligence/domain/templates.py`
- Create: `apps/api/app/modules/intelligence/application/service.py`
- Create: `apps/api/app/modules/intelligence/application/template_service.py`
- Create: `apps/api/app/modules/intelligence/adapters/sql.py`
- Create: `apps/api/app/modules/intelligence/api.py`
- Create: `apps/api/alembic/versions/0003_content_intelligence.py`
- Create: `apps/api/tests/intelligence/test_visibility.py`
- Create: `apps/api/tests/intelligence/test_writing_template_version.py`

**Interfaces:**
- Consumes: `ActorContext`、审计写入端口。
- Produces: `SourceItem`、`ContentDecomposition`、`Pattern`、`WritingTemplateVersion`；`match_templates(actor, ip_tags, topic_direction, platform, limit) -> list[WritingTemplateSummary]`；`publish_template(actor, draft_id) -> WritingTemplateVersion`。

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

- [ ] **Step 3: 实现受保护原文域和人工爆款结构**

`SourceItem.raw_text` 与拆解详情仅授予 `INTELLIGENCE`、`OPERATOR`；生成 Runtime 只能读取 `WritingTemplateSummary`，不得读取来源 URL、作者、原文、连续原句或内部评分。第一版由内容团队人工发布 20～30 个爆款结构，发布后不可原地修改，修订创建新 `WritingTemplateVersion`。

内部情报 API 固定包含 `POST /v1/intelligence/sources`、`POST /v1/intelligence/sources/{id}/decompositions`、`POST /v1/intelligence/patterns`、`POST /v1/intelligence/writing-templates`、`POST /v1/intelligence/writing-templates/{id}/publish` 和运营专用搜索。来源保存 URL、平台、发布时间、采集时间、原文哈希和授权/使用范围；7 日窗口以发布时间过滤，过期来源不参与新方向匹配但保留审计。

```python
@dataclass(frozen=True)
class WritingTemplateSummary:
    template_version_id: UUID
    applicable_ip_tags: tuple[str, ...]
    topic_direction_tags: tuple[str, ...]
    platforms: tuple[str, ...]
    hook_structure: str
    narrative_steps: tuple[str, ...]
    proof_requirements: tuple[str, ...]
    cta_type: str
    forbidden_conditions: tuple[str, ...]
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

Expected: PASS；团长接口和生成上下文均无原文，候选输出命中保护片段时阻断，爆款结构版本不可变。

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
- Consumes: IP 快照 ID、爆款结构检索端口、Celery。
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
    RunState.RESEARCHING: frozenset({RunState.WAITING_TOPIC_DIRECTION_SELECTION}),
    RunState.WAITING_TOPIC_DIRECTION_SELECTION: frozenset({RunState.DRAFTING_CANDIDATES}),
    RunState.DRAFTING_CANDIDATES: frozenset({RunState.WAITING_SCRIPT_SELECTION}),
    RunState.WAITING_SCRIPT_SELECTION: frozenset({RunState.QA}),
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
- Consumes: `IPSnapshot`、`WritingTemplateSummary`、Run 检查点。
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

`ContextPacket` 固定包含 `tenant_id`、`run_id`、`ip_snapshot_id`、`topic_selection_id`、`writing_template_version_ids`、可空的 `quality_standard_version_id: UUID | None`、带来源类型的 `items`、`token_count` 和 `assembled_at`；构造器拒绝任何 `tenant_id` 不一致的条目。爆款原文、来源 URL、作者和内部结构评分不得进入 `ContextPacket`。Task 8 创建质量标准 v1 后，进入 QA 的上下文必须将该字段设为非空。

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

### Task 7: IP 选题方向生成与单方向选择

**Files:**
- Create: `apps/api/app/modules/runtime/domain/topics.py`
- Create: `apps/api/app/modules/runtime/application/topic_direction_step.py`
- Create: `apps/api/app/modules/runtime/application/topic_selection.py`
- Modify: `apps/api/app/modules/runtime/api.py`
- Create: `apps/api/alembic/versions/0006_topic_directions.py`
- Create: `apps/api/tests/runtime/test_topic_direction_generation.py`
- Create: `apps/api/tests/runtime/test_topic_selection.py`
- Create: `apps/api/tests/evals/test_topic_direction_contract.py`

**Interfaces:**
- Consumes: `ContextAssembler.build()`、`ModelPort.generate()`、`transition()`。
- Produces: `TopicDirectionCandidate` 3～5 个；`select_topic_direction(actor, run_id, batch_id, candidate_id, expected_version) -> TopicSelection`。

- [ ] **Step 1: 写“只能选择一个方向”失败测试**

```python
async def test_run_has_one_current_topic_selection(topic_service, run, direction_batch) -> None:
    first = await topic_service.select(ACTOR, run.id, direction_batch.id, direction_batch.items[0].id, 1)
    second = await topic_service.select(ACTOR, run.id, direction_batch.id, direction_batch.items[1].id, 1)
    assert first.superseded_at is not None
    assert second.is_current is True
    assert await topic_service.current_selection(run.id) == second
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `cd apps/api; uv run pytest tests/runtime/test_topic_selection.py -q`

Expected: FAIL，选题方向类型或选择服务不存在。

- [ ] **Step 3: 实现选题方向产物与匹配理由**

```python
class TopicDirectionCandidate(BaseModel):
    id: UUID
    batch_id: UUID
    title: str
    fit_reason: str
    applicable_ip_attribute_ids: list[UUID]
    usable_fact_claim_ids: list[UUID]
    audience: str
    content_promise: str
    risks: list[str]
    matched_template_version_ids: list[UUID]

class TopicSelection(BaseModel):
    id: UUID
    run_id: UUID
    candidate_id: UUID
    selected_by: UUID
    selected_at: datetime
    version: int
    is_current: bool
```

一次选题步骤输出 3～5 个基于当前 IP 快照的方向。每个方向说明“为什么适合这个 IP”和可用事实，不展示爆款原文、内部模板名称或评分。用户可选择一个方向或要求换一批；换批保留旧批次审计。`POST /v1/runs/{id}/topic-direction-selection` 校验批次、版本和租户，选择成功后把 Run 推进 `DRAFTING_CANDIDATES`。

- [ ] **Step 4: 增加黄金样本 Eval**

评测固定检查 IP 属性契合度、方向清晰度、可用事实绑定、风险披露、原文泄露和候选差异度；报告保存模型、提示词、IP 快照、爆款结构和黄金集版本。

Run: `cd apps/api; uv run pytest tests/runtime/test_topic_direction_generation.py tests/runtime/test_topic_selection.py tests/evals/test_topic_direction_contract.py -q`

Expected: PASS；方向数量为 3～5，一次 Run 只有一个当前有效方向，方向切换不会删除历史选择。

- [ ] **Step 5: 提交**

```bash
git add apps/api/app/modules/runtime apps/api/alembic apps/api/tests/runtime apps/api/tests/evals
git commit -m "feat: generate and select IP topic directions"
```

---

### Task 8: 单方向候选文案、质量标准 v1 与最终确认

**Files:**
- Create: `apps/api/app/modules/artifacts/domain/models.py`
- Create: `apps/api/app/modules/artifacts/domain/qa.py`
- Create: `apps/api/app/modules/artifacts/domain/candidates.py`
- Create: `apps/api/app/modules/artifacts/application/script_service.py`
- Create: `apps/api/app/modules/artifacts/application/script_selection.py`
- Create: `apps/api/app/modules/artifacts/application/approval_service.py`
- Create: `apps/api/app/modules/runtime/application/script_step.py`
- Create: `apps/api/app/modules/artifacts/api.py`
- Create: `apps/api/app/modules/quality/domain/models.py`
- Create: `apps/api/app/modules/quality/application/active_standard.py`
- Create: `apps/api/app/modules/quality/application/initialization.py`
- Create: `apps/api/app/modules/quality/api.py`
- Modify: `apps/api/app/modules/runtime/application/service.py`
- Modify: `apps/api/app/modules/runtime/application/context.py`
- Create: `apps/api/alembic/versions/0007_candidates_quality_artifacts.py`
- Create: `apps/api/tests/artifacts/test_script_versioning.py`
- Create: `apps/api/tests/artifacts/test_script_selection.py`
- Create: `apps/api/tests/artifacts/test_final_confirmation.py`
- Create: `apps/api/tests/artifacts/test_qa_blocking.py`
- Create: `apps/api/tests/quality/test_active_standard.py`

**Interfaces:**
- Consumes: 当前 `TopicSelection`、`WritingTemplateSummary`、`IPSnapshot`、模型 Gateway。
- Produces: 同一方向默认 3 个 `ScriptCandidate`；`select_script_candidate(actor, run_id, batch_id, candidate_id, expected_version) -> ScriptSelection`；`ArtifactVersion`、`QAReport`、`ApprovalDecision`；`lock_version(actor, artifact_id, version, expected_sha256) -> LockedArtifact`。

- [ ] **Step 1: 写跨方向混稿阻断与质量版本锁定测试**

```python
async def test_candidate_batch_rejects_another_direction(script_service, topic_selection) -> None:
    with pytest.raises(TopicSelectionMismatch):
        await script_service.create_batch(
            ACTOR,
            topic_selection_id=topic_selection.id,
            candidates=[candidate_for(topic_selection.id), candidate_for(OTHER_SELECTION_ID)],
        )

async def test_qa_report_locks_active_quality_version(qa_service, selected_script, active_standard) -> None:
    report = await qa_service.evaluate(ACTOR, selected_script.artifact_version_id)
    assert report.quality_standard_version_id == active_standard.id
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `cd apps/api; uv run pytest tests/artifacts/test_script_selection.py tests/quality/test_active_standard.py -q`

Expected: FAIL，候选选择或质量标准模块不存在。

- [ ] **Step 3: 实现不可变文案版本和 QA**

`script_step.py` 只能读取当前 `TopicSelection`，在该方向下匹配爆款结构并默认生成 3 篇完整稿件。每个 `ScriptCandidate` 保存 `topic_selection_id`、`writing_template_version_id`、IP 快照、标题、完整口播稿、平台变体、封面文案、拍摄提示和事实引用；同批候选的 `topic_selection_id` 必须完全一致。用户选择一篇后创建 `ScriptSelection` 和可编辑 `ArtifactVersion`，Run 推进到 `QA`。

```python
class ScriptCandidate(BaseModel):
    id: UUID
    batch_id: UUID
    topic_selection_id: UUID
    writing_template_version_id: UUID
    title: str
    full_script: str
    platform_variants: dict[str, str]
    fact_claim_ids: list[UUID]

class ScriptSelection(BaseModel):
    id: UUID
    run_id: UUID
    candidate_id: UUID
    topic_selection_id: UUID
    selected_by: UUID
    selected_at: datetime
```

`ArtifactVersion` 额外保存 `script_selection_id`、`quality_standard_version_id`、模型/提示词版本和 SHA-256。编辑永远创建新版本，并让旧版本未决确认失效。

```python
class QualityStandardVersion(BaseModel):
    id: UUID
    version: int
    scope: str
    dimensions: dict[str, Decimal]
    rubric: dict[str, object]
    hard_gate_policy_version: str
    evidence_refs: list[UUID]
    status: Literal["active", "stable", "retired", "rolled_back"]
    activated_at: datetime | None
```

```python
class QAItem(BaseModel):
    code: str
    severity: Literal["block", "warn", "info"]
    message: str
    location: TextRange | None
    fact_claim_ids: list[UUID]

class QAReport(BaseModel):
    artifact_version_id: UUID
    quality_standard_version_id: UUID
    items: list[QAItem]
    passed: bool
```

其中 `TextRange` 为 `BaseModel(start: int, end: int)`，使用 UTF-8 解码后的 Unicode code point 偏移；`start >= 0` 且 `end > start`。

首个 `QualityStandardVersion` 由内容负责人通过 `POST /v1/quality-standards/initial` 根据爆款库和黄金样本人工发布，包含 IP/选题契合度、钩子、爆款结构完整度、事实忠实度、个人口吻、证据强度、信息密度、原创表达、CTA 和平台适配。首个标准只能创建一次；后续版本必须走 Task 13 的进化流程。创建 Run 时锁定当时的 ACTIVE 质量版本，质检顺序为不可降低的事实/合规/隔离/泄露硬门槛，再执行当前质量标准评分；`block` 未解决时 API 返回 409。

模型响应先过结构 Schema 和候选批次一致性检查；用户选择后才对选中稿执行正式 QA，避免对未选稿产生不必要的模型成本。

- [ ] **Step 4: 实现审批 API 的版本冲突**

`POST /v1/runs/{id}/script-selection` 必须携带候选批次和版本，跨方向候选返回 409。`POST /v1/approvals/{id}/decisions` 必须携带 `artifact_version`；旧版本返回 409 并包含当前版本号，不自动迁移人的决定。运营确认质量、团长确认“事实正确、像本人且愿意公开”后计算哈希，把 Run 推进 `CONTENT_LOCKED`，随后进入 `WAITING_MANUAL_PUBLICATION`。

- [ ] **Step 5: 验证版本、QA 和角色边界**

Run: `cd apps/api; uv run pytest tests/artifacts -q`

Expected: PASS；团长只能批准自己的文案，运营不能替团长确认“像本人且愿意公开”。

- [ ] **Step 6: 提交**

```bash
git add apps/api/app/modules/artifacts apps/api/app/modules/quality apps/api/app/modules/runtime/application apps/api/alembic apps/api/tests/artifacts apps/api/tests/quality
git commit -m "feat: generate and govern same direction script choices"
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
- Create: `apps/web/src/features/topics/TopicDirectionChoices.tsx`
- Create: `apps/web/src/features/scripts/ScriptCandidateChoices.tsx`
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
  z.object({ version: z.literal(1), type: z.literal("topic_direction_choices"), data: topicDirectionChoicesSchema }),
  z.object({ version: z.literal(1), type: z.literal("script_candidate_choices"), data: scriptCandidateChoicesSchema }),
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

桌面端为单一任务画布：顶部目标和成功标准，中部事件流，活文档内嵌；只给当前决策卡视觉高优先级。方向卡先显示 3～5 个方向及“为什么适合这个 IP”，一次只能选一个；随后文案卡只显示该方向默认 3 篇完整稿件，并清楚标识共同方向，支持“选今天拍这篇”和“同方向换一批”。团长首页显示“需要你确认”“运营正在推进”“本周结果”三段主动简报，不出现后台菜单墙、统计大盘或数字人入口。

Run: `cd apps/web; npm test -- --run; npm run test:e2e -- tests/task-flow.spec.ts`

Expected: PASS；键盘可完成方向选择、同方向文案选择、批注与最终确认；测试断言页面不会同时渲染多个方向的文案，移动端 390px 无横向滚动。

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
- Create: `apps/api/alembic/versions/0008_publications.py`
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
- Create: `apps/api/alembic/versions/0009_analytics_import.py`
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
- Consumes: IP 快照、`TopicSelection`、`WritingTemplateVersion`、`QualityStandardVersion`、文案版本、Publication、MetricSnapshot、模型 Gateway、IP MemoryProposal。
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

`InsightScope` 固定为 `CONTENT_ONLY`、`PLATFORM_AUDIENCE`、`LEADER_PREFERENCE`、`TOPIC_TEMPLATE` 四种枚举值，用来限制结论可复用范围。

复盘必须按“IP 属性 × 选题方向 × 爆款结构 × 质量标准 × 平台”保存谱系，并区分事实、相关性判断和实验假设；少于一个完整业务周期时只能生成低置信度观察，不能写“导致”“必然提升”。长期表达偏好由团长确认，内容经验由运营负责人确认，发布新版本并保留撤销入口。复盘只提供质量进化证据，不直接修改当前质量标准。

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

### Task 13: 内容质量标准自主提案、评测、启用与回滚

**Files:**
- Create: `apps/api/app/modules/quality/domain/evolution.py`
- Create: `apps/api/app/modules/quality/domain/promotion_policy.py`
- Create: `apps/api/app/modules/quality/application/discovery_service.py`
- Create: `apps/api/app/modules/quality/application/evaluation_service.py`
- Create: `apps/api/app/modules/quality/application/activation_service.py`
- Create: `apps/api/app/modules/quality/application/tasks.py`
- Create: `apps/api/app/modules/quality/adapters/sql.py`
- Modify: `apps/api/app/modules/quality/api.py`
- Create: `apps/api/alembic/versions/0010_quality_evolution.py`
- Create: `apps/api/tests/quality/test_discovery.py`
- Create: `apps/api/tests/quality/test_promotion_policy.py`
- Create: `apps/api/tests/quality/test_shadow_evaluation.py`
- Create: `apps/api/tests/quality/test_activation_and_rollback.py`
- Create: `apps/web/src/features/quality/QualityStandardReview.tsx`
- Create: `apps/web/tests/quality-standard-review.test.tsx`

**Interfaces:**
- Consumes: `ContentDecomposition`、黄金样本、历史 `ArtifactVersion`、`MetricSnapshot`、当前 `QualityStandardVersion`、模型 Gateway 和审计端口。
- Produces: `QualitySignal`、`QualityStandardProposal`、`QualityEvaluation`；`discover_quality_signals(scope, window) -> list[QualitySignal]`；`evaluate_proposal(actor, proposal_id) -> QualityEvaluation`；`activate_standard(actor, proposal_id, expected_current_version) -> QualityStandardVersion`；`rollback_standard(actor, version_id, reason) -> QualityStandardVersion`。

- [ ] **Step 1: 写不满足证据门槛不得待启用的失败测试**

```python
def test_promotion_requires_all_evidence_thresholds() -> None:
    evaluation = evaluation_result(
        independent_sources=9,
        distinct_creators=3,
        historical_artifacts=30,
        quality_lift=Decimal("0.06"),
        hard_gate_regressions=0,
    )
    assert PromotionPolicy().decision(evaluation) == PromotionDecision.INSUFFICIENT_EVIDENCE

def test_any_hard_gate_regression_blocks_promotion() -> None:
    evaluation = evaluation_result(
        independent_sources=12,
        distinct_creators=4,
        historical_artifacts=40,
        quality_lift=Decimal("0.08"),
        hard_gate_regressions=1,
    )
    assert PromotionPolicy().decision(evaluation) == PromotionDecision.HARD_GATE_REGRESSION
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `cd apps/api; uv run pytest tests/quality/test_promotion_policy.py -q`

Expected: FAIL，质量进化策略不存在。

- [ ] **Step 3: 实现提案状态和固定晋级门槛**

```python
class QualityProposalState(StrEnum):
    DISCOVERED = "discovered"
    EVALUATING = "evaluating"
    SHADOWING = "shadowing"
    WAITING_OWNER_APPROVAL = "waiting_owner_approval"
    REJECTED = "rejected"
    ACTIVATED = "activated"
    ROLLED_BACK = "rolled_back"

class PromotionDecision(StrEnum):
    READY = "ready"
    INSUFFICIENT_EVIDENCE = "insufficient_evidence"
    HARD_GATE_REGRESSION = "hard_gate_regression"

class QualityEvaluation(BaseModel):
    proposal_id: UUID
    independent_sources: int
    distinct_creators: int
    historical_artifacts: int
    quality_lift: Decimal
    hard_gate_regressions: int
    shadow_sample_count: int
    evaluated_at: datetime

class PromotionPolicy:
    def decision(self, result: QualityEvaluation) -> PromotionDecision:
        if result.hard_gate_regressions > 0:
            return PromotionDecision.HARD_GATE_REGRESSION
        enough = (
            result.independent_sources >= 10
            and result.distinct_creators >= 3
            and result.historical_artifacts >= 30
            and result.quality_lift >= Decimal("0.05")
        )
        return PromotionDecision.READY if enough else PromotionDecision.INSUFFICIENT_EVIDENCE
```

事实忠实、合规、租户隔离和爆款原文泄露四类硬门槛使用不可编辑的系统策略。`QualityStandardProposal` 只能增加或保持硬门槛，尝试降低、删除或改变严重度时直接拒绝并写安全审计。

- [ ] **Step 4: 实现自主发现、离线评测和影子评分**

定时任务按适用范围读取近 7 日爆款拆解、人工优劣样本和真实发布效果，生成带证据的 `QualitySignal`，再形成评分维度/权重/Rubric 差异提案。离线评测固定保存样本 ID、当前/候选得分、硬门槛结果、模型与提示词版本；达到前三项样本门槛后进入影子评分，影子结果只记录差异，不影响用户 QA。

Run: `cd apps/api; uv run pytest tests/quality/test_discovery.py tests/quality/test_shadow_evaluation.py -q`

Expected: PASS；播放量不能作为唯一证据，来源重复不重复计数，影子版本不改变 `active_standard_id`。

- [ ] **Step 5: 实现负责人启用和线上自动回滚**

`POST /v1/quality-standards/{id}/activate` 只允许 `ADMIN`/内容负责人角色，校验 `PromotionDecision.READY`、当前版本乐观锁和回滚点。启用后新 Run 锁定新版本，进行中的 Run 保持旧版本。线上硬门槛出现任一回归，或质量分较基线下降超过 10% 且样本不少于 30 条时，自动回滚上一稳定版本并发布 `quality_standard.rolled_back.v1`。

```python
async def test_activation_does_not_change_running_run(activation_service, runtime, active_run, new_goal, ready_proposal) -> None:
    old_version = active_run.quality_standard_version_id
    new_version = await activation_service.activate(OWNER, ready_proposal.id, expected_current_version=3)
    assert active_run.quality_standard_version_id == old_version
    new_run = await runtime.start_run(ACTOR, new_goal.id, "after-quality-activation")
    assert new_run.quality_standard_version_id == new_version.id
```

- [ ] **Step 6: 实现质量标准审阅界面**

页面只展示当前/候选版本差异、证据来源数量、创作者数量、历史样本数、综合提升、硬门槛结果、影子分布、风险和回滚版本。内容负责人可以启用、拒绝或填写理由；普通运营只读，团长端没有此入口。

Run: `cd apps/api; uv run pytest tests/quality -q; cd ../web; npm test -- --run tests/quality-standard-review.test.tsx`

Expected: PASS；未满足任一门槛时启用按钮不可用，API 即使被直接调用也返回 409。

- [ ] **Step 7: 提交**

```bash
git add apps/api/app/modules/quality apps/api/alembic apps/api/tests/quality apps/web/src/features/quality apps/web/tests/quality-standard-review.test.tsx
git commit -m "feat: evolve content quality standards safely"
```

---

### Task 14: 审计、可观测性、安全与单机恢复

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

所有日志与 Span 统一带 `tenant_id → goal_id → run_id → run_step_id → topic_selection_id → script_selection_id → quality_standard_version_id → tool_call_id → artifact_version_id → publication_id → import_batch_id` 中适用字段；输出日志前删除 token、Cookie、Authorization、原始证据正文和外部凭证。外部网页、导入文件和情报原文作为不可信数据段传入，不允许成为系统指令。

- [ ] **Step 4: 实现备份和恢复演练**

`backup.sh` 生成 PostgreSQL 自定义格式备份、对象存储对象清单、迁移版本、镜像 tag 和 SHA-256 清单；加密后上传异地存储。`restore-drill.sh` 只接受显式的新建演练目录和空数据库，恢复后执行租户计数、Run 状态、锁定稿哈希、发布记录和指标快照校验。恢复目标为 RPO 不超过 24 小时、RTO 不超过 4 小时。

- [ ] **Step 5: 建立 CI 门禁**

CI 顺序：Python format/lint/type → Python unit/integration/coverage → Alembic fresh upgrade → 方向/候选批次一致性测试 → 质量标准晋级与回滚测试 → TypeScript lint/type/Vitest → Playwright → OpenAPI/UI Schema 漂移 → Compose config → 依赖和镜像高危漏洞扫描。核心领域覆盖率门槛 90%，整体 80%。

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
- 运营独立完成至少 30 条首期业务内容，从 Goal、方向选择、同方向文案选择到锁定稿、人工发布记录、指标导入和复盘全程可追溯。
- 可核验事实忠实度至少 98%；未经引用的强背书、内部爆款原文泄露和跨租户实体泄露均为 0。
- 10 位试点团长分别完成 IP 事实确认、文案审批和记忆提案处理；平均每个任务需处理的决策卡不超过 3 张。
- 两个完整首期业务周期完成统一指标回流，至少形成一个带证据、置信度、适用范围和下一实验的内容洞察。
- 每份 QA 报告绑定唯一 `QualityStandardVersion`；至少一个质量标准提案完成发现、离线评测、影子评分和负责人启用/拒绝，且可回滚。
- 单台 4C8G 在正常活跃 Agent 步骤 10、突发 20 的边界内稳定运行；超出边界排队而不是压垮数据库或 Web。
- Worker 杀进程、Redis 重启、重复导入、SSE 断线、审批版本冲突和单机恢复演练全部通过。
- 上线前书面确认爆款素材使用规范、首期业务指标口径、黄金样本集和备份恢复责任人。

## Explicitly Deferred

数字人口播短视频、MiniMax、HeyGen、音频/视频资产、成片交付页面、自动发布、抖音/视频号 API、带货模板包、微信小程序、任务星图、多实例高可用均不属于本计划。任一项开始实施前必须单独完成业务价值、供应商、合规、成本和架构评审。
