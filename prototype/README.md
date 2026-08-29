# 内容增长 Agent 首版

首版围绕一个清晰闭环：首次确认 IP → 后续默认载入当前 IP/账号 → Agent 先生成选题池、再为用户确认的一个选题生成一篇口播稿 → 用户人工核对事实与表达边界并确认定稿 → 下载后直接拍摄或回退调整 → 导入真实账号数据 → 复盘并确认本 IP 私有创作记忆。

团长端支持多人独立登录和精确到 IP/内容账号的权限；平台运营端维护内部爆款内容结构。租户用户不会看到平台样本原文、完整模板或运营备注。数字人视频生成、平台数据 API、负载均衡和灾备属于后续版本。

## 本地启动

前置条件：Node.js 20+、npm 10+，以及兼容 OpenAI `/chat/completions` 的模型服务。

```powershell
Copy-Item .env.example .env.local
# 填写 LLM_BASE_URL、LLM_API_KEY、LLM_MODEL
npm install
npm run seed:demo
npm run dev
```

打开 `http://127.0.0.1:3000/login`。开发账号密码默认为 `demo-password`：

- `owner@example.test`：团长/所有者
- `operator@example.test`：内容运营
- `reviewer@example.test`：数据复盘
- `platform@example.test`：平台管理员，可验收拆解、试生成和人工启用完整闭环

演示种子只写入 `data_origin=demo` 数据，并提供 3 条样本、3 份已复核拆解、1 个待启用候选、1 次试生成和 3 个已启用结构。重复执行不会增加重复版本。需要一次性移除时，临时设置 `PROTOTYPE_ALLOW_DEMO_CLEAR=true` 后执行 `npm run seed:demo:clear`；脚本会同时清理演示租户关联的创作、发布、指标、复盘、记忆和平台内容资产，其他正式用户、正式样本和正式结构不受影响。

正式环境不得执行 `npm run seed:demo`，不得启用演示清理开关、共享默认账号或开启任何测试 Fixture。正式平台管理员必须由后台身份授权产生。

## 平台爆款拆解闭环

平台入口是 `http://127.0.0.1:3000/platform/content-brain`。平台管理员按照以下顺序工作：

1. 新增已授权的爆款样本；
2. Agent 拆解结构节点、证据、不可复用事实和风险边界；
3. 运营人员修改并人工通过拆解；
4. Agent 建议归入、升级或新建结构；
5. 使用固定模拟 IP 试生成，不写入任何团长数据；
6. 平台管理员确认启用，系统保存不可变结构版本和审计记录；
7. 团长下一次创作只检索已启用的脱敏结构，并在创作谱系锁定实际版本。

样本拆解采用持久化 Agent 任务：提交后接口立即返回任务编号，Web 页面按真实阶段轮询；独立 Worker 在后台执行，用户刷新或离开页面不会终止任务。批量导入时每条样本独立排队并显示整批完成数，默认最多并行处理 2 条。模型超时、限流、结构校验失败会自动重试一次，最终失败保留错误标识并允许人工重新拆解。任务只保存样本和拆解结果引用，不复制样本正文或模型完整输出。

样本支持直接粘贴，以及 `.txt`、`.srt`、`.vtt`、`.csv`、`.xlsx` 文件；单文件最大 5 MB。链接只作为来源记录，不会自动抓取网页、视频或音频。首版不处理 ASR，也不会自动启用 Agent 建议。

平台样本原文、证据引用、授权说明、来源关系和运营备注只存在于平台安全域。团长端最多收到所用结构版本号及“已结合平台审核通过的内容结构”说明，不能读取结构节点和平台内部资料。

## 模型调用

默认创作路径先用一次结构化模型调用生成 3–5 个选题方向；用户采用推荐选题或选择其他方向后，再用一个独立请求只生成该选题的一篇口播稿。自动直出模式仍遵守“选题请求 + 单篇文稿请求”的边界，不会在一个大请求中生成多个方向的多篇文稿。生成结果处于“待确认”，不会自动锁稿；页面显示可解释的 Agent 进度，并复用当天已经完成的选题池或文稿结果。

完成分段或整篇编辑会保存一个新的不可变文案版本，刷新页面不会丢失。首版不在正式创作链路调用自动 QA，也不以模型评分阻断定稿；用户须根据页面提示人工确认事实、表达边界和可拍性后锁定当前版本。下载仅导出锁定版本，复制文本是定稿后的弱化辅助操作。

环境变量的唯一完整定义位于 [`.env.example`](./.env.example)。本地至少要填写 `LLM_BASE_URL`、`LLM_API_KEY` 和 `LLM_MODEL`；超时、模型并发、租户额度、数据库、健康检查、初始化和调试开关都从同一文件复制后按环境修改。生产安全组合由 `src/lib/runtime-environment-validation.ts` 强制校验，功能开关以 `src/lib/runtime-features.ts` 为准，文档不维护第二套变量默认值。

