import { describe, expect, it } from "vitest"
import { createE2EDatabasePath } from "../../src/scripts/e2e-database-path"

describe("E2E 数据库路径", () => {
  it("同一个进程重复启动时仍生成不同的全新数据库", () => {
    const first = createE2EDatabasePath(36044)
    const second = createE2EDatabasePath(36044)

    expect(first).not.toBe(second)
    expect(first).toMatch(/^\.data\/e2e-36044-[0-9a-f-]+\.sqlite$/)
    expect(second).toMatch(/^\.data\/e2e-36044-[0-9a-f-]+\.sqlite$/)
  })
})
