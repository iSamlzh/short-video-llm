import { randomUUID } from "node:crypto"
import type Database from "better-sqlite3"
import {
  onboardingSessionSchema,
  type IndustryCategory,
  type IpOnboardingSession,
  type QuestionAnswer,
} from "../../domain/ip-onboarding"

type SessionRow = {
  id: string
  tenant_id: string
  creator_user_id: string
  display_name: string
  primary_platform: string
  industry_category: string
  question_set_version: string
  state: string
  version: number
  current_question_id: string | null
  answers_json: string
  selection_trace_json: string
  portrait_draft_json: string | null
  portrait_draft_version: number
  created_at: string
  updated_at: string
  confirmed_at: string | null
}

type CreateSessionInput = {
  tenantId: string
  creatorUserId: string
  displayName: string
  primaryPlatform: IpOnboardingSession["primaryPlatform"]
  industryCategory: IndustryCategory
  questionSetVersion: string
  firstQuestionId: string
  createdAt?: string
}

type SaveAnswerInput = {
  sessionId: string
  tenantId: string
  userId: string
  questionId: string
  value: QuestionAnswer["value"]
  signals: string[]
  answeredAt?: string
  expectedVersion: number
}

type UpdateProgressInput = {
  sessionId: string
  tenantId: string
  userId: string
  state: IpOnboardingSession["state"]
  currentQuestionId: string | null
  selectionTrace: IpOnboardingSession["selectionTrace"]
  expectedVersion: number
  updatedAt?: string
}

type SavePortraitDraftInput = {
  sessionId: string
  tenantId: string
  userId: string
  portraitDraft: unknown
  expectedVersion: number
  updatedAt?: string
}

function notFound(): Error {
  return Object.assign(new Error("ONBOARDING_SESSION_NOT_FOUND"), {
    code: "ONBOARDING_SESSION_NOT_FOUND",
  })
}

function versionConflict(): Error {
  return Object.assign(new Error("VERSION_CONFLICT"), { code: "VERSION_CONFLICT" })
}

function mapRow(row: SessionRow): IpOnboardingSession {
  return onboardingSessionSchema.parse({
    id: row.id,
    tenantId: row.tenant_id,
    creatorUserId: row.creator_user_id,
    displayName: row.display_name,
    primaryPlatform: row.primary_platform,
    industryCategory: row.industry_category,
    questionSetVersion: row.question_set_version,
    state: row.state,
    version: row.version,
    currentQuestionId: row.current_question_id,
    answers: JSON.parse(row.answers_json),
    selectionTrace: JSON.parse(row.selection_trace_json),
    portraitDraft: row.portrait_draft_json ? JSON.parse(row.portrait_draft_json) : null,
    portraitDraftVersion: row.portrait_draft_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    confirmedAt: row.confirmed_at,
  })
}

export class IpOnboardingRepository {
  constructor(private readonly database: Database.Database) {}

  create(input: CreateSessionInput): IpOnboardingSession {
    const id = randomUUID()
    const createdAt = input.createdAt ?? new Date().toISOString()
    this.database.prepare(`INSERT INTO ip_onboarding_sessions (
      id, tenant_id, creator_user_id, display_name, primary_platform,
      industry_category, question_set_version, state, version,
      current_question_id, answers_json, selection_trace_json,
      portrait_draft_json, portrait_draft_version, created_at, updated_at, confirmed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ANSWERING', 1, ?, '[]', '[]', NULL, 0, ?, ?, NULL)`)
      .run(
        id,
        input.tenantId,
        input.creatorUserId,
        input.displayName,
        input.primaryPlatform,
        input.industryCategory,
        input.questionSetVersion,
        input.firstQuestionId,
        createdAt,
        createdAt,
      )
    return this.requireScoped(id, input.tenantId, input.creatorUserId)
  }

  requireScoped(id: string, tenantId: string, userId: string): IpOnboardingSession {
    const row = this.database.prepare(`SELECT * FROM ip_onboarding_sessions
      WHERE id = ? AND tenant_id = ? AND creator_user_id = ?`)
      .get(id, tenantId, userId) as SessionRow | undefined
    if (!row) throw notFound()
    return mapRow(row)
  }

