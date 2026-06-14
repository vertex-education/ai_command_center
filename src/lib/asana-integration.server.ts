/// <reference path="../../worker-configuration.d.ts" />

import { env } from "cloudflare:workers";
import { getRequest } from "@tanstack/start-server-core";
import { getAuth } from "@/lib/auth";
import { deleteAsanaTokens, getValidAsanaTokens, storeAsanaTokens, type AsanaTokenVaultEnv } from "@/lib/asana-token-vault";
import type { DocumentIngestionJob } from "@/lib/document-ingestion-queue";
import type { ProjectStatus, WorkspaceMode, WorkspaceScope } from "@/lib/pmo-data";

type AsanaIntegrationEnv = AsanaTokenVaultEnv & {
  ASANA_CLIENT_ID?: string;
  ASANA_CLIENT_SECRET?: string;
  ASANA_USE_FULL_PERMISSIONS?: string;
  ASANA_WEBHOOK_ORIGIN?: string;
  ARTIFACTS_BUCKET?: R2Bucket;
  DOCUMENT_INGESTION_QUEUE?: Queue<DocumentIngestionJob>;
};

type AuthSession = {
  user: {
    id: string;
    email: string;
    name: string;
    role?: string | null;
  };
};

type AsanaTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  data?: {
    gid?: string;
    id?: string | number;
    name?: string;
    email?: string;
  };
  error?: string;
  error_description?: string;
};

type AsanaApiEnvelope<T> = {
  data: T;
  next_page?: {
    offset?: string;
    path?: string;
    uri?: string;
  } | null;
  errors?: Array<{ message?: string }>;
};

type AsanaWebhookRecord = {
  gid: string;
  active?: boolean;
  target?: string;
  resource?: {
    gid?: string;
    name?: string;
  };
};

type AsanaWorkspace = {
  gid: string;
  name: string;
};

type AsanaUser = {
  gid: string;
  name: string;
  email?: string;
  workspaces?: AsanaWorkspace[];
};

type AsanaProject = {
  gid: string;
  name: string;
  notes?: string | null;
  archived?: boolean;
  owner?: {
    gid?: string;
    name?: string;
  } | null;
  workspace?: AsanaWorkspace;
  team?: {
    gid?: string;
    name?: string;
  } | null;
};

type AsanaProjectMembership = {
  gid: string;
  access_level?: "admin" | "editor" | "commenter" | "viewer" | string;
  write_access?: boolean;
  parent?: {
    gid?: string;
    name?: string;
    archived?: boolean;
    workspace?: AsanaWorkspace;
  };
  project?: {
    gid?: string;
  };
  user?: {
    gid?: string;
  };
  member?: {
    gid?: string;
    resource_type?: string;
  };
};

type AsanaTeam = {
  gid: string;
  name: string;
};

type AsanaPortfolio = {
  gid: string;
  name: string;
  workspace?: AsanaWorkspace;
};

type AsanaPortfolioItem = {
  gid: string;
  name: string;
  resource_type?: string;
  archived?: boolean;
  workspace?: AsanaWorkspace;
};

type AsanaPortfolioMembership = {
  gid: string;
  access_level?: "admin" | "editor" | "commenter" | "viewer" | string;
  write_access?: boolean;
  portfolio?: AsanaPortfolio;
  parent?: AsanaPortfolio;
};

type AsanaTaskCustomFieldContextRow = {
  gid: string;
  name?: string | null;
  type?: string | null;
  display_value?: string | null;
  text_value?: string | null;
  number_value?: number | null;
  enum_value?: {
    gid?: string;
    name?: string | null;
  } | null;
  multi_enum_values?: Array<{
    gid?: string;
    name?: string | null;
  }>;
};

type AsanaTaskContextRow = {
  gid: string;
  name: string;
  completed?: boolean;
  completed_at?: string | null;
  due_on?: string | null;
  due_at?: string | null;
  modified_at?: string | null;
  notes?: string | null;
  permalink_url?: string | null;
  assignee?: {
    name?: string | null;
  } | null;
  memberships?: Array<{
    section?: {
      name?: string | null;
    } | null;
  }>;
  custom_fields?: AsanaTaskCustomFieldContextRow[];
};

export type AsanaTaskStatusCustomFieldOption = {
  gid: string;
  name: string;
  type: string | null;
};

type AsanaTaskStatusSettings = {
  source: "native" | "custom_field";
  customFieldGid: string | null;
  customFieldName: string | null;
};

type AsanaCustomFieldSettingRow = {
  gid: string;
  custom_field?: {
    gid?: string;
    name?: string | null;
    type?: string | null;
  } | null;
};

type AsanaStoryContextRow = {
  gid: string;
  created_at?: string | null;
  created_by?: {
    name?: string | null;
  } | null;
  text?: string | null;
  type?: string | null;
  resource_subtype?: string | null;
};

type AsanaStatusUpdateContextRow = {
  gid: string;
  title?: string | null;
  text?: string | null;
  color?: string | null;
  created_at?: string | null;
  created_by?: {
    name?: string | null;
  } | null;
};

type AsanaContextStatusUpdate = AsanaStatusUpdateContextRow & {
  sourceType: "project" | "portfolio";
  sourceGid: string;
  sourceName: string;
  sourceDepth?: number;
  sourcePath?: string[];
};

type NormalizedAsanaSnapshot = {
  asanaProjectGid: string;
  asanaProjectName: string;
  asanaWorkspaceName: string;
  taskStatusSource: string;
  tasks: NormalizedAsanaTaskSnapshot[];
  statusUpdates: NormalizedAsanaStatusUpdateSnapshot[];
  stories: NormalizedAsanaStorySnapshot[];
};

type NormalizedAsanaTaskSnapshot = {
  gid: string;
  name: string;
  status: string;
  completed: boolean;
  assignee: string;
  due: string;
  modifiedAt: string;
  section: string;
  notesPreview: string;
  notesHash: string;
  customFieldsHash: string;
  fingerprint: string;
};

type NormalizedAsanaStatusUpdateSnapshot = {
  gid: string;
  sourceType: "project" | "portfolio";
  sourceName: string;
  title: string;
  color: string;
  createdAt: string;
  textPreview: string;
  textHash: string;
  fingerprint: string;
};

type NormalizedAsanaStorySnapshot = {
  gid: string;
  taskGid: string;
  createdAt: string;
  author: string;
  textPreview: string;
  textHash: string;
  fingerprint: string;
};

type AsanaSnapshotDiff = {
  initial: boolean;
  addedTasks: NormalizedAsanaTaskSnapshot[];
  removedTasks: NormalizedAsanaTaskSnapshot[];
  changedTasks: Array<{
    previous: NormalizedAsanaTaskSnapshot;
    current: NormalizedAsanaTaskSnapshot;
    fields: string[];
  }>;
  addedStatusUpdates: NormalizedAsanaStatusUpdateSnapshot[];
  changedStatusUpdates: Array<{
    previous: NormalizedAsanaStatusUpdateSnapshot;
    current: NormalizedAsanaStatusUpdateSnapshot;
    fields: string[];
  }>;
  addedStories: NormalizedAsanaStorySnapshot[];
};

type AsanaPortfolioContext = AsanaPortfolio & {
  depth: number;
  path: string[];
};

export type AsanaConnectionSummary = {
  connected: boolean;
  configured: boolean;
  connection: {
    id: string;
    asanaUserGid: string;
    asanaUserName: string;
    asanaUserEmail: string | null;
    scopes: string[];
    connectedAt: number;
    updatedAt: number;
  } | null;
  requiredScopes: string[];
  missingScopes: string[];
  projectDiscoveryIssue: string | null;
  asanaProjects: AsanaProjectOption[];
  vertexProjects: VertexProjectOption[];
  mappings: AsanaProjectMappingView[];
  teams: VertexTeamOption[];
};

export type AsanaProjectOption = {
  gid: string;
  name: string;
  workspaceGid: string;
  workspaceName: string;
  teamGid: string | null;
  teamName: string | null;
  portfolioGid: string | null;
  portfolioName: string | null;
  canWriteTasks: boolean;
  permissionLevel: "write" | "read" | "unknown";
  permissionSource: string;
};

export type VertexProjectOption = {
  id: string;
  name: string;
  description: string;
  mode: WorkspaceMode;
  workspaceId: string;
  teamId: string | null;
  chatId: string | null;
};

export type VertexTeamOption = {
  id: string;
  name: string;
};

export type AsanaProjectMappingView = {
  id: string;
  asanaProjectGid: string;
  asanaProjectName: string;
  asanaWorkspaceName: string;
  vertexProjectId: string;
  vertexProjectName: string | null;
  vertexMode: WorkspaceMode;
  vertexTeamId: string | null;
  vertexChatId: string | null;
  canWriteTasks: boolean;
  permissionLevel: string;
  permissionSource: string;
  updatedAt: number;
};

export type AsanaMappingSelection = {
  asanaProjectGid: string;
  action: "ignore" | "map" | "scaffold";
  vertexProjectId?: string | null;
  targetMode?: WorkspaceMode;
  targetTeamId?: string | null;
};

const oauthStateTtlMs = 10 * 60 * 1000;
const defaultAsanaScopes = ["projects:read", "tasks:read", "tasks:write", "users:read", "workspaces:read", "portfolios:read"];
const asanaApiTimeoutMs = 10_000;
const asanaPaginationPageLimit = 25;
const asanaContextTaskLimit = 8;
const asanaContextStoryTaskLimit = 3;
const asanaContextStoriesPerTask = 2;
const asanaContextMaxChars = 8_000;

type AsanaPaginationOptions = {
  limitBehavior?: "throw" | "truncate";
  limitLabel?: string;
};

function getDb() {
  const db = (env as Env).DB;
  if (!db) throw new Error("D1 binding DB is required for Asana integration.");
  return db;
}

function integrationEnv() {
  return env as AsanaIntegrationEnv;
}

async function currentSessionFromRequest(request = getRequest()) {
  const session = await getAuth(request).api.getSession({ headers: request.headers });
  return session as AuthSession | null;
}

async function requireSignedInUser(request = getRequest()) {
  const session = await currentSessionFromRequest(request);
  if (!session?.user?.id) throw new Error("Sign in is required.");
  return session.user;
}

async function requireWorkspaceEditor() {
  const user = await requireSignedInUser();
  if (user.role !== "admin" && user.role !== "user") throw new Error("Viewer accounts cannot manage Asana integrations.");
  return user;
}

function asanaClientId(asanaEnv = integrationEnv()) {
  const clientId = asanaEnv.ASANA_CLIENT_ID?.trim();
  if (!clientId) throw new Error("ASANA_CLIENT_ID is required for Asana OAuth.");
  return clientId;
}

function asanaClientSecret(asanaEnv = integrationEnv()) {
  const clientSecret = asanaEnv.ASANA_CLIENT_SECRET?.trim();
  if (!clientSecret) throw new Error("ASANA_CLIENT_SECRET is required for Asana OAuth.");
  return clientSecret;
}

function isAsanaConfigured() {
  const asanaEnv = integrationEnv();
  return Boolean(asanaEnv.ASANA_CLIENT_ID?.trim() && asanaEnv.ASANA_CLIENT_SECRET?.trim() && asanaEnv.TOKEN_VAULT_KEY?.trim());
}

function useAsanaFullPermissions() {
  const value = integrationEnv().ASANA_USE_FULL_PERMISSIONS?.trim().toLowerCase();
  return value !== "0" && value !== "false" && value !== "no";
}

