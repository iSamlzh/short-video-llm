import { afterEach, describe, expect, it } from "vitest"
import { CURRENT_IP_KEY, clearCurrentIp, loadCurrentIp, saveCurrentIp } from "../../src/lib/current-ip-store"

const minimumIpInput = {
  displayName: "示例团长",
  experience: "三年社区团购运营经历，服务过多个社区",
  expertise: "社区团购运营",
  audience: "希望拓展本地业务的人",
  voiceStyle: "直接、实在、有案例",
  boundaries: "不承诺确定收益",
}

describe("current IP store", () => {
  afterEach(() => clearCurrentIp())

  it("persists and reloads the current IP", () => {
    saveCurrentIp(minimumIpInput)
    expect(loadCurrentIp()).toEqual(minimumIpInput)
  })

  it("removes malformed current IP data", () => {
    window.localStorage.setItem(CURRENT_IP_KEY, "{broken")
    expect(loadCurrentIp()).toBeNull()
    expect(window.localStorage.getItem(CURRENT_IP_KEY)).toBeNull()
  })

  it("removes current IP data that does not satisfy the profile schema", () => {
    window.localStorage.setItem(CURRENT_IP_KEY, JSON.stringify({ displayName: "林姐" }))
    expect(loadCurrentIp()).toBeNull()
    expect(window.localStorage.getItem(CURRENT_IP_KEY)).toBeNull()
  })
})
