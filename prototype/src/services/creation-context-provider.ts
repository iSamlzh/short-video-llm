import type Database from "better-sqlite3"
import type { GrowthScope } from "../domain/growth-loop"
import { ReviewMemoryRepository, toConfirmedCreationMemory } from "../lib/db/review-memory-repository"

export class CreationContextProvider {
  private readonly memories: ReviewMemoryRepository
  constructor(database: Database.Database) { this.memories = new ReviewMemoryRepository(database) }

  getCurrent(scope: GrowthScope) {
    const memory = this.memories.getCurrentMemory(scope)
    return memory ? toConfirmedCreationMemory(memory) : null
  }

  getVersion(scope: GrowthScope, version: number) {
    try { return toConfirmedCreationMemory(this.memories.requireMemory(scope, version)) }
    catch (error) {
      if (error instanceof Error && error.message === "TENANT_MEMORY_NOT_FOUND") return null
      throw error
    }
  }
}
