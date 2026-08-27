ALTER TABLE model_tasks ADD COLUMN request_id TEXT;

CREATE INDEX idx_model_tasks_request_id
  ON model_tasks(request_id)
  WHERE request_id IS NOT NULL;
