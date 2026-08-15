PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, state TEXT NOT NULL, input_version INTEGER NOT NULL,
  schema_version INTEGER NOT NULL, ip_profile_json TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS topic_batches (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, version INTEGER NOT NULL, input_version INTEGER NOT NULL, schema_version INTEGER NOT NULL, payload_json TEXT NOT NULL, superseded INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, UNIQUE(run_id, version));
CREATE TABLE IF NOT EXISTS topic_selections (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, version INTEGER NOT NULL, batch_version INTEGER NOT NULL, item_id TEXT NOT NULL, is_current INTEGER NOT NULL, schema_version INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS script_batches (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, version INTEGER NOT NULL, input_version INTEGER NOT NULL, schema_version INTEGER NOT NULL, payload_json TEXT NOT NULL, superseded INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, UNIQUE(run_id, version));
CREATE TABLE IF NOT EXISTS script_selections (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, version INTEGER NOT NULL, batch_version INTEGER NOT NULL, item_id TEXT NOT NULL, is_current INTEGER NOT NULL, schema_version INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS quality_reports (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, version INTEGER NOT NULL, schema_version INTEGER NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(run_id, version));
CREATE TABLE IF NOT EXISTS locked_scripts (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, version INTEGER NOT NULL, schema_version INTEGER NOT NULL, sha256 TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(run_id, version));
CREATE TABLE IF NOT EXISTS metric_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, version INTEGER NOT NULL, schema_version INTEGER NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(run_id, version));
CREATE TABLE IF NOT EXISTS reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, version INTEGER NOT NULL, schema_version INTEGER NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(run_id, version));
CREATE TABLE IF NOT EXISTS step_errors (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, error_code TEXT NOT NULL, message TEXT NOT NULL, retry_from_state TEXT NOT NULL, schema_version INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS commands (idempotency_key TEXT PRIMARY KEY, run_id TEXT NOT NULL, command TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL);