  getActiveForUser(tenantId: string, userId: string): IpOnboardingSession | null {
    const row = this.database.prepare(`SELECT * FROM ip_onboarding_sessions
      WHERE tenant_id = ? AND creator_user_id = ?
        AND state NOT IN ('CONFIRMED', 'EXPIRED')
      ORDER BY updated_at DESC, id DESC LIMIT 1`)
      .get(tenantId, userId) as SessionRow | undefined
    return row ? mapRow(row) : null
  }

  saveAnswer(input: SaveAnswerInput): IpOnboardingSession {
    return this.database.transaction(() => {
      const session = this.requireScoped(input.sessionId, input.tenantId, input.userId)
      const answer: QuestionAnswer = {
        questionId: input.questionId,
        questionSetVersion: session.questionSetVersion,
        value: input.value,
        signals: [...input.signals],
        answeredAt: input.answeredAt ?? new Date().toISOString(),
      }
      const answerIndex = session.answers.findIndex(item => item.questionId === input.questionId)
      const answers = [...session.answers]
      if (answerIndex >= 0) answers[answerIndex] = answer
      else answers.push(answer)
      const updatedAt = input.answeredAt ?? new Date().toISOString()

      const result = this.database.prepare(`UPDATE ip_onboarding_sessions
        SET answers_json = ?, version = version + 1, updated_at = ?
        WHERE id = ? AND tenant_id = ? AND creator_user_id = ? AND version = ?`)
        .run(
          JSON.stringify(answers),
          updatedAt,
          input.sessionId,
          input.tenantId,
          input.userId,
          input.expectedVersion,
        )

      if (result.changes !== 1) {
        const exists = this.database.prepare(`SELECT 1 FROM ip_onboarding_sessions
          WHERE id = ? AND tenant_id = ? AND creator_user_id = ?`)
          .get(input.sessionId, input.tenantId, input.userId)
        if (!exists) throw notFound()
        throw versionConflict()
      }

      return this.requireScoped(input.sessionId, input.tenantId, input.userId)
    })()
  }

  updateProgress(input: UpdateProgressInput): IpOnboardingSession {
    const updatedAt = input.updatedAt ?? new Date().toISOString()
    const result = this.database.prepare(`UPDATE ip_onboarding_sessions
      SET state = ?, current_question_id = ?, selection_trace_json = ?,
        version = version + 1, updated_at = ?
      WHERE id = ? AND tenant_id = ? AND creator_user_id = ? AND version = ?`)
      .run(
        input.state,
        input.currentQuestionId,
        JSON.stringify(input.selectionTrace),
        updatedAt,
        input.sessionId,
        input.tenantId,
        input.userId,
        input.expectedVersion,
      )
    this.requireSuccessfulUpdate(result.changes, input)
    return this.requireScoped(input.sessionId, input.tenantId, input.userId)
  }

  savePortraitDraft(input: SavePortraitDraftInput): IpOnboardingSession {
    const updatedAt = input.updatedAt ?? new Date().toISOString()
    const result = this.database.prepare(`UPDATE ip_onboarding_sessions
      SET state = 'PORTRAIT_PREVIEW', current_question_id = NULL,
        portrait_draft_json = ?, portrait_draft_version = portrait_draft_version + 1,
        version = version + 1, updated_at = ?
      WHERE id = ? AND tenant_id = ? AND creator_user_id = ? AND version = ?`)
      .run(
        JSON.stringify(input.portraitDraft),
        updatedAt,
        input.sessionId,
        input.tenantId,
        input.userId,
        input.expectedVersion,
      )
    this.requireSuccessfulUpdate(result.changes, input)
    return this.requireScoped(input.sessionId, input.tenantId, input.userId)
  }

  private requireSuccessfulUpdate(
    changes: number,
    input: { sessionId: string; tenantId: string; userId: string },
  ): void {
    if (changes === 1) return
    const exists = this.database.prepare(`SELECT 1 FROM ip_onboarding_sessions
      WHERE id = ? AND tenant_id = ? AND creator_user_id = ?`)
      .get(input.sessionId, input.tenantId, input.userId)
    if (!exists) throw notFound()
    throw versionConflict()
  }
}
