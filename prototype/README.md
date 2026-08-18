# 内容增长 Agent 首版

首版围绕一个清晰闭环：首次确认 IP → 后续默认载入当前 IP/账号 → Agent 一次完成选题、推荐文案与发布前检查 → 用户保存修改并确认定稿 → 复制后直接拍摄或回退调整 → 导入真实账号数据 → 复盘并确认本 IP 私有创作记忆。

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

样本支持直接粘贴，以及 `.txt`、`.srt`、`.vtt`、`.csv`、`.xlsx` 文件；单文件最大 5 MB。链接只作为来源记录，不会自动抓取网页、视频或音频。首版不处理 ASR，也不会自动启用 Agent 建议。

平台样本原文、证据引用、授权说明、来源关系和运营备注只存在于平台安全域。团长端最多收到所用结构版本号及“已结合平台审核通过的内容结构”说明，不能读取结构节点和平台内部资料。

## 模型调用

默认创作路径使用一次结构化模型调用同时返回 3–5 个选题、推荐方向、同方向 3 篇候选、推荐口播稿与质量报告；系统仍分别保存选题、文案、QA 和锁稿谱系。生成结果通过 QA 后处于“待确认”，不会自动锁稿。这样避免三次串行模型请求。若上游单次响应仍慢，页面显示可解释的 Agent 进度并复用当天已完成结果。

完成分段或整篇编辑会保存一个新的不可变文案版本，刷新页面不会丢失。旧 QA 不会套用到新版本；确认定稿时，未修改的生成稿复用已有 QA，修改稿只补做一次当前版本 QA，通过硬门槛后再锁稿。“复制并去拍”与“确认定稿”走同一服务端流程，只有定稿成功后才复制当前锁定版本。

必要环境变量：

```text
LLM_BASE_URL=https://example.com/v1
LLM_API_KEY=...
LLM_MODEL=...
LLM_TIMEOUT_SECONDS=120
PROTOTYPE_DB_PATH=.data/prototype.sqlite
```

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
- 进程：一个 Next.js Node 进程；前置 Nginx/Caddy 负责 HTTPS、压缩和请求体限制。
- 数据：首版固定使用单个 SQLite 文件，必须位于本机持久盘；不得让多个应用实例同时连接同一个 SQLite 文件。迁移由版本化 SQL 自动执行。
- 持久化：数据库目录必须挂载持久盘；使用 SQLite 在线备份能力执行每日备份，并定期做隔离恢复验证；`.env.local`/密钥不进入 Git。
- 观测：记录请求 ID、Run ID、模型耗时、错误码和 token 使用，不记录 API Key 或完整敏感正文。
- 容量策略：账号登录和页面读取成本低；内容生成受上游模型延迟和额度限制。超过单机验证规模后再引入 PostgreSQL、队列、对象存储与多实例负载均衡。

部署前至少执行 `npm ci && npm run build && npm test`，并在真实域名下验证登录 Cookie、HTTPS、上传大小和模型超时。

完整单机部署、反向代理、备份恢复与扩容边界见 [真实内容闭环单机运维说明](./docs/operations/real-growth-loop.md)。

## 文档

- 产品与系统详细设计：`../docs/superpowers/specs/2026-08-16-ai-native-team-content-agent-prototype-design.md`
- 首版实施路线：`../docs/superpowers/plans/2026-08-17-ai-native-team-content-agent-roadmap.md`
- UI 视觉规范：`../docs/ui/2026-08-17-ai-native-ui-visual-spec.md`
- 身份权限、内容库、创作、复盘的分模块实施计划均位于 `../docs/superpowers/plans/`。
