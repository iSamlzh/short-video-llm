ALTER TABLE creation_run_context ADD COLUMN primary_structure_version_id TEXT;
ALTER TABLE creation_run_context ADD COLUMN supporting_structure_version_ids_json TEXT NOT NULL DEFAULT '[]';

CREATE TABLE structure_usage_records (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  locked_script_version INTEGER NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  ip_profile_id TEXT NOT NULL REFERENCES ip_profiles(id),
  content_account_id TEXT REFERENCES content_accounts(id),
  primary_structure_version_id TEXT REFERENCES platform_template_versions(id),
  supporting_structure_version_ids_json TEXT NOT NULL DEFAULT '[]',
  attribution_status TEXT NOT NULL CHECK(attribution_status IN ('attributed','unattributed')),
  created_at TEXT NOT NULL,
  UNIQUE(run_id, locked_script_version)
);

CREATE INDEX idx_structure_usage_primary
  ON structure_usage_records(primary_structure_version_id, created_at)
  WHERE primary_structure_version_id IS NOT NULL;

CREATE INDEX idx_structure_usage_scope
  ON structure_usage_records(tenant_id, ip_profile_id, content_account_id, created_at);

CREATE TABLE structure_usage_nodes (
  id TEXT PRIMARY KEY,
  usage_id TEXT NOT NULL REFERENCES structure_usage_records(id) ON DELETE CASCADE,
  template_version_id TEXT NOT NULL REFERENCES platform_template_versions(id),
  node_key TEXT NOT NULL,
  segment_id TEXT NOT NULL,
  segment_kind TEXT NOT NULL,
  position INTEGER NOT NULL CHECK(position >= 0),
  created_at TEXT NOT NULL,
  UNIQUE(usage_id, segment_id, template_version_id, node_key)
);

CREATE INDEX idx_structure_usage_nodes_lookup
  ON structure_usage_nodes(template_version_id, node_key, created_at);
