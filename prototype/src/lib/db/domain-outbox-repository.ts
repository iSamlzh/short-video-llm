import { randomUUID } from "node:crypto"
import type Database from "better-sqlite3"

export type StructureOutboxEventType = "structure.match_upserted" | "structure.match_retracted"

type OutboxRow = {
  id: string
  event_type: StructureOutboxEventType
  aggregate_type: string
  aggregate_id: string
  payload_json: string
  attempt_count: number
  max_attempts: number
}

export class DomainOutboxRepository {
  constructor(private readonly database: Database.Database) {}

  enqueue(input: {
    eventType: StructureOutboxEventType
    aggregateType: string
    aggregateId: string
    dedupeKey: string
    payload: Record<string, unknown>
    now?: string
  }) {
    const now = input.now ?? new Date().toISOString()
    this.database.prepare(`INSERT OR IGNORE INTO domain_outbox_events
      (id,event_type,aggregate_type,aggregate_id,dedupe_key,payload_json,status,attempt_count,max_attempts,
       available_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,'pending',0,5,?,?,?)`).run(
      randomUUID(), input.eventType, input.aggregateType, input.aggregateId, input.dedupeKey,
      JSON.stringify(input.payload), now, now, now,
    )
  }

  claim(limit = 20, now = new Date().toISOString()) {
    return this.database.transaction(() => {
      const rows = this.database.prepare(`SELECT * FROM domain_outbox_events
        WHERE status IN ('pending','failed') AND available_at<=? AND attempt_count<max_attempts
        ORDER BY created_at,id LIMIT ?`).all(now, limit) as OutboxRow[]
      const update = this.database.prepare(`UPDATE domain_outbox_events
        SET status='processing',attempt_count=attempt_count+1,updated_at=?
        WHERE id=? AND status IN ('pending','failed')`)
      return rows.filter((row) => update.run(now, row.id).changes === 1).map((row) => ({
        id: row.id,
        eventType: row.event_type,
        aggregateType: row.aggregate_type,
        aggregateId: row.aggregate_id,
        payload: JSON.parse(row.payload_json) as Record<string, unknown>,
        attemptCount: row.attempt_count + 1,
        maxAttempts: row.max_attempts,
      }))
    })()
  }

  complete(id: string, now = new Date().toISOString()) {
    this.database.prepare(`UPDATE domain_outbox_events
      SET status='completed',processed_at=?,last_error=NULL,updated_at=? WHERE id=? AND status='processing'`)
      .run(now, now, id)
  }

  fail(id: string, error: unknown, attemptCount: number, now = new Date().toISOString()) {
    const delaySeconds = Math.min(300, 2 ** Math.min(attemptCount, 8))
    const availableAt = new Date(Date.parse(now) + delaySeconds * 1_000).toISOString()
    const message = (error as Error)?.message?.slice(0, 500) || "UNKNOWN_OUTBOX_ERROR"
    this.database.prepare(`UPDATE domain_outbox_events
      SET status='failed',available_at=?,last_error=?,updated_at=? WHERE id=? AND status='processing'`)
      .run(availableAt, message, now, id)
  }
}
