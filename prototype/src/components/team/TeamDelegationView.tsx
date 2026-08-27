"use client"

import { FormEvent, useState } from "react"

type TeamData = {
  members: any[]
  ips: Array<{ id: string; display_name: string }>
  accounts: Array<{ id: string; account_name: string; platform: string }>
  grantableCapabilities: string[]
  audits: any[]
}

const capabilityLabels: Record<string, string> = {
  "ip.view": "查看 IP", "content.create": "生成内容", "content.edit": "编辑文稿", "content.lock": "确认定稿",
  "publication.record": "登记发布", "metrics.import": "导入数据", "review.generate": "生成复盘",
  "review.view": "查看复盘", "review.confirm": "确认复盘记忆", "team.manage": "管理团队",
  "ip.manage": "管理 IP 与账号",
}

export function TeamDelegationView({ initialData }: { initialData: TeamData }) {
  const [data, setData] = useState(initialData)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const [temporaryPassword, setTemporaryPassword] = useState("")
  const [status, setStatus] = useState("")

  async function refresh() {
    const response = await fetch("/api/app/team")
    if (response.ok) setData(await response.json())
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setStatus("正在创建成员…")
    const form = new FormData(event.currentTarget)
    const response = await fetch("/api/app/team", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: form.get("email"), displayName: form.get("displayName"), roleKey: form.get("roleKey"), ipIds: form.getAll("ipIds"), contentAccountIds: form.getAll("contentAccountIds") }),
    })
    const body = await response.json()
    if (!response.ok) { setStatus(body.message ?? "创建失败"); return }
    setTemporaryPassword(body.temporaryPassword); setCreating(false); setStatus("成员已创建，请安全转交临时密码")
    await refresh()
  }

  async function saveAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setStatus("正在保存权限…")
    const form = new FormData(event.currentTarget)
    const response = await fetch(`/api/app/team/members/${editing.membershipId}`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ roleKey: form.get("roleKey"), capabilities: form.getAll("capabilities"), ipIds: form.getAll("ipIds"), contentAccountIds: form.getAll("contentAccountIds") }),
    })
    const body = await response.json()
    if (!response.ok) { setStatus(body.message ?? "保存失败"); return }
    setEditing(null); setStatus("权限已更新"); await refresh()
  }

  async function changeStatus(member: any) {
    const next = member.status === "active" ? "disabled" : "active"
    const response = await fetch(`/api/app/team/members/${member.membershipId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: next }) })
    const body = await response.json()
    setStatus(response.ok ? (next === "active" ? "成员已恢复" : "成员已停用，旧登录已失效") : body.message)
    if (response.ok) await refresh()
  }

  async function resetPassword(member: any) {
    const response = await fetch(`/api/app/team/members/${member.membershipId}`, { method: "POST" })
    const body = await response.json()
    if (!response.ok) { setStatus(body.message ?? "重置失败"); return }
    setTemporaryPassword(body.temporaryPassword); setStatus(`已为 ${member.displayName} 生成新临时密码，旧登录已失效`)
    await refresh()
  }

  return <div className="document-page team-delegation-view">
    <section className="result-lead"><div><p className="eyebrow">团队协作</p><h1>让每个人只看到该负责的内容</h1><p>创建成员时直接分配 IP、内容账号和操作权限；临时密码只展示一次。</p></div><div className="lead-actions"><button className="primary-button" onClick={() => setCreating(value => !value)}>新增成员</button>{status && <p className="inline-status" role="status">{status}</p>}</div></section>

    {temporaryPassword && <section className="workspace-notice" role="status"><strong>一次性临时密码</strong><p className="temporary-password">{temporaryPassword}</p><p>请现在安全转交。关闭后系统不会再次显示。</p><button className="secondary-button" onClick={() => setTemporaryPassword("")}>我已保存</button></section>}

    {creating && <form className="primary-document team-member-form" onSubmit={create}><h2>新增运营成员</h2><label>姓名<input name="displayName" required minLength={2} /></label><label>登录邮箱<input name="email" type="email" required /></label><label>职责<select name="roleKey"><option value="operator">内容运营</option><option value="reviewer">数据复盘</option></select></label><ScopeChoices data={data} /><div className="lead-actions"><button className="primary-button">创建并生成临时密码</button><button type="button" className="secondary-button" onClick={() => setCreating(false)}>取消</button></div></form>}

    <section className="team-member-list"><p className="eyebrow">{data.members.length} 位团队成员</p>{data.members.map(member => <article className="primary-document team-member-card" key={member.membershipId}><div><h2>{member.displayName}{member.isCurrentUser ? "（我）" : ""}</h2><p>{member.email} · {member.roleKey === "owner" ? "团长" : member.roleKey === "reviewer" ? "数据复盘" : "内容运营"}</p></div><p>{member.status === "disabled" ? "已停用" : member.mustChangePassword ? "等待首次修改密码" : "使用中"}</p><p>可访问 {member.ipIds.length} 个 IP、{member.contentAccountIds.length} 个内容账号</p>{!member.isCurrentUser && <div className="lead-actions"><button className="secondary-button" onClick={() => setEditing(member)}>调整权限</button><button className="secondary-button" onClick={() => void resetPassword(member)}>重置密码</button><button className="secondary-button" onClick={() => void changeStatus(member)}>{member.status === "active" ? "停用" : "恢复"}</button></div>}</article>)}</section>

    {editing && <form className="primary-document team-member-form" onSubmit={saveAccess}><h2>调整 {editing.displayName} 的范围</h2><label>职责<select name="roleKey" defaultValue={editing.roleKey}><option value="operator">内容运营</option><option value="reviewer">数据复盘</option></select></label><fieldset><legend>可执行操作</legend>{data.grantableCapabilities.map(value => <label key={value}><input name="capabilities" type="checkbox" value={value} defaultChecked={editing.capabilities.includes(value)} />{capabilityLabels[value] ?? value}</label>)}</fieldset><ScopeChoices data={data} defaults={editing} /><div className="lead-actions"><button className="primary-button">保存权限</button><button type="button" className="secondary-button" onClick={() => setEditing(null)}>取消</button></div></form>}
  </div>
}

function ScopeChoices({ data, defaults }: { data: TeamData; defaults?: any }) {
  return <><fieldset><legend>可访问 IP</legend>{data.ips.map(ip => <label key={ip.id}><input name="ipIds" type="checkbox" value={ip.id} defaultChecked={defaults ? defaults.ipIds.includes(ip.id) : true} />{ip.display_name}</label>)}</fieldset><fieldset><legend>可访问内容账号</legend>{data.accounts.map(account => <label key={account.id}><input name="contentAccountIds" type="checkbox" value={account.id} defaultChecked={defaults ? defaults.contentAccountIds.includes(account.id) : true} />{account.account_name} · {account.platform}</label>)}</fieldset></>
}
