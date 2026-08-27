CREATE TABLE model_tasks_v2 (
  id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES tenants(id),
  scope_type TEXT NOT NULL CHECK (scope_type IN ('tenant','platform')),
  scope_id TEXT NOT NULL,
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
  request_id TEXT,
  request_started_at TEXT NOT NULL,
  request_finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (scope_type='tenant' AND tenant_id IS NOT NULL AND tenant_id=scope_id)
    OR (scope_type='platform' AND tenant_id IS NULL)
  ),
  UNIQUE(scope_type, scope_id, idempotency_key)
);

INSERT INTO model_tasks_v2 (
  id,tenant_id,scope_type,scope_id,actor_user_id,run_id,operation,idempotency_key,status,
  model,prompt_tokens,completion_tokens,total_tokens,error_code,request_id,
  request_started_at,request_finished_at,created_at,updated_at
)
SELECT
  id,tenant_id,'tenant',tenant_id,actor_user_id,run_id,operation,idempotency_key,status,
  model,prompt_tokens,completion_tokens,total_tokens,error_code,request_id,
  request_started_at,request_finished_at,created_at,updated_at
FROM model_tasks;

DROP TABLE model_tasks;
ALTER TABLE model_tasks_v2 RENAME TO model_tasks;

CREATE INDEX idx_model_tasks_active
  ON model_tasks(status, scope_type, scope_id, request_started_at);

CREATE INDEX idx_model_tasks_daily_usage
  ON model_tasks(scope_type, scope_id, created_at, status);

CREATE INDEX idx_model_tasks_request_id
  ON model_tasks(request_id)
  WHERE request_id IS NOT NULL;
