ALTER TABLE projects ADD COLUMN asana_task_status_source text DEFAULT 'native' NOT NULL;
ALTER TABLE projects ADD COLUMN asana_task_status_custom_field_gid text;
ALTER TABLE projects ADD COLUMN asana_task_status_custom_field_name text;
