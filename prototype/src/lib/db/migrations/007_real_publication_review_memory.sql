CREATE TABLE publications (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  ip_profile_id TEXT NOT NULL REFERENCES ip_profiles(id),
  content_account_id TEXT NOT NULL REFERENCES content_accounts(id),
  platform TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('system','external')),
  run_id TEXT,
  locked_script_version INTEGER,
  locked_script_selection_version INTEGER,
  title TEXT NOT NULL,
  platform_video_id TEXT,
  video_url TEXT,
  normalized_video_url TEXT,
  published_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','disabled')),
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  CHECK(source = 'external' OR (
    run_id IS NOT NULL
    AND locked_script_version IS NOT NULL
    AND locked_script_selection_version IS NOT NULL
  ))
);

CREATE UNIQUE INDEX uq_publication_video_id
  ON publications(tenant_id, content_account_id, platform, platform_video_id)
  WHERE platform_video_id IS NOT NULL AND status = 'active';
CREATE UNIQUE INDEX uq_publication_url
  ON publications(tenant_id, content_account_id, platform, normalized_video_url)
  WHERE normalized_video_url IS NOT NULL AND status = 'active';
CREATE INDEX idx_publications_scope_time
  ON publications(tenant_id, ip_profile_id, content_account_id, platform, published_at);

CREATE TABLE metric_import_batches (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  ip_profile_id TEXT NOT NULL REFERENCES ip_profiles(id),
  content_account_id TEXT NOT NULL REFERENCES content_accounts(id),
  platform TEXT NOT NULL,
  filename TEXT NOT NULL,
  file_sha256 TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('processing','parsed','matched','review_ready','completed','failed')),
  total_rows INTEGER NOT NULL DEFAULT 0 CHECK(total_rows >= 0),
  inserted_rows INTEGER NOT NULL DEFAULT 0 CHECK(inserted_rows >= 0),
  duplicate_rows INTEGER NOT NULL DEFAULT 0 CHECK(duplicate_rows >= 0),
  error_rows INTEGER NOT NULL DEFAULT 0 CHECK(error_rows >= 0),
  candidate_rows INTEGER NOT NULL DEFAULT 0 CHECK(candidate_rows >= 0),
  unmatched_rows INTEGER NOT NULL DEFAULT 0 CHECK(unmatched_rows >= 0),
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id, content_account_id, file_sha256)
);
CREATE INDEX idx_batches_scope_time
  ON metric_import_batches(tenant_id, ip_profile_id, content_account_id, created_at);

CREATE TABLE metric_import_row_errors (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES metric_import_batches(id),
  row_number INTEGER NOT NULL CHECK(row_number > 0),
  error_code TEXT NOT NULL,
  message TEXT NOT NULL,
  redacted_reference TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(batch_id, row_number, error_code)
);

CREATE TABLE real_metric_snapshots (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  ip_profile_id TEXT NOT NULL REFERENCES ip_profiles(id),
  content_account_id TEXT NOT NULL REFERENCES content_accounts(id),
  platform TEXT NOT NULL,
  platform_content_key TEXT NOT NULL,
  platform_video_id TEXT,
  video_url TEXT,
  normalized_video_url TEXT,
  title TEXT NOT NULL,
  published_at TEXT,
  captured_at TEXT NOT NULL,
  impressions INTEGER CHECK(impressions IS NULL OR impressions >= 0),
  plays INTEGER CHECK(plays IS NULL OR plays >= 0),
  completions INTEGER CHECK(completions IS NULL OR completions >= 0),
  completion_rate REAL CHECK(completion_rate IS NULL OR (completion_rate >= 0 AND completion_rate <= 1)),
  likes INTEGER CHECK(likes IS NULL OR likes >= 0),
  comments INTEGER CHECK(comments IS NULL OR comments >= 0),
  saves INTEGER CHECK(saves IS NULL OR saves >= 0),
  shares INTEGER CHECK(shares IS NULL OR shares >= 0),
  inquiries INTEGER CHECK(inquiries IS NULL OR inquiries >= 0),
  negative_feedback INTEGER CHECK(negative_feedback IS NULL OR negative_feedback >= 0),
  is_simulated INTEGER NOT NULL CHECK(is_simulated = 0),
  source_batch_id TEXT NOT NULL REFERENCES metric_import_batches(id),
  source_row_number INTEGER NOT NULL CHECK(source_row_number > 0),
  created_at TEXT NOT NULL,
  UNIQUE(tenant_id, content_account_id, platform_content_key, captured_at)
);
CREATE INDEX idx_snapshots_scope_time
  ON real_metric_snapshots(tenant_id, ip_profile_id, content_account_id, captured_at);

