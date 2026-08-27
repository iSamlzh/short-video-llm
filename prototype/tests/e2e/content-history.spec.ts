import { expect, test } from "@playwright/test"

test("内容记录按当前账号打开历史稿并展示不可变生成谱系", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto("/login")
  await page.getByLabel("邮箱").fill("owner@example.test")
  await page.getByLabel("密码").fill("demo-password")
  await page.getByRole("button", { name: "进入内容工作台" }).click()
  await page.waitForURL("**/app/today")
  await expect(page.getByText("今天建议讲")).toBeVisible({ timeout: 20_000 })

  await page.getByRole("link", { name: "内容记录" }).click()
  await expect(page).toHaveURL(/\/app\/content$/)
  await expect(page.getByRole("heading", { name: "每一篇稿，都保留它为什么产生。" })).toBeVisible()
  await expect(page.locator(".history-stream-summary")).toHaveText("1篇内容记录")

  await page.locator(".history-card").first().click()
  await expect(page.getByText("生成依据")).toBeVisible()
  await expect(page.getByText(/IP 画像/)).toBeVisible()
  await expect(page.getByRole("button", { name: /参考这篇再创作/ })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: "test-results/design-qa/content-history-desktop.png", fullPage: true })

  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: "test-results/design-qa/content-history-mobile.png", fullPage: true })
})
