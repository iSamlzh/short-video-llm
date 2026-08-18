CREATE TABLE ip_onboarding_sessions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  creator_user_id TEXT NOT NULL REFERENCES users(id),
  display_name TEXT NOT NULL,
  primary_platform TEXT NOT NULL,
  industry_category TEXT NOT NULL,
  question_set_version TEXT NOT NULL,
  state TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  current_question_id TEXT,
  answers_json TEXT NOT NULL DEFAULT '[]',
  selection_trace_json TEXT NOT NULL DEFAULT '[]',
  portrait_draft_json TEXT,
  portrait_draft_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  confirmed_at TEXT
);

CREATE INDEX idx_ip_onboarding_scope
  ON ip_onboarding_sessions(tenant_id, creator_user_id, state, updated_at);
