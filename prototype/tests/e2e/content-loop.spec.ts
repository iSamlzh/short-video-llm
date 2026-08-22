import { expect, test } from "@playwright/test"

const consoleErrors = new WeakMap<import("@playwright/test").Page, string[]>()
test.beforeEach(async ({ page }) => {
  const errors: string[] = []
  consoleErrors.set(page, errors)
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) errors.push(message.text())
  })
  page.on("response", (response) => {
    if (response.status() < 400) return
    void Promise.all([response.text(), response.request().headerValue("cookie")]).then(([body, cookie]) => {
      errors.push(`HTTP ${response.status()} ${response.url()} (${cookie ? "含会话 Cookie" : "无会话 Cookie"}): ${body.slice(0, 500)}`)
    })
  })
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

async function answerUntilReview(page: import("@playwright/test").Page) {
  for (let index = 0; index < 10; index += 1) {
    if (await page.getByRole("heading", { name: "先核对这些内容依据" }).isVisible()) return
    const question = page.locator(".question-step")
    await expect(question).toBeVisible()
    const prompt = await question.getByRole("heading", { level: 1 }).innerText()
    const textarea = question.getByRole("textbox", { name: "你的回答" })
    if (await textarea.isVisible()) {
      await textarea.fill(`第 ${index + 1} 项真实内容依据：来自日常服务、用户提问和长期实践。`)
    } else {
      await question.locator(".answer-option input").first().check()
    }
    await question.getByRole("button", { name: "保存并继续" }).click()
    await expect.poll(async () => {
      if (await page.getByRole("heading", { name: "先核对这些内容依据" }).isVisible()) return true
      return await question.getByRole("heading", { level: 1 }).innerText().catch(() => "") !== prompt
    }).toBe(true)
  }
  await expect(page.getByRole("heading", { name: "先核对这些内容依据" })).toBeVisible()
}

async function captureOnboarding(page: import("@playwright/test").Page, name: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: `test-results/design-qa/ip-onboarding-desktop-${name}.png`, fullPage: true })
}

test("tenant default path produces one usable draft and keeps internal brain private", async ({ page }) => {
  await page.setViewportSize({ width: 1487, height: 1058 })
  await login(page, "owner@example.test")
  await expect(page.getByText("今天建议讲")).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole("button", { name: "确认定稿" })).toBeVisible()
  await expect(page.getByText("内容检查已完成：事实与表达边界")).toBeVisible()
  await expect(page.getByText("为什么今天推荐这篇")).toBeVisible()
  await expect(page.getByText("尚未使用历史表现")).toBeVisible()
  await page.getByRole("button", { name: "查看完整判断依据" }).click()
  await expect(page.getByRole("dialog", { name: "这次推荐依据" })).toBeVisible()
  await expect(page.getByText(/IP 建档回答/).first()).toBeVisible()
  await page.getByRole("button", { name: "关闭判断依据" }).click()
  const currentResult = await page.evaluate(async () => {
    const response = await fetch("/api/app/creation/current")
    return { ok: response.ok, payload: await response.json() }
  })
  const currentPayload = currentResult.payload
  expect(currentResult.ok, JSON.stringify(currentPayload)).toBe(true)
  expect(currentPayload.structureVersionIds.length).toBeGreaterThan(0)
  expect(JSON.stringify(currentPayload)).not.toMatch(/sourceText|evidenceRefs|rightsNote|operatorNote|nodes|qualityRules|riskRules/)
  const editSecondParagraph = page.getByRole("button", { name: "编辑第 2 段" })
  await expect(editSecondParagraph).toBeEnabled()
  await editSecondParagraph.click()
  await expect(page.getByRole("textbox", { name: "第 2 段" })).toBeVisible()
  await expect(page.getByRole("textbox", { name: "第 1 段" })).toHaveCount(0)
  await page.getByRole("textbox", { name: "第 2 段" }).fill("这是刷新后仍然存在的第二段。")
  await page.getByRole("button", { name: "完成第 2 段编辑" }).click()
  await expect(page.getByText("修改已保存，定稿前会重新检查")).toBeVisible()
  await expect(page.getByText("这是刷新后仍然存在的第二段。")).toBeVisible()
  await expect(page.getByText("v2 · 待检查")).toBeVisible()
  await page.reload()
  await expect(page.getByText("这是刷新后仍然存在的第二段。")).toBeVisible()
  await page.getByRole("button", { name: "检查并定稿" }).click()
  await expect(page.getByRole("button", { name: "下载口播稿" })).toBeVisible()
  await expect(page.getByText("v2 · 已定稿")).toBeVisible()
  const downloadPromise = page.waitForEvent("download")
  await page.getByRole("button", { name: "下载口播稿" }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/\.docx$/)

  await page.getByRole("button", { name: "返回编辑" }).click()
  await page.getByRole("button", { name: "编辑第 2 段" }).click()
  await page.getByRole("textbox", { name: "第 2 段" }).fill("这是定稿后再次修改并形成第三版的第二段。")
  await page.getByRole("button", { name: "完成第 2 段编辑" }).click()
  await expect(page.getByText("v3 · 待检查")).toBeVisible()
  await page.getByRole("button", { name: "检查并定稿" }).click()
  await expect(page.getByText("v3 · 已定稿")).toBeVisible()
  await page.screenshot({ path: "test-results/design-qa/daily-implementation.png", fullPage: true })
  await page.getByRole("button", { name: "换一个选题" }).click()
  await expect(page.getByRole("heading", { name: "新团长最容易误判的三件事：今天这样讲" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "真正难的不是找货，是让邻居愿意一直信你" })).toHaveCount(0)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole("button", { name: "确认定稿" })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: "test-results/design-qa/daily-implementation-mobile.png", fullPage: true })

  await page.goto("/platform/content-brain")
  await expect(page.getByText("无权访问平台运营空间")).toBeVisible()
})

