# 真实发布、数据复盘与私有记忆闭环详细设计

**日期：** 2026-08-17
**状态：** 待用户书面审阅
**适用范围：** 团长端首版内容闭环；平台数据 API、数字人视频和平台通用模板自主进化不在本设计范围内。

## 1. 目标与产品判断

当前系统已经完成“当前 IP 默认进入 → 自动选题与口播稿 → 编辑保存 → 质检 → 定稿”的创作闭环，但增长闭环尚未完成：导入数据不能可靠关联到具体发布视频和锁稿版本，已确认复盘记忆也没有进入下一次创作上下文。

本阶段交付以下完整链路：

`锁稿 → 记录发布 → 导入真实数据 → 确定性匹配 → 自动复盘 → 人工确认私有记忆 → 下一次创作使用该记忆`

首版继续遵守以下产品原则：

- 结果优先，不建设数据仪表盘；
- 真实数据优先，生产服务拒绝模拟数据；
- 模型负责总结和提出有边界的假设，不负责猜测视频匹配；
- 只有人工确认的复盘能够影响后续创作；
- 私有记忆只属于当前租户、IP 和内容账号，不回写平台模板；
- 单台 4 核 8 GB 部署可以运行，不提前引入 Redis、队列或微服务。

## 2. 已确认决策

1. 发布回执采用混合来源：系统锁稿由用户发布后补充作品 ID 或链接；历史视频可在导入时建立外部发布记录。
2. 匹配首先限定在同一租户、IP、平台和内容账号内，再按作品 ID、规范化链接、唯一标题与时间窗处理。
3. 标题或正文相似只能生成候选，不能自动绑定。
4. 导入完成后自动进入复盘；错误行和未匹配行不阻断有效数据。
5. 匹配成功少于 3 条只展示事实；3–4 条生成暂定复盘但不能写入长期记忆；5 条及以上才允许确认记忆。
6. 使用模块化单机架构，服务边界为发布、导入、匹配、复盘、记忆和创作上下文。
7. 三个界面均采用已确认的 A 方案：正文末尾轻量发布回执、结论优先的导入异常处理、结论与记忆预览式复盘。
8. 私有记忆在下一次创作中自动生效，只轻量展示使用的版本和实际影响，不增加配置步骤。

## 3. 范围

### 3.1 首版包含

- 一个锁稿版本发布到一个或多个平台账号的发布记录；
- 系统内容与历史外部内容两类发布来源；
- CSV 和 XLSX 上传、中文/英文表头归一化、逐行校验、去重和部分成功；
- 作品 ID、视频链接、标题与发布时间的确定性匹配；
- 未匹配候选确认和外部发布记录创建；
- 同一视频多次采集的不可变指标快照；
- 同账号相对基线、样本门槛和有证据边界的模型复盘；
- 人工确认、不可变私有记忆版本和创作使用谱系；
- 团长分配给员工的发布、导入、复盘和记忆确认权限；
- 桌面与移动端的结果优先界面；
- 审计、幂等、恢复、测试和首版单机部署约束。

### 3.2 首版不包含

- 抖音、视频号等平台 API 或 OAuth 自动回流；
- 系统代替用户发布视频；
- 数字人音频或视频生成；
- 模型自动确认记忆；
- 租户数据训练或修改平台通用模板；
- 跨账号绝对播放量排名；
- Redis、外部消息队列、多实例调度和对象存储；
- 预测爆款、承诺增长或把相关性表述为因果。

## 4. 模块职责

### 4.1 `PublicationService`

负责发布记录的创建、补充、停用和读取。系统发布记录必须绑定当前账号可访问的 Run 与锁稿版本；外部发布记录不伪造 Run 或锁稿谱系。

公开接口：

```ts
type RecordSystemPublicationInput = {
  runId: string
  lockedVersion: number
  contentAccountId: string
  platformVideoId?: string
  videoUrl?: string
  publishedAt: string
}

type CreateExternalPublicationInput = {
  contentAccountId: string
  platformVideoId?: string
  videoUrl?: string
  title: string
  publishedAt: string
}

recordSystem(context, input): Publication
createExternal(context, input): Publication
getByCurrentLock(context, runId, lockedVersion): Publication[]
```

系统发布回执要求 `platformVideoId` 或 `videoUrl` 至少存在一个。标题从锁稿读取，不能由客户端替换。外部发布记录允许使用作品 ID、链接或“唯一标题 + 发布时间”建立，但必须标记 `source=external`。

