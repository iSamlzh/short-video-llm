CREATE TABLE model_tasks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  run_id TEXT,
  operation TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running','succeeded','failed','cancelled','timed_out')),
  model TEXT,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  request_started_at TEXT NOT NULL,
  request_finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id, idempotency_key)
);

CREATE INDEX idx_model_tasks_active
  ON model_tasks(status, tenant_id, request_started_at);

CREATE INDEX idx_model_tasks_daily_usage
  ON model_tasks(tenant_id, created_at, status);
