CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT REFERENCES "organization"(id) ON DELETE CASCADE,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('Weekly Briefing', 'Background Research', 'Artifact Validation')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'paused')),
  enabled INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL DEFAULT '{}',
  schedule_json TEXT NOT NULL DEFAULT '{}',
  next_run_at INTEGER NOT NULL,
  interval_minutes INTEGER,
  retry_delay_minutes INTEGER NOT NULL DEFAULT 15,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  locked_at INTEGER,
  last_run_at INTEGER,
  last_completed_at INTEGER,
  last_error TEXT,
  result_json TEXT,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER) * 1000)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS scheduled_tasks_due_idx
  ON scheduled_tasks (enabled, status, next_run_at, priority);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS scheduled_tasks_org_type_idx
  ON scheduled_tasks (organization_id, type, status, next_run_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS scheduled_tasks_workspace_idx
  ON scheduled_tasks (workspace_id, status, next_run_at);
--> statement-breakpoint
INSERT OR IGNORE INTO scheduled_tasks (
  id,
  type,
  status,
  enabled,
  priority,
  payload_json,
  schedule_json,
  next_run_at,
  interval_minutes,
  retry_delay_minutes,
  max_attempts
) VALUES (
  'system-weekly-briefing-dispatch',
  'Weekly Briefing',
  'pending',
  1,
  100,
  '{"runner":"due-briefing-schedules"}',
  '{"cadence":"hourly"}',
  0,
  60,
  15,
  3
);
--> statement-breakpoint
INSERT OR IGNORE INTO scheduled_tasks (
  id,
  type,
  status,
  enabled,
  priority,
  payload_json,
  schedule_json,
  next_run_at,
  interval_minutes,
  retry_delay_minutes,
  max_attempts
) VALUES (
  'system-artifact-validation',
  'Artifact Validation',
  'pending',
  1,
  25,
  '{"staleAfterHours":24}',
  '{"cadence":"hourly"}',
  0,
  60,
  15,
  3
);