### 4.2 `MetricImportService`

负责文件限制、解析、表头归一化、行级校验、批次持久化、快照去重和结果摘要。上传文件处理结束后删除，不保存原文件字节。

公开接口：

```ts
type MetricImportInput = {
  contentAccountId: string
  filename: string
  mimeType: string
  bytes: Uint8Array
}

import(context, input): Promise<MetricImportResult>
getBatch(context, batchId): MetricImportBatchView
```

限制为单文件 10 MB、最多 10,000 行，只接受 `.csv`、`.xlsx`。超过限制分别返回 `FILE_TOO_LARGE`、`ROW_LIMIT_EXCEEDED` 或 `FILE_TYPE_UNSUPPORTED`。

### 4.3 `PublicationMatcher`

负责纯确定性匹配和人工确认，不调用模型。匹配结果独立持久化并保留历史。

匹配优先级：

1. 同账号、同平台下 `platformVideoId` 完全一致；
2. 同账号、同平台下规范化 `videoUrl` 完全一致；
3. 同账号、同平台下规范化标题完全一致，发布时间前后 7 天内只有一个候选；
4. 标题或可用正文的相似候选，只进入 `candidate`；
5. 其余进入 `unmatched`。

URL 规范化只移除明确的跟踪参数、统一主机大小写和末尾斜杠，不擅自展开无法验证的短链。相似度不进入自动匹配条件。

公开接口：

```ts
matchBatch(context, batchId): MatchBatchResult
confirmCandidate(context, matchId, publicationId): PublicationMatch
rejectCandidateAndCreateExternal(context, matchId): PublicationMatch
```

### 4.4 `ReviewService`

先由确定性代码计算同账号基线、样本层级和证据集合，再调用现有 provider-neutral LLM 生成结构化复盘。模型不能选择未提供的证据 ID，也不能改变指标或匹配关系。

公开接口：

```ts
generateCurrent(context, contentAccountId): Promise<ContentReviewVersion>
getCurrent(context, contentAccountId): ContentReviewVersion | null
getHistory(context, contentAccountId): ContentReviewVersion[]
```

### 4.5 `TenantMemoryService`

负责确认复盘、保存不可变记忆版本和读取当前有效版本。确认输入只允许编辑公开结论，不接收或保存模型思维链。

公开接口：

```ts
type ConfirmMemoryInput = {
  reviewId: string
  keep: string[]
  avoid: string[]
  nextContentSignals: string[]
}

confirm(context, input): TenantMemoryVersion
getCurrent(tenantId, ipId, contentAccountId): TenantMemoryVersion | null
```

### 4.6 `CreationContextProvider`

负责在创建 Run 之前读取当前账号最新的已确认记忆，并返回经过最小化处理的上下文：

```ts
type ConfirmedCreationMemory = {
  version: number
  keep: string[]
  avoid: string[]
  nextContentSignals: string[]
}
```

不向创作模型传递原始指标、员工身份、完整复盘历史、未确认推测或平台运营数据。Run 创建时保存实际使用的 `tenantMemoryVersion`；历史 Run 不随新记忆变化。

## 5. 数据模型与谱系

核心关系：

`LockedScript 1 → N Publication 1 → N MetricSnapshot N → M ReviewVersion → N TenantMemoryVersion`

### 5.1 `publications`

关键字段：

- `id`
- `tenant_id`
- `ip_profile_id`
- `content_account_id`
- `platform`
- `source`: `system | external`
- `run_id`: 系统来源必填，外部来源为空
- `locked_script_version`: 系统来源必填
- `locked_script_selection_version`: 系统来源必填
- `title`
- `platform_video_id`
- `video_url`
- `normalized_video_url`
- `published_at`
- `status`: `active | disabled`
- `created_by_user_id`
- `created_at`

同一锁稿可以产生多条发布记录。作品 ID 在 `(tenant_id, content_account_id, platform, platform_video_id)` 范围内唯一；规范化链接存在时使用同范围唯一索引。

### 5.2 `metric_import_batches`

保存批次 ID、租户/IP/账号、文件名、文件 SHA-256、状态、总行数、有效数、重复数、错误数、未匹配数、操作者和时间。状态为 `processing | parsed | matched | review_ready | completed | failed`。