`LLM_TIMEOUT_SECONDS` 是一次业务操作（含一次结构修复）的总时间预算。模型任务不在内存中排队：超过全局或租户并发、日任务数或日 Token 限额时，会返回明确错误，由用户决定是否重试。浏览器发起的创作请求携带幂等键，同一请求不会重复调用模型。

### 生产环境首次初始化

生产库不执行 Demo Seed。设置 `APP_ENV=production`、正式数据库路径以及 `.env.example` 中的 `INIT_*` 变量后，执行：

```bash
npm run init:production
```

该命令一次性创建平台管理员、首个租户和租户 Owner；如果数据库存在演示用户或已经存在正式用户，会拒绝执行，不覆盖已有账号。密码通过环境变量或进程级安全注入提供，不应直接写在命令参数中。

团长在“团队”页面直接创建下属账号并分配 IP、内容账号和操作能力。系统只展示一次临时密码；成员首次登录必须设置自己的新密码，修改后旧 Session 全部失效。停用成员或重置密码同样会撤销其现有 Session。

### IP 与内容账号管理

拥有 `ip.manage` 能力的团长可从工作台 IP 切换器进入 `/app/settings/ip`：

- 校准 IP 名称、经历、擅长领域、受众、表达方式和内容边界；
- 每次画像调整生成不可变的新版本，历史 Run 继续使用创建时的画像快照与版本号；
- 归档和恢复 IP，不物理删除历史内容引用；
- 为同一 IP 新增视频号、抖音、小红书、快手或其他平台账号；
- 修改账号名称、设置默认账号、停用和恢复账号；
- 当前 IP 或账号被归档时，系统只在该成员授权范围内选择替代工作上下文。

### 历史内容中心

工作台主导航“内容记录”进入 `/app/content`。默认读取当前 IP 与账号，支持按 IP、账号、日期、阶段和标题筛选：

- 查看创建时的 IP 画像版本、平台结构版本和已确认私有记忆版本；
- 查看不可变文稿修订与对应定稿版本；
- 下载历史定稿 DOCX，正文复制作为弱化辅助操作；
- 查看发布登记、最新真实指标和对应复盘结论；
- 以历史选题和文稿为参考新建一条创作 Run，不覆盖原记录；
- 成员只能读取其持久授权范围，IP 或账号归档不会删除历史记录。

### 单机生产部署与数据保护

首版采用一个 Next.js Web 进程、一个内容拆解 Worker、systemd、Nginx 和 SQLite Online Backup。两类进程部署在同一台服务器，使用 WAL、短事务和数据库原子认领任务；不启动第二个 Web 实例。代码库提供存活/就绪接口、Agent 任务心跳、全 API 结构化请求日志、跨 Nginx/API/模型任务的 `requestId`、正常日志 14 天与异常日志 90 天轮转策略、HTTPS 反向代理、部署脚本、每日/每周备份保留策略及禁止覆盖生产库的隔离恢复工具。

完整操作步骤见 [`docs/首版单机生产部署与数据保护手册.md`](./docs/首版单机生产部署与数据保护手册.md)。生产环境不得直接复制运行中的 SQLite 主文件，不得启动多个应用进程共同写库。

## 首版功能

- 本地身份与会话、租户隔离、成员能力和 IP/账号数据范围。
- IP 首次确认和当前 IP/账号持久化；日常不重复选择。
- 结果优先的每日创作，可持久化分段/整篇编辑、换选题/讲法、按版本确认定稿、复制当前锁稿和查看其他选题。
- 平台私有内容库只检索已启用的不可变结构版本；无启用结构时阻断生成。
- CSV/XLSX 真实数据导入、格式校验、行级容错、确定性发布匹配、租户内去重和证据边界复盘。
- 用户确认后形成租户/IP/账号私有记忆，不回写平台爆款模板。
- 自然语言分工确认后，按当前 IP/账号写入最小权限并记录审计日志。

## 新 IP 首次建档

租户用户没有当前 IP 或内容账号时，登录后会进入 `/app/setup/ip`，而不是直接生成固定示例内容。用户先填写 IP 名称和主要发布平台，主动选择行业，再逐题回答 8—10 个与内容产出有关的问题；系统保存每一题，页面刷新或重新登录后会从未完成的问题继续。答案复核后只调用一次画像生成，画像有误时必须回到它所依据的原回答修改，确认后才建立当前 IP、内容账号并进入今日首稿。

问题库源文件位于 `src/ip-question-bank/sets/`，选择和覆盖逻辑位于 `src/services/ip-question-selector.ts`。客户端接口只返回当前问题和已答摘要，不返回完整内部问题库。

