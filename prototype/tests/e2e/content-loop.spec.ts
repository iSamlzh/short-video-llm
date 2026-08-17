import { expect, test } from "@playwright/test"

const consoleErrors = new WeakMap<import("@playwright/test").Page, string[]>()
test.beforeEach(async ({ page }) => {
  const errors: string[] = []
  consoleErrors.set(page, errors)
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()) })
  page.on("pageerror", (error) => errors.push(error.message))
})
test.afterEach(async ({ page }) => { expect(consoleErrors.get(page) ?? []).toEqual([]) })

async function login(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login")
  await page.getByLabel("邮箱").fill(email)
  await page.getByLabel("密码").fill("demo-password")
  await page.getByRole("button", { name: "进入内容工作台" }).click()
  await page.waitForURL(email.startsWith("platform") ? "**/platform/content-brain" : "**/app/today")
}

test("tenant default path produces one usable draft and keeps internal brain private", async ({ page }) => {
  await page.setViewportSize({ width: 1487, height: 1058 })
  await login(page, "owner@example.test")
  await expect(page.getByText("林姐，今天这篇可以直接拍")).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole("button", { name: "复制并去拍" })).toBeVisible()
  await expect(page.getByText("已检查：事实可信 · 符合你的表达 · 无收益承诺")).toBeVisible()
  await expect(page.getByText("创作依据（摘要）")).toBeVisible()
  const editSecondParagraph = page.getByRole("button", { name: "编辑第 2 段" })
  await expect(editSecondParagraph).toBeEnabled()
  await editSecondParagraph.click()
  await expect(page.getByRole("textbox", { name: "第 2 段" })).toBeVisible()
  await expect(page.getByRole("textbox", { name: "第 1 段" })).toHaveCount(0)
  await page.getByRole("textbox", { name: "第 2 段" }).fill("这是刷新后仍然存在的第二段。")
  await page.getByRole("button", { name: "完成第 2 段编辑" }).click()
  await expect(page.getByText("修改已保存，定稿前会重新检查")).toBeVisible()
  await expect(page.getByText("这是刷新后仍然存在的第二段。")).toBeVisible()
  await expect(page.getByRole("article").getByText("v2 · 待检查")).toBeVisible()
  await page.reload()
  await expect(page.getByText("这是刷新后仍然存在的第二段。")).toBeVisible()
  await page.getByRole("button", { name: "确认定稿" }).click()
  await expect(page.getByRole("button", { name: "已确认定稿" })).toBeDisabled()
  await expect(page.getByRole("article").getByText("v2 · 已定稿")).toBeVisible()
  await expect(page.getByText("锁稿 1")).toBeVisible()

  await page.getByRole("button", { name: "编辑第 2 段" }).click()
  await page.getByRole("textbox", { name: "第 2 段" }).fill("这是定稿后再次修改并形成第三版的第二段。")
  await page.getByRole("button", { name: "完成第 2 段编辑" }).click()
  await expect(page.getByRole("article").getByText("v3 · 待检查")).toBeVisible()
  await page.getByRole("button", { name: "确认定稿" }).click()
  await expect(page.getByRole("article").getByText("v3 · 已定稿")).toBeVisible()
  await expect(page.getByText("锁稿 2")).toBeVisible()
  await page.screenshot({ path: "test-results/design-qa/daily-implementation.png", fullPage: true })
  await page.getByRole("button", { name: "换选题" }).click()
  await expect(page.getByRole("heading", { name: "新团长最容易误判的三件事：今天这样讲" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "真正难的不是找货，是让邻居愿意一直信你" })).toHaveCount(0)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole("button", { name: "复制并去拍" })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: "test-results/design-qa/daily-implementation-mobile.png", fullPage: true })

  await page.goto("/platform/content-brain")
  await expect(page.getByText("无权访问平台运营空间")).toBeVisible()
})

test("delegation and platform content brain are usable in their own scopes", async ({ page }) => {
  await login(page, "owner@example.test")
  await page.goto("/app/team")
  await page.getByRole("button", { name: "确认并邀请小周" }).click()
  await expect(page.getByText(/小周现在只能操作林姐/)).toBeVisible()

  await page.request.post("/api/auth/logout")
  await login(page, "platform@example.test")
  await expect(page.getByText("已启用的内容结构")).toBeVisible()
  await expect(page.getByText(/客户永远看不到原文/)).toBeVisible()
})