相同账号、相同文件哈希重复上传时返回已存在批次，不重新创建快照。

### 5.3 `metric_import_row_errors`

保存批次、行号、稳定错误码、用户可读信息和经过脱敏的行引用。不得保存整份文件，也不得把其他账号标识返回给当前用户。

### 5.4 `real_metric_snapshots`

指标快照不可覆盖。关键字段：

- `platform_content_key`: 作品 ID、规范化链接或受控的外部行键；
- `captured_at`: 平台导出时间或文件明确的采集时间；
- `published_at`
- `plays`, `impressions`, `completions`
- `completion_rate`
- `likes`, `comments`, `saves`, `shares`, `inquiries`
- `negative_feedback`
- `is_simulated`: 真实服务只能为 `0`
- `source_batch_id`

唯一键为 `(tenant_id, content_account_id, platform_content_key, captured_at)`。再次导入同一视频的新采集时间会产生新快照；横向复盘取截止时间内每条视频的最新快照，纵向趋势保留全部快照。

### 5.5 `publication_match_versions`

匹配采用追加版本而非覆盖。字段包含快照、候选发布记录、方法、状态、分数说明、是否当前、确认人和确认时间。

方法为：

- `exact_video_id`
- `exact_url`
- `exact_title_time`
- `similarity_candidate`
- `manual_existing`
- `manual_external_created`

状态为 `matched | candidate | unmatched | rejected`。任何人工变化写入 `audit_logs`。

### 5.6 `content_review_versions` 与 `review_evidence_links`

复盘版本保存：

- 作用域和版本；
- `sample_tier`: `facts_only | tentative | memory_eligible`；
- 指标截止时间；
- 当前匹配集合与最新快照集合的哈希；
- 结构化复盘 JSON；
- 模型、Prompt 版本和 token 使用；
- 状态 `generated | superseded | confirmed`；
- 创建时间。

证据链接单独记录复盘、发布记录、指标快照和证据用途。新数据或匹配变化导致集合哈希变化时，未确认的旧复盘标记 `superseded`，不能直接确认。

### 5.7 `tenant_memory_versions`

沿用现有表并增量增加 `source_review_id`、`content_hash` 和 `schema_version`。Payload 固定为：

```ts
{
  keep: string[]
  avoid: string[]
  nextContentSignals: string[]
  evidenceLimits: string
}
```

同一租户/IP/账号的版本单调递增，不允许更新或删除历史正式版本。

### 5.8 `creation_run_context`

增量增加 `tenant_memory_version`。创建 Run 时一次写入；没有确认记忆时为 `NULL`。不得在 Run 完成后回填更新。

### 5.9 兼容迁移

新增迁移从版本 7 开始，不删除现有 `imported_content_metrics` 和 `tenant_memory_versions`。现有演示指标可按账号建立 `external` 发布记录并迁入快照表；无法形成可靠平台内容键的数据保留为历史兼容数据，不参与新复盘。迁移重复执行必须幂等。

## 6. 文件导入契约

接受以下字段和中文/英文别名：

| 标准字段 | 接受示例 |
|---|---|
| `platform_video_id` | 平台作品ID、作品ID、视频ID |
| `video_url` | 视频链接、作品链接、URL |
| `title` | 标题、视频标题、作品标题 |
| `published_at` | 发布时间、发布日期 |
| `captured_at` | 采集时间、导出时间、统计时间 |
| `plays` | 播放量、播放 |
| `completion_rate` | 完播率、播放完成率 |
| `impressions` | 曝光量、展示量 |
| `likes` | 点赞、点赞量 |
| `comments` | 评论、评论量 |
| `saves` | 收藏、收藏量 |
| `shares` | 转发、分享量 |
| `inquiries` | 咨询、线索量 |
| `negative_feedback` | 负反馈、不感兴趣 |

每行必须包含标题，并满足以下身份条件之一：提供作品 ID；提供视频链接；或在历史数据场景下同时提供标题与发布时间。仅有标题与发布时间的数据可以进入候选处理，但不得自动匹配；该类数据的 `platform_content_key` 由 `platform + accountId + normalizedTitle + publishedAt` 生成稳定哈希，用于批次内去重和重复导入幂等，不作为自动匹配依据。计数必须为非负整数；比率接受 `0.35` 或 `35%` 并归一化为 `0.35`；时间统一保存为 UTC ISO 字符串并保留原时区解释。

