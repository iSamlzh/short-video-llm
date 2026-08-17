import { afterEach, describe, expect, it } from "vitest"
import type Database from "better-sqlite3"
import { openDatabase } from "../../src/lib/db/database"
import { IdentityRepository } from "../../src/lib/db/identity-repository"
import { LocalIdentityProvider } from "../../src/lib/auth/local-identity-provider"
import { SessionRepository } from "../../src/lib/auth/session"

let database: Database.Database | undefined

afterEach(() => database?.close())

describe("local identity and opaque sessions", () => {
  it("authenticates a normalized email but rejects a wrong password", async () => {
    database = openDatabase(":memory:")
    const identities = new IdentityRepository(database)
    const provider = new LocalIdentityProvider(identities)
    await provider.createUser({
      id: "user-owner",
      email: "Owner@Example.Test ",
      displayName: "林姐",
      password: "correct horse battery staple",
      audience: "tenant",
      dataOrigin: "demo",
    })

    await expect(provider.authenticate(" owner@example.test", "correct horse battery staple"))
      .resolves.toEqual({ userId: "user-owner", audience: "tenant" })
    await expect(provider.authenticate("owner@example.test", "wrong password"))
      .rejects.toThrowError("INVALID_CREDENTIALS")
  })

  it("stores only the hash of an opaque session token", async () => {
    database = openDatabase(":memory:")
    const identities = new IdentityRepository(database)
    const provider = new LocalIdentityProvider(identities)
    await provider.createUser({
      id: "user-owner",
      email: "owner@example.test",
      displayName: "林姐",
      password: "correct horse battery staple",
      audience: "tenant",
      dataOrigin: "demo",
    })
    const sessions = new SessionRepository(database)

    const rawToken = sessions.create("user-owner", "tenant")
    const stored = database.prepare("SELECT token_hash FROM sessions").get() as { token_hash: string }

    expect(rawToken).not.toContain("user-owner")
    expect(stored.token_hash).not.toBe(rawToken)
    expect(sessions.resolve(rawToken)).toMatchObject({ userId: "user-owner", audience: "tenant" })
  })
})
