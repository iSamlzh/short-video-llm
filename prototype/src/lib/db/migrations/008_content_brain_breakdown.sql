ALTER TABLE platform_content_samples ADD COLUMN source_url TEXT;
ALTER TABLE platform_content_samples ADD COLUMN normalized_source_url TEXT;
ALTER TABLE platform_content_samples ADD COLUMN author_reference TEXT;
ALTER TABLE platform_content_samples ADD COLUMN published_at TEXT;
ALTER TABLE platform_content_samples ADD COLUMN captured_at TEXT;
ALTER TABLE platform_content_samples ADD COLUMN metrics_json TEXT;
ALTER TABLE platform_content_samples ADD COLUMN current_revision_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE platform_content_samples ADD COLUMN workflow_status TEXT NOT NULL DEFAULT 'draft'
  CHECK(workflow_status IN ('draft','analyzing','review_required','reviewed','candidate_ready','completed','analysis_failed','rejected'));
ALTER TABLE platform_content_samples ADD COLUMN updated_at TEXT;

CREATE TABLE platform_content_sample_revisions (
  id TEXT PRIMARY KEY,
  sample_id TEXT NOT NULL REFERENCES platform_content_samples(id),
  version INTEGER NOT NULL CHECK(version > 0),
  transcript TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(sample_id, version)
);
CREATE INDEX idx_content_sample_revision_hash ON platform_content_sample_revisions(content_hash);

INSERT INTO platform_content_sample_revisions
  (id,sample_id,version,transcript,content_hash,created_by_user_id,created_at)
SELECT id || '-revision-1',id,1,source_text,id || ':legacy',created_by_user_id,created_at
FROM platform_content_samples;
UPDATE platform_content_samples SET updated_at=created_at WHERE updated_at IS NULL;

CREATE TABLE platform_content_analysis_versions (
  id TEXT PRIMARY KEY,
  sample_id TEXT NOT NULL REFERENCES platform_content_samples(id),
  revision_id TEXT NOT NULL REFERENCES platform_content_sample_revisions(id),
  version INTEGER NOT NULL CHECK(version > 0),
  payload_json TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version INTEGER NOT NULL CHECK(prompt_version > 0),
  token_usage_json TEXT,
  status TEXT NOT NULL CHECK(status IN ('generated','reviewed','rejected')),
  created_by_user_id TEXT NOT NULL,
  reviewed_by_user_id TEXT,
  reviewed_at TEXT,
  review_note TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(sample_id, version)
);

CREATE TABLE platform_structure_candidates (
  id TEXT PRIMARY KEY,
  candidate_key TEXT NOT NULL,
  sample_id TEXT NOT NULL REFERENCES platform_content_samples(id),
  version INTEGER NOT NULL CHECK(version > 0),
  decision TEXT NOT NULL CHECK(decision IN ('merge_existing','upgrade_existing','create_new')),
  target_template_id TEXT,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('draft','preview_ready','activation_required','active','inactive','rejected')),
  data_origin TEXT NOT NULL CHECK(data_origin IN ('demo','formal')),
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  review_note TEXT,
  UNIQUE(candidate_key, version)
);

CREATE TABLE platform_candidate_source_links (
  candidate_id TEXT NOT NULL REFERENCES platform_structure_candidates(id),
  analysis_id TEXT NOT NULL REFERENCES platform_content_analysis_versions(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY(candidate_id, analysis_id)
);

CREATE TABLE platform_structure_previews (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES platform_structure_candidates(id),
  candidate_version INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  model TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE platform_template_activation_events (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  template_version_id TEXT NOT NULL REFERENCES platform_template_versions(id),
  candidate_id TEXT,
  action TEXT NOT NULL CHECK(action IN ('activate','deactivate','rollback')),
  actor_user_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);

ALTER TABLE creation_run_context ADD COLUMN structure_version_ids_json TEXT NOT NULL DEFAULT '[]';