CREATE TABLE publication_match_versions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  ip_profile_id TEXT NOT NULL REFERENCES ip_profiles(id),
  content_account_id TEXT NOT NULL REFERENCES content_accounts(id),
  snapshot_id TEXT NOT NULL REFERENCES real_metric_snapshots(id),
  publication_id TEXT REFERENCES publications(id),
  candidate_ids_json TEXT NOT NULL,
  method TEXT NOT NULL CHECK(method IN (
    'exact_video_id','exact_url','exact_title_time','similarity_candidate','manual_existing','manual_external_created'
  )),
  status TEXT NOT NULL CHECK(status IN ('matched','candidate','unmatched','rejected')),
  explanation TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version > 0),
  is_current INTEGER NOT NULL CHECK(is_current IN (0,1)),
  confirmed_by_user_id TEXT REFERENCES users(id),
  confirmed_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(snapshot_id, version)
);
CREATE UNIQUE INDEX uq_current_publication_match
  ON publication_match_versions(snapshot_id) WHERE is_current = 1;

CREATE TABLE review_generation_checkpoints (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  ip_profile_id TEXT NOT NULL REFERENCES ip_profiles(id),
  content_account_id TEXT NOT NULL REFERENCES content_accounts(id),
  evidence_set_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','running','completed','failed')),
  review_id TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id, ip_profile_id, content_account_id, evidence_set_hash)
);

CREATE TABLE content_review_versions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  ip_profile_id TEXT NOT NULL REFERENCES ip_profiles(id),
  content_account_id TEXT NOT NULL REFERENCES content_accounts(id),
  version INTEGER NOT NULL CHECK(version > 0),
  sample_tier TEXT NOT NULL CHECK(sample_tier IN ('facts_only','tentative','memory_eligible')),
  evidence_cutoff_at TEXT NOT NULL,
  evidence_set_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  model TEXT,
  prompt_version INTEGER NOT NULL CHECK(prompt_version > 0),
  token_usage_json TEXT,
  status TEXT NOT NULL CHECK(status IN ('generated','superseded','confirmed')),
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE(tenant_id, ip_profile_id, content_account_id, version),
  UNIQUE(tenant_id, ip_profile_id, content_account_id, evidence_set_hash)
);
CREATE INDEX idx_reviews_scope_version
  ON content_review_versions(tenant_id, ip_profile_id, content_account_id, version);

CREATE TABLE review_evidence_links (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL REFERENCES content_review_versions(id),
  publication_id TEXT NOT NULL REFERENCES publications(id),
  snapshot_id TEXT NOT NULL REFERENCES real_metric_snapshots(id),
  purpose TEXT NOT NULL CHECK(purpose IN ('observation','hypothesis_for','hypothesis_against','baseline')),
  created_at TEXT NOT NULL,
  UNIQUE(review_id, snapshot_id, purpose)
);

ALTER TABLE tenant_memory_versions ADD COLUMN source_review_id TEXT;
ALTER TABLE tenant_memory_versions ADD COLUMN content_hash TEXT;
ALTER TABLE tenant_memory_versions ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE creation_run_context ADD COLUMN tenant_memory_version INTEGER;

CREATE UNIQUE INDEX uq_memory_review_hash
  ON tenant_memory_versions(source_review_id, content_hash)
  WHERE source_review_id IS NOT NULL AND content_hash IS NOT NULL;
