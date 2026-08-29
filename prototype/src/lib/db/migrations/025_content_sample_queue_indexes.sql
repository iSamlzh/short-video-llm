CREATE INDEX IF NOT EXISTS idx_content_samples_workflow_updated
  ON platform_content_samples(workflow_status,updated_at,id);

CREATE INDEX IF NOT EXISTS idx_content_samples_created
  ON platform_content_samples(created_at,id);

CREATE INDEX IF NOT EXISTS idx_content_samples_source_created
  ON platform_content_samples(source_platform,created_at,id);

CREATE INDEX IF NOT EXISTS idx_content_analyses_sample_version
  ON platform_content_analysis_versions(sample_id,version DESC);

CREATE INDEX IF NOT EXISTS idx_structure_candidates_sample_created
  ON platform_structure_candidates(sample_id,created_at DESC,id);
