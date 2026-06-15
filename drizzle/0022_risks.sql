CREATE TABLE IF NOT EXISTS risks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status TEXT NOT NULL DEFAULT 'open',
  mitigation_strategy TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS risks_scope_idx
  ON risks (workspace_id, project_id);

CREATE INDEX IF NOT EXISTS risks_severity_idx
  ON risks (workspace_id, project_id, severity);

CREATE INDEX IF NOT EXISTS risks_status_idx
  ON risks (workspace_id, project_id, status);
