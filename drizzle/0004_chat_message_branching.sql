ALTER TABLE "chat_messages" ADD COLUMN "parent_id" text REFERENCES "chat_messages"("id") ON UPDATE no action ON DELETE set null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_messages_parent_idx" ON "chat_messages" ("parent_id");
