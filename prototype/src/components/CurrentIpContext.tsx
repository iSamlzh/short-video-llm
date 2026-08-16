"use client"

import { useState } from "react"
import type { IpProfile } from "../domain/models"

export function CurrentIpContext({ profile, onAddIp }: { profile: IpProfile; onAddIp?: () => void }) {
  const [open, setOpen] = useState(false)
  return <div className="current-ip">
    <button className="current-ip-trigger" type="button" aria-label={`当前 IP ${profile.displayName}`} aria-expanded={open} onClick={() => setOpen((value) => !value)}><span>当前 IP</span><strong>{profile.displayName}</strong></button>
    {open && <div className="current-ip-panel">
      <p className="current-ip-name">{profile.displayName}</p>
      <p>{profile.expertise}</p>
      <dl>
        <div><dt>目标人群</dt><dd>{profile.audience}</dd></div>
        <div><dt>表达方式</dt><dd>{profile.voiceStyle}</dd></div>
      </dl>
      {onAddIp && <button className="secondary-action" type="button" onClick={onAddIp}>新增 IP</button>}
      <small>新增 IP 使用独立初始化流程，不会改动当前任务。</small>
    </div>}
  </div>
}
