import type Database from "better-sqlite3"
import type { ActorAudience } from "../../domain/access"

type UserRow = {
  id: string
  email_normalized: string
  display_name: string
  password_hash: string
  audience: ActorAudience
  platform_role: "platform_operator" | "platform_admin" | null
  status: "active" | "disabled"
}

export class IdentityRepository {
  constructor(private readonly database: Database.Database) {}

  create(input: {
    id: string
    emailNormalized: string
    displayName: string
    passwordHash: string
    audience: ActorAudience
    platformRole?: "platform_operator" | "platform_admin"
    dataOrigin: "demo" | "formal"
  }) {
    this.database.prepare(`INSERT INTO users
      (id,email_normalized,display_name,password_hash,audience,platform_role,status,data_origin,created_at)
      VALUES (?,?,?,?,?,?, 'active', ?, ?)`)
      .run(input.id, input.emailNormalized, input.displayName, input.passwordHash, input.audience,
        input.platformRole ?? null, input.dataOrigin, new Date().toISOString())
  }

  findByEmail(emailNormalized: string) {
    return this.database.prepare("SELECT * FROM users WHERE email_normalized = ?").get(emailNormalized) as UserRow | undefined
  }
}
