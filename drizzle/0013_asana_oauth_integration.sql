CREATE TABLE IF NOT EXISTS asana_oauth_states (
  state_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  code_verifier TEXT NOT NULL,
  redirect_to TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS asana_oauth_states_user_idx
  ON asana_oauth_states (user_id, expires_at);

CREATE TABLE IF NOT EXISTS asana_connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  asana_user_gid TEXT NOT NULL,
  asana_user_name TEXT NOT NULL,
  asana_user_email TEXT,
  scopes TEXT NOT NULL,
  connected_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS asana_connections_user_idx
  ON asana_connections (user_id);

CREATE INDEX IF NOT EXISTS asana_connections_asana_user_idx
  ON asana_connections (asana_user_gid);

CREATE TABLE IF NOT EXISTS asana_project_mappings (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES asana_connections(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  asana_workspace_gid TEXT NOT NULL,
  asana_workspace_name TEXT NOT NULL,
  asana_project_gid TEXT NOT NULL,
  asana_project_name TEXT NOT NULL,
  asana_team_gid TEXT,
  vertex_workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  vertex_mode TEXT NOT NULL CHECK (vertex_mode IN ('Personal', 'Team', 'Org')),
  vertex_team_id TEXT,
  vertex_project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  vertex_chat_id TEXT REFERENCES chats(id) ON DELETE SET NULL,
  can_write_tasks INTEGER NOT NULL DEFAULT 0,
  permission_level TEXT NOT NULL DEFAULT 'read',
  permission_source TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS asana_project_mappings_project_idx
  ON asana_project_mappings (asana_project_gid);

CREATE INDEX IF NOT EXISTS asana_project_mappings_vertex_project_idx
  ON asana_project_mappings (vertex_project_id);

CREATE INDEX IF NOT EXISTS asana_project_mappings_user_idx
  ON asana_project_mappings (user_id, updated_at);