test("换选题可取消，迟到响应不会覆盖当前稿件", async ({ page }) => {
  await login(page, "owner@example.test")
  const currentHeading = page.locator(".creation-decision h1")
  await expect(currentHeading).toBeVisible({ timeout: 20_000 })
  const originalTitle = await currentHeading.innerText()
  const currentDraft = await page.evaluate(async () => {
    const response = await fetch("/api/app/creation/current")
    return response.json()
  })

  let releaseResponse: (() => void) | undefined
  await page.route("**/api/app/creation/auto", async (route) => {
    await new Promise<void>((resolve) => { releaseResponse = resolve })
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ ...currentDraft, title: "这是一条已经迟到的新选题" }),
    }).catch(() => undefined)
  })

  await page.getByRole("button", { name: "换一个选题" }).click()
  await expect(page.getByRole("button", { name: "取消本次生成" })).toBeVisible()
  await expect(page.getByRole("status")).toContainText("正在")
  await expect(currentHeading).toHaveText(originalTitle)
  await page.screenshot({ path: "test-results/design-qa/generation-progress.png", fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await expect(page.getByRole("button", { name: "取消本次生成" })).toBeVisible()
  await page.screenshot({ path: "test-results/design-qa/generation-progress-mobile.png", fullPage: true })
  await page.getByRole("button", { name: "取消本次生成" }).click()
  await expect(page.getByRole("button", { name: "取消本次生成" })).toHaveCount(0)
  releaseResponse?.()
  await page.waitForTimeout(500)
  await expect(currentHeading).toHaveText(originalTitle)
  await expect(page.getByText("这是一条已经迟到的新选题")).toHaveCount(0)
})

test("负责人切换 IP 与账号后正文同步刷新且选择可持久化", async ({ page }) => {
  test.setTimeout(90_000)
  await login(page, "owner@example.test")
  await expect(page.getByText("今天建议讲")).toBeVisible({ timeout: 20_000 })

  const switcher = page.getByRole("button", { name: /切换当前 IP 和账号/ })
  await expect(switcher).toHaveAccessibleName(/当前 林姐，视频号｜林姐说团购/)
  await switcher.click()
  await page.getByRole("button", { name: "切换到 IP：王姐" }).click()
  await expect(switcher).toHaveAccessibleName(/当前 王姐，抖音｜王姐本地生活/)
  await expect(page.getByText("今天建议讲")).toBeVisible({ timeout: 20_000 })

  const wangContext = await page.evaluate(async () => {
    const response = await fetch("/api/app/context")
    return response.json()
  })
  expect(wangContext.ip.id).toBe("ip-wangjie")
  expect(wangContext.account.id).toBe("account-wangjie-douyin")
  await page.reload()
  await expect(switcher).toHaveAccessibleName(/当前 王姐，抖音｜王姐本地生活/)

  await switcher.click()
  await page.getByRole("button", { name: "切换到 IP：林姐" }).click()
  await expect(switcher).toHaveAccessibleName(/当前 林姐，视频号｜林姐说团购/)
  await switcher.click()
  await page.getByRole("button", { name: "切换到账号：抖音｜林姐聊团购" }).click()
  await expect(switcher).toHaveAccessibleName(/当前 林姐，抖音｜林姐聊团购/)
  await page.reload()
  await expect(switcher).toHaveAccessibleName(/当前 林姐，抖音｜林姐聊团购/)

  // 恢复默认上下文，避免影响后续共享演示数据的流程验证。
  await switcher.click()
  await page.getByRole("button", { name: "切换到账号：视频号｜林姐说团购" }).click()
  await expect(switcher).toHaveAccessibleName(/当前 林姐，视频号｜林姐说团购/)
})

