# Draft Save and Finalization Design

**Date:** 2026-08-17  
**Status:** Approved for implementation planning  
**Scope:** 首版“编辑保存 → 质检 → 确认定稿 → 复制拍摄”闭环

## 1. Goal

让模型生成的可用口播稿在用户确认前保持可编辑，并保证每次人工修改可以保存、追溯且不会覆盖历史。用户点击“确认定稿”或“复制并去拍”时，系统必须锁定经过当前质量报告验证的准确稿件版本。

本设计不增加新的工作台、弹窗或 SaaS 式工具栏；只完善今日创作页现有的分段编辑、整篇编辑、确认定稿和复制动作。

## 2. Current Problem

当前生成链路在质量检查后立即调用 `lockScript()`，因此页面出现前稿件已经进入 `LOCKED`。页面的“确认定稿”只修改浏览器本地状态，分段和整篇编辑也只保存在 React state 中：

- 刷新页面会丢失人工修改；
- 页面确认与服务端锁稿没有因果关系；
- 人工修改后仍展示生成稿的旧质量结论；
- 后续发布和复盘无法确定用户真正拍摄的是哪个版本；
- 两位员工同时编辑时没有版本冲突保护。

## 3. Considered Approaches

### 3.1 Save on edit completion — selected

点击“完成本段编辑”或“完成整篇编辑”时保存完整稿件的新版本。最终动作负责确保当前版本已保存、质量报告有效并完成锁稿。

该方案操作语义明确，不增加保存按钮，不产生逐字输入版本，并能在用户完成一个自然编辑单元后持久化。

### 3.2 Debounced autosave while typing — rejected

该方案减少显式动作，但会增加写入频率、并发冲突和中间版本噪声。首版无需实现离线协作编辑或逐字恢复。

### 3.3 Save only during finalization — rejected

该方案实现简单，但用户在定稿前刷新、离开页面或模型调整选题时会丢失人工修改，不满足首版可用性要求。

## 4. Product Rules

1. 模型生成和首次 QA 完成后，Run 停留在 `WAITING_LOCK_CONFIRMATION`，页面显示“待确认”，不自动锁稿。
2. “完成本段编辑”和“完成整篇编辑”均保存当前完整口播稿；服务器按内容哈希判断无变化时不创建空版本。
3. 人工修改创建新的不可变 Script Batch 与 Script Selection，旧版本不覆盖、不删除。
4. 人工修改会使旧质量报告失效，Run 回到 `READY_FOR_QA`。
5. 未修改的生成稿在确认时复用已有 QA，不重复产生模型成本。
6. 修改后的稿件在最终动作中重新执行 QA；只有硬门槛通过才能锁稿。
7. “确认定稿”执行：保存未提交内容 → 必要时 QA → 锁定当前版本。
8. “复制并去拍”执行与“确认定稿”相同的服务器流程；成功后把服务器返回的最终稿复制到剪贴板。
9. 已锁稿后再次编辑会从当前选中稿创建新草稿版本；旧锁稿继续保留，直到新版本 QA 通过并被锁定。
10. 保存失败时保留浏览器中的输入并提供重试；QA 未通过时保持草稿状态并显示具体问题。
11. 两个客户端使用相同旧版本保存时，后提交者收到 `SCRIPT_VERSION_CONFLICT`，服务器不得静默覆盖先提交的版本。

## 5. State and Lineage Model

现有状态机已经包含 `WAITING_LOCK_CONFIRMATION`，本实现删除生成路径中的自动锁稿，并新增脚本修订命令：

```text
READY_FOR_QA
  → RUN_QA
  → RUNNING_QA
  → QA_COMPLETED
  → WAITING_LOCK_CONFIRMATION
  → LOCK
  → LOCKED

WAITING_LOCK_CONFIRMATION | READY_FOR_QA | LOCKED
  → SAVE_SCRIPT_REVISION
  → READY_FOR_QA
```

每份质量报告必须绑定 `script_selection_version`。锁稿时同时保存当前 `script_selection_version`，并验证：

```text
latest_quality_report.script_selection_version
  == current_script_selection.version
```

不相等时返回 `QA_RESULT_STALE`，禁止锁定旧 QA 未覆盖的新内容。

数据库迁移为现有 `quality_reports` 和 `locked_scripts` 增加可空的 `script_selection_version`。历史原型数据保持可读；任何新写入都必须填写该字段。

## 6. Server Interfaces

### 6.1 Save a revision

```http
PUT /api/app/creation/runs/{runId}/draft
Content-Type: application/json

{
  "expectedRevision": 1,
  "paragraphs": ["开头", "正文段落", "行动引导"]
}
```

约束：

- 至少包含开头和行动引导两个非空段落；
- 第一段映射为 `hook`，最后一段映射为 `callToAction`，中间段以双换行组成 `body`；
- 保留当前选中稿的标题、选题方向和稿件标识语义；新版本使用新的稿件 ID；
- 根据最新文本重新计算预计时长；
- `expectedRevision` 必须等于当前 Script Selection version；
- 需要 `content.edit` 能力并通过 tenant、IP 和 content account 范围校验。

返回最新的 `CreationDraftView`。内容未变化时返回同一 revision，并带 `saved: false`；创建新版本时返回 `saved: true`。

### 6.2 Finalize

```http
POST /api/app/creation/runs/{runId}/finalize
Content-Type: application/json

{
  "expectedRevision": 2,
  "paragraphs": ["当前页面的开头", "正文", "行动引导"]
}
```

该接口在一个应用服务入口中依次执行：

