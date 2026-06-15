ALTER TABLE workspace_actions ADD COLUMN outbound_status TEXT NOT NULL DEFAULT 'Pending';
--> statement-breakpoint
ALTER TABLE workspace_actions ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'NotQueued';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS vector_tenant_map (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  team_id TEXT,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  tenant_key TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS vector_tenant_map_tenant_key_idx
  ON vector_tenant_map (tenant_key);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS vector_tenant_map_scope_idx
  ON vector_tenant_map (workspace_id, team_id, project_id);
--> statement-breakpoint
ALTER TABLE document_chunks ADD COLUMN vector_tenant_id INTEGER REFERENCES vector_tenant_map(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS document_chunks_vector_tenant_idx
  ON document_chunks (vector_tenant_id, project_id, team_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS extracted_tasks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_message_id TEXT REFERENCES chat_messages(id) ON DELETE SET NULL,
  task_description TEXT NOT NULL,
  confidence_score REAL NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS extracted_tasks_workspace_idx
  ON extracted_tasks (workspace_id, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS extracted_tasks_source_message_idx
  ON extracted_tasks (source_message_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS project_risks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  risk_category TEXT NOT NULL CHECK (risk_category IN ('security', 'technical', 'delivery', 'operational', 'compliance')),
  severity_level TEXT NOT NULL CHECK (severity_level IN ('low', 'medium', 'high', 'critical')),
  mitigation_suggestion TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS project_risks_project_idx
  ON project_risks (project_id, severity_level, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS project_risks_category_idx
  ON project_risks (project_id, risk_category);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS briefings (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  markdown_content TEXT NOT NULL,
  source_data_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS briefings_source_data_hash_idx
  ON briefings (source_data_hash);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS briefings_workspace_idx
  ON briefings (workspace_id, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS briefings_project_idx
  ON briefings (project_id, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS workspace_actions_sync_status_idx
  ON workspace_actions (workspace_id, kind, sync_status);