## 7. 自动复盘与模型契约

### 7.1 样本门槛

- 0–2 条已匹配视频：`facts_only`，只展示单条指标事实，不调用趋势总结模型，不可确认记忆；
- 3–4 条：`tentative`，允许生成暂定复盘，必须标注样本较少，不可确认长期记忆；
- 5 条及以上：`memory_eligible`，生成完整复盘，可由有权限的人确认。

样本数按“已匹配的独立发布视频”计算，不按快照行数计算。

### 7.2 同账号相对基线

确定性代码按当前账号和兼容内容类型计算中位数、分位区间、样本量和缺失字段。不同账号之间不比较绝对播放量。没有曝光量时不伪造曝光转化率；没有时长或观看秒数时不推断完播原因。

### 7.3 模型输入

新增 `real_review` 操作，输入只包含：

- 当前 IP 的公开表达边界；
- 当前账号的相对基线；
- 匿名化发布记录引用；
- 允许引用的指标快照 ID 和确定性指标；
- 样本层级；
- “不得声称因果、不得编造缺失指标”的硬约束。

### 7.4 模型输出

```ts
type RealContentReview = {
  headline: string
  observations: Array<{
    text: string
    evidenceSnapshotIds: string[]
  }>
  hypotheses: Array<{
    text: string
    confidence: "low" | "medium"
    evidenceFor: string[]
    evidenceAgainst: string[]
  }>
  keep: string[]
  avoid: string[]
  nextContentSignals: string[]
  evidenceLimits: string
}
```

服务端校验所有证据 ID 必须来自输入集合，`hypotheses.confidence` 不允许 `certain`。结构修复失败沿用现有一次 Repair 机制；仍失败则保存 `MODEL_SCHEMA_INVALID`，允许单独重试。

## 8. 应用流程

### 8.1 系统锁稿发布回执

1. 用户定稿后继续看到完整口播稿；
2. 文稿末尾出现“这条视频已经发布了吗？”轻量入口；
3. 点击后补充作品 ID 或链接，发布时间默认当前时间并可修改；
4. 服务端从锁稿读取标题和谱系，验证当前账号、IP、Run 和锁稿版本；
5. 记录完成后入口折叠为平台、发布时间和“已关联发布”的一行状态；
6. 同一锁稿发布到其他账号时可新增记录，不覆盖已有发布。

“复制并去拍”不强制打开发布表单，也不自动假设用户已发布。

### 8.2 导入与匹配

1. 用户在复盘页选择当前账号并上传 CSV/XLSX；
2. 服务端先校验权限和文件限制，再读取文件；
3. 批次创建后逐行保存有效快照、重复和错误；
4. 匹配器处理有效快照并保存精确匹配、候选和未匹配状态；
5. 页面先显示“已处理多少、已关联多少、多少需要确认”；
6. 只展开候选项，用户可确认已有发布记录或建立外部发布记录；
7. 已匹配样本立即进入自动复盘，候选处理不阻断它。

### 8.3 自动复盘与确认

导入请求完成后，客户端自动请求当前复盘。服务端检测当前匹配/快照集合是否已有同哈希复盘：有则复用，没有则创建复盘检查点并同步执行一次模型调用。页面关闭或调用失败时，重新进入复盘页可根据检查点重试，不要求重新上传。

复盘页先展示一句账号级结论，然后分为“能确定什么”“比较可能但不能确定”“不能推断什么”和“下一轮建议”。右侧展示将写入的 `keep`、`avoid`、`nextContentSignals` 以及作用范围。

只有 `memory_eligible` 且未失效的复盘显示“确认并用于后续创作”。确认操作再次校验当前快照集合哈希，防止用户确认过期结论。

### 8.4 下一次创作

进入今日创作时，系统读取当前账号最新确认记忆并自动参与选题、结构排序和口播稿生成。结果页轻量展示：

`已参考上次确认的复盘：保留真实邻里场景，开头更快进入冲突 · 记忆 v1`

创作依据区显示记忆版本、确认日期和影响摘要。用户不需要选择记忆、设置权重或确认是否使用。

## 9. UI 冻结稿

### 9.1 发布回执：A 方案

