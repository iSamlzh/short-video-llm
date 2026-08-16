# 内容增长 Agent 快速原型

这是一个本地运行的纵向原型，用来验证“首次 IP 初始化或载入当前 IP → 选题方向 → 自动生成同方向 3 篇口播稿 → 独立 QA → 锁稿 → 模拟表现 → 模型复盘”的内容闭环。它不是正式首版系统，也不包含登录、租户、角色权限、平台 API、数字人视频或生产级队列。

## 本地启动

前置条件：Node.js 20+、npm 10+，以及一个兼容 OpenAI `/chat/completions` 的模型服务。原型当前使用已通过审计的 Next.js 16.3.1。

```powershell
Copy-Item .env.example .env.local
# 在 .env.local 填写 LLM_BASE_URL、LLM_API_KEY、LLM_MODEL
npm install
npm run dev
```

从仓库根目录也可以使用：

```powershell
npm --prefix prototype install
npm --prefix prototype run dev
```

打开 `http://localhost:3000`。模型未配置或调用失败时，界面会明确阻断并保留当前检查点，不会用静态数据冒充真实结果。

## 验证

```powershell
npm run typecheck
npm test
npm run test:e2e
npm run build
npm run test:live
```

- 单元测试使用显式 Fake Adapter。
- E2E 只有 Playwright 同时设置 `PROTOTYPE_TEST_MODE` 与 `PLAYWRIGHT_TEST_MODE` 时才启用固定模型；普通 `npm run dev` 不会启用。
- `test:live` 使用真实模型执行四个业务 operation；缺少环境变量时以退出码 `2` 明确跳过，不输出正文或密钥。

Windows 首次运行 E2E 需安装测试浏览器：

```powershell
npx playwright install chromium
```

## 数据与重置

默认数据库为 `.data/prototype.sqlite`，刷新页面会从 SQLite 恢复当前 Run。浏览器使用 `content-prototype-current-ip-v1` 记录原型当前 IP；清除当前 Run 后再次进入，会默认使用该 IP 创建当天内容，不重复建档。需要彻底重置时，停止开发服务器后删除原型数据库，并清除浏览器站点数据；其中不存 API Key。

所有发布指标均由确定性模拟器生成，页面固定显示：**模拟数据，不代表真实平台表现**。复盘 Prompt 和服务端校验都禁止把这些指标表述为真实平台因果。

## 演示顺序

1. 首次使用填写六项最小 IP 信息；后续默认载入当前 IP。
2. Agent 自动生成 3–5 个符合当前 IP 属性的方向。
3. 用户只选择一个“今天拍什么”的方向，系统立即生成该方向下恰好 3 篇完整口播稿，不再要求点击“生成文案”。
4. 用户选择一篇口播稿后自动运行独立 QA；硬门禁通过后锁稿。
5. 生成带完整模拟标识的发布表现，再由真实模型复盘。

## 原型边界

可供正式系统评审复用的候选资产：Zod Schema、四类 Prompt、六个抽象结构、决策卡交互、模型兼容经验和 E2E 路径。

必须丢弃或重新实现的原型资产：Next Route Handler、SQLite schema/repository、简化状态机、测试 Fixture LLM、模拟指标以及基于模拟指标产生的复盘内容。正式系统不得直接 import 原型模块。
