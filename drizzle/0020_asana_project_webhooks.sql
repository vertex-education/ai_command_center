CREATE TABLE IF NOT EXISTS asana_project_webhooks (
  asana_project_gid TEXT PRIMARY KEY,
  asana_workspace_gid TEXT NOT NULL,
  webhook_gid TEXT,
  target_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'creating' CHECK (status IN ('active', 'creating', 'failed', 'deleted')),
  last_error TEXT,
  created_by_user_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS asana_project_webhooks_workspace_idx
  ON asana_project_webhooks (asana_workspace_gid, updated_at);

CREATE INDEX IF NOT EXISTS asana_project_webhooks_status_idx
  ON asana_project_webhooks (status, updated_at);

CREATE UNIQUE INDEX IF NOT EXISTS asana_project_webhooks_webhook_idx
  ON asana_project_webhooks (webhook_gid);