- 位置在已锁稿正文末尾，不放在右侧常驻工作区；
- 未记录时是一条轻量提问和“记录已发布”；
- 已记录时折叠为一行发布状态；
- 不改变“复制并去拍”“确认定稿”“换选题”“换讲法”的层级。

### 9.2 导入匹配：A 方案

- 首屏标题直接说明已处理、已关联和待确认数量；
- 有效数据自动继续复盘；
- 只展开真正需要人工确认的候选；
- 重复、错误和文件处理说明作为次级信息；
- 不建设批次表格、筛选器或数据管理仪表盘。

### 9.3 复盘与记忆：A 方案

- 主体是结论、证据、推测和边界，不是指标卡；
- 右侧预览确认后写入的私有记忆；
- 明确显示影响范围为当前团队/IP/账号；
- 不展示模型思维链；
- 不允许未达到样本门槛的复盘确认记忆。

### 9.4 记忆回流：A 方案

- 记忆自动生效；
- 结果页只轻量显示使用版本和产生的影响；
- 创作依据可追溯到确认复盘；
- 不增加记忆选择器、权重配置、开关或生成前表单。

## 10. 权限与租户隔离

新增两个业务能力：

- `publication.record`：记录当前授权账号的发布回执；
- `review.confirm`：确认复盘并写入私有创作记忆。

沿用现有能力：

- `metrics.import`：上传指标文件、处理候选匹配和建立外部发布记录；
- `review.generate`：生成或重试复盘；
- `review.view`：查看当前授权账号的复盘和历史。

默认角色：

- Owner 拥有全部能力；
- Operator 默认拥有 `publication.record`，并继续拥有内容创作和编辑能力；
- Reviewer 默认拥有 `metrics.import`、`review.generate`、`review.view`，默认没有 `review.confirm`；
- 团长可显式把 `review.confirm` 授予指定员工；
- 平台账号不能满足任何租户数据能力。

所有服务在查询资源前验证 `tenantId + ipId + contentAccountId` 范围。越权时返回通用 403 或 404，不泄露资源是否存在。人工匹配、外部发布创建、复盘确认和记忆确认均写入审计日志。

## 11. API 契约

### 11.1 发布记录

- `POST /api/app/publications`
- `GET /api/app/publications?runId={id}&lockedVersion={n}`

请求体使用 Zod 严格校验，未知字段拒绝。冲突返回 `PUBLICATION_ID_CONFLICT` 或 `PUBLICATION_URL_CONFLICT`。

### 11.2 指标导入与匹配

- `POST /api/app/metrics/imports`：`multipart/form-data`，返回批次摘要；
- `GET /api/app/metrics/imports/{batchId}`：返回授权范围内的批次结果；
- `POST /api/app/metrics/matches/{matchId}/confirm`：确认已有发布；
- `POST /api/app/metrics/matches/{matchId}/external`：建立外部发布并确认。

服务端在读取上传体之前完成会话、能力和账号范围验证。

### 11.3 复盘与记忆

- `GET /api/app/reviews/current?contentAccountId={id}`
- `POST /api/app/reviews/generate`
- `POST /api/app/reviews/{reviewId}/confirm`

确认冲突返回 `REVIEW_SUPERSEDED`；样本不足返回 `MEMORY_SAMPLE_INSUFFICIENT`；仅有模拟数据返回 `REAL_METRICS_REQUIRED`。

## 12. 幂等、并发与失败恢复

- 发布记录以账号、平台和作品 ID/规范化链接防重；相同请求返回已有记录；
- 导入批次以账号和文件 SHA-256 防重；
- 指标快照以账号、内容键和采集时间防重；
- 匹配确认使用 `expectedVersion`，过期操作返回 `MATCH_VERSION_CONFLICT`；
- 复盘以当前匹配/快照集合哈希防止重复模型调用；
- 记忆确认以复盘 ID 和内容哈希幂等；
- SQLite 使用 WAL、外键和合理 `busy_timeout`；写事务只包围本地持久化，不包围模型网络调用；
- 模型调用失败不回滚导入、快照或匹配，可从复盘检查点重试；
- 页面刷新后通过批次和复盘状态恢复，不依赖浏览器内存；
- 新导入或匹配变化会使未确认复盘失效，但不会修改已确认复盘或记忆；
- 已确认记忆不可更新，只能产生下一版本。

## 13. 单机部署与二期扩展

