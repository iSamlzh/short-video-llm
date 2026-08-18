import { describe, expect, it } from "vitest"
import nextConfig from "../../next.config"

describe("Next.js 本地验证来源", () => {
  it("允许通过 localhost 和 127.0.0.1 加载开发资源", () => {
    expect(nextConfig.allowedDevOrigins).toEqual(expect.arrayContaining(["localhost", "127.0.0.1"]))
  })
})
