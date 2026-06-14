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
      tableExists("events") &&
      indexExists("events_scope_idx") &&
      indexExists("events_source_user_idx") &&
      indexExists("events_entity_idx"),
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
        statement: "ALTER TABLE workspace_actions ADD COLUMN project_id text REFERENCES projects(id) ON UPDATE no action ON DELETE set null;",
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
];

ensureMigrationTable();
for (const migration of migrations) {
  applyMigration(migration);
}
