import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const database = "ai-command-center-db";
const config = "./wrangler.jsonc";
const mode = process.argv.includes("--remote") ? "--remote" : "--local";
const migrationTable = "app_schema_migrations";
const minimumMajor = 22;
const currentMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
const wranglerBin = join(process.cwd(), "node_modules", "wrangler", "bin", "wrangler.js");
const codexNode = join(
  process.env.USERPROFILE ?? "",
  ".cache",
  "codex-runtimes",
  "codex-primary-runtime",
  "dependencies",
  "node",
  "bin",
  "node.exe",
);

if (!existsSync(wranglerBin)) {
  console.error("Wrangler is not installed. Run npm install first.");
  process.exit(1);
}

const nodeExecutable = currentMajor >= minimumMajor ? process.execPath : codexNode;

if (!existsSync(nodeExecutable)) {
  console.error(`Wrangler requires Node.js v${minimumMajor}.0.0 or newer. Current Node.js is ${process.version}.`);
  console.error("Run `nvm install 22` and `nvm use 22`, then try again.");
  process.exit(1);
}

const baseArgs = ["d1", "execute", database, `--config=${config}`, mode];

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function extractRows(stdout) {
  const jsonStart = stdout.lastIndexOf("\n[");
  const jsonText = (jsonStart >= 0 ? stdout.slice(jsonStart + 1) : stdout).trim();
  try {
    const payload = JSON.parse(jsonText);
    return payload.flatMap((entry) => entry.results ?? []);
  } catch {
    throw new Error(`Unable to parse Wrangler JSON output:\n${stdout}`);
  }
}

