CREATE TABLE platform_structure_evaluations (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  template_version_id TEXT NOT NULL REFERENCES platform_template_versions(id),
  version INTEGER NOT NULL CHECK(version > 0),
  input_hash TEXT NOT NULL,
  window_start TEXT,
  window_end TEXT,
  publication_count INTEGER NOT NULL CHECK(publication_count >= 0),
  scope_count INTEGER NOT NULL CHECK(scope_count >= 0),
  eligible_publication_count INTEGER NOT NULL CHECK(eligible_publication_count >= 0),
  aggregate_json TEXT NOT NULL,
  confidence TEXT NOT NULL CHECK(confidence IN ('facts_only','exploratory','standard')),
  algorithm_version INTEGER NOT NULL,
  policy_version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('building','current','superseded','failed')),
  created_at TEXT NOT NULL,
  UNIQUE(template_version_id, input_hash),
  UNIQUE(template_version_id, version)
);

CREATE UNIQUE INDEX idx_structure_evaluation_current
  ON platform_structure_evaluations(template_version_id) WHERE status='current';

CREATE TABLE platform_structure_evaluation_evidence (
  evaluation_id TEXT NOT NULL REFERENCES platform_structure_evaluations(id) ON DELETE CASCADE,
  observation_id TEXT NOT NULL REFERENCES platform_structure_observations(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY(evaluation_id, observation_id)
);

ALTER TABLE platform_structure_candidates ADD COLUMN source_type TEXT NOT NULL DEFAULT 'sample_breakdown'
  CHECK(source_type IN ('sample_breakdown','outcome_evolution'));
ALTER TABLE platform_structure_candidates ADD COLUMN source_reference_id TEXT;
ALTER TABLE platform_structure_candidates ADD COLUMN base_template_version_id TEXT REFERENCES platform_template_versions(id);
ALTER TABLE platform_structure_candidates ADD COLUMN change_type TEXT;
ALTER TABLE platform_structure_candidates ADD COLUMN generated_by_model_task_id TEXT;

CREATE TABLE platform_candidate_evaluation_links (
  candidate_id TEXT NOT NULL REFERENCES platform_structure_candidates(id),
  evaluation_id TEXT NOT NULL REFERENCES platform_structure_evaluations(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY(candidate_id, evaluation_id),
  UNIQUE(evaluation_id)
);

CREATE TABLE platform_candidate_observation_evidence (
  candidate_id TEXT NOT NULL REFERENCES platform_structure_candidates(id),
  observation_id TEXT NOT NULL REFERENCES platform_structure_observations(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY(candidate_id, observation_id)
);

CREATE INDEX idx_structure_candidate_source
  ON platform_structure_candidates(source_type, source_reference_id);
