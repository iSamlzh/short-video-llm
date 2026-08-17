CREATE TABLE IF NOT EXISTS platform_content_samples (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  source_platform TEXT NOT NULL,
  source_text TEXT NOT NULL,
  rights_note TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','reviewed','rejected')),
  data_origin TEXT NOT NULL CHECK (data_origin IN ('demo','formal')),
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS platform_template_versions (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  name TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','active','inactive')),
  is_general INTEGER NOT NULL DEFAULT 0,
  data_origin TEXT NOT NULL CHECK (data_origin IN ('demo','formal')),
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  activated_at TEXT,
  UNIQUE(template_id, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_template
  ON platform_template_versions(template_id) WHERE status = 'active';