test("运营员工只能看到负责人授权的 IP 与账号", async ({ page }) => {
  await login(page, "operator@example.test")
  const switcher = page.getByRole("button", { name: /切换当前 IP 和账号/ })
  await switcher.click()
  await expect(page.getByRole("button", { name: "切换到 IP：林姐" })).toBeVisible()
  await expect(page.getByRole("button", { name: "切换到 IP：王姐" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "切换到账号：视频号｜林姐说团购" })).toBeVisible()
  await expect(page.getByRole("button", { name: "切换到账号：抖音｜林姐聊团购" })).toHaveCount(0)
})

test("delegation and platform content brain are usable in their own scopes", async ({ page }) => {
  await login(page, "owner@example.test")
  await page.goto("/app/team")
  await page.getByRole("button", { name: "确认并邀请小周" }).click()
  await expect(page.getByText(/小周现在只能操作林姐/)).toBeVisible()

  await page.evaluate(() => fetch("/api/auth/logout", { method: "POST" }))
  await login(page, "platform@example.test")
  await page.getByRole("button", { name: "结构库" }).click()
  await expect(page.getByRole("heading", { name: "结构库" })).toBeVisible()
  await expect(page.getByText(/当前启用版本会参与团长口播稿创作检索/)).toBeVisible()
})

test("退出入口清除当前会话并返回登录页", async ({ page }) => {
  await login(page, "owner@example.test")
  await expect(page.getByText("今天建议讲")).toBeVisible()
  await page.getByRole("button", { name: "退出" }).click()

  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole("button", { name: "进入内容工作台" })).toBeVisible()
  const sessionCookie = (await page.context().cookies()).find((cookie) => cookie.name === "content_agent_session")
  expect(sessionCookie).toBeUndefined()
})

test("首次登录从 IP 初始化开始并在确认后进入今日创作", async ({ page }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 1440, height: 1024 })
  await page.goto("/login")
  await page.getByLabel("邮箱").fill("firsttime@example.test")
  await page.getByLabel("密码").fill("demo-password")
  await page.getByRole("button", { name: "进入内容工作台" }).click()

  await expect(page).toHaveURL(/\/app\/setup\/ip$/)
  await expect(page.getByRole("heading", { name: "先确定这个IP要讲什么" })).toBeVisible()
  await expect(page.getByText(/林姐/)).toHaveCount(0)
  await captureOnboarding(page, "01-basic")
  await page.getByLabel("IP名称").fill("周姐")
  await page.getByLabel("主要发布平台").selectOption("wechat_channels")
  await page.getByRole("button", { name: "继续选择行业" }).click()
  await captureOnboarding(page, "02-industry")
  await page.getByLabel("健康养生").check()
  await page.getByRole("button", { name: "开始建立内容画像" }).click()
  await captureOnboarding(page, "03-question")

  await answerUntilReview(page)
  await captureOnboarding(page, "04-review")
  await page.getByRole("button", { name: "生成内容画像" }).click()
  await expect(page.getByRole("heading", { name: /我理解的周姐/ })).toBeVisible()
  await captureOnboarding(page, "05-portrait")
  await page.getByRole("button", { name: "这个理解准确，开始创作" }).click()

  await expect(page).toHaveURL(/\/app\/today$/)
  await expect(page.getByText("今天建议讲")).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole("button", { name: "确认定稿" })).toBeVisible()
  await expect(page.getByText(/林姐/)).toHaveCount(0)
  await captureOnboarding(page, "06-today")
})
