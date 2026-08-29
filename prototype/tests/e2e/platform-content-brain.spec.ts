import { expect, test } from "@playwright/test"

async function login(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login")
  await page.getByLabel("邮箱").fill(email)
  await page.getByLabel("密码").fill("demo-password")
  await page.getByRole("button", { name: "进入内容工作台" }).click()
  await page.waitForURL(email.startsWith("platform") ? "**/platform/content-brain" : "**/app/today")
}

test("平台拆解启用的新结构进入团长创作且不泄露内部内容", async ({ page }) => {
  await login(page, "platform@example.test")
  await expect(page.getByText("平台管理员")).toBeVisible()

  await page.getByRole("button", { name: "新增爆款样本" }).click()
  await page.getByLabel("样本标题").fill("一次退款让我重新理解长期信任")
  await page.getByLabel("来源平台").selectOption("douyin")
  await page.getByLabel("口播原文").fill("有位邻居收到商品后发现不合适，我没有先解释，而是当天核对订单并完成退款。之后我把同类商品的介绍重新检查了一遍。做长期生意不是证明自己没有错，而是问题出现时把责任和处理动作说清楚。")
  await page.getByLabel("授权说明").fill("已获得内部拆解和结构研究授权")
  await page.getByRole("button", { name: "保存并开始拆解" }).click()

  await expect(page.getByRole("heading", { name: "Agent 拆解结论" })).toBeVisible({ timeout: 20_000 })
  await page.getByLabel("拆解摘要").fill("退款冲突进入，处理动作建立可信度，最终收束到长期责任原则。")
  await page.getByRole("button", { name: "通过拆解并判断结构" }).click()

  await expect(page.getByText("拟议结构")).toBeVisible({ timeout: 20_000 })
  await page.getByRole("button", { name: "试生成" }).click()
  await expect(page.getByRole("heading", { name: "这份结构如何生成口播稿" })).toBeVisible({ timeout: 20_000 })
  await page.getByRole("button", { name: "启用这个结构" }).click()
  await expect(page.getByRole("dialog", { name: "确认启用结构版本" })).toBeVisible()
  await page.getByLabel("启用原因").fill("试生成结构完整，事实与风险检查通过")
  const activationResponse = page.waitForResponse((response) => response.url().includes("/api/platform/content-brain/candidates/") && response.url().endsWith("/activate") && response.request().method() === "POST")
  await page.getByRole("button", { name: "确认启用", exact: true }).click()
  const activated = await (await activationResponse).json() as { id: string }
  expect(activated.id).toBeTruthy()

  await page.getByRole("button", { name: "结构进化" }).click()
  await expect(page.getByRole("heading", { name: "结构进化" })).toBeVisible()
  await expect(page.getByText("租户原稿与身份不进入平台证据")).toBeVisible()
  await expect(page.getByText("当前结构还没有评估版本")).toBeVisible()

  await page.getByRole("button", { name: "退出登录" }).click()
  await expect(page).toHaveURL(/\/login$/)
  await login(page, "owner@example.test")
  const creationResult = await page.evaluate(async () => {
    const operationKey = crypto.randomUUID()
    const currentResponse = await fetch("/api/app/creation/current")
    const current = currentResponse.status === 204 ? null : await currentResponse.json()
    const topicResponse = await fetch("/api/app/creation/topics", {
      method: "POST", headers: { "content-type": "application/json", "idempotency-key": `${operationKey}:topics` },
      body: JSON.stringify(current?.runId
        ? { intent: "change_expression", fromRunId: current.runId }
        : { intent: "initial" }),
    })
    const pool = await topicResponse.json()
    if (!topicResponse.ok) return { ok: false, payload: pool }
    const response = await fetch("/api/app/creation/scripts", {
      method: "POST", headers: { "content-type": "application/json", "idempotency-key": `${operationKey}:script` },
      body: JSON.stringify({
        runId: pool.runId, topicId: pool.recommendedTopicId,
        intent: current?.runId ? "change_expression" : "initial",
        ...(current?.runId ? { fromRunId: current.runId } : {}),
      }),
    })
    return { ok: response.ok, payload: await response.json() }
  })
  const creation = creationResult.payload as { structureVersionIds: string[] }
  expect(creationResult.ok, JSON.stringify(creation)).toBe(true)
  const serialized = JSON.stringify(creation)

  expect(creation.structureVersionIds).toContain(activated.id)
  expect(serialized).not.toMatch(/sourceText|evidenceRefs|rightsNote|operatorNote|nodes|qualityRules|riskRules/)

  await page.goto("/platform/content-brain")
  await expect(page.getByText("无权访问平台运营空间")).toBeVisible()
})
