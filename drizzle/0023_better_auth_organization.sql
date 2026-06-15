ALTER TABLE "session" ADD COLUMN "activeOrganizationId" text;

CREATE INDEX IF NOT EXISTS "session_active_organization_idx"
  ON "session" ("activeOrganizationId");

CREATE TABLE IF NOT EXISTS "organization" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "logo" text,
  "createdAt" integer NOT NULL,
  "metadata" text
);

CREATE UNIQUE INDEX IF NOT EXISTS "organization_slug_idx"
  ON "organization" ("slug");

CREATE TABLE IF NOT EXISTS "member" (
  "id" text PRIMARY KEY NOT NULL,
  "organizationId" text NOT NULL,
  "userId" text NOT NULL,
  "role" text NOT NULL,
  "createdAt" integer NOT NULL,
  FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE cascade,
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE cascade
);

CREATE INDEX IF NOT EXISTS "member_user_id_idx"
  ON "member" ("userId");

CREATE INDEX IF NOT EXISTS "member_organization_id_idx"
  ON "member" ("organizationId");

CREATE UNIQUE INDEX IF NOT EXISTS "member_user_organization_idx"
  ON "member" ("userId", "organizationId");

CREATE TABLE IF NOT EXISTS "invitation" (
  "id" text PRIMARY KEY NOT NULL,
  "organizationId" text NOT NULL,
  "email" text NOT NULL,
  "role" text,
  "status" text NOT NULL DEFAULT 'pending',
  "expiresAt" integer NOT NULL,
  "inviterId" text NOT NULL,
  "createdAt" integer NOT NULL,
  FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE cascade,
  FOREIGN KEY ("inviterId") REFERENCES "user"("id") ON DELETE cascade
);

CREATE INDEX IF NOT EXISTS "invitation_organization_id_idx"
  ON "invitation" ("organizationId");

CREATE INDEX IF NOT EXISTS "invitation_email_idx"
  ON "invitation" ("email");
