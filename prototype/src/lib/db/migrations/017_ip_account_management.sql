CREATE TABLE ip_profile_versions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  ip_profile_id TEXT NOT NULL REFERENCES ip_profiles(id),
  version INTEGER NOT NULL,
  display_name TEXT NOT NULL,
  profile_json TEXT NOT NULL,
  change_summary TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE(ip_profile_id, version)
);

CREATE INDEX idx_ip_profile_versions_history
  ON ip_profile_versions(tenant_id, ip_profile_id, version DESC);

INSERT INTO ip_profile_versions
  (id,tenant_id,ip_profile_id,version,display_name,profile_json,change_summary,created_by_user_id,created_at)
SELECT 'backfill-' || i.id || '-' || i.version,i.tenant_id,i.id,i.version,i.display_name,i.profile_json,
  'Migration 017：补录当前画像版本',m.user_id,i.updated_at
FROM ip_profiles i
JOIN memberships m ON m.tenant_id=i.tenant_id AND m.role_key='owner'
WHERE m.id=(SELECT m2.id FROM memberships m2 WHERE m2.tenant_id=i.tenant_id AND m2.role_key='owner' ORDER BY m2.created_at,m2.id LIMIT 1);

ALTER TABLE creation_run_context ADD COLUMN ip_profile_version INTEGER;

UPDATE creation_run_context
SET ip_profile_version=(SELECT version FROM ip_profiles WHERE id=creation_run_context.ip_profile_id)
WHERE ip_profile_version IS NULL;

INSERT OR IGNORE INTO membership_capabilities (membership_id,capability)
SELECT id,'ip.manage' FROM memberships WHERE role_key='owner';