运行问题库及建档静态测试：

```powershell
npm test -- tests/unit/ip-question-bank-schema.test.ts tests/unit/ip-question-bank-content.test.ts tests/unit/ip-question-selector.test.ts tests/unit/ip-onboarding-session-service.test.ts
```

运行首次建档、刷新恢复、画像失败重试和首稿闭环浏览器验收：

```powershell
npm run build
npm run test:e2e -- tests/e2e/content-loop.spec.ts tests/e2e/ip-onboarding-recovery.spec.ts
```

新增问题库版本时，新建版本化题集并在 `src/ip-question-bank/index.ts` 显式注册；保持问题 ID 全局唯一、每个行业至少 30 道启用问题，并先通过静态校验和选择器测试。已有会话继续绑定创建时的 `questionSetVersion`，不得直接修改旧版本使进行中的建档失去可恢复性。

推荐导入表头（中英文别名均可，至少提供标题，并通过作品 ID、视频链接或标题 + 发布时间建立身份）：

```text
platform_video_id,video_url,title,published_at,captured_at,impressions,plays,completions,completion_rate,likes,comments,saves,shares,inquiries,negative_feedback
```

单文件仅接受 `.csv` 或 `.xlsx`，最大 10 MB、10,000 条数据。原始上传字节只在请求内使用，系统持久化不可变指标快照、批次摘要和脱敏行错误，不保存原文件。

平台 API 自动回流是二期能力，首版以导入为主。

## 验证

```powershell
npm run typecheck
npm test
npm run build
npm run test:e2e
```

验收矩阵覆盖单元/组件测试、生产构建、平台爆款拆解闭环、团长创作闭环和真实发布—复盘—记忆浏览器路径。端到端路径验证样本新增、人工复核、试生成、人工启用、创作结构版本锁定、平台资料不泄露、修改后刷新持久化、不可变锁稿、真实发布回执、五条真实指标匹配、权限隔离、复盘确认、下一次创作引用精确记忆版本，以及 390 px 移动端无横向溢出。固定模型和 E2E 真实形态 Fixture 只有在 `PROTOTYPE_TEST_MODE=true` 且 `PLAYWRIGHT_TEST_MODE=true` 同时成立时启用，普通运行始终调用配置的真实模型。

视觉验收报告见 [design-qa.md](./design-qa.md)。

## 首版部署

首版采用单台部署，避免过早引入负载均衡：

- 推荐：4 核 CPU、8 GB 内存、80 GB SSD、Linux、Node.js LTS。
- 进程：一个 Next.js Web 进程和一个内容拆解 Worker；前置 Nginx/Caddy 负责 HTTPS、压缩和请求体限制。不得启动多个 Web 或多个 Worker 实例。
- 数据：首版固定使用单个 SQLite 文件，必须位于本机持久盘；Web 与 Worker 通过 WAL、短事务和原子任务认领协作。迁移由版本化 SQL 自动执行，不允许跨服务器共享 SQLite 文件。
- 持久化：数据库目录必须挂载持久盘；使用 SQLite 在线备份能力执行每日备份，并定期做隔离恢复验证；`.env.local`/密钥不进入 Git。
- 观测：记录请求 ID、Run ID、模型耗时、错误码和 token 使用，不记录 API Key 或完整敏感正文。
- 容量策略：账号登录和页面读取成本低；内容生成受上游模型延迟和额度限制。超过单机验证规模后再引入 PostgreSQL、队列、对象存储与多实例负载均衡。

部署前至少执行 `npm ci && npm run build && npm test`，并在真实域名下验证登录 Cookie、HTTPS、上传大小和模型超时。

完整单机部署、反向代理、备份恢复与扩容边界见 [真实内容闭环单机运维说明](./docs/operations/real-growth-loop.md)。

## 文档

- 首版上线补齐实施计划：`./docs/首版上线补齐实施计划.md`
- 首版接口、权限与数据谱系：`./docs/首版接口权限与数据谱系说明.md`
- 首版单机生产部署与数据保护手册：`./docs/首版单机生产部署与数据保护手册.md`
- 首版发布验收与回退记录：`./docs/首版发布验收与回退记录.md`
- 产品与系统详细设计：`../docs/superpowers/specs/2026-08-16-ai-native-team-content-agent-prototype-design.md`
- 首版实施路线：`../docs/superpowers/plans/2026-08-17-ai-native-team-content-agent-roadmap.md`
- UI 视觉规范：`../docs/ui/2026-08-17-ai-native-ui-visual-spec.md`
- 身份权限、内容库、创作、复盘的分模块实施计划均位于 `../docs/superpowers/plans/`。
