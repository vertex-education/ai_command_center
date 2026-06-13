CREATE TABLE IF NOT EXISTS artifacts_registry (
  id TEXT PRIMARY KEY,
  original_filename TEXT NOT NULL,
  mime_type TEXT,
  file_size INTEGER NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  scope_level TEXT NOT NULL CHECK (scope_level IN ('org', 'team', 'personal')),
  scope_id TEXT NOT NULL,
  project_id TEXT,
  document_type TEXT NOT NULL,
  custom_tags_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error_message TEXT,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  uploaded_by_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS artifacts_registry_scope_idx
  ON artifacts_registry (scope_level, scope_id, project_id, status, created_at);

CREATE INDEX IF NOT EXISTS artifacts_registry_r2_key_idx
  ON artifacts_registry (r2_key);

CREATE INDEX IF NOT EXISTS artifacts_registry_document_type_idx
  ON artifacts_registry (document_type, status);

CREATE TABLE IF NOT EXISTS document_chunks_v2 (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES artifacts_registry(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  vector_id TEXT NOT NULL UNIQUE,
  r2_key TEXT NOT NULL,
  content TEXT NOT NULL,
  scope_level TEXT NOT NULL CHECK (scope_level IN ('org', 'team', 'personal')),
  scope_id TEXT NOT NULL,
  project_id TEXT,
  document_type TEXT NOT NULL,
  custom_tags_json TEXT NOT NULL DEFAULT '[]',
  sensitivity_label TEXT NOT NULL DEFAULT 'Standard' CHECK (sensitivity_label IN ('Standard', 'Confidential')),
  restricted INTEGER NOT NULL DEFAULT 0,
  token_count INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (artifact_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS document_chunks_v2_scope_idx
  ON document_chunks_v2 (scope_level, scope_id, project_id, created_at);

CREATE INDEX IF NOT EXISTS document_chunks_v2_artifact_idx
  ON document_chunks_v2 (artifact_id, chunk_index);

CREATE INDEX IF NOT EXISTS document_chunks_v2_r2_key_idx
  ON document_chunks_v2 (r2_key);
