CREATE TABLE IF NOT EXISTS imported_content_metrics (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  ip_profile_id TEXT NOT NULL,
  content_account_id TEXT NOT NULL,
  content_title TEXT NOT NULL,
  published_at TEXT,
  plays INTEGER NOT NULL,
  completion_rate REAL NOT NULL,
  likes INTEGER NOT NULL,
  comments INTEGER NOT NULL,
  shares INTEGER NOT NULL,
  negative_feedback INTEGER NOT NULL DEFAULT 0,
  source_hash TEXT NOT NULL,
  data_origin TEXT NOT NULL CHECK (data_origin IN ('demo','formal')),
  created_at TEXT NOT NULL,
  UNIQUE(tenant_id, content_account_id, source_hash)
);
CREATE INDEX IF NOT EXISTS idx_metrics_scope ON imported_content_metrics(tenant_id, ip_profile_id, content_account_id, created_at);

CREATE TABLE IF NOT EXISTS tenant_memory_versions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  ip_profile_id TEXT NOT NULL,
  content_account_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  confirmed_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(tenant_id, ip_profile_id, content_account_id, version)
);
