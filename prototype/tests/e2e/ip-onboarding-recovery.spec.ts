import { expect, test, type Page } from "@playwright/test"

const consoleErrors = new WeakMap<Page, string[]>()
test.beforeEach(async ({ page }) => {
  const errors: string[] = []
  consoleErrors.set(page, errors)
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()) })
  page.on("pageerror", error => errors.push(error.message))
})
test.afterEach(async ({ page }) => { expect(consoleErrors.get(page) ?? []).toEqual([]) })

async function login(page: Page, email: string) {
  await page.goto("/login")
  await page.getByLabel("邮箱").fill(email)
  await page.getByLabel("密码").fill("demo-password")
  await page.getByRole("button", { name: "进入内容工作台" }).click()
  await page.waitForURL("**/app/today")
}

async function ensureDraft(page: Page) {
  const draft = page.getByText("今天建议讲")
  const oneClick = page.getByRole("button", { name: "一键生成今日口播稿" })
  await expect.poll(async () => await draft.isVisible() || await oneClick.isVisible()).toBe(true)
  if (await oneClick.isVisible()) await oneClick.click()
  await expect(draft).toBeVisible({ timeout: 20_000 })
}

async function answerCurrent(page: Page, index: number) {
  const question = page.locator(".question-step")
  await expect(question).toBeVisible()
  const prompt = await question.getByRole("heading", { level: 1 }).innerText()
  const textarea = question.getByRole("textbox", { name: "你的回答" })
  if (await textarea.isVisible()) await textarea.fill(`恢复测试第 ${index} 项：这是一条可追溯的真实内容依据。`)
  else await question.locator(".answer-option input").first().check()
  await question.getByRole("button", { name: "保存并继续" }).click()
  await expect.poll(async () => {
    if (await page.getByRole("heading", { name: "先核对这些内容依据" }).isVisible()) return true
    return await question.getByRole("heading", { level: 1 }).innerText().catch(() => "") !== prompt
  }).toBe(true)
}

async function answerRemaining(page: Page, answered = 0) {
  for (let index = answered; index < 10; index += 1) {
    if (await page.getByRole("heading", { name: "先核对这些内容依据" }).isVisible()) return
    await answerCurrent(page, index + 1)
  }
  await expect(page.getByRole("heading", { name: "先核对这些内容依据" })).toBeVisible()
}

async function captureMobile(page: Page, name: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: `test-results/design-qa/ip-onboarding-mobile-${name}.png`, fullPage: true })
}

test("逐题建档可恢复、画像失败可重试且修改原回答会使草稿失效", async ({ page }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 390, height: 844 })
  await login(page, "operator@example.test")
  await page.goto("/app/setup/ip")
  await captureMobile(page, "01-basic")
  await page.getByLabel("IP名称").fill("恢复姐")
  await page.getByLabel("主要发布平台").selectOption("wechat_channels")
  await page.getByRole("button", { name: "继续选择行业" }).click()
  await captureMobile(page, "02-industry")
  await page.getByLabel("食品生鲜").check()
  await page.getByRole("button", { name: "开始建立内容画像" }).click()
  await captureMobile(page, "03-question")

  await answerCurrent(page, 1)
  await answerCurrent(page, 2)
  await answerCurrent(page, 3)
  const fourthQuestion = await page.locator(".question-step h1").innerText()
  await page.reload()
  await expect(page.locator(".question-step h1")).toHaveText(fourthQuestion)

  await answerRemaining(page, 3)
  await expect(page.locator(".answer-ledger article")).toHaveCount(8)
  await captureMobile(page, "04-review")

  let firstPreview = true
  await page.route("**/portrait-preview", async route => {
    if (firstPreview) {
      firstPreview = false
      await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ errorCode: "MODEL_SCHEMA_INVALID" }) })
      return
    }
    await route.continue()
  })
  await page.getByRole("button", { name: "生成内容画像" }).click()
  await expect(page.locator(".onboarding-error")).toContainText("MODEL_SCHEMA_INVALID")
  await expect(page.locator(".answer-ledger article")).toHaveCount(8)
  consoleErrors.set(page, [])

  await page.getByRole("button", { name: "生成内容画像" }).click()
  await expect(page.getByRole("heading", { name: /我理解的恢复姐/ })).toBeVisible()
  await captureMobile(page, "05-portrait")
  await page.getByRole("button", { name: "修改「内容应该服务谁」" }).click()
  const revised = "希望服务重视食材真实来源、正在为家人挑选日常食品的人。"
  await page.getByRole("textbox", { name: "你的回答" }).fill(revised)
  await page.getByRole("button", { name: "保存修改" }).click()
  await expect(page.getByText("原回答已更新，需要重新生成画像。")).toBeVisible()
  await expect(page.getByText(revised)).toBeVisible()

  await page.getByRole("button", { name: "重新生成内容画像" }).click()
  await expect(page.getByRole("heading", { name: /我理解的恢复姐/ })).toBeVisible()
  await page.getByRole("button", { name: "这个理解准确，开始创作" }).click()
  await expect(page).toHaveURL(/\/app\/today$/)
  await ensureDraft(page)
  await captureMobile(page, "06-today")

  await page.goto("/logout")
  await page.getByRole("button", { name: "确认退出" }).click()
  await page.waitForURL("**/login")
  await login(page, "operator@example.test")
  await expect(page).toHaveURL(/\/app\/today$/)
  await ensureDraft(page)
})
