ALTER TABLE quality_reports ADD COLUMN script_selection_version INTEGER;
ALTER TABLE locked_scripts ADD COLUMN script_selection_version INTEGER;

CREATE INDEX IF NOT EXISTS idx_quality_report_lineage
  ON quality_reports(run_id, script_selection_version, version);

CREATE UNIQUE INDEX IF NOT EXISTS idx_locked_script_selection
  ON locked_scripts(run_id, script_selection_version)
  WHERE script_selection_version IS NOT NULL;
