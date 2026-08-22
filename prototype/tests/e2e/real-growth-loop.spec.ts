import { expect, test, type Page } from "@playwright/test"
import { resolve } from "node:path"

const consoleErrors = new WeakMap<Page, string[]>()
test.beforeEach(async ({ page }) => {
  const errors: string[] = []
  consoleErrors.set(page, errors)
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()) })
  page.on("pageerror", (error) => errors.push(error.message))
})
test.afterEach(async ({ page }) => { expect(consoleErrors.get(page) ?? []).toEqual([]) })

async function login(page: Page, email: string) {
  await page.goto("/login")
  await page.getByLabel("邮箱").fill(email)
  await page.getByLabel("密码").fill("demo-password")
  await page.getByRole("button", { name: "进入内容工作台" }).click()
  await page.waitForURL(email.startsWith("platform") ? "**/platform/content-brain" : "**/app/today")
}

async function ensureLocked(page: Page) {
  await expect(page.getByText("今天建议讲")).toBeVisible({ timeout: 20_000 })
  const record = page.getByRole("button", { name: "记录已发布" })
  if (!await record.isVisible()) {
    await page.getByRole("button", { name: "确认定稿" }).click()
    await expect(record).toBeVisible()
  }
}

test("真实发布数据成为下一次创作使用的已确认记忆", async ({ page }) => {
  await page.setViewportSize({ width: 1487, height: 1058 })
  await login(page, "owner@example.test")
  await ensureLocked(page)
  await page.screenshot({ path: "test-results/design-qa/publication-implementation.png", fullPage: true })

  await page.getByRole("button", { name: "记录已发布" }).click()
  await page.getByLabel("作品 ID 或视频链接").fill("wx-real-001")
  await page.getByRole("button", { name: "保存发布记录" }).click()
  await expect(page.getByText(/已关联发布/)).toBeVisible()

  await page.goto("/app/review")
  await page.getByLabel("导入真实平台数据").setInputFiles(resolve(process.cwd(), "tests/e2e/fixtures/real-metrics.csv"))
  await expect(page.getByRole("heading", { name: "已处理 5 条，5 条已关联" })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText("能确定什么")).toBeVisible()
  await expect(page.getByRole("button", { name: "确认并用于后续创作" })).toBeVisible()

  await page.reload()
  await expect(page.getByRole("heading", { name: "已处理 5 条，5 条已关联" })).toBeVisible()
  await expect(page.getByText("真实场景内容值得继续验证")).toBeVisible()
  await page.screenshot({ path: "test-results/design-qa/review-memory-implementation.png", fullPage: true })
  await page.getByRole("button", { name: "确认并用于后续创作" }).click()
  await expect(page.getByText(/已形成不可变记忆 v1/)).toBeVisible()

  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: "test-results/design-qa/review-memory-implementation-mobile.png", fullPage: true })
  await page.setViewportSize({ width: 1487, height: 1058 })

  await page.getByLabel("导入真实平台数据").setInputFiles(resolve(process.cwd(), "tests/e2e/fixtures/mixed-real-metrics.csv"))
  await expect(page.getByRole("heading", { name: "已处理 4 条，1 条已关联" })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole("heading", { name: "有 1 条需要你看一眼" })).toBeVisible()
  await page.screenshot({ path: "test-results/design-qa/import-match-implementation.png", fullPage: true })

  await page.goto("/app/today")
  await page.getByRole("button", { name: "换一个选题" }).click()
  await expect(page.getByText(/已参考确认复盘.*记忆 v1/)).toBeVisible({ timeout: 20_000 })
  await page.screenshot({ path: "test-results/design-qa/memory-in-creation-implementation.png", fullPage: true })
})

test("复盘确认权限与平台空间保持隔离", async ({ page, request }) => {
  await login(page, "reviewer@example.test")
  await page.goto("/app/review")
  await expect(page.getByText("真实场景内容值得继续验证")).toBeVisible()
  await expect(page.getByRole("button", { name: "确认并用于后续创作" })).toHaveCount(0)

  await page.request.post("/api/auth/logout")
  await login(page, "platform@example.test")
  const cookies = await page.context().cookies()
  const cookie = cookies.map((item) => `${item.name}=${item.value}`).join("; ")
  const response = await request.get("http://127.0.0.1:3100/api/app/reviews/current?contentAccountId=account-linjie-wechat", {
    headers: { cookie },
  })
  expect(response.status()).toBe(403)
})
