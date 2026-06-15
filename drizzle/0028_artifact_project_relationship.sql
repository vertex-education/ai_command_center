ALTER TABLE artifacts ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL;
--> statement-breakpoint
UPDATE artifacts
SET project_id = NULLIF(json_extract(preview_json, '$.projectId'), '')
WHERE json_valid(preview_json)
  AND json_type(preview_json, '$.projectId') = 'text';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS artifacts_workspace_project_idx
  ON artifacts (workspace_id, project_id);
