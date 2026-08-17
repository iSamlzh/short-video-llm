CREATE TABLE IF NOT EXISTS creation_run_context (
  run_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  ip_profile_id TEXT NOT NULL,
  content_account_id TEXT,
  business_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (actor_user_id) REFERENCES users(id),
  FOREIGN KEY (ip_profile_id) REFERENCES ip_profiles(id),
  FOREIGN KEY (content_account_id) REFERENCES content_accounts(id)
);
CREATE INDEX IF NOT EXISTS idx_creation_current
  ON creation_run_context(tenant_id, ip_profile_id, content_account_id, business_date, created_at);
