CREATE TABLE IF NOT EXISTS "briefing_schedules" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  "workspace_id" text NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "project_id" text REFERENCES "projects"("id") ON DELETE cascade,
  "chat_id" text REFERENCES "chats"("id") ON DELETE set null,
  "title" text NOT NULL,
  "enabled" integer DEFAULT 1 NOT NULL,
  "recurrence" text NOT NULL,
  "time_zone" text NOT NULL,
  "local_time" text NOT NULL,
  "weekdays_json" text DEFAULT '[]' NOT NULL,
  "month_day" integer,
  "run_once_at" integer,
  "reporting_window_hours" integer DEFAULT 24 NOT NULL,
  "prompt_instructions" text DEFAULT '' NOT NULL,
  "next_run_at" integer,
  "last_run_at" integer,
  "last_status" text,
  "last_error" text,
  "created_at" integer NOT NULL,
  "updated_at" integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "briefing_schedules_user_idx" ON "briefing_schedules" ("user_id", "updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "briefing_schedules_due_idx" ON "briefing_schedules" ("enabled", "next_run_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "briefing_schedules_scope_idx" ON "briefing_schedules" ("workspace_id", "project_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "briefing_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "schedule_id" text REFERENCES "briefing_schedules"("id") ON DELETE set null,
  "chat_message_id" text REFERENCES "chat_messages"("id") ON DELETE set null,
  "trigger" text NOT NULL,
  "status" text NOT NULL,
  "output_markdown" text,
  "error" text,
  "created_at" integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "briefing_runs_schedule_idx" ON "briefing_runs" ("schedule_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "briefing_runs_status_idx" ON "briefing_runs" ("status", "created_at");
