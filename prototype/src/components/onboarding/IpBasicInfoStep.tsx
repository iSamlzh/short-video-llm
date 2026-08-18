import { FormEvent, useState } from "react"

export type IpBasicInfo = {
  displayName: string
  primaryPlatform: "wechat_channels" | "douyin" | "xiaohongshu" | "kuaishou" | "other"
}

export function IpBasicInfoStep({ onContinue }: { onContinue(input: IpBasicInfo): void }) {
  const [displayName, setDisplayName] = useState("")
  const [primaryPlatform, setPrimaryPlatform] = useState<IpBasicInfo["primaryPlatform"]>("wechat_channels")

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!displayName.trim()) return
    onContinue({ displayName: displayName.trim(), primaryPlatform })
  }

  return <form className="onboarding-sheet onboarding-basic-step" onSubmit={submit}>
    <p className="onboarding-kicker">首次建立内容画像</p>
    <h1>先确定这个IP要讲什么</h1>
    <p className="onboarding-intro-copy">先留下称呼和主要发布平台。下一步由你主动选择行业，Agent 再围绕内容产出逐题了解你。</p>
    <label htmlFor="ip-display-name">IP名称</label>
    <input id="ip-display-name" value={displayName} onChange={event => setDisplayName(event.target.value)} placeholder="例如：周姐" maxLength={60} required />
    <label htmlFor="ip-primary-platform">主要发布平台</label>
    <select id="ip-primary-platform" value={primaryPlatform} onChange={event => setPrimaryPlatform(event.target.value as IpBasicInfo["primaryPlatform"])}>
      <option value="wechat_channels">视频号</option>
      <option value="douyin">抖音</option>
      <option value="xiaohongshu">小红书</option>
      <option value="kuaishou">快手</option>
      <option value="other">其他</option>
    </select>
    <p className="onboarding-helper">这些信息只在首次创建或新增IP时填写，后续默认使用当前IP。</p>
    <button className="primary-button" type="submit" disabled={!displayName.trim()}>继续选择行业</button>
  </form>
}
