CREATE TABLE IF NOT EXISTS knowledge_items (
  id TEXT PRIMARY KEY,
  item_type TEXT NOT NULL,
  source_type TEXT NOT NULL,
  title TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  workspace_scope TEXT NOT NULL CHECK (workspace_scope IN ('org', 'team', 'personal')),
  team_id TEXT,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  r2_key TEXT,
  source_url TEXT,
  content_hash TEXT,
  version_label TEXT,
  sensitivity_label TEXT NOT NULL DEFAULT 'Standard' CHECK (sensitivity_label IN ('Standard', 'Confidential')),
  restricted INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'failed')),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  indexed_at TEXT,
  error_message TEXT
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS knowledge_items_scope_idx
  ON knowledge_items (workspace_id, workspace_scope, team_id, project_id, updated_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS knowledge_items_source_idx
  ON knowledge_items (source_type, item_type, updated_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS knowledge_items_status_idx
  ON knowledge_items (status, updated_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  vector_id TEXT NOT NULL UNIQUE,
  vector_tenant_id INTEGER REFERENCES vector_tenant_map(id) ON DELETE SET NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  workspace_scope TEXT NOT NULL CHECK (workspace_scope IN ('org', 'team', 'personal')),
  team_id TEXT,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  r2_key TEXT,
  source_type TEXT NOT NULL,
  item_type TEXT NOT NULL,
  content TEXT NOT NULL,
  sensitivity_label TEXT NOT NULL DEFAULT 'Standard' CHECK (sensitivity_label IN ('Standard', 'Confidential')),
  restricted INTEGER NOT NULL DEFAULT 0,
  token_count INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (item_id, chunk_index)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS knowledge_chunks_tenant_idx
  ON knowledge_chunks (vector_tenant_id, project_id, team_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_chunks_vector_idx
  ON knowledge_chunks (vector_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_chunks_item_chunk_idx
  ON knowledge_chunks (item_id, chunk_index);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS knowledge_chunks_scope_idx
  ON knowledge_chunks (workspace_id, workspace_scope, team_id, project_id, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS knowledge_chunks_item_idx
  ON knowledge_chunks (item_id, chunk_index);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS knowledge_chunks_r2_key_idx
  ON knowledge_chunks (r2_key);
