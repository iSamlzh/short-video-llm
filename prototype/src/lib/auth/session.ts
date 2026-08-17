import { createHash, randomBytes, randomUUID } from "node:crypto"
import type Database from "better-sqlite3"
import type { ActorAudience } from "../../domain/access"

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex")
}

export class SessionRepository {
  constructor(private readonly database: Database.Database) {}

  create(userId: string, audience: ActorAudience, lifetimeMs = 12 * 60 * 60 * 1000) {
    const rawToken = randomBytes(32).toString("base64url")
    const now = new Date()
    this.database.prepare(`INSERT INTO sessions
      (id,user_id,token_hash,audience,expires_at,revoked_at,created_at) VALUES (?,?,?,?,?,NULL,?)`)
      .run(randomUUID(), userId, hashToken(rawToken), audience, new Date(now.getTime() + lifetimeMs).toISOString(), now.toISOString())
    return rawToken
  }

  resolve(rawToken: string) {
    const row = this.database.prepare(`SELECT s.user_id, s.audience
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.status = 'active'`)
      .get(hashToken(rawToken), new Date().toISOString()) as { user_id: string; audience: ActorAudience } | undefined
    return row ? { userId: row.user_id, audience: row.audience } : null
  }

  revoke(rawToken: string) {
    this.database.prepare("UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL")
      .run(new Date().toISOString(), hashToken(rawToken))
  }
}
