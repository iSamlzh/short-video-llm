CREATE TABLE IF NOT EXISTS user_current_tenant (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_current_tenant_team
  ON user_current_tenant(tenant_id, user_id);
