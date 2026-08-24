ALTER TABLE creation_run_context ADD COLUMN trigger_type TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE creation_run_context ADD COLUMN source_review_id TEXT;

CREATE INDEX idx_creation_run_review_followup
  ON creation_run_context(tenant_id, source_review_id, created_at)
  WHERE source_review_id IS NOT NULL;