1. 若页面内容与服务器版本不同，先按保存规则创建 revision；
2. 若当前 QA 未绑定当前 revision，调用现有 `qa` 模型操作；
3. QA 硬门槛通过后创建新的 Locked Script version；
4. 返回最终的 `CreationDraftView`。

重复提交相同已锁定 revision 必须幂等返回，不创建重复锁稿。

### 6.3 Creation view

`CreationDraftView` 增加：

```ts
type CreationDraftStatus = "ready_to_confirm" | "needs_qa" | "locked"

type CreationDraftView = {
  runId: string
  revision: number
  status: CreationDraftStatus
  lockedVersion: number | null
  title: string
  paragraphs: string[]
  // 保留现有 lead、duration、wordCount、checks、evidence、alternatives
}
```

Presenter 从“当前选中稿”生成草稿视图，不再强制要求 `lockedScript`。当 QA 不属于当前 revision 时，不得把旧 QA 展示成当前稿的通过结论。

## 7. Component Boundaries

### `RunService`

- 停止在 `generateAutoDraft()` 和 `generateTopicDraft()` 末尾自动锁稿；
- 新增 `saveScriptRevision()`，负责版本冲突、文本映射、持久化和状态变化；
- `runQa()` 把当前 Script Selection version 写入质量报告；
- `lockScript()` 校验 QA 与当前 revision 的谱系一致性并实现同 revision 幂等。

### `CreationAppService`

- 统一执行租户、IP、账号范围校验；
- 暴露 `saveDraft()` 与 `finalize()`；
- `finalize()` 编排保存、条件 QA 和锁稿，不把事务或权限判断交给模型。

### `DailyCreationWorkspace`

- 管理保存、质检、锁稿的网络状态和错误；
- 保存成功后用服务器返回的新 revision 替换页面数据；
- 版本冲突时保留本地输入，明确提示刷新或复制本地内容后重试。

### `DailyCreationView`

- 分段或整篇编辑完成时提交完整 paragraphs；
- 最终动作仍使用当前两个主按钮，不新增工具栏；
- `locked` 完全来自服务器状态，不再使用独立本地布尔值；
- 已定稿后进入编辑时提示“正在基于已定稿创建新版本”。

## 8. UI Behavior

- 初始生成稿：按钮显示“确认定稿”，版本标签显示 `v1 · 待确认`。
- 保存进行中：当前完成按钮禁用，页面顶部显示“正在保存修改…”。
- 修改已保存：版本标签更新为新 revision，显示“修改已保存，定稿前会重新检查”。
- 定稿进行中：两个最终动作均禁用，状态依次显示“正在保存当前版本…”和“正在检查并定稿…”。
- 定稿成功：按钮显示“已确认定稿”，版本标签显示锁稿版本；“复制并去拍”仍可再次复制，但不重复锁稿。
- QA 阻断：页面保留稿件，证据栏显示未通过项，按钮恢复可用。
- 保存错误或版本冲突：不清空 textarea，不替换服务器视图，不丢失用户输入。

## 9. Error Handling

| Error code | Meaning | UI behavior |
|---|---|---|
| `SCRIPT_VERSION_CONFLICT` | 客户端基于旧 revision 保存 | 保留本地内容，提示刷新前先复制本地修改 |
| `SCRIPT_PARAGRAPHS_INVALID` | 段落为空或不足两段 | 保持编辑状态并定位问题 |
| `QA_RESULT_STALE` | QA 与当前 revision 不一致 | 自动重新 QA；仍不一致时阻断锁稿 |
| `DRAFT_NEEDS_ATTENTION` | QA 硬门槛未通过 | 展示建议，保持草稿 |
| `RUN_NOT_FOUND` | 越权或 Run 不存在 | 不泄露其他租户实体，显示无权访问 |
| `LLM_TIMEOUT` | 修改后 QA 超时 | 保持已保存 revision，允许重试定稿 |

## 10. Testing and Acceptance

### Unit and service tests

- 自动生成完成后状态为 `WAITING_LOCK_CONFIRMATION`，不存在 locked script；
- 保存人工修改创建新 Script Selection version，旧版本仍可读取；
- 相同内容保存不增加版本；
- 基于旧 expected revision 保存返回冲突；
- 修改后旧 QA 不能锁定新 revision；
- 未修改生成稿确认时不重复调用 QA；
- 修改稿确认时只重新调用一次 QA；
- 同 revision 重复 finalization 不创建重复 locked script；
- tenant、IP 和 account 越权调用保存或定稿均被拒绝。

### Component tests

- 完成单段编辑后向保存回调提交完整 paragraphs；
- 保存失败仍保留 textarea 内容；
- `locked` 标签完全由服务器返回状态驱动；
- “复制并去拍”先等待 finalization 成功再写入剪贴板。

### Browser acceptance

1. 登录并获得真实或固定测试模型生成稿；
2. 修改第二段并完成编辑；
3. 刷新页面后修改仍存在；
4. 点击确认定稿，状态变为 locked；
5. 再次编辑并保存，旧锁稿仍存在且当前视图进入新草稿；
6. 点击复制并去拍，最终版本被锁定且剪贴板文本与服务器稿一致；
7. 页面无控制台错误，移动端无横向溢出。

## 11. Out of Scope

- 平台自动发布和平台数据 API；
- 数字人口播视频链路；
- 多人实时协同光标、字段级合并或离线编辑；
- 自动保存每次击键；
- 应用蓝绿发布、灾备和多实例高可用；
- 发布登记和指标绑定。本功能完成后，发布登记作为下一独立首版切片实施。

