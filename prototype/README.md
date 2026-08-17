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
- `platform@example.test`：平台内容运营

演示种子只写入 `data_origin=demo` 数据。需要一次性移除时，临时设置 `PROTOTYPE_ALLOW_DEMO_CLEAR=true` 后执行 `npm run seed:demo:clear`；脚本会同时清理演示租户关联的创作、发布、指标、复盘与记忆数据，其他正式用户和正式租户不受影响。生产环境不得启用演示清理开关、共享默认账号或任何测试 Fixture。

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

验收矩阵覆盖单元/组件测试、生产构建、创作闭环和真实发布—复盘—记忆浏览器路径。端到端路径验证修改后刷新持久化、不可变锁稿、真实发布回执、五条真实指标匹配、权限隔离、复盘确认、下一次创作引用精确记忆版本，以及 390 px 移动端无横向溢出。固定模型和 E2E 真实形态 Fixture 只有在 `PROTOTYPE_TEST_MODE=true` 且 `PLAYWRIGHT_TEST_MODE=true` 同时成立时启用，普通运行始终调用配置的真实模型。

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
