ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN password_changed_at TEXT;

CREATE INDEX idx_memberships_tenant_status
  ON memberships(tenant_id, status, created_at);