首版继续使用一个 Next.js Node 进程和一个 SQLite 持久盘。文件解析在请求内完成，单文件 10 MB 和 10,000 行限制可控制内存；复盘使用一次模型调用和一次 Repair 上限。页面用持久化状态表现为阶段性 Agent 任务，不依赖后台常驻 Worker。

二期接入平台 API 时复用 `MetricImportService` 的规范化输入和 `PublicationMatcher`，只增加新的数据源适配器。迁移到 PostgreSQL、队列或多实例时，模块接口、页面契约、幂等键和状态机保持不变。

## 14. 错误码与用户反馈

| 错误码 | 页面反馈 |
|---|---|
| `FILE_TOO_LARGE` | 文件超过 10 MB，请缩小范围后重试 |
| `ROW_LIMIT_EXCEEDED` | 文件超过 10,000 行，请拆分后导入 |
| `FILE_TYPE_UNSUPPORTED` | 仅支持 CSV 和 XLSX |
| `METRIC_HEADERS_INVALID` | 缺少必需列，并显示接受的表头 |
| `PUBLICATION_ID_CONFLICT` | 该作品 ID 已关联到当前账号的另一条发布记录 |
| `MATCH_VERSION_CONFLICT` | 匹配结果已更新，请刷新后再确认 |
| `REAL_METRICS_REQUIRED` | 当前只有开发模拟数据，不能生成正式复盘 |
| `MEMORY_SAMPLE_INSUFFICIENT` | 已匹配视频不足 5 条，暂不能形成长期记忆 |
| `REVIEW_SUPERSEDED` | 新数据已进入，请使用最新复盘确认 |
| `LLM_TIMEOUT` | 数据已保存，复盘暂未完成，可直接重试 |
| `MODEL_SCHEMA_INVALID` | 数据已保存，模型输出校验失败，可直接重试 |

所有错误都保留已完成数据，不要求用户从头开始。

## 15. 测试与验收

### 15.1 单元测试

- CSV/XLSX 中英文表头、百分比、时区、负数、缺失字段和行级错误；
- 文件大小、行数和扩展名限制；
- 发布记录一对多、系统/外部来源和冲突；
- 作品 ID、链接、唯一标题时间窗和相似候选的匹配顺序；
- 匹配版本冲突与人工审计；
- 快照追加、最新快照选择和重复导入；
- 0–2、3–4、5+ 三档样本门槛；
- 同账号相对基线和缺失指标处理；
- 模型证据 ID 白名单、推测置信度和因果边界；
- 复盘失效、确认幂等和不可变记忆版本；
- 创作只读取最新确认记忆并保存使用版本；
- 租户、IP、账号、能力和平台角色隔离。

### 15.2 组件测试

- 已锁稿正文末尾显示轻量发布回执；
- 回执失败保留输入，成功折叠为状态；
- 导入结果先显示完成结论，只展开候选；
- 有效数据自动触发复盘，异常不阻断；
- 不同样本层级对应正确按钮状态；
- 复盘页区分事实、推测和不能确定；
- 记忆预览准确，越权用户不显示确认操作；
- 下一次创作显示记忆版本但不出现配置控件。

### 15.3 端到端验收

1. Owner 定稿 v2，记录视频号作品 ID；
2. Reviewer 导入含有效、重复、错误和相似标题的 XLSX；
3. 精确匹配自动完成，相似标题等待确认，有效数据继续复盘；
4. 4 条样本只出现暂定复盘且不能确认记忆；
5. 补充到 5 条后生成可确认复盘；
6. Reviewer 无 `review.confirm` 时被拒绝；
7. Owner 确认并生成私有记忆 v1；
8. 下一次创作请求与 Run 谱系包含记忆 v1，页面显示其影响；
9. 其他账号、其他 IP 和平台运营账号不能读取该批次、复盘或记忆；
10. 生产配置无法导入或复盘模拟数据；
11. 刷新页面后批次、匹配、复盘和记忆状态保持一致；
12. 全量单元/组件测试、类型检查、生产构建和浏览器验收全部通过。

## 16. 完成定义

只有当一条真实视频指标能追溯到发布记录，复盘能追溯到确定的快照集合，确认记忆能追溯到复盘版本，下一次创作又能追溯到实际使用的记忆版本时，本阶段才算完成。

仅有“数据导入页面”“模型给出总结”或“数据库写入记忆”中的任何一项，都不构成内容增长闭环。
