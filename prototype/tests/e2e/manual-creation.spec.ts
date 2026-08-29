import { expect, test } from "@playwright/test"

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login")
  await page.getByLabel("邮箱").fill("owner@example.test")
  await page.getByLabel("密码").fill("demo-password")
  await page.getByRole("button", { name: "进入内容工作台" }).click()
  await page.waitForURL("**/app/today")
  await expect(page.getByRole("heading", { name: /今天想怎么开始|.+/ }).first()).toBeVisible({ timeout: 20_000 })
}

test("用户输入内容意图、选择方向后只生成所选方向的单篇稿件", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await login(page)
  const existingDraftEntry = page.getByRole("button", { name: "自己定选题" })
  const freshDraftEntry = page.getByRole("button", { name: /手动选择选题方向/ })
  await expect.poll(async () => await existingDraftEntry.isVisible() || await freshDraftEntry.isVisible()).toBe(true)
  const existingDraft = await page.getByText("今天建议讲").isVisible().catch(() => false)

  await (existingDraft ? existingDraftEntry : freshDraftEntry).click()
  await expect(page.getByRole("heading", { name: "自己确定今天讲什么" })).toBeFocused()
  const brief = page.getByRole("textbox", { name: /今天想讲的内容/ })
  await brief.fill("我想讲新团长应该先选品还是先建群")
  await page.screenshot({ path: "test-results/design-qa/manual-topic-input-desktop.png", fullPage: true })
  await page.getByRole("button", { name: /生成 3 个选题方向/ }).click()

  await expect(page.getByRole("heading", { name: "今天具体拍哪一条？" })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole("radio")).toHaveCount(3)
  const secondTopic = page.getByRole("radio").nth(1)
  await secondTopic.check()
  const selectedTitle = await secondTopic.locator("xpath=following-sibling::*[2]/*[1]").innerText()
  await page.screenshot({ path: "test-results/design-qa/manual-topic-selection-desktop.png", fullPage: true })

  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: "test-results/design-qa/manual-topic-selection-mobile.png", fullPage: true })
  await page.getByRole("button", { name: /按这个方向生成口播稿/ }).click()

  await expect(page.getByText("今天建议讲")).toBeVisible({ timeout: 20_000 })
  await expect(page.locator(".creation-decision h1")).toContainText(
    selectedTitle.replace("Agent 首选", "").trim(),
    { timeout: 20_000 },
  )
})