export async function startAsanaConnectionForCurrentUser() {
  const user = await requireWorkspaceEditor();
  const request = getRequest();
  if (!isAsanaConfigured()) throw new Error("Asana OAuth is not configured.");

  const state = randomToken(32);
  const codeVerifier = randomToken(48);
  const stateHash = await sha256Hex(state);
  const codeChallenge = await pkceChallenge(codeVerifier);
  const now = Date.now();
  await getDb()
    .prepare("INSERT INTO asana_oauth_states (state_hash, user_id, code_verifier, redirect_to, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(stateHash, user.id, codeVerifier, "/profile/asana", now, now + oauthStateTtlMs)
    .run();

  const url = new URL("https://app.asana.com/-/oauth_authorize");
  url.searchParams.set("client_id", asanaClientId());
  url.searchParams.set("redirect_uri", asanaRedirectUri(request));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  if (!useAsanaFullPermissions()) url.searchParams.set("scope", defaultAsanaScopes.join(" "));
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");

  return { url: url.toString() };
}

export async function disconnectAsanaConnectionForCurrentUser() {
  const user = await requireWorkspaceEditor();
  const connection = await getConnectionForUser(user.id);
  if (connection) {
    await getDb().prepare("DELETE FROM asana_connections WHERE id = ?").bind(connection.id).run();
  }
  await deleteAsanaTokens({ env: integrationEnv(), userId: user.id });
  return { disconnected: true };
}

export async function getAsanaConnectionSummaryForCurrentUser(): Promise<AsanaConnectionSummary> {
  const user = await requireSignedInUser();
  const configured = isAsanaConfigured();
  let connection: Awaited<ReturnType<typeof getConnectionForUser>> = null;
  try {
    connection = await getConnectionForUser(user.id);
  } catch (error) {
    console.warn(JSON.stringify({
      event: "asana_connection_summary_connection_failed",
      userId: user.id,
      error: error instanceof Error ? error.message : "Unknown Asana connection lookup failure",
    }));
  }
  const scopes = parseScopes(connection?.scopes ?? "");
  const missingScopes = defaultAsanaScopes.filter((scope) => !hasAsanaScope(scopes, scope));
  const [vertexProjects, mappings, teams] = await Promise.all([
    safeSummaryRead("asana_connection_summary_vertex_projects_failed", user.id, () => listVertexProjectsForUser(user.id), []),
    safeSummaryRead("asana_connection_summary_mappings_failed", user.id, () => listAsanaMappingsForUser(user.id), []),
    safeSummaryRead("asana_connection_summary_teams_failed", user.id, () => listTeamsForUser(user.id), []),
  ]);

  let asanaProjects: AsanaProjectOption[] = [];
  let projectDiscoveryIssue: string | null = null;
  if (configured && connection) {
    try {
      asanaProjects = await listMemberAsanaProjects(user.id, scopes);
    } catch (error) {
      projectDiscoveryIssue = error instanceof Error ? error.message : "Unknown Asana project refresh failure";
      console.warn(JSON.stringify({
        event: "asana_project_refresh_failed",
        userId: user.id,
        error: projectDiscoveryIssue,
      }));
    }
  }

  return {
    connected: Boolean(connection),
    configured,
    connection: connection
      ? {
        id: connection.id,
        asanaUserGid: connection.asanaUserGid,
        asanaUserName: connection.asanaUserName,
        asanaUserEmail: connection.asanaUserEmail,
        scopes,
        connectedAt: connection.connectedAt,
        updatedAt: connection.updatedAt,
      }
      : null,
    requiredScopes: defaultAsanaScopes,
    missingScopes,
    projectDiscoveryIssue,
    asanaProjects,
    vertexProjects,
    mappings,
    teams,
  };
}

async function safeSummaryRead<T>(event: string, userId: string, read: () => Promise<T>, fallback: T) {
  try {
    return await read();
  } catch (error) {
    console.warn(JSON.stringify({
      event,
      userId,
      error: error instanceof Error ? error.message : "Unknown Asana summary read failure",
    }));
    return fallback;
  }
}

export async function saveAsanaProjectMappingsForCurrentUser(data: { selections: AsanaMappingSelection[] }) {
    const user = await requireWorkspaceEditor();
    const request = getRequest();
    const connection = await getConnectionForUser(user.id);
    if (!connection) throw new Error("Connect Asana before mapping projects.");

    const scopes = parseScopes(connection.scopes);
    const asanaProjects = await listMemberAsanaProjects(user.id, scopes);
    const asanaProjectByGid = new Map(asanaProjects.map((project) => [project.gid, project]));
    const tokenSet = await getValidAsanaTokens({ env: integrationEnv(), userId: user.id });
    const asanaUser = tokenSet ? await fetchAsanaMe(tokenSet.accessToken) : null;
    const results: Array<{ asanaProjectGid: string; action: string; vertexProjectId?: string; webhookStatus?: string; webhookGid?: string | null }> = [];

    for (const selection of data.selections) {
      if (selection.action === "ignore") continue;
      let asanaProject = asanaProjectByGid.get(selection.asanaProjectGid);
      if (!asanaProject) throw new Error("Asana project is not visible to the connected user.");
      if (tokenSet && asanaUser) {
        asanaProject = await resolveAsanaProjectWriteAccess(tokenSet.accessToken, asanaUser.gid, asanaProject, scopes);
      }

      const vertexProject = selection.action === "scaffold"
        ? await scaffoldVertexProjectForAsana(user.id, asanaProject, selection.targetMode ?? "Team", selection.targetTeamId ?? null)
        : await getAccessibleVertexProject(user.id, selection.vertexProjectId ?? "");
      if (!vertexProject) throw new Error("Select a VertexAI project you can access.");
      await upsertAsanaProjectMapping({ connectionId: connection.id, userId: user.id, asanaProject, vertexProject });
      const webhook = tokenSet
        ? await ensureAsanaProjectWebhook({
          accessToken: tokenSet.accessToken,
          asanaProject,
          origin: asanaWebhookOrigin(request),
          userId: user.id,
        })
        : await recordAsanaProjectWebhookFailure({
          asanaProject,
          error: "Asana OAuth token is unavailable; reconnect Asana and retry webhook setup.",
          origin: asanaWebhookOrigin(request),
          userId: user.id,
        });
      results.push({
        asanaProjectGid: asanaProject.gid,
        action: selection.action,
        vertexProjectId: vertexProject.id,
        webhookGid: webhook.webhookGid,
        webhookStatus: webhook.status,
      });
    }

    return { saved: results.length, results };
}

export async function repairAsanaProjectWebhooksForCurrentUser() {
  const user = await requireWorkspaceEditor();
  const tokenSet = await getValidAsanaTokens({ env: integrationEnv(), userId: user.id });
  if (!tokenSet) throw new Error("Reconnect Asana before repairing webhooks.");

  const rows = await getDb()
    .prepare(
      `SELECT asana_project_gid as gid,
              asana_project_name as name,
              asana_workspace_gid as workspaceGid,
              asana_workspace_name as workspaceName,
              asana_team_gid as teamGid
       FROM asana_project_mappings
       WHERE user_id = ?
       ORDER BY updated_at DESC`,
    )
    .bind(user.id)
    .all<{
      gid: string;
      name: string;
      workspaceGid: string;
      workspaceName: string;
      teamGid: string | null;
    }>();

  const request = getRequest();
  const results = [];
  for (const row of rows.results ?? []) {
    const result = await ensureAsanaProjectWebhook({
      accessToken: tokenSet.accessToken,
      asanaProject: {
        gid: row.gid,
        name: row.name,
        workspaceGid: row.workspaceGid,
        workspaceName: row.workspaceName,
        teamGid: row.teamGid,
        teamName: null,
        portfolioGid: null,
        portfolioName: null,
        canWriteTasks: false,
        permissionLevel: "unknown",
        permissionSource: "repair",
      },
      origin: asanaWebhookOrigin(request),
      userId: user.id,
    });
    results.push({ asanaProjectGid: row.gid, webhookGid: result.webhookGid, status: result.status });
  }

  return { repaired: results.length, results };
}

export async function createAsanaTaskForMappedProjectForCurrentUser(data: { vertexProjectId: string; title: string; notes?: string }) {
    const user = await requireWorkspaceEditor();
    const title = data.title.trim();
    if (!title) throw new Error("Task title is required.");

    const mapping = await getDb()
      .prepare(
        `SELECT asana_project_gid as asanaProjectGid,
                can_write_tasks as canWriteTasks
         FROM asana_project_mappings
         WHERE user_id = ?
           AND vertex_project_id = ?
         LIMIT 1`,
      )
      .bind(user.id, data.vertexProjectId)
      .first<{ asanaProjectGid: string; canWriteTasks: number | boolean }>();
    if (!mapping) throw new Error("This VertexAI project is not mapped to Asana.");
    if (!Boolean(mapping.canWriteTasks)) throw new Error("Your Asana permission for this project is read-only. Task submission is disabled.");

    const tokenSet = await getValidAsanaTokens({ env: integrationEnv(), userId: user.id });
    if (!tokenSet) throw new Error("Reconnect Asana before submitting tasks.");

    const created = await asanaFetch<{ gid: string; name: string }>(tokenSet.accessToken, "/tasks", {
      method: "POST",
      body: JSON.stringify({
        data: {
          name: title,
          notes: data.notes?.trim() || undefined,
          projects: [mapping.asanaProjectGid],
        },
      }),
    });
    return { gid: created.gid, name: created.name };
}

export async function listAsanaTaskStatusCustomFieldsForCurrentUser(data: { vertexProjectId: string }): Promise<AsanaTaskStatusCustomFieldOption[]> {
  const user = await requireSignedInUser();
  const connection = await getConnectionForUser(user.id);
  if (!connection) return [];
  const scopes = parseScopes(connection.scopes);
  if (!hasAsanaScope(scopes, "projects:read") && !hasAsanaScope(scopes, "tasks:read")) return [];

  const mapping = await getDb()
    .prepare(
      `SELECT asana_project_gid as asanaProjectGid
       FROM asana_project_mappings
       WHERE user_id = ?
         AND vertex_project_id = ?
       LIMIT 1`,
    )
    .bind(user.id, data.vertexProjectId)
    .first<{ asanaProjectGid: string }>();
  if (!mapping) return [];

  const tokenSet = await getValidAsanaTokens({ env: integrationEnv(), userId: user.id });
  if (!tokenSet) return [];

  const fields = await listAsanaProjectCustomFields(tokenSet.accessToken, mapping.asanaProjectGid);
  if (fields.length) return fields;

  const tasks = await listAsanaTasksForContext(tokenSet.accessToken, mapping.asanaProjectGid);
  return collectTaskCustomFieldOptions(tasks);
}

export async function fetchAsanaProjectContextForCurrentUser({
  enabled,
  maxContextChars = asanaContextMaxChars,
  prompt,
  vertexProjectId,
}: {
  enabled?: boolean;
  maxContextChars?: number;
  prompt: string;
  vertexProjectId: string | null;
}) {
  if (!enabled || !vertexProjectId) return null;

  const user = await requireSignedInUser();
  const connection = await getConnectionForUser(user.id);
  if (!connection) return "Asana search was enabled, but this user has not connected Asana.";
  const scopes = parseScopes(connection.scopes);
  if (!hasAsanaScope(scopes, "tasks:read")) return "Asana search was enabled, but the current connection does not include tasks:read.";

  const mapping = await getDb()
    .prepare(
      `SELECT m.asana_project_gid as asanaProjectGid,
              m.id as mappingId,
              m.user_id as userId,
              m.asana_project_name as asanaProjectName,
              m.asana_workspace_gid as asanaWorkspaceGid,
              m.asana_workspace_name as asanaWorkspaceName,
              m.vertex_workspace_id as vertexWorkspaceId,
              m.vertex_team_id as vertexTeamId,
              m.vertex_mode as vertexMode,
              m.vertex_project_id as vertexProjectId,
              m.permission_level as permissionLevel,
              COALESCE(p.asana_task_status_source, 'native') as taskStatusSource,
              p.asana_task_status_custom_field_gid as taskStatusCustomFieldGid,
              p.asana_task_status_custom_field_name as taskStatusCustomFieldName
       FROM asana_project_mappings m
       INNER JOIN projects p ON p.id = m.vertex_project_id
       WHERE m.user_id = ?
         AND m.vertex_project_id = ?
       LIMIT 1`,
    )
    .bind(user.id, vertexProjectId)
    .first<{
      mappingId: string;
      userId: string;
      asanaProjectGid: string;
      asanaProjectName: string;
      asanaWorkspaceGid: string;
      asanaWorkspaceName: string;
      vertexWorkspaceId: string;
      vertexTeamId: string | null;
      vertexMode: WorkspaceMode;
      vertexProjectId: string;
      permissionLevel: string;
      taskStatusSource: "native" | "custom_field";
      taskStatusCustomFieldGid: string | null;
      taskStatusCustomFieldName: string | null;
    }>();
  if (!mapping) return "Asana search was enabled, but this VertexAI project is not mapped to an Asana project for the current user.";

  const tokenSet = await getValidAsanaTokens({ env: integrationEnv(), userId: user.id });
  if (!tokenSet) return "Asana search was enabled, but the Asana token is unavailable. Reconnect Asana.";

  try {
    const tasks = await listAsanaTasksForContext(tokenSet.accessToken, mapping.asanaProjectGid);
    const taskStatusSettings: AsanaTaskStatusSettings = {
      source: mapping.taskStatusSource === "custom_field" ? "custom_field" : "native",
      customFieldGid: mapping.taskStatusCustomFieldGid,
      customFieldName: mapping.taskStatusCustomFieldName,
    };
    const rankedTasks = rankAsanaTasksForPrompt(tasks, prompt).slice(0, asanaContextTaskLimit);
    const [storiesByTaskGid, statusUpdates] = await Promise.all([
      fetchStoriesForContextTasks(tokenSet.accessToken, rankedTasks.slice(0, asanaContextStoryTaskLimit)),
      listAsanaStatusUpdatesForMappedProject(tokenSet.accessToken, mapping, scopes),
    ]);
    const snapshotComparison = await persistAsanaSnapshotForRag({
      mapping,
      statusUpdates,
      storiesByTaskGid,
      taskStatusSettings,
      tasks,
    });
    return buildAsanaProjectContext({
      mapping,
      maxContextChars,
      snapshotComparison,
      statusUpdates,
      taskStatusSettings,
      storiesByTaskGid,
      taskStatusSummary: buildAsanaTaskStatusSummary(tasks, taskStatusSettings),
      tasks: rankedTasks,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Asana context fetch failure.";
    console.warn(JSON.stringify({
      event: "asana_chat_context_failed",
      vertexProjectId,
      asanaProjectGid: mapping.asanaProjectGid,
      error: message,
    }));
    return `Asana search was enabled, but Asana context could not be loaded: ${message}`;
  }
}

export async function handleAsanaOAuthCallback(request: Request) {
  const user = await requireSignedInUser(request);
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  if (error) return Response.redirect(`${url.origin}/profile/asana?oauthError=${encodeURIComponent(error)}`, 302);
  if (!code || !state) return new Response("Missing Asana OAuth callback parameters.", { status: 400 });

  const stateHash = await sha256Hex(state);
  const stateRecord = await getDb()
    .prepare("SELECT user_id as userId, code_verifier as codeVerifier, redirect_to as redirectTo, expires_at as expiresAt FROM asana_oauth_states WHERE state_hash = ? LIMIT 1")
    .bind(stateHash)
    .first<{ userId: string; codeVerifier: string; redirectTo: string | null; expiresAt: number }>();

  await getDb().prepare("DELETE FROM asana_oauth_states WHERE state_hash = ?").bind(stateHash).run();
  if (!stateRecord || stateRecord.expiresAt < Date.now() || stateRecord.userId !== user.id) {
    return new Response("Asana OAuth state is invalid or expired.", { status: 403 });
  }

  const tokenResponse = await exchangeAsanaCode({
    code,
    codeVerifier: stateRecord.codeVerifier,
    redirectUri: asanaRedirectUri(request),
  });
  const asanaUser = await fetchAsanaMe(tokenResponse.access_token ?? "");
  const now = Date.now();
  const connectionId = `asana-conn-${crypto.randomUUID()}`;
  const asanaUserGid = tokenResponse.data?.gid || tokenResponse.data?.id?.toString() || asanaUser.gid;
  const asanaUserName = tokenResponse.data?.name || asanaUser.name || "Asana user";
  const asanaUserEmail = tokenResponse.data?.email || asanaUser.email || null;
  const scope = normalizeScopeString(tokenResponse.scope || (useAsanaFullPermissions() ? "full" : defaultAsanaScopes.join(" ")));

  await storeAsanaTokens({
    env: integrationEnv(),
    userId: user.id,
    tokens: {
      accessToken: tokenResponse.access_token ?? "",
      refreshToken: tokenResponse.refresh_token ?? "",
      expiresAt: now + Math.max(tokenResponse.expires_in ?? 0, 0) * 1000,
      scope,
      tokenType: tokenResponse.token_type,
    },
  });

  await getDb()
    .prepare(
      `INSERT INTO asana_connections (
        id, user_id, asana_user_gid, asana_user_name, asana_user_email, scopes, connected_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        id = excluded.id,
        asana_user_gid = excluded.asana_user_gid,
        asana_user_name = excluded.asana_user_name,
        asana_user_email = excluded.asana_user_email,
        scopes = excluded.scopes,
        updated_at = excluded.updated_at`,
    )
    .bind(connectionId, user.id, asanaUserGid, asanaUserName, asanaUserEmail, scope, now, now)
    .run();

  return Response.redirect(`${url.origin}${stateRecord.redirectTo ?? "/profile/asana"}?connected=1`, 302);
}

async function exchangeAsanaCode({
  code,
  codeVerifier,
  redirectUri,
}: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: asanaClientId(),
    client_secret: asanaClientSecret(),
    redirect_uri: redirectUri,
    code,
    code_verifier: codeVerifier,
  });
  const response = await fetch("https://app.asana.com/-/oauth_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const result = await response.json<AsanaTokenResponse>();
  if (!response.ok || result.error || !result.access_token || !result.refresh_token) {
    throw new Error(result.error_description || result.error || "Asana OAuth token exchange failed.");
  }
  return result;
}

async function fetchAsanaMe(accessToken: string) {
  return asanaFetch<AsanaUser>(accessToken, "/users/me", {
    query: { opt_fields: "gid,name,email,workspaces.gid,workspaces.name" },
  });
}

async function listMemberAsanaProjects(userId: string, scopes: string[]) {
  const tokenSet = await getValidAsanaTokens({ env: integrationEnv(), userId });
  if (!tokenSet) return [];
  if (!hasAsanaScope(scopes, "projects:read")) return [];

  const me = await fetchAsanaMe(tokenSet.accessToken);
  const projects: AsanaProjectOption[] = [];
  for (const workspace of me.workspaces ?? []) {
    const teams = await listAsanaTeamsForUser(tokenSet.accessToken, me.gid, workspace.gid);
    const membershipResults = await Promise.all(teams.map(async (team) => ({
      team,
      memberships: await listProjectMembershipsForTeam(tokenSet.accessToken, team.gid),
    })));
    for (const { memberships, team } of membershipResults) {
      for (const membership of memberships) {
        if (!membership.parent?.gid || membership.parent.archived) continue;
        const writeAccess = hasAsanaProjectWriteAccess(membership);
        const canWriteTasks = hasAsanaScope(scopes, "tasks:write") && writeAccess === true;
        projects.push({
          gid: membership.parent.gid,
          name: membership.parent.name ?? membership.parent.gid,
          workspaceGid: membership.parent.workspace?.gid ?? workspace.gid,
          workspaceName: membership.parent.workspace?.name ?? workspace.name,
          teamGid: team.gid,
          teamName: team.name,
          portfolioGid: null,
          portfolioName: null,
          canWriteTasks,
          permissionLevel: writeAccess === true ? "write" : "unknown",
          permissionSource: writeAccess === true
            ? "Asana team project membership access_level/write_access plus task-write authorization"
            : writeAccess === false
              ? `Asana team project membership is ${membership.access_level ?? "read-only"}; user write access will be checked when mapping is saved`
              : "Asana did not return access_level or write_access; user write access will be checked when mapping is saved",
        });
      }
    }
    const portfolioMemberships = await listAsanaPortfolioMembershipsForUser(tokenSet.accessToken, workspace.gid);
    const portfolios = dedupeAsanaPortfolios(portfolioMemberships
      .map((membership) => membership.portfolio ?? membership.parent)
      .filter((portfolio): portfolio is AsanaPortfolio => Boolean(portfolio?.gid)));
    const portfolioResults = await Promise.all(portfolios.map(async (portfolio) => ({
      portfolio,
      items: await listAsanaPortfolioItems(tokenSet.accessToken, portfolio.gid),
    })));
    for (const { items, portfolio } of portfolioResults) {
      for (const item of items) {
        if (item.resource_type && item.resource_type !== "project") continue;
        if (item.archived) continue;
        projects.push({
          gid: item.gid,
          name: item.name,
          workspaceGid: item.workspace?.gid ?? portfolio.workspace?.gid ?? workspace.gid,
          workspaceName: item.workspace?.name ?? portfolio.workspace?.name ?? workspace.name,
          teamGid: null,
          teamName: null,
          portfolioGid: portfolio.gid,
          portfolioName: portfolio.name,
          canWriteTasks: false,
          permissionLevel: "unknown",
          permissionSource: `Asana owned portfolio item from ${portfolio.name}; waiting for user project permission check`,
        });
      }
    }
  }
  const dedupedProjects = dedupeAsanaProjects(projects);
  return dedupedProjects;
}

async function listAsanaTeamsForUser(accessToken: string, userGid: string, workspaceGid: string) {
  return asanaFetchPaginated<AsanaTeam>(
    accessToken,
    `/users/${encodeURIComponent(userGid)}/teams`,
    {
      organization: workspaceGid,
      opt_fields: "gid,name",
      limit: "100",
    },
  );
}

async function listProjectMembershipsForTeam(accessToken: string, teamGid: string) {
  try {
    return await asanaFetchPaginated<AsanaProjectMembership>(
      accessToken,
      "/memberships",
      {
        member: teamGid,
        resource_subtype: "project_membership",
        opt_fields: "gid,access_level,write_access,member.gid,member.resource_type,parent.gid,parent.name,parent.archived,parent.workspace.gid,parent.workspace.name",
        limit: "100",
      },
    );
  } catch (error) {
    console.warn(JSON.stringify({
      event: "asana_team_project_memberships_failed",
      teamGid,
      error: error instanceof Error ? error.message : "Unknown Asana membership probe failure",
    }));
    return [];
  }
}

async function listAsanaPortfolioMembershipsForUser(accessToken: string, workspaceGid: string) {
  try {
    return await asanaFetchPaginated<AsanaPortfolioMembership>(
      accessToken,
      "/portfolio_memberships",
      {
        workspace: workspaceGid,
        user: "me",
        opt_fields: "gid,access_level,write_access,portfolio.gid,portfolio.name,portfolio.workspace.gid,portfolio.workspace.name,parent.gid,parent.name,parent.workspace.gid,parent.workspace.name",
        limit: "100",
      },
    );
  } catch (error) {
    console.warn(JSON.stringify({
      event: "asana_portfolio_memberships_failed",
      workspaceGid,
      error: error instanceof Error ? error.message : "Unknown Asana portfolio membership discovery failure",
    }));
    return [];
  }
}

async function listAsanaPortfolioItems(accessToken: string, portfolioGid: string) {
  try {
    return await asanaFetchPaginated<AsanaPortfolioItem>(
      accessToken,
      `/portfolios/${encodeURIComponent(portfolioGid)}/items`,
      {
        opt_fields: "gid,name,resource_type,archived,workspace.gid,workspace.name",
        limit: "100",
      },
    );
  } catch (error) {
    console.warn(JSON.stringify({
      event: "asana_portfolio_items_failed",
      portfolioGid,
      error: error instanceof Error ? error.message : "Unknown Asana portfolio item discovery failure",
    }));
    return [];
  }
}

async function resolveAsanaProjectWriteAccess(accessToken: string, userGid: string, project: AsanaProjectOption, scopes: string[]) {
  const [membership, projectRecord] = await Promise.all([
    getProjectMembershipForUser(accessToken, project.gid),
    fetchAsanaProject(accessToken, project.gid),
  ]);

  if (projectRecord?.owner?.gid === userGid) {
    return {
      ...project,
      canWriteTasks: hasAsanaScope(scopes, "tasks:write"),
      permissionLevel: "write",
      permissionSource: "Connected Asana user is the project owner plus task-write authorization",
    } satisfies AsanaProjectOption;
  }

  if (!membership) {
    return {
      ...project,
      permissionSource: `${project.permissionSource}; no user-specific project membership was returned`,
    } satisfies AsanaProjectOption;
  }

  const writeAccess = hasAsanaProjectWriteAccess(membership);
  return {
    ...project,
    canWriteTasks: hasAsanaScope(scopes, "tasks:write") && writeAccess === true,
    permissionLevel: writeAccess === true ? "write" : writeAccess === false ? "read" : "unknown",
    permissionSource: writeAccess === true
      ? "Asana user project membership access_level/write_access plus task-write authorization"
      : writeAccess === false
        ? `Asana user project membership is ${membership.access_level ?? "read-only"}`
        : "Asana did not return user access_level or write_access; task writes are disabled until permission is confirmed",
  } satisfies AsanaProjectOption;
}

async function getProjectMembershipForUser(accessToken: string, projectGid: string) {
  try {
    const memberships = await asanaFetchPaginated<AsanaProjectMembership>(
      accessToken,
      `/projects/${encodeURIComponent(projectGid)}/project_memberships`,
      {
        user: "me",
        opt_fields: "gid,access_level,write_access,member.gid,member.resource_type,user.gid,project.gid",
        limit: "10",
      },
    );
    return memberships[0] ?? null;
  } catch (error) {
    console.warn(JSON.stringify({
      event: "asana_user_project_membership_failed",
      projectGid,
      error: error instanceof Error ? error.message : "Unknown Asana user membership probe failure",
    }));
    return null;
  }
}

async function fetchAsanaProject(accessToken: string, projectGid: string) {
  try {
    return await asanaFetch<AsanaProject>(
      accessToken,
      `/projects/${encodeURIComponent(projectGid)}`,
      {
        query: { opt_fields: "gid,name,archived,owner.gid,owner.name" },
      },
    );
  } catch (error) {
    console.warn(JSON.stringify({
      event: "asana_project_owner_probe_failed",
      projectGid,
      error: error instanceof Error ? error.message : "Unknown Asana project owner probe failure",
    }));
    return null;
  }
}

async function listAsanaTasksForContext(accessToken: string, projectGid: string) {
  return asanaFetchPaginated<AsanaTaskContextRow>(
    accessToken,
    "/tasks",
    {
      project: projectGid,
      completed_since: "1970-01-01T00:00:00.000Z",
      opt_fields: [
        "gid",
        "name",
        "completed",
        "completed_at",
        "due_on",
        "due_at",
        "modified_at",
        "notes",
        "permalink_url",
        "assignee.name",
        "memberships.section.name",
        "custom_fields.gid",
        "custom_fields.name",
        "custom_fields.type",
        "custom_fields.display_value",
        "custom_fields.text_value",
        "custom_fields.number_value",
        "custom_fields.enum_value.gid",
        "custom_fields.enum_value.name",
        "custom_fields.multi_enum_values.gid",
        "custom_fields.multi_enum_values.name",
      ].join(","),
      limit: "100",
    },
    asanaPaginationPageLimit,
  );
}

async function listAsanaProjectCustomFields(accessToken: string, projectGid: string): Promise<AsanaTaskStatusCustomFieldOption[]> {
  try {
    const settings = await asanaFetchPaginated<AsanaCustomFieldSettingRow>(
      accessToken,
      `/projects/${encodeURIComponent(projectGid)}/custom_field_settings`,
      {
        opt_fields: "gid,custom_field.gid,custom_field.name,custom_field.type",
        limit: "100",
      },
      2,
    );
    return settings
      .map((setting) => setting.custom_field)
      .filter((field): field is { gid: string; name?: string | null; type?: string | null } => Boolean(field?.gid && field.name?.trim()))
      .map((field) => ({
        gid: field.gid,
        name: field.name?.trim() ?? field.gid,
        type: field.type ?? null,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  } catch (error) {
    console.warn(JSON.stringify({
      event: "asana_custom_field_settings_failed",
      projectGid,
      error: error instanceof Error ? error.message : "Unknown Asana custom field settings failure",
    }));
    return [];
  }
}

function collectTaskCustomFieldOptions(tasks: AsanaTaskContextRow[]) {
  const byGid = new Map<string, AsanaTaskStatusCustomFieldOption>();
  for (const task of tasks) {
    for (const field of task.custom_fields ?? []) {
      const name = field.name?.trim();
      if (!field.gid || !name || byGid.has(field.gid)) continue;
      byGid.set(field.gid, {
        gid: field.gid,
        name,
        type: field.type ?? null,
      });
    }
  }
  return [...byGid.values()].sort((left, right) => left.name.localeCompare(right.name));
}

async function fetchStoriesForContextTasks(accessToken: string, tasks: AsanaTaskContextRow[]) {
  const entries = await Promise.all(tasks.map(async (task) => {
    try {
      const stories = await asanaFetchPaginated<AsanaStoryContextRow>(
        accessToken,
        `/tasks/${encodeURIComponent(task.gid)}/stories`,
        {
          opt_fields: "gid,created_at,created_by.name,text,type,resource_subtype",
          limit: "20",
        },
        5,
        { limitBehavior: "truncate", limitLabel: "Asana task story context" },
      );
      return [task.gid, stories.filter(isUsefulAsanaStory).slice(-asanaContextStoriesPerTask)] as const;
    } catch (error) {
      console.warn(JSON.stringify({
        event: "asana_task_stories_context_failed",
        taskGid: task.gid,
        error: error instanceof Error ? error.message : "Unknown Asana task story failure",
      }));
      return [task.gid, [] as AsanaStoryContextRow[]] as const;
    }
  }));
  return new Map(entries);
}

async function listAsanaStatusUpdatesForMappedProject(
  accessToken: string,
  mapping: {
    asanaProjectGid: string;
    asanaProjectName: string;
    asanaWorkspaceGid: string;
    asanaWorkspaceName: string;
  },
  scopes: string[],
) {
  const projectUpdatesPromise = listAsanaStatusUpdatesForContext(accessToken, {
    parentGid: mapping.asanaProjectGid,
    sourceType: "project",
    sourceName: mapping.asanaProjectName,
    logContext: { projectGid: mapping.asanaProjectGid },
  });

  const portfolioUpdatesPromise = hasAsanaScope(scopes, "portfolios:read")
    ? listAsanaPortfolioStatusUpdatesForProject(accessToken, mapping)
    : Promise.resolve([] as AsanaContextStatusUpdate[]);

  const [projectUpdates, portfolioUpdates] = await Promise.all([projectUpdatesPromise, portfolioUpdatesPromise]);
  return [...projectUpdates, ...portfolioUpdates]
    .sort((left, right) => {
      const leftHierarchy = left.sourceType === "portfolio" ? left.sourceDepth ?? 0 : 999;
      const rightHierarchy = right.sourceType === "portfolio" ? right.sourceDepth ?? 0 : 999;
      if (leftHierarchy !== rightHierarchy) return leftHierarchy - rightHierarchy;
      const dateDiff = Date.parse(right.created_at ?? "") - Date.parse(left.created_at ?? "");
      if (dateDiff !== 0) return dateDiff;
      if (left.sourceType !== right.sourceType) return left.sourceType === "portfolio" ? -1 : 1;
      return left.sourceName.localeCompare(right.sourceName);
    })
    .slice(0, 10);
}

async function listAsanaPortfolioStatusUpdatesForProject(
  accessToken: string,
  mapping: {
    asanaProjectGid: string;
    asanaProjectName: string;
    asanaWorkspaceGid: string;
    asanaWorkspaceName: string;
  },
) {
  const portfolios = await listAsanaPortfoliosContainingProject(accessToken, mapping.asanaWorkspaceGid, mapping.asanaProjectGid);
  if (!portfolios.length) return [];

  const updateGroups = await Promise.all(portfolios.map((portfolio) => (
    listAsanaStatusUpdatesForContext(accessToken, {
      parentGid: portfolio.gid,
      sourceType: "portfolio",
      sourceName: portfolio.name,
      sourceDepth: portfolio.depth,
      sourcePath: portfolio.path,
      logContext: {
        projectGid: mapping.asanaProjectGid,
        portfolioGid: portfolio.gid,
      },
    })
  )));
  return updateGroups.flat();
}

async function listAsanaPortfoliosContainingProject(accessToken: string, workspaceGid: string, projectGid: string) {
  try {
    const memberships = await listAsanaPortfolioMembershipsForUser(accessToken, workspaceGid);
    const rootPortfolios = dedupeAsanaPortfolios(memberships
      .map((membership) => membership.portfolio ?? membership.parent)
      .filter((portfolio): portfolio is AsanaPortfolio => Boolean(portfolio?.gid)));
    const contextsByGid = new Map<string, AsanaPortfolioContext>();

    async function visitPortfolio(portfolio: AsanaPortfolio, path: string[], visited: Set<string>) {
      if (visited.has(portfolio.gid) || path.length > 6) return false;
      const nextVisited = new Set(visited);
      nextVisited.add(portfolio.gid);
      const nextPath = [...path, portfolio.name];
      const items = await listAsanaPortfolioItems(accessToken, portfolio.gid);
      let containsProject = items.some((item) =>
        item.gid === projectGid
          && (!item.resource_type || item.resource_type === "project")
          && !item.archived,
      );

      const childPortfolios = items
        .filter((item) => item.gid && item.resource_type === "portfolio" && !item.archived)
        .map((item): AsanaPortfolio => ({
          gid: item.gid,
          name: item.name,
          workspace: item.workspace ?? portfolio.workspace,
        }));

      for (const childPortfolio of childPortfolios) {
        const childContainsProject = await visitPortfolio(childPortfolio, nextPath, nextVisited);
        containsProject ||= childContainsProject;
      }

      if (containsProject) {
        const context: AsanaPortfolioContext = {
          ...portfolio,
          depth: path.length,
          path: nextPath,
        };
        const existing = contextsByGid.get(portfolio.gid);
        if (!existing || context.depth < existing.depth || context.path.length < existing.path.length) {
          contextsByGid.set(portfolio.gid, context);
        }
      }
      return containsProject;
    }

    await Promise.all(rootPortfolios.map((portfolio) => visitPortfolio(portfolio, [], new Set())));
    return [...contextsByGid.values()].sort((left, right) =>
      left.depth - right.depth
        || left.path.join(" / ").localeCompare(right.path.join(" / "))
        || left.name.localeCompare(right.name),
    );
  } catch (error) {
    console.warn(JSON.stringify({
      event: "asana_project_portfolio_context_failed",
      workspaceGid,
      projectGid,
      error: error instanceof Error ? error.message : "Unknown Asana project portfolio context failure",
    }));
    return [];
  }
}

async function listAsanaStatusUpdatesForContext(
  accessToken: string,
  source: {
    parentGid: string;
    sourceType: "project" | "portfolio";
    sourceName: string;
    sourceDepth?: number;
    sourcePath?: string[];
    logContext: Record<string, string>;
  },
) {
  try {
    return (await asanaFetchPaginated<AsanaStatusUpdateContextRow>(
      accessToken,
      "/status_updates",
      {
        parent: source.parentGid,
        opt_fields: "gid,title,text,color,created_at,created_by.name",
        limit: "20",
      },
      5,
      { limitBehavior: "truncate", limitLabel: `Asana ${source.sourceType} status update context` },
    ))
      .sort((left, right) => Date.parse(right.created_at ?? "") - Date.parse(left.created_at ?? ""))
      .slice(0, 10)
      .map((update) => ({
        ...update,
        sourceType: source.sourceType,
        sourceGid: source.parentGid,
        sourceName: source.sourceName,
        sourceDepth: source.sourceDepth,
        sourcePath: source.sourcePath,
      }));
  } catch (error) {
    console.warn(JSON.stringify({
      event: "asana_status_updates_context_failed",
      sourceType: source.sourceType,
      parentGid: source.parentGid,
      ...source.logContext,
      error: error instanceof Error ? error.message : "Unknown Asana status update failure",
    }));
    return [];
  }
}

function isUsefulAsanaStory(story: AsanaStoryContextRow) {
  return Boolean(story.text?.trim()) && story.resource_subtype !== "system";
}

function rankAsanaTasksForPrompt(tasks: AsanaTaskContextRow[], prompt: string) {
  const terms = new Set(prompt.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length > 2));
  return [...tasks].sort((left, right) => {
    const leftScore = scoreAsanaTask(left, terms);
    const rightScore = scoreAsanaTask(right, terms);
    if (rightScore !== leftScore) return rightScore - leftScore;
    return Date.parse(right.modified_at ?? "") - Date.parse(left.modified_at ?? "");
  });
}

function scoreAsanaTask(task: AsanaTaskContextRow, terms: Set<string>) {
  const haystack = [
    task.name,
    task.notes,
    task.assignee?.name,
    ...(task.memberships ?? []).map((membership) => membership.section?.name),
  ].filter(Boolean).join(" ").toLowerCase();
  let score = task.completed ? 0 : 8;
  for (const term of terms) {
    if (haystack.includes(term)) score += 5;
  }
  if (task.due_on || task.due_at) score += 2;
  const modified = Date.parse(task.modified_at ?? "");
  if (Number.isFinite(modified)) {
    const daysOld = Math.max(0, (Date.now() - modified) / 86_400_000);
    score += Math.max(0, 8 - Math.floor(daysOld / 7));
  }
  return score;
}

function asanaCustomFieldValue(field: AsanaTaskCustomFieldContextRow) {
  const multiEnum = field.multi_enum_values?.map((value) => value.name).filter(Boolean).join(", ");
  return field.display_value
    ?? field.enum_value?.name
    ?? multiEnum
    ?? field.text_value
    ?? (typeof field.number_value === "number" ? String(field.number_value) : null);
}

function resolveAsanaTaskStatus(task: AsanaTaskContextRow, settings: AsanaTaskStatusSettings) {
  if (settings.source !== "custom_field") {
    return {
      label: task.completed ? "Completed" : "Open",
      sourceLabel: "Native Asana completion",
    };
  }

  const configuredName = settings.customFieldName?.trim().toLowerCase() ?? "";
  const field = (task.custom_fields ?? []).find((customField) =>
    (settings.customFieldGid && customField.gid === settings.customFieldGid)
      || (configuredName && customField.name?.trim().toLowerCase() === configuredName),
  );
  const statusValue = field ? asanaCustomFieldValue(field) : null;
  return {
    label: statusValue?.trim() || "Blank",
    sourceLabel: settings.customFieldName
      ? `Asana custom field: ${settings.customFieldName}`
      : "Asana custom field",
  };
}

function buildAsanaTaskStatusSummary(tasks: AsanaTaskContextRow[], settings: AsanaTaskStatusSettings) {
  const counts = new Map<string, number>();
  for (const task of tasks) {
    const status = resolveAsanaTaskStatus(task, settings).label || "Blank";
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }

  const sortedCounts = [...counts.entries()]
    .sort((left, right) => {
      if (right[1] !== left[1]) return right[1] - left[1];
      return left[0].localeCompare(right[0]);
    })
    .map(([status, count]) => `- ${status}: ${count}`);

  return {
    lines: sortedCounts,
    sourceLabel: settings.source === "custom_field"
      ? `Asana custom field ${settings.customFieldName ?? settings.customFieldGid ?? "(not selected)"}`
      : "Native Asana completion",
    totalTasks: tasks.length,
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function cleanSnapshotText(value: string | null | undefined, maxLength = 260) {
  const text = value?.replace(/\s+/g, " ").trim() ?? "";
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
}

function taskSection(task: AsanaTaskContextRow) {
  return task.memberships?.map((membership) => membership.section?.name).filter(Boolean).join(", ") ?? "";
}

function normalizeCustomFields(fields: AsanaTaskCustomFieldContextRow[] | undefined) {
  return (fields ?? [])
    .map((field) => ({
      gid: field.gid,
      name: field.name ?? "",
      value: asanaCustomFieldValue(field) ?? "",
    }))
    .sort((left, right) => left.gid.localeCompare(right.gid));
}

async function normalizeAsanaSnapshot({
  mapping,
  statusUpdates,
  storiesByTaskGid,
  taskStatusSettings,
  tasks,
}: {
  mapping: {
    asanaProjectGid: string;
    asanaProjectName: string;
    asanaWorkspaceName: string;
  };
  statusUpdates: AsanaContextStatusUpdate[];
  storiesByTaskGid: Map<string, AsanaStoryContextRow[]>;
  taskStatusSettings: AsanaTaskStatusSettings;
  tasks: AsanaTaskContextRow[];
}): Promise<NormalizedAsanaSnapshot> {
  const normalizedTasks = await Promise.all(tasks.map(async (task) => {
    const customFieldsHash = await sha256Hex(stableJson(normalizeCustomFields(task.custom_fields)));
    const notesHash = await sha256Hex(task.notes?.trim() ?? "");
    const status = resolveAsanaTaskStatus(task, taskStatusSettings).label;
    const snapshotBase = {
      gid: task.gid,
      name: task.name,
      status,
      completed: Boolean(task.completed),
      assignee: task.assignee?.name?.trim() ?? "",
      due: task.due_on ?? task.due_at ?? "",
      modifiedAt: task.modified_at ?? "",
      section: taskSection(task),
      notesPreview: cleanSnapshotText(task.notes),
      notesHash,
      customFieldsHash,
    };
    return {
      ...snapshotBase,
      fingerprint: await sha256Hex(stableJson(snapshotBase)),
    };
  }));

  const normalizedStatusUpdates = await Promise.all(statusUpdates.map(async (update) => {
    const textHash = await sha256Hex(update.text?.trim() ?? "");
    const snapshotBase = {
      gid: update.gid,
      sourceType: update.sourceType,
      sourceName: update.sourceName,
      title: update.title?.trim() ?? "",
      color: update.color?.trim() ?? "",
      createdAt: update.created_at ?? "",
      textPreview: cleanSnapshotText(update.text),
      textHash,
    };
    return {
      ...snapshotBase,
      fingerprint: await sha256Hex(stableJson(snapshotBase)),
    };
  }));

  const storyEntries = [...storiesByTaskGid.entries()].flatMap(([taskGid, stories]) =>
    stories.map((story) => ({ taskGid, story })),
  );
  const normalizedStories = await Promise.all(storyEntries.map(async ({ taskGid, story }) => {
    const textHash = await sha256Hex(story.text?.trim() ?? "");
    const snapshotBase = {
      gid: story.gid,
      taskGid,
      createdAt: story.created_at ?? "",
      author: story.created_by?.name?.trim() ?? "",
      textPreview: cleanSnapshotText(story.text),
      textHash,
    };
    return {
      ...snapshotBase,
      fingerprint: await sha256Hex(stableJson(snapshotBase)),
    };
  }));

  return {
    asanaProjectGid: mapping.asanaProjectGid,
    asanaProjectName: mapping.asanaProjectName,
    asanaWorkspaceName: mapping.asanaWorkspaceName,
    taskStatusSource: taskStatusSettings.source === "custom_field"
      ? `custom_field:${taskStatusSettings.customFieldName ?? taskStatusSettings.customFieldGid ?? ""}`
      : "native",
    tasks: normalizedTasks.sort((left, right) => left.gid.localeCompare(right.gid)),
    statusUpdates: normalizedStatusUpdates.sort((left, right) => left.gid.localeCompare(right.gid)),
    stories: normalizedStories.sort((left, right) => left.gid.localeCompare(right.gid)),
  };
}

function diffRecords<T extends { gid: string; fingerprint: string }>(
  previous: T[],
  current: T[],
) {
  const previousByGid = new Map(previous.map((item) => [item.gid, item]));
  const currentByGid = new Map(current.map((item) => [item.gid, item]));
  const added = current.filter((item) => !previousByGid.has(item.gid));
  const removed = previous.filter((item) => !currentByGid.has(item.gid));
  const changed = current
    .map((item) => {
      const oldItem = previousByGid.get(item.gid);
      return oldItem && oldItem.fingerprint !== item.fingerprint ? { previous: oldItem, current: item } : null;
    })
    .filter((item): item is { previous: T; current: T } => Boolean(item));
  return { added, removed, changed };
}

function changedFields<T extends Record<string, unknown>>(previous: T, current: T, ignored: string[] = ["fingerprint"]) {
  const ignoredSet = new Set(ignored);
  return Object.keys(current)
    .filter((key) => !ignoredSet.has(key) && stableJson(previous[key]) !== stableJson(current[key]));
}

function buildSnapshotDiff(previous: NormalizedAsanaSnapshot | null, current: NormalizedAsanaSnapshot): AsanaSnapshotDiff {
  if (!previous) {
    return {
      initial: true,
      addedTasks: current.tasks,
      removedTasks: [],
      changedTasks: [],
      addedStatusUpdates: current.statusUpdates,
      changedStatusUpdates: [],
      addedStories: current.stories,
    };
  }

  const taskDiff = diffRecords(previous.tasks, current.tasks);
  const statusUpdateDiff = diffRecords(previous.statusUpdates, current.statusUpdates);
  const storyDiff = diffRecords(previous.stories, current.stories);

  return {
    initial: false,
    addedTasks: taskDiff.added,
    removedTasks: taskDiff.removed,
    changedTasks: taskDiff.changed.map((item) => ({
      ...item,
      fields: changedFields(item.previous, item.current),
    })),
    addedStatusUpdates: statusUpdateDiff.added,
    changedStatusUpdates: statusUpdateDiff.changed.map((item) => ({
      ...item,
      fields: changedFields(item.previous, item.current),
    })),
    addedStories: storyDiff.added,
  };
}

function hasSnapshotDiff(diff: AsanaSnapshotDiff) {
  return diff.initial
    || diff.addedTasks.length > 0
    || diff.removedTasks.length > 0
    || diff.changedTasks.length > 0
    || diff.addedStatusUpdates.length > 0
    || diff.changedStatusUpdates.length > 0
    || diff.addedStories.length > 0;
}

function taskSnapshotLine(task: NormalizedAsanaTaskSnapshot) {
  return [
    `${task.name} (${task.gid})`,
    `status=${task.status}`,
    task.assignee ? `assignee=${task.assignee}` : "",
    task.due ? `due=${task.due}` : "",
    task.section ? `section=${task.section}` : "",
    task.modifiedAt ? `modified=${task.modifiedAt}` : "",
  ].filter(Boolean).join("; ");
}

function buildSnapshotDiffSummary(diff: AsanaSnapshotDiff) {
  if (diff.initial) {
    return `Initial Asana snapshot captured with ${diff.addedTasks.length} tasks, ${diff.addedStatusUpdates.length} status updates, and ${diff.addedStories.length} recent task stories.`;
  }

  const parts = [
    diff.addedTasks.length ? `${diff.addedTasks.length} task(s) added` : "",
    diff.removedTasks.length ? `${diff.removedTasks.length} task(s) removed` : "",
    diff.changedTasks.length ? `${diff.changedTasks.length} task(s) changed` : "",
    diff.addedStatusUpdates.length ? `${diff.addedStatusUpdates.length} status update(s) added` : "",
    diff.changedStatusUpdates.length ? `${diff.changedStatusUpdates.length} status update(s) changed` : "",
    diff.addedStories.length ? `${diff.addedStories.length} story/comment(s) added` : "",
  ].filter(Boolean);
  return parts.length ? parts.join("; ") : "No material Asana changes since the previous snapshot.";
}

function buildAsanaSnapshotDocument({
  capturedAt,
  current,
  diff,
  mapping,
}: {
  capturedAt: string;
  current: NormalizedAsanaSnapshot;
  diff: AsanaSnapshotDiff;
  mapping: {
    asanaProjectGid: string;
    asanaProjectName: string;
    asanaWorkspaceName: string;
    vertexProjectId: string;
  };
}) {
  const lines = [
    `# Asana Snapshot - ${mapping.asanaProjectName}`,
    "",
    `Captured at: ${capturedAt}`,
    `Asana project: ${mapping.asanaProjectName} (${mapping.asanaProjectGid})`,
    `Asana workspace: ${mapping.asanaWorkspaceName}`,
    `Vertex project ID: ${mapping.vertexProjectId}`,
    `Task status source: ${current.taskStatusSource}`,
    "",
    "## Snapshot Summary",
    `- Tasks: ${current.tasks.length}`,
    `- Status updates tracked: ${current.statusUpdates.length}`,
    `- Recent task stories tracked: ${current.stories.length}`,
    `- Change summary: ${buildSnapshotDiffSummary(diff)}`,
    "",
    "## Task Changes",
  ];

  if (diff.initial) {
    lines.push("- Baseline snapshot. Future snapshots will list deltas against this baseline.");
  }
  for (const task of diff.addedTasks.slice(0, 80)) lines.push(`- Added: ${taskSnapshotLine(task)}`);
  for (const task of diff.removedTasks.slice(0, 80)) lines.push(`- Removed: ${taskSnapshotLine(task)}`);
  for (const change of diff.changedTasks.slice(0, 80)) {
    lines.push(`- Changed: ${taskSnapshotLine(change.current)}; fields changed=${change.fields.join(", ") || "unknown"}`);
  }
  if (!diff.addedTasks.length && !diff.removedTasks.length && !diff.changedTasks.length) lines.push("- No task changes detected.");

  lines.push("", "## Status Update Changes");
  for (const update of diff.addedStatusUpdates.slice(0, 30)) {
    lines.push(`- Added: [${update.sourceType}] ${update.sourceName}; ${update.title || "Untitled"}; ${update.createdAt}; ${update.color}; ${update.textPreview}`);
  }
  for (const update of diff.changedStatusUpdates.slice(0, 30)) {
    lines.push(`- Changed: [${update.current.sourceType}] ${update.current.sourceName}; ${update.current.title || "Untitled"}; fields changed=${update.fields.join(", ") || "unknown"}; ${update.current.textPreview}`);
  }
  if (!diff.addedStatusUpdates.length && !diff.changedStatusUpdates.length) lines.push("- No status update changes detected.");

  lines.push("", "## New Task Stories");
  for (const story of diff.addedStories.slice(0, 40)) {
    lines.push(`- Task ${story.taskGid}; ${story.createdAt}; ${story.author}: ${story.textPreview}`);
  }
  if (!diff.addedStories.length) lines.push("- No new tracked task stories detected.");

  lines.push("", "## Current Task Snapshot");
  for (const task of current.tasks.slice(0, 250)) lines.push(`- ${taskSnapshotLine(task)}; notes=${task.notesPreview}`);
  if (current.tasks.length > 250) lines.push(`- ${current.tasks.length - 250} additional tasks omitted from this snapshot document.`);

  return lines.join("\n");
}

async function latestAsanaSnapshot(mappingId: string) {
  return getDb()
    .prepare(
      `SELECT snapshot_json as snapshotJson,
              snapshot_hash as snapshotHash,
              created_at as createdAt
       FROM asana_project_snapshots
       WHERE mapping_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .bind(mappingId)
    .first<{ snapshotJson: string; snapshotHash: string; createdAt: number }>();
}

function parseSnapshot(value: string | null | undefined) {
  if (!value) return null;
  try {
    return JSON.parse(value) as NormalizedAsanaSnapshot;
  } catch {
    return null;
  }
}

function snapshotTeamId(mapping: { vertexTeamId: string | null; vertexWorkspaceId: string }) {
  return mapping.vertexTeamId?.trim() || `workspace-${mapping.vertexWorkspaceId}`;
}

function asanaSnapshotR2Key(teamId: string, projectId: string, hash: string) {
  return `rag-asana/${teamId}/${projectId}/${Date.now()}-${hash.slice(0, 12)}.md`;
}

async function persistAsanaSnapshotForRag({
  mapping,
  statusUpdates,
  storiesByTaskGid,
  taskStatusSettings,
  tasks,
}: {
  mapping: {
    mappingId: string;
    userId: string;
    asanaProjectGid: string;
    asanaProjectName: string;
    asanaWorkspaceName: string;
    vertexWorkspaceId: string;
    vertexTeamId: string | null;
    vertexMode: WorkspaceMode;
    vertexProjectId: string;
  };
  statusUpdates: AsanaContextStatusUpdate[];
  storiesByTaskGid: Map<string, AsanaStoryContextRow[]>;
  taskStatusSettings: AsanaTaskStatusSettings;
  tasks: AsanaTaskContextRow[];
}) {
  try {
    const snapshot = await normalizeAsanaSnapshot({ mapping, statusUpdates, storiesByTaskGid, taskStatusSettings, tasks });
    const snapshotJson = stableJson(snapshot);
    const snapshotHash = await sha256Hex(snapshotJson);
    const previousRow = await latestAsanaSnapshot(mapping.mappingId);
    if (previousRow?.snapshotHash === snapshotHash) {
      return `Asana snapshot comparison: no material changes since the previous snapshot captured at ${new Date(previousRow.createdAt).toISOString()}.`;
    }

    const previousSnapshot = parseSnapshot(previousRow?.snapshotJson);
    const diff = buildSnapshotDiff(previousSnapshot, snapshot);
    if (!hasSnapshotDiff(diff)) {
      return "Asana snapshot comparison: no material changes since the previous snapshot.";
    }

    const capturedAt = new Date().toISOString();
    const diffSummary = buildSnapshotDiffSummary(diff);
    const teamId = snapshotTeamId(mapping);
    const r2Key = asanaSnapshotR2Key(teamId, mapping.vertexProjectId, snapshotHash);
    const documentName = `Asana Snapshot - ${mapping.asanaProjectName} - ${capturedAt.slice(0, 10)}.md`;
    const documentText = buildAsanaSnapshotDocument({ capturedAt, current: snapshot, diff, mapping });
    const snapshotEnv = integrationEnv();
    let queued = false;

    if (snapshotEnv.ARTIFACTS_BUCKET && snapshotEnv.DOCUMENT_INGESTION_QUEUE) {
      await snapshotEnv.ARTIFACTS_BUCKET.put(r2Key, documentText, {
        httpMetadata: { contentType: "text/markdown; charset=utf-8" },
        customMetadata: {
          team_id: teamId,
          project_id: mapping.vertexProjectId,
          document_name: documentName,
          source: "asana-snapshot",
          asana_project_gid: mapping.asanaProjectGid,
          confidentiality: "Standard",
          restricted: "false",
        },
      });
      await snapshotEnv.DOCUMENT_INGESTION_QUEUE.send({
        kind: "scoped-rag-generated-artifact",
        r2Key,
        documentName,
        teamId,
        projectId: mapping.vertexProjectId,
      });
      queued = true;
    } else {
      console.warn(JSON.stringify({
        event: "asana_snapshot_rag_bindings_missing",
        vertexProjectId: mapping.vertexProjectId,
        asanaProjectGid: mapping.asanaProjectGid,
      }));
    }

    await getDb()
      .prepare(
        `INSERT INTO asana_project_snapshots (
          id,
          mapping_id,
          user_id,
          vertex_workspace_id,
          vertex_team_id,
          vertex_mode,
          vertex_project_id,
          asana_project_gid,
          asana_project_name,
          snapshot_hash,
          snapshot_json,
          task_count,
          status_update_count,
          story_count,
          diff_summary,
          r2_key,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        `asana-snapshot-${crypto.randomUUID()}`,
        mapping.mappingId,
        mapping.userId,
        mapping.vertexWorkspaceId,
        mapping.vertexTeamId,
        mapping.vertexMode,
        mapping.vertexProjectId,
        mapping.asanaProjectGid,
        mapping.asanaProjectName,
        snapshotHash,
        snapshotJson,
        snapshot.tasks.length,
        snapshot.statusUpdates.length,
        snapshot.stories.length,
        diffSummary,
        queued ? r2Key : null,
        Date.now(),
      )
      .run();

    return `Asana snapshot comparison: ${diffSummary}${queued ? " The changed snapshot was queued for future RAG vector search." : " Snapshot metadata was stored, but RAG ingestion was skipped because storage/queue bindings were unavailable."}`;
  } catch (error) {
    console.warn(JSON.stringify({
      event: "asana_snapshot_persist_failed",
      vertexProjectId: mapping.vertexProjectId,
      asanaProjectGid: mapping.asanaProjectGid,
      error: error instanceof Error ? error.message : "Unknown Asana snapshot persistence failure",
    }));
    return "Asana snapshot comparison: unavailable because snapshot persistence failed.";
  }
}

function buildAsanaProjectContext({
  mapping,
  maxContextChars,
  snapshotComparison,
  statusUpdates,
  taskStatusSettings,
  storiesByTaskGid,
  taskStatusSummary,
  tasks,
}: {
  mapping: {
    asanaProjectGid: string;
    asanaProjectName: string;
    asanaWorkspaceName: string;
    permissionLevel: string;
  };
  maxContextChars: number;
  snapshotComparison?: string | null;
  statusUpdates: AsanaContextStatusUpdate[];
  taskStatusSettings: AsanaTaskStatusSettings;
  storiesByTaskGid: Map<string, AsanaStoryContextRow[]>;
  taskStatusSummary: {
    lines: string[];
    sourceLabel: string;
    totalTasks: number;
  };
  tasks: AsanaTaskContextRow[];
}) {
  const lines = [
    "Asana search: enabled",
    `Mapped Asana project: ${mapping.asanaProjectName} (${mapping.asanaProjectGid})`,
    `Asana workspace: ${mapping.asanaWorkspaceName}`,
    `Connected permission: ${mapping.permissionLevel}`,
    `Task status source: ${taskStatusSettings.source === "custom_field" ? `Custom field ${taskStatusSettings.customFieldName ?? taskStatusSettings.customFieldGid ?? "(not selected)"}` : "Native Asana completion"}`,
    "Use this Asana context when it is relevant to the user's request. Treat it as live project evidence, but do not invent missing Asana fields.",
  ];

  lines.push(
    "",
    "Full Asana task status summary:",
    `Status source: ${taskStatusSummary.sourceLabel}`,
    `Tasks counted from mapped project: ${taskStatusSummary.totalTasks}`,
    "Use these aggregate counts for task-status/count questions. The detailed tasks below are only a relevance-ranked sample.",
    ...(taskStatusSummary.lines.length ? taskStatusSummary.lines : ["- No tasks returned"]),
  );

  if (snapshotComparison) {
    lines.push("", snapshotComparison);
  }

  if (statusUpdates.length) {
    lines.push(
      "",
      "Recent Asana status updates:",
      "Portfolio updates below include parent portfolios and nested portfolios that contain the mapped project. Use the highest-level relevant portfolio status as the primary context for status questions, then use nested portfolio/project updates for more specific or fresher details.",
    );
    for (const update of statusUpdates) {
      const sourceLabel = update.sourceType === "portfolio"
        ? `Portfolio${typeof update.sourceDepth === "number" ? ` L${update.sourceDepth + 1}` : ""}: ${update.sourcePath?.length ? update.sourcePath.join(" / ") : update.sourceName}`
        : `Project: ${update.sourceName}`;
      lines.push(`- ${formatDateTime(update.created_at)} [${sourceLabel}]${update.title ? ` ${update.title}` : ""}${update.color ? ` [${update.color}]` : ""}${update.created_by?.name ? ` by ${update.created_by.name}` : ""}: ${truncateAsanaContext(update.text ?? "", 450)}`);
    }
  }

  if (tasks.length) {
    lines.push("", "Relevant Asana tasks:");
    tasks.forEach((task, index) => {
      const stories = storiesByTaskGid.get(task.gid) ?? [];
      const section = task.memberships?.map((membership) => membership.section?.name).filter(Boolean).join(", ");
      const taskStatus = resolveAsanaTaskStatus(task, taskStatusSettings);
      lines.push([
        `[Task ${index + 1}] ${task.name} (${task.gid})`,
        `Status: ${taskStatus.label} (${taskStatus.sourceLabel})`,
        task.assignee?.name ? `Assignee: ${task.assignee.name}` : "",
        task.due_on || task.due_at ? `Due: ${task.due_on ?? task.due_at}` : "",
        task.modified_at ? `Modified: ${task.modified_at}` : "",
        section ? `Section: ${section}` : "",
        task.permalink_url ? `URL: ${task.permalink_url}` : "",
        task.notes?.trim() ? `Notes: ${truncateAsanaContext(task.notes, 500)}` : "",
      ].filter(Boolean).join("\n"));
      if (stories.length) {
        lines.push("Recent task messages/stories:");
        for (const story of stories) {
          lines.push(`- ${formatDateTime(story.created_at)}${story.created_by?.name ? ` ${story.created_by.name}` : ""}: ${truncateAsanaContext(story.text ?? "", 300)}`);
        }
      }
    });
  } else {
    lines.push("", "No Asana tasks were returned for the mapped project.");
  }

  return truncateAsanaContext(lines.join("\n"), maxContextChars);
}

function truncateAsanaContext(value: string, maxLength: number) {
  const normalized = value.replace(/\r/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1).trim()}...` : normalized;
}

function formatDateTime(value: string | null | undefined) {
  return value ? value : "Unknown date";
}

function hasAsanaProjectWriteAccess(membership: AsanaProjectMembership) {
  if (membership.write_access === true) return true;
  if (membership.write_access === false) return false;
  if (membership.access_level === "admin" || membership.access_level === "editor") return true;
  if (membership.access_level === "commenter" || membership.access_level === "viewer") return false;
  return null;
}

function dedupeAsanaProjects(projects: AsanaProjectOption[]) {
  const byGid = new Map<string, AsanaProjectOption>();
  for (const project of projects) {
    const current = byGid.get(project.gid);
    if (!current || projectPermissionRank(project) > projectPermissionRank(current)) {
      byGid.set(project.gid, project);
    }
  }
  return [...byGid.values()].sort((left, right) => left.workspaceName.localeCompare(right.workspaceName) || left.name.localeCompare(right.name));
}

function projectPermissionRank(project: AsanaProjectOption) {
  if (project.canWriteTasks || project.permissionLevel === "write") return 3;
  if (project.permissionLevel === "unknown") return 2;
  return 1;
}

function asanaWebhookOrigin(request = getRequest()) {
  return integrationEnv().ASANA_WEBHOOK_ORIGIN?.trim().replace(/\/+$/, "") || new URL(request.url).origin;
}

function asanaProjectWebhookTarget(origin: string, project: Pick<AsanaProjectOption, "gid" | "workspaceGid">) {
  const target = new URL("/api/webhooks/asana", origin);
  target.searchParams.set("asanaWorkspaceGid", project.workspaceGid);
  target.searchParams.set("asanaProjectGid", project.gid);
  return target.toString();
}

async function ensureAsanaProjectWebhook({
  accessToken,
  asanaProject,
  origin,
  userId,
}: {
  accessToken: string;
  asanaProject: AsanaProjectOption;
  origin: string;
  userId: string;
}) {
  const targetUrl = asanaProjectWebhookTarget(origin, asanaProject);
  const existing = await getAsanaProjectWebhookRecord(asanaProject.gid);
  if (existing?.status === "active" && existing.targetUrl === targetUrl && existing.webhookGid) {
    return { status: "active", webhookGid: existing.webhookGid };
  }

  try {
    let remoteWebhook: AsanaWebhookRecord | null = null;
    try {
      remoteWebhook = await findExistingAsanaWebhook(accessToken, asanaProject, targetUrl);
    } catch (error) {
      console.warn(JSON.stringify({
        asanaProjectGid: asanaProject.gid,
        event: "asana_project_webhook_lookup_failed",
        error: error instanceof Error ? error.message : "Unknown Asana webhook lookup failure",
      }));
    }
    const webhook = remoteWebhook ?? await createAsanaProjectWebhook(accessToken, asanaProject, targetUrl);
    await upsertAsanaProjectWebhookRecord({
      asanaProject,
      status: "active",
      targetUrl,
      userId,
      webhookGid: webhook.gid,
    });
    return { status: "active", webhookGid: webhook.gid };
  } catch (error) {
    return recordAsanaProjectWebhookFailure({
      asanaProject,
      error: error instanceof Error ? error.message : "Unknown Asana webhook setup failure",
      origin,
      userId,
    });
  }
}

async function recordAsanaProjectWebhookFailure({
  asanaProject,
  error,
  origin,
  userId,
}: {
  asanaProject: AsanaProjectOption;
  error: string;
  origin: string;
  userId: string;
}) {
  await upsertAsanaProjectWebhookRecord({
    asanaProject,
    lastError: error,
    status: "failed",
    targetUrl: asanaProjectWebhookTarget(origin, asanaProject),
    userId,
    webhookGid: null,
  });
  console.warn(JSON.stringify({
    asanaProjectGid: asanaProject.gid,
    event: "asana_project_webhook_setup_failed",
    error,
  }));
  return { status: "failed", webhookGid: null };
}

async function getAsanaProjectWebhookRecord(asanaProjectGid: string) {
  return getDb()
    .prepare(
      `SELECT asana_project_gid as asanaProjectGid,
              webhook_gid as webhookGid,
              target_url as targetUrl,
              status,
              last_error as lastError
       FROM asana_project_webhooks
       WHERE asana_project_gid = ?
       LIMIT 1`,
    )
    .bind(asanaProjectGid)
    .first<{
      asanaProjectGid: string;
      webhookGid: string | null;
      targetUrl: string;
      status: "active" | "creating" | "failed" | "deleted";
      lastError: string | null;
    }>();
}

async function findExistingAsanaWebhook(accessToken: string, asanaProject: AsanaProjectOption, targetUrl: string) {
  const webhooks = await asanaFetchPaginated<AsanaWebhookRecord>(
    accessToken,
    "/webhooks",
    {
      workspace: asanaProject.workspaceGid,
      resource: asanaProject.gid,
      opt_fields: "gid,active,target,resource.gid,resource.name",
    },
    10,
  );
  return webhooks.find((webhook) => webhook.target === targetUrl && webhook.active !== false) ?? null;
}

async function createAsanaProjectWebhook(accessToken: string, asanaProject: AsanaProjectOption, targetUrl: string) {
  return asanaFetch<AsanaWebhookRecord>(accessToken, "/webhooks", {
    method: "POST",
    body: JSON.stringify({
      data: {
        resource: asanaProject.gid,
        target: targetUrl,
        filters: [
          { resource_type: "task", action: "added" },
          { resource_type: "task", action: "changed" },
          { resource_type: "task", action: "removed" },
          { resource_type: "task", action: "deleted" },
          { resource_type: "task", action: "undeleted" },
        ],
      },
    }),
  });
}

async function upsertAsanaProjectWebhookRecord({
  asanaProject,
  lastError = null,
  status,
  targetUrl,
  userId,
  webhookGid,
}: {
  asanaProject: AsanaProjectOption;
  lastError?: string | null;
  status: "active" | "creating" | "failed" | "deleted";
  targetUrl: string;
  userId: string;
  webhookGid: string | null;
}) {
  const now = Date.now();
  await getDb()
    .prepare(
      `INSERT INTO asana_project_webhooks (
        asana_project_gid,
        asana_workspace_gid,
        webhook_gid,
        target_url,
        status,
        last_error,
        created_by_user_id,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(asana_project_gid) DO UPDATE SET
        asana_workspace_gid = excluded.asana_workspace_gid,
        webhook_gid = excluded.webhook_gid,
        target_url = excluded.target_url,
        status = excluded.status,
        last_error = excluded.last_error,
        created_by_user_id = excluded.created_by_user_id,
        updated_at = excluded.updated_at`,
    )
    .bind(
      asanaProject.gid,
      asanaProject.workspaceGid,
      webhookGid,
      targetUrl,
      status,
      lastError,
      userId,
      now,
      now,
    )
    .run();
}

function dedupeAsanaPortfolios(portfolios: AsanaPortfolio[]) {
  const byGid = new Map<string, AsanaPortfolio>();
  for (const portfolio of portfolios) byGid.set(portfolio.gid, portfolio);
  return [...byGid.values()].sort((left, right) => left.name.localeCompare(right.name));
}

async function asanaFetch<T>(
  accessToken: string,
  path: string,
  options: {
    method?: string;
    query?: Record<string, string>;
    body?: BodyInit;
  } = {},
) {
  const url = new URL(`https://app.asana.com/api/1.0${path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, value);
  const response = await fetchAsanaWithTimeout(url, {
    method: options.method ?? "GET",
    headers: asanaHeaders(accessToken),
    body: options.body,
  });
  const envelope = await response.json<AsanaApiEnvelope<T>>();
  if (!response.ok) {
    const message = envelope.errors?.map((item) => item.message).filter(Boolean).join("; ");
    throw new Error(message || `Asana API request failed with ${response.status}.`);
  }
  return envelope.data;
}

async function asanaFetchPaginated<T>(
  accessToken: string,
  path: string,
  query: Record<string, string>,
  pageLimit = asanaPaginationPageLimit,
  options: AsanaPaginationOptions = {},
) {
  const rows: T[] = [];
  let offset: string | undefined;
  let pageCount = 0;
  const seenOffsets = new Set<string>();
  do {
    const url = new URL(`https://app.asana.com/api/1.0${path}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    if (offset) url.searchParams.set("offset", offset);
    const response = await fetchAsanaWithTimeout(url, {
      headers: asanaHeaders(accessToken),
    });
    const envelope = await response.json<AsanaApiEnvelope<T[]>>();
    if (!response.ok) {
      const message = envelope.errors?.map((item) => item.message).filter(Boolean).join("; ");
      throw new Error(message || `Asana API request failed with ${response.status}.`);
    }
    rows.push(...(envelope.data ?? []));
    offset = envelope.next_page?.offset;
    pageCount += 1;
    if (offset && pageCount >= pageLimit) {
      if (options.limitBehavior === "truncate") {
        break;
      }
      const label = options.limitLabel ?? "Asana request";
      throw new Error(`${label} returned more than ${pageLimit * 100} rows. Narrow the connected project or increase the Asana pagination cap.`);
    }
    if (offset && seenOffsets.has(offset)) {
      throw new Error("Asana project discovery returned a repeated pagination offset.");
    }
    if (offset) seenOffsets.add(offset);
  } while (offset);
  return rows;
}

function asanaHeaders(accessToken: string) {
  return {
    "Authorization": `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
}

async function fetchAsanaWithTimeout(url: URL, init: RequestInit) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), asanaApiTimeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`Asana API request timed out after ${Math.round(asanaApiTimeoutMs / 1000)} seconds.`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function getConnectionForUser(userId: string) {
  return getDb()
    .prepare(
      `SELECT id,
              asana_user_gid as asanaUserGid,
              asana_user_name as asanaUserName,
              asana_user_email as asanaUserEmail,
              scopes,
              connected_at as connectedAt,
              updated_at as updatedAt
       FROM asana_connections
       WHERE user_id = ?
       LIMIT 1`,
    )
    .bind(userId)
    .first<{
      id: string;
      asanaUserGid: string;
      asanaUserName: string;
      asanaUserEmail: string | null;
      scopes: string;
      connectedAt: number;
      updatedAt: number;
    }>();
}

async function listVertexProjectsForUser(userId: string) {
  const rows = await getDb()
    .prepare(
      `SELECT p.id,
              p.name,
              p.description,
              p.workspace_id as workspaceId,
              w.scope as workspaceScope,
              pm.team_id as teamId,
              (
                SELECT c.id
                FROM chats c
                WHERE c.project_id = p.id
                  AND c.section = 'project'
                ORDER BY c.sort_order ASC
                LIMIT 1
              ) as chatId
       FROM projects p
       INNER JOIN workspaces w ON w.id = p.workspace_id
       INNER JOIN project_members pm ON pm.project_id = p.id
       WHERE pm.user_id = ?
       ORDER BY w.scope ASC, p.sort_order ASC, p.name ASC`,
    )
    .bind(userId)
    .all<{
      id: string;
      name: string;
      description: string;
      workspaceId: string;
      workspaceScope: WorkspaceScope;
      teamId: string | null;
      chatId: string | null;
    }>();

  return (rows.results ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    workspaceId: row.workspaceId,
    mode: modeForScope(row.workspaceScope),
    teamId: row.teamId,
    chatId: row.chatId,
  } satisfies VertexProjectOption));
}

async function getAccessibleVertexProject(userId: string, projectId: string) {
  const projects = await listVertexProjectsForUser(userId);
  return projects.find((project) => project.id === projectId) ?? null;
}

async function listTeamsForUser(userId: string) {
  const rows = await getDb()
    .prepare(
      `SELECT t.id, t.name
       FROM teams t
       INNER JOIN team_members tm ON tm.team_id = t.id
       WHERE tm.user_id = ?
       ORDER BY t.name ASC`,
    )
    .bind(userId)
    .all<VertexTeamOption>();
  return rows.results ?? [];
}

async function listAsanaMappingsForUser(userId: string) {
  const rows = await getDb()
    .prepare(
      `SELECT m.id,
              m.asana_project_gid as asanaProjectGid,
              m.asana_project_name as asanaProjectName,
              m.asana_workspace_name as asanaWorkspaceName,
              m.vertex_project_id as vertexProjectId,
              p.name as vertexProjectName,
              m.vertex_mode as vertexMode,
              m.vertex_team_id as vertexTeamId,
              m.vertex_chat_id as vertexChatId,
              m.can_write_tasks as canWriteTasks,
              m.permission_level as permissionLevel,
              m.permission_source as permissionSource,
              m.updated_at as updatedAt
       FROM asana_project_mappings m
       LEFT JOIN projects p ON p.id = m.vertex_project_id
       WHERE m.user_id = ?
       ORDER BY m.updated_at DESC`,
    )
    .bind(userId)
    .all<AsanaProjectMappingView & { canWriteTasks: number | boolean }>();

  return (rows.results ?? []).map((row) => ({
    ...row,
    canWriteTasks: Boolean(row.canWriteTasks),
  }));
}

async function scaffoldVertexProjectForAsana(
  userId: string,
  asanaProject: AsanaProjectOption,
  mode: WorkspaceMode,
  teamId: string | null,
) {
  if (mode === "Team") {
    if (!teamId) throw new Error("Select a VertexAI team before scaffolding a team project.");
    await requireTeamMember(userId, teamId);
  }

  const workspace = await getDb()
    .prepare("SELECT id FROM workspaces WHERE scope = ? LIMIT 1")
    .bind(scopeForMode(mode))
    .first<{ id: string }>();
  if (!workspace) throw new Error(`${mode} workspace was not found.`);

  const id = await uniqueProjectId(asanaProject.name);
  const sort = await getDb()
    .prepare("SELECT COALESCE(MAX(sort_order), 0) + 1 as sortOrder FROM projects WHERE workspace_id = ?")
    .bind(workspace.id)
    .first<{ sortOrder: number }>();
  const description = `Scaffolded from Asana project ${asanaProject.name} in ${asanaProject.workspaceName}.`;
  const status: ProjectStatus = "Active";

  await getDb()
    .prepare(
      `INSERT INTO projects (
        id, workspace_id, name, description, status, project_instructions,
        asana_task_status_source, asana_task_status_custom_field_gid,
        asana_task_status_custom_field_name, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, workspace.id, asanaProject.name, description, status, "", "native", null, null, sort?.sortOrder ?? 1)
    .run();
  await getDb()
    .prepare("INSERT OR IGNORE INTO project_members (project_id, user_id, team_id, created_at) VALUES (?, ?, ?, ?)")
    .bind(id, userId, mode === "Team" ? teamId : null, Date.now())
    .run();

  const chatId = await createDefaultProjectChat({ workspaceId: workspace.id, projectId: id, projectName: asanaProject.name, mode });
  return {
    id,
    name: asanaProject.name,
    description,
    workspaceId: workspace.id,
    mode,
    teamId: mode === "Team" ? teamId : null,
    chatId,
  } satisfies VertexProjectOption;
}

async function createDefaultProjectChat({
  mode,
  projectId,
  projectName,
  workspaceId,
}: {
  mode: WorkspaceMode;
  projectId: string;
  projectName: string;
  workspaceId: string;
}) {
  const id = await uniqueChatId(`${projectName} Asana Updates`);
  await getDb()
    .prepare("INSERT INTO chats (id, workspace_id, project_id, section, title, description, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(id, workspaceId, projectId, "project", `${projectName} Asana Updates`, `${mode} project chat for Asana task updates.`, 1)
    .run();
  return id;
}

async function upsertAsanaProjectMapping({
  asanaProject,
  connectionId,
  userId,
  vertexProject,
}: {
  asanaProject: AsanaProjectOption;
  connectionId: string;
  userId: string;
  vertexProject: VertexProjectOption;
}) {
  const now = Date.now();
  const id = `asana-map-${crypto.randomUUID()}`;
  await getDb()
    .prepare(
      `INSERT INTO asana_project_mappings (
        id,
        connection_id,
        user_id,
        asana_workspace_gid,
        asana_workspace_name,
        asana_project_gid,
        asana_project_name,
        asana_team_gid,
        vertex_workspace_id,
        vertex_mode,
        vertex_team_id,
        vertex_project_id,
        vertex_chat_id,
        can_write_tasks,
        permission_level,
        permission_source,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(asana_project_gid) DO UPDATE SET
        connection_id = excluded.connection_id,
        user_id = excluded.user_id,
        asana_workspace_gid = excluded.asana_workspace_gid,
        asana_workspace_name = excluded.asana_workspace_name,
        asana_project_name = excluded.asana_project_name,
        asana_team_gid = excluded.asana_team_gid,
        vertex_workspace_id = excluded.vertex_workspace_id,
        vertex_mode = excluded.vertex_mode,
        vertex_team_id = excluded.vertex_team_id,
        vertex_project_id = excluded.vertex_project_id,
        vertex_chat_id = excluded.vertex_chat_id,
        can_write_tasks = excluded.can_write_tasks,
        permission_level = excluded.permission_level,
        permission_source = excluded.permission_source,
        updated_at = excluded.updated_at`,
    )
    .bind(
      id,
      connectionId,
      userId,
      asanaProject.workspaceGid,
      asanaProject.workspaceName,
      asanaProject.gid,
      asanaProject.name,
      asanaProject.teamGid,
      vertexProject.workspaceId,
      vertexProject.mode,
      vertexProject.teamId,
      vertexProject.id,
      vertexProject.chatId,
      asanaProject.canWriteTasks ? 1 : 0,
      asanaProject.permissionLevel,
      asanaProject.permissionSource,
      now,
      now,
    )
    .run();
}

async function requireTeamMember(userId: string, teamId: string) {
  const row = await getDb()
    .prepare("SELECT team_id FROM team_members WHERE team_id = ? AND user_id = ? LIMIT 1")
    .bind(teamId, userId)
    .first<{ team_id: string }>();
  if (!row) throw new Error("You are not a member of this team.");
}

async function uniqueProjectId(name: string) {
  return uniqueSlug("projects", "id", slugWithPrefix("asana-project", name));
}

async function uniqueChatId(name: string) {
  return uniqueSlug("chats", "id", slugWithPrefix("asana-chat", name));
}

async function uniqueSlug(table: "projects" | "chats", column: "id", base: string) {
  let candidate = base;
  let suffix = 2;
  while (await getDb().prepare(`SELECT ${column} FROM ${table} WHERE ${column} = ? LIMIT 1`).bind(candidate).first()) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function slugWithPrefix(prefix: string, value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return `${prefix}-${slug || crypto.randomUUID()}`;
}

function asanaRedirectUri(request: Request) {
  return `${new URL(request.url).origin}/api/asana/oauth/callback`;
}

function scopeForMode(mode: WorkspaceMode): WorkspaceScope {
  if (mode === "Team") return "team";
  if (mode === "Org") return "org";
  return "personal";
}

function modeForScope(scope: WorkspaceScope): WorkspaceMode {
  if (scope === "team") return "Team";
  if (scope === "org") return "Org";
  return "Personal";
}

function normalizeScopeString(scope: string) {
  return parseScopes(scope).join(" ");
}

function parseScopes(scope: string) {
  return [...new Set(scope.split(/\s+/).map((item) => item.trim()).filter(Boolean))].sort();
}

function hasAsanaScope(scopes: string[], scope: string) {
  return scopes.includes("full") || scopes.includes("default") || scopes.includes(scope);
}

function randomToken(byteCount: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteCount));
  return bytesToBase64Url(bytes);
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function pkceChallenge(verifier: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return bytesToBase64Url(new Uint8Array(digest));
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
