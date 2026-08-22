import { expect, test, type Page } from "@playwright/test"

async function login(page: Page) {
  await page.goto("/login")
  await page.getByLabel("邮箱").fill("owner@example.test")
  await page.getByLabel("密码").fill("demo-password")
  await page.getByRole("button", { name: "进入内容工作台" }).click()
  await page.waitForURL("**/app/today")
  await expect(page.getByText("今天建议讲")).toBeVisible({ timeout: 20_000 })
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
}

test("三个验收视口均无横向溢出并保留清晰工作层级", async ({ page }) => {
  await login(page)
  for (const viewport of [
    { width: 1440, height: 1000, name: "desktop" },
    { width: 1024, height: 768, name: "compact" },
    { width: 390, height: 844, name: "mobile" },
  ]) {
    await page.setViewportSize(viewport)
    await expectNoHorizontalOverflow(page)
    await expect(page.getByRole("navigation", { name: "主要任务" })).toBeVisible()
    await expect(page.getByRole("button", { name: /切换当前 IP 和账号/ })).toBeVisible()
    await page.screenshot({ path: `test-results/design-qa/task8-today-${viewport.name}.png`, fullPage: true })
  }
})

test("工作上下文和判断依据均支持键盘关闭并归还焦点", async ({ page }) => {
  await login(page)
  const contextTrigger = page.getByRole("button", { name: /切换当前 IP 和账号/ })
  await contextTrigger.focus()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("dialog", { name: "切换工作上下文" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog", { name: "切换工作上下文" })).not.toBeVisible()
  await expect(contextTrigger).toBeFocused()

  const rationaleTrigger = page.getByRole("button", { name: "查看完整判断依据" })
  await rationaleTrigger.focus()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("dialog", { name: "这次推荐依据" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog", { name: "这次推荐依据" })).not.toBeVisible()
  await expect(rationaleTrigger).toBeFocused()
})

test("移动端核心点击目标不小于 44 像素且状态有文字说明", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await login(page)

  const targets = [
    page.getByRole("button", { name: /切换当前 IP 和账号/ }),
    page.getByRole("button", { name: "换一个选题" }),
    page.getByRole("button", { name: "换一种讲法" }),
    page.getByRole("button", { name: /确认定稿|检查并定稿/ }),
  ]
  for (const target of targets) {
    const box = await target.boundingBox()
    expect(box, "核心操作必须可见").not.toBeNull()
    expect(box!.height).toBeGreaterThanOrEqual(44)
    expect(box!.width).toBeGreaterThanOrEqual(44)
  }

  await page.getByRole("button", { name: /切换当前 IP 和账号/ }).click()
  await expect(page.getByText("当前", { exact: true }).first()).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await page.keyboard.press("Escape")

  await page.goto("/app/review")
  await expect(page.locator(".review-view, .empty-review").first()).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: "test-results/design-qa/task8-review-mobile.png", fullPage: true })
})

test("登录与首次 IP 建档在三个视口保持单一任务焦点", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto("/login")
  await expect(page.getByRole("heading", { name: "每天打开，就有一篇真正适合你的口播稿" })).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: "test-results/design-qa/task8-login-desktop.png", fullPage: true })

  await page.getByLabel("邮箱").fill("firsttime@example.test")
  await page.getByLabel("密码").fill("demo-password")
  await page.getByRole("button", { name: "进入内容工作台" }).click()
  await page.waitForURL("**/app/setup/ip")
  await expect(page.getByRole("heading", { name: "先确定这个IP要讲什么" })).toBeVisible()

  for (const viewport of [
    { width: 1440, height: 1000, name: "desktop" },
    { width: 1024, height: 768, name: "compact" },
    { width: 390, height: 844, name: "mobile" },
  ]) {
    await page.setViewportSize(viewport)
    await expectNoHorizontalOverflow(page)
    await page.screenshot({ path: `test-results/design-qa/task8-onboarding-${viewport.name}.png`, fullPage: true })
  }
})
