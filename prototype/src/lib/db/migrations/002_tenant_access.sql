CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email_normalized TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  audience TEXT NOT NULL CHECK (audience IN ('tenant','platform')),
  platform_role TEXT CHECK (platform_role IN ('platform_operator','platform_admin') OR platform_role IS NULL),
  status TEXT NOT NULL CHECK (status IN ('active','disabled')),
  data_origin TEXT NOT NULL CHECK (data_origin IN ('demo','formal')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  audience TEXT NOT NULL CHECK (audience IN ('tenant','platform')),
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_active ON sessions(user_id, expires_at, revoked_at);

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','disabled')),
  data_origin TEXT NOT NULL CHECK (data_origin IN ('demo','formal')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memberships (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','disabled')),
  data_origin TEXT NOT NULL CHECK (data_origin IN ('demo','formal')),
  created_at TEXT NOT NULL,
  UNIQUE(tenant_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id, status);

CREATE TABLE IF NOT EXISTS membership_capabilities (
  membership_id TEXT NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  capability TEXT NOT NULL,
  PRIMARY KEY(membership_id, capability)
);

CREATE TABLE IF NOT EXISTS ip_profiles (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  display_name TEXT NOT NULL,
  profile_json TEXT NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'unverified',
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK (status IN ('active','disabled')),
  data_origin TEXT NOT NULL CHECK (data_origin IN ('demo','formal')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ip_profiles_tenant ON ip_profiles(tenant_id, status);

CREATE TABLE IF NOT EXISTS content_accounts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  ip_profile_id TEXT NOT NULL REFERENCES ip_profiles(id),
  platform TEXT NOT NULL,
  account_name TEXT NOT NULL,
  platform_account_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('active','disabled')),
  data_origin TEXT NOT NULL CHECK (data_origin IN ('demo','formal')),
  created_at TEXT NOT NULL,
  UNIQUE(tenant_id, platform, platform_account_id)
);
CREATE INDEX IF NOT EXISTS idx_content_accounts_ip ON content_accounts(tenant_id, ip_profile_id, status);

CREATE TABLE IF NOT EXISTS membership_ip_scopes (
  membership_id TEXT NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  ip_profile_id TEXT NOT NULL REFERENCES ip_profiles(id) ON DELETE CASCADE,
  PRIMARY KEY(membership_id, ip_profile_id)
);

CREATE TABLE IF NOT EXISTS membership_account_scopes (
  membership_id TEXT NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  content_account_id TEXT NOT NULL REFERENCES content_accounts(id) ON DELETE CASCADE,
  PRIMARY KEY(membership_id, content_account_id)
);

CREATE TABLE IF NOT EXISTS user_current_context (
  user_id TEXT NOT NULL REFERENCES users(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  ip_profile_id TEXT REFERENCES ip_profiles(id),
  content_account_id TEXT REFERENCES content_accounts(id),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id, tenant_id)
);

CREATE TABLE IF NOT EXISTS invitations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  email_normalized TEXT NOT NULL,
  role_key TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  revoked_at TEXT,
  invited_by_user_id TEXT NOT NULL REFERENCES users(id),
  data_origin TEXT NOT NULL CHECK (data_origin IN ('demo','formal')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_tenant_time ON audit_logs(tenant_id, created_at);
