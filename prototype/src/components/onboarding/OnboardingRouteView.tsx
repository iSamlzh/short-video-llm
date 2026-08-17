"use client"

import { useRouter } from "next/navigation"
import { IpOnboardingView } from "./IpOnboardingView"

export function OnboardingRouteView({ portrait }: { portrait: any }) {
  const router = useRouter()
  async function confirm() {
    const response = await fetch("/api/app/ip-profiles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        profile: {
          displayName: portrait.name,
          experience: portrait.identity,
          expertise: portrait.title,
          audience: portrait.audience,
          voiceStyle: "直白、温和、讲真实案例",
          boundaries: portrait.boundaries.join("；"),
        },
        account: { platform: "wechat_channels", name: portrait.account.replace(/^.*?｜/, "") },
      }),
    })
    if (!response.ok) throw new Error((await response.json()).message || "保存失败")
    router.push("/app/today")
    router.refresh()
  }
  return <IpOnboardingView portrait={portrait} onConfirm={confirm} />
}
