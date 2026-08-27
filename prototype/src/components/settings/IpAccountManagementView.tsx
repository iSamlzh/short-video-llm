"use client"

import Link from "next/link"
import { FormEvent, useMemo, useState } from "react"

type IpItem = { id: string; displayName: string; status: string; version: number; profile: Record<string, any>; versions: any[]; accounts: any[] }
type Data = { ips: IpItem[] }
const platformLabels: Record<string, string> = { wechat_channels: "视频号", douyin: "抖音", xiaohongshu: "小红书", kuaishou: "快手", other: "其他" }

export function IpAccountManagementView({ initialData }: { initialData: Data }) {
  const [data, setData] = useState(initialData)
  const [selectedId, setSelectedId] = useState(initialData.ips.find(ip => ip.status === "active")?.id ?? initialData.ips[0]?.id ?? "")
  const [editingProfile, setEditingProfile] = useState(false)
  const [addingAccount, setAddingAccount] = useState(false)
  const [status, setStatus] = useState("")
  const selected = useMemo(() => data.ips.find(ip => ip.id === selectedId) ?? data.ips[0], [data, selectedId])

  async function refresh() {
    const response = await fetch("/api/app/settings/ip")
    if (response.ok) setData(await response.json())
  }
  async function request(url: string, options: RequestInit = {}) {
    setStatus("正在保存…")
    const response = await fetch(url, options)
    const body = await response.json().catch(() => ({}))
    if (!response.ok) { setStatus(body.message ?? "操作未完成"); return false }
    setStatus("已保存"); await refresh(); return true
  }
  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return
    const form = new FormData(event.currentTarget)
    const profile = { ...selected.profile,
      displayName: form.get("displayName"), experience: form.get("experience"), expertise: form.get("expertise"),
      audience: form.get("audience"), voiceStyle: form.get("voiceStyle"), boundaries: form.get("boundaries"),
    }
    const ok = await request(`/api/app/settings/ip/ips/${selected.id}/profile`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedVersion: selected.version, displayName: form.get("displayName"), profile, changeSummary: form.get("changeSummary") }) })
    if (ok) setEditingProfile(false)
  }
  async function addAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return
    const form = new FormData(event.currentTarget)
    const ok = await request(`/api/app/settings/ip/ips/${selected.id}/accounts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ platform: form.get("platform"), accountName: form.get("accountName"), platformAccountId: form.get("platformAccountId") || undefined }) })
    if (ok) setAddingAccount(false)
  }
  async function renameAccount(account: any) {
    const accountName = window.prompt("新的账号名称", account.accountName)?.trim()
    if (!accountName) return
    await request(`/api/app/settings/ip/accounts/${account.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ accountName, platformAccountId: account.platformAccountId || undefined }) })
  }

  if (!selected) return <div className="document-page"><section className="result-lead"><div><p className="eyebrow">IP 与账号</p><h1>先创建第一个 IP</h1><p>完成一次建档后，画像和内容账号会在这里统一管理。</p></div><Link className="primary-button" href="/app/setup/ip">开始建档</Link></section></div>
  return <div className="document-page ip-settings-view">
    <section className="result-lead"><div><p className="eyebrow">IP 与内容账号</p><h1>管理长期使用的内容身份</h1><p>修改画像会创建新版本；历史口播稿仍保留当时使用的画像快照。</p></div><div className="lead-actions"><Link className="primary-button" href="/app/setup/ip">新增 IP</Link>{status && <p className="inline-status" role="status">{status}</p>}</div></section>
    <nav className="ip-settings-tabs" aria-label="选择要管理的 IP">{data.ips.map(ip => <button key={ip.id} className={ip.id === selected.id ? "is-active" : ""} onClick={() => setSelectedId(ip.id)}>{ip.displayName}<small>{ip.status === "active" ? `画像 v${ip.version}` : "已归档"}</small></button>)}</nav>

    <div className="document-grid">
      <article className="primary-document ip-profile-document">
        <header><div><p className="eyebrow">当前画像 · v{selected.version}</p><h2>{selected.displayName}</h2></div><div className="lead-actions"><button className="secondary-button" onClick={() => setEditingProfile(value => !value)}>校准画像</button><button className="secondary-button" onClick={() => void request(`/api/app/settings/ip/ips/${selected.id}/${selected.status === "active" ? "archive" : "restore"}`, { method: "POST" })}>{selected.status === "active" ? "归档 IP" : "恢复 IP"}</button></div></header>
        {editingProfile ? <form className="ip-profile-form" onSubmit={saveProfile}>
          <label>IP 名称<input name="displayName" defaultValue={selected.profile.displayName ?? selected.displayName} required /></label>
          <label>真实经历<textarea name="experience" defaultValue={selected.profile.experience} required /></label>
          <label>擅长领域<textarea name="expertise" defaultValue={selected.profile.expertise} required /></label>
          <label>主要受众<textarea name="audience" defaultValue={selected.profile.audience} required /></label>
          <label>表达方式<textarea name="voiceStyle" defaultValue={selected.profile.voiceStyle} required /></label>
          <label>内容边界<textarea name="boundaries" defaultValue={selected.profile.boundaries} required /></label>
          <label>本次调整说明<input name="changeSummary" placeholder="例如：补充新的从业经历与受众范围" required minLength={2} /></label>
          <div className="lead-actions"><button className="primary-button">生成新画像版本</button><button className="secondary-button" type="button" onClick={() => setEditingProfile(false)}>取消</button></div>
        </form> : <dl className="profile-facts"><div><dt>真实经历</dt><dd>{selected.profile.experience}</dd></div><div><dt>擅长领域</dt><dd>{selected.profile.expertise}</dd></div><div><dt>主要受众</dt><dd>{selected.profile.audience}</dd></div><div><dt>表达方式</dt><dd>{selected.profile.voiceStyle}</dd></div><div><dt>内容边界</dt><dd>{selected.profile.boundaries}</dd></div></dl>}
      </article>

      <aside className="evidence-rail"><h2>画像版本</h2><ol className="version-list">{selected.versions.map(version => <li key={version.version}><strong>v{version.version} · {version.display_name}</strong><span>{version.change_summary}</span><time>{new Date(version.created_at).toLocaleString("zh-CN")}</time></li>)}</ol></aside>
    </div>

    <section className="account-management-section"><div className="section-heading"><div><p className="eyebrow">发布身份</p><h2>{selected.displayName}的内容账号</h2></div><button className="secondary-button" onClick={() => setAddingAccount(value => !value)}>新增内容账号</button></div>
      {addingAccount && <form className="account-create-form" onSubmit={addAccount}><label>平台<select name="platform"><option value="wechat_channels">视频号</option><option value="douyin">抖音</option><option value="xiaohongshu">小红书</option><option value="kuaishou">快手</option><option value="other">其他</option></select></label><label>账号名称<input name="accountName" required /></label><label>平台账号 ID（可选）<input name="platformAccountId" /></label><button className="primary-button">保存账号</button></form>}
      <div className="account-card-grid">{selected.accounts.map(account => <article className="account-card" key={account.id}><div><strong>{platformLabels[account.platform] ?? account.platform}｜{account.accountName}</strong><p>{account.platformAccountId || "尚未填写平台账号 ID"}</p></div><span>{account.status === "disabled" ? "已停用" : account.isDefault ? "默认账号" : "使用中"}</span><div className="lead-actions"><button className="secondary-button" onClick={() => void renameAccount(account)}>修改名称</button>{account.status === "active" && !account.isDefault && <button className="secondary-button" onClick={() => void request(`/api/app/settings/ip/accounts/${account.id}/default`, { method: "POST" })}>设为默认</button>}<button className="secondary-button" onClick={() => void request(`/api/app/settings/ip/accounts/${account.id}/${account.status === "active" ? "archive" : "restore"}`, { method: "POST" })}>{account.status === "active" ? "停用" : "恢复"}</button></div></article>)}</div>
    </section>
  </div>
}
