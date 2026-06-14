CREATE TABLE IF NOT EXISTS asana_webhook_task_states (
  asana_task_gid TEXT PRIMARY KEY,
  asana_workspace_gid TEXT NOT NULL,
  vertex_workspace_id TEXT,
  asana_project_gid TEXT,
  task_name TEXT,
  action TEXT NOT NULL,
  change_action TEXT,
  change_field TEXT,
  status TEXT,
  last_event_at INTEGER NOT NULL,
  raw_event_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS asana_webhook_task_states_workspace_idx
  ON asana_webhook_task_states (asana_workspace_gid, updated_at);

CREATE INDEX IF NOT EXISTS asana_webhook_task_states_vertex_workspace_idx
  ON asana_webhook_task_states (vertex_workspace_id, updated_at);

CREATE INDEX IF NOT EXISTS asana_webhook_task_states_project_idx
  ON asana_webhook_task_states (asana_project_gid, updated_at);
