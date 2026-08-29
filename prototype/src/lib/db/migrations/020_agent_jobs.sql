CREATE TABLE agent_jobs (
  id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('tenant','platform')),
  scope_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  job_type TEXT NOT NULL CHECK (job_type IN ('content_analysis')),
  resource_type TEXT NOT NULL CHECK (resource_type IN ('content_sample')),
  resource_id TEXT NOT NULL,
  batch_id TEXT,
  parent_job_id TEXT REFERENCES agent_jobs(id),
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed','timed_out','cancelled')),
  stage TEXT NOT NULL,
  progress_message TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  result_reference TEXT,
  error_code TEXT,
  retryable INTEGER NOT NULL DEFAULT 0 CHECK (retryable IN (0,1)),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 2 CHECK (max_attempts BETWEEN 1 AND 5),
  available_at TEXT NOT NULL,
  heartbeat_at TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(scope_type,scope_id,idempotency_key)
);

CREATE INDEX idx_agent_jobs_queue
  ON agent_jobs(status,job_type,available_at,created_at);

CREATE INDEX idx_agent_jobs_resource
  ON agent_jobs(scope_type,scope_id,resource_type,resource_id,created_at DESC);

CREATE INDEX idx_agent_jobs_batch
  ON agent_jobs(scope_type,scope_id,batch_id,created_at)
  WHERE batch_id IS NOT NULL;

CREATE UNIQUE INDEX idx_agent_jobs_one_active_resource
  ON agent_jobs(scope_type,scope_id,job_type,resource_type,resource_id)
  WHERE status IN ('queued','running');
