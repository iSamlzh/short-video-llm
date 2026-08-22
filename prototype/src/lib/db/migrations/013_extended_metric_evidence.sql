ALTER TABLE real_metric_snapshots ADD COLUMN three_second_retention REAL;
ALTER TABLE real_metric_snapshots ADD COLUMN five_second_retention REAL;
ALTER TABLE real_metric_snapshots ADD COLUMN average_watch_seconds REAL;
ALTER TABLE real_metric_snapshots ADD COLUMN profile_visits INTEGER;
ALTER TABLE real_metric_snapshots ADD COLUMN followers_gained INTEGER;
ALTER TABLE real_metric_snapshots ADD COLUMN raw_columns_json TEXT NOT NULL DEFAULT '{}';
