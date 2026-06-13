CREATE TABLE IF NOT EXISTS document_chunks (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  document_name TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS document_chunks_scope_idx
  ON document_chunks (team_id, project_id, created_at);

CREATE INDEX IF NOT EXISTS document_chunks_r2_key_idx
  ON document_chunks (r2_key);
