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
  must_change_password: number
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
    mustChangePassword?: boolean
  }) {
    this.database.prepare(`INSERT INTO users
      (id,email_normalized,display_name,password_hash,audience,platform_role,status,data_origin,created_at,must_change_password)
      VALUES (?,?,?,?,?,?, 'active', ?, ?, ?)`)
      .run(input.id, input.emailNormalized, input.displayName, input.passwordHash, input.audience,
        input.platformRole ?? null, input.dataOrigin, new Date().toISOString(), input.mustChangePassword ? 1 : 0)
  }

  findByEmail(emailNormalized: string) {
    return this.database.prepare("SELECT * FROM users WHERE email_normalized = ?").get(emailNormalized) as UserRow | undefined
  }

  updatePassword(userId: string, passwordHash: string, mustChangePassword: boolean) {
    this.database.prepare(`UPDATE users SET password_hash=?,must_change_password=?,password_changed_at=? WHERE id=?`)
      .run(passwordHash, mustChangePassword ? 1 : 0, mustChangePassword ? null : new Date().toISOString(), userId)
  }
}
