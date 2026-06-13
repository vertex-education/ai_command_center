CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  team_id TEXT,
  project_id TEXT,
  chat_id TEXT,
  mode TEXT NOT NULL CHECK (mode IN ('Personal', 'Team', 'Org')),
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  invalidates_json TEXT NOT NULL DEFAULT '[]',
  source_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  source_client_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS events_scope_idx
  ON events (workspace_id, mode, team_id, id);

CREATE INDEX IF NOT EXISTS events_source_user_idx
  ON events (workspace_id, source_user_id, id);

CREATE INDEX IF NOT EXISTS events_entity_idx
  ON events (entity, entity_id, id);
