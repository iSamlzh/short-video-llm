CREATE TABLE domain_outbox_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL CHECK(event_type IN ('structure.match_upserted','structure.match_retracted')),
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','processing','completed','failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK(max_attempts BETWEEN 1 AND 20),
  available_at TEXT NOT NULL,
  last_error TEXT,
  processed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_domain_outbox_pending
  ON domain_outbox_events(status, available_at, created_at);

CREATE TABLE platform_structure_observations (
  id TEXT PRIMARY KEY,
  source_fingerprint TEXT NOT NULL UNIQUE,
  scope_fingerprint TEXT NOT NULL,
  publication_fingerprint TEXT NOT NULL,
  structure_version_id TEXT NOT NULL REFERENCES platform_template_versions(id),
  node_keys_json TEXT NOT NULL,
  platform TEXT NOT NULL,
  context_bucket_json TEXT NOT NULL,
  evidence_tier TEXT NOT NULL CHECK(evidence_tier IN ('fact','tentative','confirmed')),
  metrics_json TEXT NOT NULL,
  metric_delta_json TEXT NOT NULL,
  data_quality_json TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','invalidated')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_structure_observation_version
  ON platform_structure_observations(structure_version_id, status, captured_at);

CREATE INDEX idx_structure_observation_platform
  ON platform_structure_observations(platform, status, captured_at);

CREATE INDEX idx_structure_observation_scope
  ON platform_structure_observations(structure_version_id, scope_fingerprint, status);

CREATE TABLE structure_observation_source_links (
  observation_id TEXT PRIMARY KEY REFERENCES platform_structure_observations(id) ON DELETE CASCADE,
  usage_id TEXT NOT NULL REFERENCES structure_usage_records(id),
  publication_id TEXT NOT NULL REFERENCES publications(id),
  snapshot_id TEXT NOT NULL REFERENCES real_metric_snapshots(id),
  match_id TEXT NOT NULL REFERENCES publication_match_versions(id),
  created_at TEXT NOT NULL,
  UNIQUE(match_id)
);

CREATE INDEX idx_structure_observation_source_publication
  ON structure_observation_source_links(publication_id, snapshot_id);
