import { hashPassword, verifyPassword } from "./password"
import type { IdentityProvider } from "./identity-provider"
import type { ActorAudience } from "../../domain/access"
import { IdentityRepository } from "../db/identity-repository"

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

export class LocalIdentityProvider implements IdentityProvider {
  constructor(private readonly identities: IdentityRepository) {}

  async createUser(input: {
    id: string
    email: string
    displayName: string
    password: string
    audience: ActorAudience
    platformRole?: "platform_operator" | "platform_admin"
    dataOrigin: "demo" | "formal"
    mustChangePassword?: boolean
  }) {
    this.identities.create({
      ...input,
      emailNormalized: normalizeEmail(input.email),
      passwordHash: await hashPassword(input.password),
    })
  }

  async authenticate(email: string, password: string) {
    const user = this.identities.findByEmail(normalizeEmail(email))
    const valid = user?.status === "active" && await verifyPassword(password, user.password_hash)
    if (!user || !valid) throw new Error("INVALID_CREDENTIALS")
    return { userId: user.id, audience: user.audience, mustChangePassword: Boolean(user.must_change_password) }
  }
}
