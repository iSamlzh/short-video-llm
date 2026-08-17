# 真实内容闭环单机运维说明

## 1. 首版运行边界

首版只运行一个 Next.js Node 进程和一个 SQLite 数据库文件，建议基线为 4 核 CPU、8 GB 内存、80 GB SSD。这个配置面向“页面访问较轻、模型调用受上游并发限制、每月约 10,000 个内容任务”的首版内容闭环，并不代表能够在单机上同时执行 10,000 个模型请求。

首版不依赖 Redis、独立 Worker、对象存储、平台数据 API、PostgreSQL、负载均衡或多实例协调。平台数据 API、任务队列、PostgreSQL 和多实例负载均衡属于二期扩展接口。

单机方案提供进程自动拉起、持久化、备份和可恢复性基线，不等同于跨机器高可用。不得启动多个实例共同读写同一个 SQLite 文件。

## 2. 必需配置

```text
LLM_BASE_URL=https://模型服务地址/v1
LLM_API_KEY=仅通过密钥管理或环境变量注入
LLM_MODEL=生产模型名称
LLM_TIMEOUT_SECONDS=120
PROTOTYPE_DB_PATH=/srv/content-agent/data/prototype.sqlite
PROTOTYPE_DEMO_CONTROLS=false
PROTOTYPE_TEST_MODE=false
PLAYWRIGHT_TEST_MODE=false
PROTOTYPE_ALLOW_DEMO_CLEAR=false
```

生产环境必须明确保持三个测试/清理开关为 `false`。`.env.local`、模型密钥、数据库文件和备份文件不得提交到 Git。

## 3. 进程与目录

建议目录：

```text
/srv/content-agent/current/       应用发布目录
/srv/content-agent/data/          SQLite 持久化目录
/srv/content-agent/backups/       受控备份目录
/var/log/content-agent/           进程与反向代理日志
```

应用以非 root 用户运行。使用 systemd 或等价进程管理器保持一个实例，在异常退出后自动拉起。发布前先在独立构建目录执行 `npm ci`、`npm run build`、`npm test` 和 `npm run typecheck`，成功后再切换 `current` 指向，并重启唯一实例。

## 4. 反向代理与上传限制

应用自身限制真实指标文件为 10 MB、10,000 行。反向代理请求体上限应高于 10 MB 且低于 12 MB，推荐 Nginx 设置：

```nginx
client_max_body_size 11m;
proxy_connect_timeout 10s;
proxy_read_timeout 180s;
proxy_send_timeout 180s;
```

这样合法的 10 MB 文件可以到达应用并由应用返回稳定错误码，明显超限的请求会先被代理拒绝。生产域名必须启用 HTTPS、安全 Cookie 和可信代理头配置。

## 5. SQLite 运行要求

应用启动时启用以下数据库行为：

- `journal_mode=WAL`：读请求不会被普通写事务长期阻塞。
- `foreign_keys=ON`：发布、指标、复盘和记忆谱系保持引用完整。
- `busy_timeout=5000`：短暂写竞争最多等待 5 秒，避免立即失败。
- 版本化 Migration：每个版本只执行一次，启动失败时不得绕过迁移错误。

必须监控数据库目录可用空间、数据库文件与 WAL 文件增长、写入错误和 `SQLITE_BUSY` 次数。磁盘剩余空间低于 20% 时告警。

## 6. 每日备份与恢复验证

不要在进程运行时只复制主数据库文件，因为尚未合并的 WAL 可能导致备份不完整。使用 SQLite 在线备份 API 或 `sqlite3 .backup` 生成一致性备份，再进行压缩、加密和异地保存。建议保留 7 个每日版本和 4 个每周版本。

恢复验证步骤：

1. 在隔离目录恢复最近备份，禁止覆盖生产数据库。
2. 使用同版本应用只读启动或执行数据库完整性检查。
3. 核对最新发布、指标批次、复盘版本和记忆版本是否可读取。
4. 记录备份时间、恢复耗时、校验结果和操作人。

这是首版的数据安全基线；跨地域灾备、自动故障转移和季度灾备演练属于二期。

## 7. 日志与告警

日志可以记录请求 ID、Run ID、批次 ID、复盘版本、模型名称、耗时、Token 用量和稳定错误码。不得记录 LLM API Key、Session Cookie、完整上传文件、完整用户文稿或模型隐藏推理。

至少对以下情况告警：进程连续重启、5xx 比例异常、模型超时上升、SQLite 写入失败、备份失败、磁盘低水位和上传错误突然增加。

## 8. 扩容触发条件

出现以下任一情况时进入二期容量设计，而不是继续堆高单机配置：

- 模型任务需要可靠排队、取消、重试或跨进程执行；
- SQLite 写竞争持续出现，5 秒 Busy Timeout 仍频繁耗尽；
- 单机维护窗口已不能接受；
- 需要多个应用实例或跨机器故障转移；
- 平台 API 回流量要求异步消费、限流和重放。

二期迁移顺序建议为 PostgreSQL → 任务队列/Worker → 对象存储 → 多实例负载均衡；接口保持发布、导入、匹配、复盘和记忆模块职责不变。
