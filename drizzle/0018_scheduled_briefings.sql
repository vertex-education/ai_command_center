ALTER TABLE "chat_messages" ADD COLUMN "type" text DEFAULT 'message' NOT NULL;
--> statement-breakpoint
ALTER TABLE "workspace_actions" ADD COLUMN "created_at" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_actions_kind_created_idx" ON "workspace_actions" ("workspace_id", "kind", "created_at");
