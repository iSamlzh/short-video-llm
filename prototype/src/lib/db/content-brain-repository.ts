import type Database from "better-sqlite3"

type VersionInput = {
  id: string
  templateId: string
  version: number
  name: string
  nodes: string[]
  status: "draft" | "active" | "inactive"
  isGeneral: boolean
  dataOrigin: "demo" | "formal"
  actorUserId: string
}

type Row = {
  id: string
  template_id: string
  version: number
  name: string
  payload_json: string
  status: "draft" | "active" | "inactive"
  is_general: number
  data_origin: "demo" | "formal"
  created_at: string
}

export class ContentBrainRepository {
  constructor(private readonly database: Database.Database) {}

  saveVersion(input: VersionInput) {
    const now = new Date().toISOString()
    if (input.status === "active") {
      this.database.prepare("UPDATE platform_template_versions SET status = 'inactive' WHERE template_id = ? AND status = 'active'").run(input.templateId)
    }
    this.database.prepare(`INSERT INTO platform_template_versions
      (id,template_id,version,name,payload_json,status,is_general,data_origin,created_by_user_id,created_at,activated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      input.id, input.templateId, input.version, input.name, JSON.stringify({ nodes: input.nodes }), input.status,
      input.isGeneral ? 1 : 0, input.dataOrigin, input.actorUserId, now, input.status === "active" ? now : null,
    )
    return { ...input, createdAt: now }
  }

  listActive() {
    const rows = this.database.prepare("SELECT * FROM platform_template_versions WHERE status = 'active' ORDER BY is_general, name, version DESC").all() as Row[]
    return rows.map((row) => ({
      id: row.id,
      templateId: row.template_id,
      version: row.version,
      name: row.name,
      nodes: (JSON.parse(row.payload_json) as { nodes: string[] }).nodes,
      status: row.status,
      isGeneral: Boolean(row.is_general),
      dataOrigin: row.data_origin,
      createdAt: row.created_at,
    }))
  }

  retrieveStructures() {
    return this.listActive().slice(0, 3).map((item) => item.nodes.join(" → "))
  }
}
