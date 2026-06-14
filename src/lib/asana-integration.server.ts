/// <reference path="../../worker-configuration.d.ts" />

import { env } from "cloudflare:workers";
import { getRequest } from "@tanstack/start-server-core";
import { getAuth } from "@/lib/auth";
import { deleteAsanaTokens, getValidAsanaTokens, storeAsanaTokens, type AsanaTokenVaultEnv } from "@/lib/asana-token-vault";
import type { ProjectStatus, WorkspaceMode, WorkspaceScope } from "@/lib/pmo-data";

type AsanaIntegrationEnv = AsanaTokenVaultEnv & {
  ASANA_CLIENT_ID?: string;
  ASANA_CLIENT_SECRET?: string;
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
  workspace?: AsanaWorkspace;
  team?: {
    gid?: string;
    name?: string;
  } | null;
};

type AsanaProjectMembership = {
  gid: string;
  write_access?: boolean;
  project?: {
    gid?: string;
  };
  user?: {
    gid?: string;
  };
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
const defaultAsanaScopes = ["projects:read", "tasks:read", "tasks:write", "users:read", "workspaces:read"];

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
  url.searchParams.set("scope", defaultAsanaScopes.join(" "));
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
  const connection = await getConnectionForUser(user.id);
  const scopes = parseScopes(connection?.scopes ?? "");
  const missingScopes = defaultAsanaScopes.filter((scope) => !scopes.includes(scope));
  const [vertexProjects, mappings, teams] = await Promise.all([
    listVertexProjectsForUser(user.id),
    listAsanaMappingsForUser(user.id),
    listTeamsForUser(user.id),
  ]);

  let asanaProjects: AsanaProjectOption[] = [];
  if (configured && connection) {
    try {
      asanaProjects = await listMemberAsanaProjects(user.id, scopes);
    } catch (error) {
      console.warn(JSON.stringify({
        event: "asana_project_refresh_failed",
        userId: user.id,
        error: error instanceof Error ? error.message : "Unknown Asana project refresh failure",
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
    asanaProjects,
    vertexProjects,
    mappings,
    teams,
  };
}

export async function saveAsanaProjectMappingsForCurrentUser(data: { selections: AsanaMappingSelection[] }) {
    const user = await requireWorkspaceEditor();
    const connection = await getConnectionForUser(user.id);
    if (!connection) throw new Error("Connect Asana before mapping projects.");

    const scopes = parseScopes(connection.scopes);
    const asanaProjects = await listMemberAsanaProjects(user.id, scopes);
    const asanaProjectByGid = new Map(asanaProjects.map((project) => [project.gid, project]));
    const results: Array<{ asanaProjectGid: string; action: string; vertexProjectId?: string }> = [];

    for (const selection of data.selections) {
      if (selection.action === "ignore") continue;
      const asanaProject = asanaProjectByGid.get(selection.asanaProjectGid);
      if (!asanaProject) throw new Error("Asana project is not visible to the connected user.");

      const vertexProject = selection.action === "scaffold"
        ? await scaffoldVertexProjectForAsana(user.id, asanaProject, selection.targetMode ?? "Team", selection.targetTeamId ?? null)
        : await getAccessibleVertexProject(user.id, selection.vertexProjectId ?? "");
      if (!vertexProject) throw new Error("Select a VertexAI project you can access.");
      await upsertAsanaProjectMapping({ connectionId: connection.id, userId: user.id, asanaProject, vertexProject });
      results.push({ asanaProjectGid: asanaProject.gid, action: selection.action, vertexProjectId: vertexProject.id });
    }

    return { saved: results.length, results };
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
  const scope = normalizeScopeString(tokenResponse.scope || defaultAsanaScopes.join(" "));

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
  if (!scopes.includes("projects:read")) return [];

  const me = await fetchAsanaMe(tokenSet.accessToken);
  const projects: AsanaProjectOption[] = [];
  for (const workspace of me.workspaces ?? []) {
    const workspaceProjects = await asanaFetchPaginated<AsanaProject>(tokenSet.accessToken, `/workspaces/${encodeURIComponent(workspace.gid)}/projects`, {
      archived: "false",
      opt_fields: "gid,name,notes,archived,workspace.gid,workspace.name,team.gid,team.name",
      limit: "100",
    });
    for (const project of workspaceProjects) {
      if (project.archived) continue;
      const membership = await getProjectMembershipForMe(tokenSet.accessToken, project.gid);
      if (!membership) continue;
      const canWriteTasks = scopes.includes("tasks:write") && membership.write_access === true;
      projects.push({
        gid: project.gid,
        name: project.name,
        workspaceGid: project.workspace?.gid ?? workspace.gid,
        workspaceName: project.workspace?.name ?? workspace.name,
        teamGid: project.team?.gid ?? null,
        teamName: project.team?.name ?? null,
        canWriteTasks,
        permissionLevel: membership.write_access === true ? "write" : membership.write_access === false ? "read" : "unknown",
        permissionSource: membership.write_access === true
          ? "Asana project membership write_access plus tasks:write OAuth scope"
          : membership.write_access === false
            ? "Asana project membership is read-only"
            : "Asana did not return write_access; task writes are disabled until permission is confirmed",
      });
    }
  }
  return dedupeAsanaProjects(projects);
}

async function getProjectMembershipForMe(accessToken: string, projectGid: string) {
  try {
    const memberships = await asanaFetchPaginated<AsanaProjectMembership>(
      accessToken,
      `/projects/${encodeURIComponent(projectGid)}/project_memberships`,
      {
        user: "me",
        opt_fields: "gid,write_access,user.gid,project.gid",
        limit: "10",
      },
    );
    return memberships[0] ?? null;
  } catch (error) {
    console.warn(JSON.stringify({
      event: "asana_membership_probe_failed",
      projectGid,
      error: error instanceof Error ? error.message : "Unknown Asana membership probe failure",
    }));
    return null;
  }
}

function dedupeAsanaProjects(projects: AsanaProjectOption[]) {
  const seen = new Set<string>();
  return projects.filter((project) => {
    if (seen.has(project.gid)) return false;
    seen.add(project.gid);
    return true;
  }).sort((left, right) => left.workspaceName.localeCompare(right.workspaceName) || left.name.localeCompare(right.name));
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
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: options.body,
  });
  const envelope = await response.json<AsanaApiEnvelope<T>>();
  if (!response.ok) {
    const message = envelope.errors?.map((item) => item.message).filter(Boolean).join("; ");
    throw new Error(message || `Asana API request failed with ${response.status}.`);
  }
  return envelope.data;
}

async function asanaFetchPaginated<T>(accessToken: string, path: string, query: Record<string, string>) {
  const rows: T[] = [];
  let offset: string | undefined;
  do {
    const url = new URL(`https://app.asana.com/api/1.0${path}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    if (offset) url.searchParams.set("offset", offset);
    const response = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });
    const envelope = await response.json<AsanaApiEnvelope<T[]>>();
    if (!response.ok) {
      const message = envelope.errors?.map((item) => item.message).filter(Boolean).join("; ");
      throw new Error(message || `Asana API request failed with ${response.status}.`);
    }
    rows.push(...(envelope.data ?? []));
    offset = envelope.next_page?.offset;
  } while (offset);
  return rows;
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
    .prepare("INSERT INTO projects (id, workspace_id, name, description, status, sort_order) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, workspace.id, asanaProject.name, description, status, sort?.sortOrder ?? 1)
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