function runWrangler(args, { quiet = false } = {}) {
  const result = spawnSync(nodeExecutable, [wranglerBin, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: false,
  });

  if (!quiet && result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  return result.stdout ?? "";
}

function queryRows(sql) {
  return extractRows(runWrangler([...baseArgs, "--command", sql], { quiet: true }));
}

function execute(sql, { quiet = false } = {}) {
  runWrangler([...baseArgs, "--command", sql], { quiet });
}

function tableExists(table) {
  return queryRows(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${sqlString(table)};`).length > 0;
}

function indexExists(index) {
  return queryRows(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = ${sqlString(index)};`).length > 0;
}

function columnExists(table, column) {
  if (!tableExists(table)) {
    return false;
  }
  return queryRows(`PRAGMA table_info(${table});`).some((row) => row.name === column);
}

function ensureMigrationTable() {
  execute(
    `CREATE TABLE IF NOT EXISTS ${migrationTable} (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);`,
    { quiet: true },
  );
}

function migrationRecorded(name) {
  return queryRows(`SELECT name FROM ${migrationTable} WHERE name = ${sqlString(name)};`).length > 0;
}

function recordMigration(name) {
  execute(`INSERT OR IGNORE INTO ${migrationTable} (name) VALUES (${sqlString(name)});`, { quiet: true });
}

function applyMigration(migration) {
  if (migrationRecorded(migration.name)) {
    console.log(`Skipping ${migration.name}: already recorded.`);
    return;
  }

  if (migration.isComplete()) {
    console.log(`Recording ${migration.name}: schema already complete.`);
    recordMigration(migration.name);
    return;
  }

  console.log(`Applying ${migration.name}.`);
  if (migration.steps) {
    for (const step of migration.steps) {
      if (step.isComplete()) {
        continue;
      }
      execute(step.statement);
    }
  } else {
    for (const statement of migration.statements) {
      execute(statement);
    }
  }

  if (!migration.isComplete()) {
    console.error(`Migration ${migration.name} did not pass its completion check.`);
    process.exit(1);
  }

  recordMigration(migration.name);
}

const migrations = [
  {
    name: "0005_realtime_events",
    isComplete: () =>
      tableExists("events") && indexExists("events_scope_idx") && indexExists("events_source_user_idx") && indexExists("events_entity_idx"),
    statements: [
      `CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  team_id TEXT,
  project_id TEXT,
  chat_id TEXT,
  mode TEXT NOT NULL CHECK (mode IN ('Personal', 'Team', 'Org')),
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  invalidates_json TEXT NOT NULL DEFAULT '[]',
  source_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  source_client_id TEXT,
  created_at INTEGER NOT NULL
);`,
      "CREATE INDEX IF NOT EXISTS events_scope_idx ON events (workspace_id, mode, team_id, id);",
      "CREATE INDEX IF NOT EXISTS events_source_user_idx ON events (workspace_id, source_user_id, id);",
      "CREATE INDEX IF NOT EXISTS events_entity_idx ON events (entity, entity_id, id);",
    ],
  },
  {
    name: "0006_admin_usage_events",
    isComplete: () =>
      tableExists("admin_usage_events") &&
      indexExists("admin_usage_events_provider_idx") &&
      indexExists("admin_usage_events_scope_idx") &&
      indexExists("admin_usage_events_chat_idx"),
    statements: [
      `CREATE TABLE IF NOT EXISTS admin_usage_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  feature TEXT NOT NULL,
  model TEXT,
  credits_used REAL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  duration_ms INTEGER,
  team_id TEXT,
  project_id TEXT,
  chat_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);`,
      "CREATE INDEX IF NOT EXISTS admin_usage_events_provider_idx ON admin_usage_events (provider, created_at);",
      "CREATE INDEX IF NOT EXISTS admin_usage_events_scope_idx ON admin_usage_events (team_id, project_id, created_at);",
      "CREATE INDEX IF NOT EXISTS admin_usage_events_chat_idx ON admin_usage_events (chat_id, created_at);",
    ],
  },
  {
    name: "0007_chat_message_attachments",
    isComplete: () => columnExists("chat_messages", "attachments_json"),
    steps: [
      {
        isComplete: () => columnExists("chat_messages", "attachments_json"),
        statement: 'ALTER TABLE "chat_messages" ADD COLUMN "attachments_json" text;',
      },
    ],
  },
  {
    name: "0008_artifact_versioning",
    isComplete: () =>
      columnExists("artifacts", "version") &&
      columnExists("artifacts", "parent_artifact_id") &&
      columnExists("artifacts", "commit_message") &&
      indexExists("artifacts_parent_idx") &&
      indexExists("artifacts_version_idx"),
    steps: [
      {
        isComplete: () => columnExists("artifacts", "version"),
        statement: "ALTER TABLE artifacts ADD version integer DEFAULT 1 NOT NULL;",
      },
      {
        isComplete: () => columnExists("artifacts", "parent_artifact_id"),
        statement: "ALTER TABLE artifacts ADD parent_artifact_id text REFERENCES artifacts(id) ON UPDATE no action ON DELETE set null;",
      },
      {
        isComplete: () => columnExists("artifacts", "commit_message"),
        statement: "ALTER TABLE artifacts ADD commit_message text DEFAULT 'Initial artifact version' NOT NULL;",
      },
      {
        isComplete: () => indexExists("artifacts_parent_idx"),
        statement: "CREATE INDEX IF NOT EXISTS artifacts_parent_idx ON artifacts (parent_artifact_id);",
      },
      {
        isComplete: () => indexExists("artifacts_version_idx"),
        statement: "CREATE INDEX IF NOT EXISTS artifacts_version_idx ON artifacts (workspace_id, title, version);",
      },
    ],
  },
  {
    name: "0009_rbac_inference_guardrails",
    isComplete: () => columnExists("document_chunks", "sensitivity_label") && columnExists("document_chunks", "restricted"),
    steps: [
      {
        isComplete: () => columnExists("document_chunks", "sensitivity_label"),
        statement:
          "ALTER TABLE document_chunks ADD COLUMN sensitivity_label TEXT NOT NULL DEFAULT 'Standard' CHECK (sensitivity_label IN ('Standard', 'Confidential'));",
      },
      {
        isComplete: () => columnExists("document_chunks", "restricted"),
        statement: "ALTER TABLE document_chunks ADD COLUMN restricted INTEGER NOT NULL DEFAULT 0;",
      },
    ],
  },
  {
    name: "0010_workflow_persistence",
    isComplete: () =>
      columnExists("workspace_actions", "project_id") &&
      columnExists("workspace_actions", "original_text") &&
      columnExists("ideas", "project_id") &&
      columnExists("ideas", "original_text") &&
      indexExists("workspace_actions_project_idx") &&
      indexExists("ideas_project_idx"),
    steps: [
      {
        isComplete: () => columnExists("workspace_actions", "project_id"),
        statement:
          "ALTER TABLE workspace_actions ADD COLUMN project_id text REFERENCES projects(id) ON UPDATE no action ON DELETE set null;",
      },
      {
        isComplete: () => columnExists("workspace_actions", "original_text"),
        statement: "ALTER TABLE workspace_actions ADD COLUMN original_text text DEFAULT '' NOT NULL;",
      },
      {
        isComplete: () => columnExists("ideas", "project_id"),
        statement: "ALTER TABLE ideas ADD COLUMN project_id text REFERENCES projects(id) ON UPDATE no action ON DELETE set null;",
      },
      {
        isComplete: () => columnExists("ideas", "original_text"),
        statement: "ALTER TABLE ideas ADD COLUMN original_text text DEFAULT '' NOT NULL;",
      },
      {
        isComplete: () => indexExists("workspace_actions_project_idx"),
        statement: "CREATE INDEX IF NOT EXISTS workspace_actions_project_idx ON workspace_actions (workspace_id, project_id);",
      },
      {
        isComplete: () => indexExists("ideas_project_idx"),
        statement: "CREATE INDEX IF NOT EXISTS ideas_project_idx ON ideas (workspace_id, project_id);",
      },
    ],
  },
  {
    name: "0011_workspace_action_pins",
    isComplete: () => columnExists("workspace_actions", "pinned"),
    steps: [
      {
        isComplete: () => columnExists("workspace_actions", "pinned"),
        statement: "ALTER TABLE workspace_actions ADD COLUMN pinned integer DEFAULT false NOT NULL;",
      },
    ],
  },
  {
    name: "0012_microsoft_graph_webhooks",
    isComplete: () =>
      tableExists("microsoft_graph_subscriptions") &&
      tableExists("microsoft_graph_webhook_deliveries") &&
      indexExists("microsoft_graph_subscriptions_kind_status_idx") &&
      indexExists("microsoft_graph_subscriptions_expiration_idx") &&
      indexExists("microsoft_graph_subscriptions_tenant_idx") &&
      indexExists("microsoft_graph_webhook_deliveries_request_idx") &&
      indexExists("microsoft_graph_webhook_deliveries_received_at_idx"),
    statements: [
      `CREATE TABLE IF NOT EXISTS microsoft_graph_subscriptions (
  subscription_id TEXT PRIMARY KEY,
  tenant_id TEXT,
  resource TEXT NOT NULL,
  resource_kind TEXT NOT NULL CHECK (resource_kind IN ('teams', 'outlook', 'other')),
  change_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'renewing', 'expired', 'deleted')),
  expiration_at TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  notification_count INTEGER NOT NULL DEFAULT 0
);`,
      "CREATE INDEX IF NOT EXISTS microsoft_graph_subscriptions_kind_status_idx ON microsoft_graph_subscriptions (resource_kind, status);",
      "CREATE INDEX IF NOT EXISTS microsoft_graph_subscriptions_expiration_idx ON microsoft_graph_subscriptions (expiration_at);",
      "CREATE INDEX IF NOT EXISTS microsoft_graph_subscriptions_tenant_idx ON microsoft_graph_subscriptions (tenant_id);",
      `CREATE TABLE IF NOT EXISTS microsoft_graph_webhook_deliveries (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  notification_count INTEGER NOT NULL,
  validation_token_count INTEGER NOT NULL,
  user_agent TEXT,
  cf_ray TEXT,
  connecting_ip TEXT,
  received_at TEXT NOT NULL
);`,
      "CREATE UNIQUE INDEX IF NOT EXISTS microsoft_graph_webhook_deliveries_request_idx ON microsoft_graph_webhook_deliveries (request_id);",
      "CREATE INDEX IF NOT EXISTS microsoft_graph_webhook_deliveries_received_at_idx ON microsoft_graph_webhook_deliveries (received_at);",
    ],
  },
  {
    name: "0013_asana_oauth_integration",
    isComplete: () =>
      tableExists("asana_oauth_states") &&
      tableExists("asana_connections") &&
      tableExists("asana_project_mappings") &&
      indexExists("asana_oauth_states_user_idx") &&
      indexExists("asana_connections_user_idx") &&
      indexExists("asana_project_mappings_project_idx") &&
      indexExists("asana_project_mappings_vertex_project_idx") &&
      indexExists("asana_project_mappings_user_idx"),
    statements: [
      `CREATE TABLE IF NOT EXISTS asana_oauth_states (
  state_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  code_verifier TEXT NOT NULL,
  redirect_to TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);`,
      "CREATE INDEX IF NOT EXISTS asana_oauth_states_user_idx ON asana_oauth_states (user_id, expires_at);",
      `CREATE TABLE IF NOT EXISTS asana_connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  asana_user_gid TEXT NOT NULL,
  asana_user_name TEXT NOT NULL,
  asana_user_email TEXT,
  scopes TEXT NOT NULL,
  connected_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);`,
      "CREATE UNIQUE INDEX IF NOT EXISTS asana_connections_user_idx ON asana_connections (user_id);",
      "CREATE INDEX IF NOT EXISTS asana_connections_asana_user_idx ON asana_connections (asana_user_gid);",
      `CREATE TABLE IF NOT EXISTS asana_project_mappings (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES asana_connections(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  asana_workspace_gid TEXT NOT NULL,
  asana_workspace_name TEXT NOT NULL,
  asana_project_gid TEXT NOT NULL,
  asana_project_name TEXT NOT NULL,
  asana_team_gid TEXT,
  vertex_workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  vertex_mode TEXT NOT NULL CHECK (vertex_mode IN ('Personal', 'Team', 'Org')),
  vertex_team_id TEXT,
  vertex_project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  vertex_chat_id TEXT REFERENCES chats(id) ON DELETE SET NULL,
  can_write_tasks INTEGER NOT NULL DEFAULT 0,
  permission_level TEXT NOT NULL DEFAULT 'read',
  permission_source TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);`,
      "CREATE UNIQUE INDEX IF NOT EXISTS asana_project_mappings_project_idx ON asana_project_mappings (asana_project_gid);",
      "CREATE INDEX IF NOT EXISTS asana_project_mappings_vertex_project_idx ON asana_project_mappings (vertex_project_id);",
      "CREATE INDEX IF NOT EXISTS asana_project_mappings_user_idx ON asana_project_mappings (user_id, updated_at);",
    ],
  },
  {
    name: "0014_project_instructions",
    isComplete: () => columnExists("projects", "project_instructions"),
    steps: [
      {
        isComplete: () => columnExists("projects", "project_instructions"),
        statement: "ALTER TABLE projects ADD COLUMN project_instructions text DEFAULT '' NOT NULL;",
      },
    ],
  },
  {
    name: "0015_project_asana_task_status_source",
    isComplete: () =>
      columnExists("projects", "asana_task_status_source") &&
      columnExists("projects", "asana_task_status_custom_field_gid") &&
      columnExists("projects", "asana_task_status_custom_field_name"),
    steps: [
      {
        isComplete: () => columnExists("projects", "asana_task_status_source"),
        statement: "ALTER TABLE projects ADD COLUMN asana_task_status_source text DEFAULT 'native' NOT NULL;",
      },
      {
        isComplete: () => columnExists("projects", "asana_task_status_custom_field_gid"),
        statement: "ALTER TABLE projects ADD COLUMN asana_task_status_custom_field_gid text;",
      },
      {
        isComplete: () => columnExists("projects", "asana_task_status_custom_field_name"),
        statement: "ALTER TABLE projects ADD COLUMN asana_task_status_custom_field_name text;",
      },
    ],
  },
  {
    name: "0016_asana_project_snapshots",
    isComplete: () =>
      tableExists("asana_project_snapshots") &&
      indexExists("asana_project_snapshots_mapping_created_idx") &&
      indexExists("asana_project_snapshots_mapping_hash_idx") &&
      indexExists("asana_project_snapshots_vertex_project_idx"),
    statements: [
      `CREATE TABLE IF NOT EXISTS asana_project_snapshots (
  id TEXT PRIMARY KEY,
  mapping_id TEXT NOT NULL REFERENCES asana_project_mappings(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  vertex_workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  vertex_team_id TEXT,
  vertex_mode TEXT NOT NULL CHECK (vertex_mode IN ('Personal', 'Team', 'Org')),
  vertex_project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  asana_project_gid TEXT NOT NULL,
  asana_project_name TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  task_count INTEGER NOT NULL,
  status_update_count INTEGER NOT NULL,
  story_count INTEGER NOT NULL,
  diff_summary TEXT NOT NULL,
  r2_key TEXT,
  created_at INTEGER NOT NULL
);`,
      "CREATE INDEX IF NOT EXISTS asana_project_snapshots_mapping_created_idx ON asana_project_snapshots (mapping_id, created_at);",
      "CREATE UNIQUE INDEX IF NOT EXISTS asana_project_snapshots_mapping_hash_idx ON asana_project_snapshots (mapping_id, snapshot_hash);",
      "CREATE INDEX IF NOT EXISTS asana_project_snapshots_vertex_project_idx ON asana_project_snapshots (vertex_project_id, created_at);",
    ],
  },
  {
    name: "0017_asana_webhook_task_states",
    isComplete: () =>
      tableExists("asana_webhook_task_states") &&
      indexExists("asana_webhook_task_states_workspace_idx") &&
      indexExists("asana_webhook_task_states_vertex_workspace_idx") &&
      indexExists("asana_webhook_task_states_project_idx"),
    statements: [
      `CREATE TABLE IF NOT EXISTS asana_webhook_task_states (
  asana_task_gid TEXT PRIMARY KEY,
  asana_workspace_gid TEXT NOT NULL,
  vertex_workspace_id TEXT,
  asana_project_gid TEXT,
  task_name TEXT,
  action TEXT NOT NULL,
  change_action TEXT,
  change_field TEXT,
  status TEXT,
  last_event_at INTEGER NOT NULL,
  raw_event_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);`,
      "CREATE INDEX IF NOT EXISTS asana_webhook_task_states_workspace_idx ON asana_webhook_task_states (asana_workspace_gid, updated_at);",
      "CREATE INDEX IF NOT EXISTS asana_webhook_task_states_vertex_workspace_idx ON asana_webhook_task_states (vertex_workspace_id, updated_at);",
      "CREATE INDEX IF NOT EXISTS asana_webhook_task_states_project_idx ON asana_webhook_task_states (asana_project_gid, updated_at);",
    ],
  },
  {
    name: "0018_scheduled_briefings",
    isComplete: () =>
      columnExists("chat_messages", "type") &&
      columnExists("workspace_actions", "created_at") &&
      indexExists("workspace_actions_kind_created_idx"),
    steps: [
      {
        isComplete: () => columnExists("chat_messages", "type"),
        statement: "ALTER TABLE chat_messages ADD COLUMN type text DEFAULT 'message' NOT NULL;",
      },
      {
        isComplete: () => columnExists("workspace_actions", "created_at"),
        statement: "ALTER TABLE workspace_actions ADD COLUMN created_at integer DEFAULT 0 NOT NULL;",
      },
      {
        isComplete: () => indexExists("workspace_actions_kind_created_idx"),
        statement: "CREATE INDEX IF NOT EXISTS workspace_actions_kind_created_idx ON workspace_actions (workspace_id, kind, created_at);",
      },
    ],
  },
  {
    name: "0019_user_briefing_schedules",
    isComplete: () =>
      tableExists("briefing_schedules") &&
      tableExists("briefing_runs") &&
      indexExists("briefing_schedules_user_idx") &&
      indexExists("briefing_schedules_due_idx") &&
      indexExists("briefing_schedules_scope_idx") &&
      indexExists("briefing_runs_schedule_idx") &&
      indexExists("briefing_runs_status_idx"),
    statements: [
      `CREATE TABLE IF NOT EXISTS briefing_schedules (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  chat_id TEXT REFERENCES chats(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  recurrence TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  local_time TEXT NOT NULL,
  weekdays_json TEXT NOT NULL DEFAULT '[]',
  month_day INTEGER,
  run_once_at INTEGER,
  reporting_window_hours INTEGER NOT NULL DEFAULT 24,
  prompt_instructions TEXT NOT NULL DEFAULT '',
  next_run_at INTEGER,
  last_run_at INTEGER,
  last_status TEXT,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);`,
      "CREATE INDEX IF NOT EXISTS briefing_schedules_user_idx ON briefing_schedules (user_id, updated_at);",
      "CREATE INDEX IF NOT EXISTS briefing_schedules_due_idx ON briefing_schedules (enabled, next_run_at);",
      "CREATE INDEX IF NOT EXISTS briefing_schedules_scope_idx ON briefing_schedules (workspace_id, project_id);",
      `CREATE TABLE IF NOT EXISTS briefing_runs (
  id TEXT PRIMARY KEY NOT NULL,
  schedule_id TEXT REFERENCES briefing_schedules(id) ON DELETE SET NULL,
  chat_message_id TEXT REFERENCES chat_messages(id) ON DELETE SET NULL,
  trigger TEXT NOT NULL,
  status TEXT NOT NULL,
  output_markdown TEXT,
  error TEXT,
  created_at INTEGER NOT NULL
);`,
      "CREATE INDEX IF NOT EXISTS briefing_runs_schedule_idx ON briefing_runs (schedule_id, created_at);",
      "CREATE INDEX IF NOT EXISTS briefing_runs_status_idx ON briefing_runs (status, created_at);",
    ],
  },
  {
    name: "0020_asana_project_webhooks",
    isComplete: () =>
      tableExists("asana_project_webhooks") &&
      indexExists("asana_project_webhooks_workspace_idx") &&
      indexExists("asana_project_webhooks_status_idx") &&
      indexExists("asana_project_webhooks_webhook_idx"),
    statements: [
      `CREATE TABLE IF NOT EXISTS asana_project_webhooks (
  asana_project_gid TEXT PRIMARY KEY,
  asana_workspace_gid TEXT NOT NULL,
  webhook_gid TEXT,
  target_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'creating' CHECK (status IN ('active', 'creating', 'failed', 'deleted')),
  last_error TEXT,
  created_by_user_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);`,
      "CREATE INDEX IF NOT EXISTS asana_project_webhooks_workspace_idx ON asana_project_webhooks (asana_workspace_gid, updated_at);",
      "CREATE INDEX IF NOT EXISTS asana_project_webhooks_status_idx ON asana_project_webhooks (status, updated_at);",
      "CREATE UNIQUE INDEX IF NOT EXISTS asana_project_webhooks_webhook_idx ON asana_project_webhooks (webhook_gid);",
    ],
  },
  {
    name: "0021_manual_asana_task_sync",
    isComplete: () =>
      columnExists("workspace_actions", "asana_task_gid") &&
      columnExists("workspace_actions", "asana_synced_at") &&
      columnExists("workspace_actions", "asana_sync_error") &&
      columnExists("asana_connections", "auto_sync_tasks_enabled"),
    steps: [
      {
        isComplete: () => columnExists("workspace_actions", "asana_task_gid"),
        statement: "ALTER TABLE workspace_actions ADD COLUMN asana_task_gid TEXT;",
      },
      {
        isComplete: () => columnExists("workspace_actions", "asana_synced_at"),
        statement: "ALTER TABLE workspace_actions ADD COLUMN asana_synced_at INTEGER;",
      },
      {
        isComplete: () => columnExists("workspace_actions", "asana_sync_error"),
        statement: "ALTER TABLE workspace_actions ADD COLUMN asana_sync_error TEXT;",
      },
      {
        isComplete: () => columnExists("asana_connections", "auto_sync_tasks_enabled"),
        statement: "ALTER TABLE asana_connections ADD COLUMN auto_sync_tasks_enabled INTEGER DEFAULT 0 NOT NULL;",
      },
    ],
  },
  {
    name: "0022_risks",
    isComplete: () =>
      tableExists("risks") && indexExists("risks_scope_idx") && indexExists("risks_severity_idx") && indexExists("risks_status_idx"),
    statements: [
      `CREATE TABLE IF NOT EXISTS risks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status TEXT NOT NULL DEFAULT 'open',
  mitigation_strategy TEXT NOT NULL DEFAULT ''
);`,
      "CREATE INDEX IF NOT EXISTS risks_scope_idx ON risks (workspace_id, project_id);",
      "CREATE INDEX IF NOT EXISTS risks_severity_idx ON risks (workspace_id, project_id, severity);",
      "CREATE INDEX IF NOT EXISTS risks_status_idx ON risks (workspace_id, project_id, status);",
    ],
  },
  {
    name: "0023_better_auth_organization",
    isComplete: () =>
      columnExists("session", "activeOrganizationId") &&
      indexExists("session_active_organization_idx") &&
      tableExists("organization") &&
      tableExists("member") &&
      tableExists("invitation") &&
      indexExists("organization_slug_idx") &&
      indexExists("member_user_id_idx") &&
      indexExists("member_organization_id_idx") &&
      indexExists("member_user_organization_idx") &&
      indexExists("invitation_organization_id_idx") &&
      indexExists("invitation_email_idx"),
    steps: [
      {
        isComplete: () => columnExists("session", "activeOrganizationId"),
        statement: 'ALTER TABLE "session" ADD COLUMN "activeOrganizationId" text;',
      },
      {
        isComplete: () => indexExists("session_active_organization_idx"),
        statement: 'CREATE INDEX IF NOT EXISTS "session_active_organization_idx" ON "session" ("activeOrganizationId");',
      },
      {
        isComplete: () => tableExists("organization"),
        statement: `CREATE TABLE IF NOT EXISTS "organization" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "logo" text,
  "createdAt" integer NOT NULL,
  "metadata" text
);`,
      },
      {
        isComplete: () => indexExists("organization_slug_idx"),
        statement: 'CREATE UNIQUE INDEX IF NOT EXISTS "organization_slug_idx" ON "organization" ("slug");',
      },
      {
        isComplete: () => tableExists("member"),
        statement: `CREATE TABLE IF NOT EXISTS "member" (
  "id" text PRIMARY KEY NOT NULL,
  "organizationId" text NOT NULL,
  "userId" text NOT NULL,
  "role" text NOT NULL,
  "createdAt" integer NOT NULL,
  FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE cascade,
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE cascade
);`,
      },
      {
        isComplete: () => indexExists("member_user_id_idx"),
        statement: 'CREATE INDEX IF NOT EXISTS "member_user_id_idx" ON "member" ("userId");',
      },
      {
        isComplete: () => indexExists("member_organization_id_idx"),
        statement: 'CREATE INDEX IF NOT EXISTS "member_organization_id_idx" ON "member" ("organizationId");',
      },
      {
        isComplete: () => indexExists("member_user_organization_idx"),
        statement: 'CREATE UNIQUE INDEX IF NOT EXISTS "member_user_organization_idx" ON "member" ("userId", "organizationId");',
      },
      {
        isComplete: () => tableExists("invitation"),
        statement: `CREATE TABLE IF NOT EXISTS "invitation" (
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
);`,
      },
      {
        isComplete: () => indexExists("invitation_organization_id_idx"),
        statement: 'CREATE INDEX IF NOT EXISTS "invitation_organization_id_idx" ON "invitation" ("organizationId");',
      },
      {
        isComplete: () => indexExists("invitation_email_idx"),
        statement: 'CREATE INDEX IF NOT EXISTS "invitation_email_idx" ON "invitation" ("email");',
      },
    ],
  },
  {
    name: "0024_risks_title",
    isComplete: () => columnExists("risks", "title"),
    steps: [
      {
        isComplete: () => columnExists("risks", "title"),
        statement: "ALTER TABLE risks ADD COLUMN title TEXT NOT NULL DEFAULT 'Untitled risk';",
      },
      {
        isComplete: () => false,
        statement: "UPDATE risks SET title = substr(trim(description), 1, 140) WHERE title = 'Untitled risk' AND trim(description) <> '';",
      },
    ],
  },
  {
    name: "0025_asana_sync_queue",
    isComplete: () => columnExists("workspace_actions", "asana_sync_queued_at"),
    steps: [
      {
        isComplete: () => columnExists("workspace_actions", "asana_sync_queued_at"),
        statement: "ALTER TABLE workspace_actions ADD COLUMN asana_sync_queued_at INTEGER;",
      },
    ],
  },
  {
    name: "0026_scheduled_tasks",
    isComplete: () =>
      tableExists("scheduled_tasks") &&
      indexExists("scheduled_tasks_due_idx") &&
      indexExists("scheduled_tasks_org_type_idx") &&
      indexExists("scheduled_tasks_workspace_idx"),
    statements: [
      `CREATE TABLE IF NOT EXISTS scheduled_tasks (
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
);`,
      "CREATE INDEX IF NOT EXISTS scheduled_tasks_due_idx ON scheduled_tasks (enabled, status, next_run_at, priority);",
      "CREATE INDEX IF NOT EXISTS scheduled_tasks_org_type_idx ON scheduled_tasks (organization_id, type, status, next_run_at);",
      "CREATE INDEX IF NOT EXISTS scheduled_tasks_workspace_idx ON scheduled_tasks (workspace_id, status, next_run_at);",
      `INSERT OR IGNORE INTO scheduled_tasks (
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
);`,
      `INSERT OR IGNORE INTO scheduled_tasks (
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
);`,
    ],
  },
];

ensureMigrationTable();
for (const migration of migrations) {
  applyMigration(migration);
}
