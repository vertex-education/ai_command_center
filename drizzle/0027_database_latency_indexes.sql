CREATE INDEX IF NOT EXISTS workspace_actions_asana_task_gid_idx
  ON workspace_actions (asana_task_gid, kind);
