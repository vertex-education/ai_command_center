import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { runTrackedAiGateway } from "@/lib/ai-gateway";
import { getAuth } from "@/lib/auth";
import { publishChatMessageInserts, type ChatMessageInsertEvent } from "@/lib/chat-sync";
import { lightweightChatTitleModelId } from "@/lib/prompts";
import { avatarAlex, getConversationKey, parseChatAttachments, type ChatMessage, type ChatSection, type ChatSummary, type ProjectSummary, type WorkspaceMode } from "@/lib/pmo-data";
import { recordRealtimeMutationEvent, type RealtimeInvalidationTarget } from "@/lib/realtime-events";
import { getRequest } from "@tanstack/start-server-core";

type SessionUser = {
  id: string;
  email: string;
  role?: string | null;
};

type AuthSession = {
  user: SessionUser;
};

type CloudflareContext = {
  cloudflare?: {
    env?: {
      AI?: Ai;
    };
  };
};

export type ScopedInviteScope = "team" | "project";
export type TeamSummary = {
  id: string;
  name: string;
  description: string;
  role: "owner" | "member";
};

export type CreateProjectInput = {
  mode: WorkspaceMode;
  teamId?: string | null;
  name: string;
  description: string;
  status: ProjectSummary["status"];
};

export type DeleteProjectInput = {
  mode: WorkspaceMode;
  teamId?: string | null;
  projectId: string;
};

export type UpdateProjectInstructionsInput = DeleteProjectInput & {
  asanaTaskStatusCustomFieldGid?: string | null;
  asanaTaskStatusCustomFieldName?: string | null;
  asanaTaskStatusSource: ProjectSummary["asanaTaskStatusSource"];
  description: string;
  projectInstructions: string;
};

export type ScopedChatsResult = {
  workspaceChats: ChatSummary[];
  projectChatsByProjectId: Record<string, ChatSummary[]>;
  conversations: Record<string, ChatMessage[]>;
};

export type CreateChatInput = {
  mode: WorkspaceMode;
  teamId?: string | null;
  projectId?: string | null;
  section: ChatSection;
  title: string;
  description: string;
};

export type DeleteChatInput = {
  mode: WorkspaceMode;
  teamId?: string | null;
  projectId?: string | null;
  section: ChatSection;
  chatId: string;
};

export type RenameChatInput = DeleteChatInput & {
  title: string;
};

export type BranchChatInput = DeleteChatInput & {
  messageId: string;
};

export type BranchChatResult = {
  chat: ChatSummary;
  rootMessage: ChatMessage;
};

export type PersistScopedRagChatInput = {
  mode: WorkspaceMode;
  teamId?: string | null;
  projectId: string;
  chatId: string;
  userMessageId: string;
  assistantMessageId: string;
  prompt: string;
  response: string;
};

function getDb() {
  const db = (env as Env).DB;
  if (!db) throw new Error("D1 binding DB is required.");
  return db;
}

function currentClientId() {
  return getRequest().headers.get("x-vertex-client-id");
}

async function currentUser() {
  const request = getRequest();
  const session = await getAuth(request).api.getSession({ headers: request.headers });
  const user = (session as AuthSession | null)?.user;
  if (!user) throw new Error("Sign in is required.");
  return user;
}

function canManage(user: SessionUser) {
  return user.role === "admin" || user.role === "user";
}

async function requireManager() {
  const user = await currentUser();
  if (!canManage(user)) throw new Error("Viewer accounts cannot create invites.");
  return user;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function scopeForMode(mode: WorkspaceMode) {
  return mode.toLowerCase();
}

function projectId(name: string) {
  return `project-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 44) || "untitled"}-${crypto.randomUUID()}`;
}

function chatId(title: string) {
  return `chat-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 44) || "untitled"}-${crypto.randomUUID()}`;
}

function messageId(prefix: string, value: string) {
  const trimmed = value.trim();
  return trimmed && /^[a-zA-Z0-9_-]{8,120}$/.test(trimmed) ? trimmed : `msg-${prefix}-${crypto.randomUUID()}`;
}

function nowLabel() {
  return new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function normalizeChatTitle(title: string) {
  const trimmed = title.trim().replace(/\s+/g, " ").slice(0, 60);
  return trimmed ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1) : "";
}

function conciseChatTitleFromRequest(text: string) {
  const cleaned = text
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\b(please|can you|could you|would you|help me|i need|we need)\b/gi, " ")
    .replace(/\b(create|make|build|write|generate|give|tell|show|summarize)\s+(me\s+)?\b/gi, " ")
    .replace(/[^a-z0-9\s&/+-]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = cleaned
    .split(" ")
    .map((word) => word.trim())
    .filter(Boolean)
    .slice(0, 6);
  const title = (words.length > 0 ? words : ["New", "request"]).join(" ");
  const conciseTitle = title.length > 48 ? `${title.slice(0, 45).trim()}...` : title;
  return normalizeChatTitle(conciseTitle) || "New Request";
}

function normalizeGeneratedInitialChatTitle(title: string, fallback: string) {
  const cleaned = title
    .split("\n")[0]
    .replace(/^title\s*:\s*/i, "")
    .replace(/^["'`]+|["'`.]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return normalizeChatTitle(cleaned && cleaned.length >= 3 ? cleaned : fallback) || fallback;
}

async function generateInitialChatTitle(context: unknown, text: string) {
  const fallback = conciseChatTitleFromRequest(text);
  const ai = (context as CloudflareContext).cloudflare?.env?.AI ?? (env as Env & { AI?: Ai }).AI;
  if (!ai) return fallback;

  try {
    const result = await Promise.race([
      runTrackedAiGateway(ai, lightweightChatTitleModelId, {
        messages: [
          {
            role: "system",
            content: [
              "Name this chat from the user's initial message.",
              "Return only a concise title, no quotes, no punctuation at the end.",
              "Use 3 to 7 words. Preserve useful project, artifact, or technical nouns.",
            ].join(" "),
          },
          { role: "user", content: text.slice(0, 2_000) },
        ],
        max_completion_tokens: 24,
        temperature: 0.1,
      }, {
        feature: "stream-chat-title",
        metadata: {
          feature: "stream-chat-title",
          model: lightweightChatTitleModelId,
        },
      }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Chat title model timed out.")), 5_000);
      }),
    ]);
    return normalizeGeneratedInitialChatTitle(extractGeneratedText(result), fallback);
  } catch (error) {
    console.warn("[VertexAI] Stream chat title generation fell back", {
      model: lightweightChatTitleModelId,
      message: error instanceof Error ? error.message : "Unknown title generation error.",
    });
    return fallback;
  }
}

function shouldAutoRenameInitialChat(chat: { title: string; description: string | null }) {
  return /\sAI Chat$/i.test(chat.title.trim()) && /^AI chatbot scoped to .+\.$/i.test((chat.description ?? "").trim());
}

function branchContextTitle(messageText: string) {
  const cleaned = messageText
    .replace(/[`*_#>\[\](){}]/g, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[^a-z0-9\s&/+-]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = cleaned
    .split(" ")
    .map((word) => word.trim())
    .filter(Boolean)
    .filter((word) => word.length > 2)
    .slice(0, 8);
  return words.join(" ");
}

function fallbackBranchChatTitle(sourceChatTitle: string, messageText: string) {
  const contextualTitle = branchContextTitle(messageText) || sourceChatTitle;
  return normalizeChatTitle(`Branch: ${contextualTitle}`) || "Branch Chat";
}

function extractGeneratedText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const candidates = [
    record.response,
    record.text,
    record.output_text,
    (record.result as Record<string, unknown> | undefined)?.response,
    (record.result as Record<string, unknown> | undefined)?.text,
    (record.result as Record<string, unknown> | undefined)?.output_text,
  ];
  const choices = Array.isArray(record.choices) ? record.choices : [];
  const firstChoice = choices[0] as { message?: { content?: unknown; text?: unknown }; delta?: { content?: unknown } } | undefined;
  candidates.push(firstChoice?.message?.content, firstChoice?.message?.text, firstChoice?.delta?.content);
  return candidates.find((candidate): candidate is string => typeof candidate === "string" && Boolean(candidate.trim()))?.trim() ?? "";
}

function normalizeBranchGeneratedTitle(title: string, fallback: string) {
  const cleaned = title
    .split("\n")[0]
    .replace(/^title\s*:\s*/i, "")
    .replace(/^branch\s*:\s*/i, "")
    .replace(/^["'`]+|["'`.]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const usable = cleaned && cleaned.length >= 3 ? cleaned : fallback.replace(/^Branch:\s*/i, "");
  return normalizeChatTitle(`Branch: ${usable}`) || fallback;
}

async function generateBranchChatTitle(context: unknown, sourceChatTitle: string, messageText: string) {
  const fallback = fallbackBranchChatTitle(sourceChatTitle, messageText);
  const ai = (context as CloudflareContext).cloudflare?.env?.AI ?? (env as Env & { AI?: Ai }).AI;
  if (!ai) return fallback;

  try {
    const result = await Promise.race([
      runTrackedAiGateway(ai, lightweightChatTitleModelId, {
        messages: [
          {
            role: "system",
            content: [
              "Name a branched chat from the selected source message.",
              "Return only the contextual title without the word Branch.",
              "Use 3 to 7 words. Preserve useful project, artifact, or technical nouns.",
            ].join(" "),
          },
          { role: "user", content: messageText.slice(0, 2_000) },
        ],
        max_completion_tokens: 24,
        temperature: 0.1,
      }, {
        feature: "branch-title",
        metadata: {
          feature: "branch-title",
          model: lightweightChatTitleModelId,
        },
      }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Chat title model timed out.")), 5_000);
      }),
    ]);
    const generatedTitle = normalizeBranchGeneratedTitle(extractGeneratedText(result), fallback);
    console.info("[VertexAI] Branch chat title generated", {
      model: lightweightChatTitleModelId,
      title: generatedTitle,
      usedFallback: generatedTitle === fallback,
    });
    return generatedTitle;
  } catch (error) {
    console.warn("[VertexAI] Branch chat title generation fell back", {
      model: lightweightChatTitleModelId,
      message: error instanceof Error ? error.message : "Unknown title generation error.",
    });
    return fallback;
  }
}

function branchChatDescription(messageText: string) {
  const snippet = messageText.trim().replace(/\s+/g, " ").slice(0, 96);
  return snippet ? `Branched from: ${snippet}` : "Branched from a selected chat message.";
}

async function getWorkspaceId(mode: WorkspaceMode) {
  const workspace = await getDb()
    .prepare("SELECT id FROM workspaces WHERE scope = ? LIMIT 1")
    .bind(scopeForMode(mode))
    .first<{ id: string }>();
  if (!workspace) throw new Error(`${mode} workspace was not found.`);
  return workspace.id;
}

async function recordScopedMutation({
  chatId = null,
  entity,
  entityId,
  invalidates,
  mode,
  operation,
  projectId = null,
  sourceUserId,
  teamId = null,
  workspaceId,
}: {
  chatId?: string | null;
  entity: string;
  entityId: string;
  invalidates: RealtimeInvalidationTarget[];
  mode: WorkspaceMode;
  operation: string;
  projectId?: string | null;
  sourceUserId: string;
  teamId?: string | null;
  workspaceId?: string;
}) {
  await recordRealtimeMutationEvent(getDb(), {
    chatId,
    entity,
    entityId,
    invalidates,
    mode,
    operation,
    projectId,
    sourceClientId: currentClientId(),
    sourceUserId,
    teamId: mode === "Team" ? teamId : null,
    workspaceId: workspaceId ?? await getWorkspaceId(mode),
  });
}

async function requireTeamMember(userId: string, teamId: string) {
  const membership = await getDb()
    .prepare("SELECT team_id FROM team_members WHERE team_id = ? AND user_id = ? LIMIT 1")
    .bind(teamId, userId)
    .first<{ team_id: string }>();
  if (!membership) throw new Error("You are not a member of this team.");
}

async function requireProjectMember(userId: string, projectId: string, teamId?: string | null) {
  const membership = await getDb()
    .prepare(
      `SELECT project_id
       FROM project_members
       WHERE project_id = ?
         AND user_id = ?
         AND ((? IS NULL AND team_id IS NULL) OR team_id = ?)
       LIMIT 1`,
    )
    .bind(projectId, userId, teamId ?? null, teamId ?? null)
    .first<{ project_id: string }>();
  if (!membership) throw new Error("You are not assigned to this project.");
}

function chatSyncScopeKey({
  mode,
  teamId,
  userId,
  workspaceId,
}: {
  mode: WorkspaceMode;
  teamId: string | null;
  userId: string;
  workspaceId: string;
}) {
  if (mode === "Team") return `${workspaceId}:team:${teamId ?? ""}`;
  if (mode === "Org") return `${workspaceId}:org`;
  return `${workspaceId}:user:${userId}`;
}

async function insertScopedChatMessage({
  chatId,
  message,
  mode,
  projectId,
  workspaceId,
}: {
  chatId: string;
  workspaceId: string;
  projectId: string | null;
  mode: WorkspaceMode;
  message: ChatMessage;
}): Promise<ChatMessageInsertEvent> {
  await getDb()
    .prepare(
      `INSERT OR IGNORE INTO chat_messages (
        id,
        chat_id,
        parent_id,
        workspace_id,
        author,
        role,
        avatar,
        message_time,
        body,
        artifact_title,
        artifact_type,
        artifact_meta,
        attachments_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      message.id,
      chatId,
      message.parentId ?? null,
      workspaceId,
      message.author,
      message.role,
      message.avatar ?? null,
      message.time,
      message.text,
      message.artifact?.title ?? null,
      message.artifact?.type ?? null,
      message.artifact?.meta ?? null,
      message.attachments?.length ? JSON.stringify(message.attachments) : null,
      new Date().toISOString(),
    )
    .run();

  return {
    id: message.id,
    chatId,
    workspaceId,
    projectId,
    mode,
    message,
  };
}

export const listMyTeams = createServerFn({ method: "GET" }).handler(async () => {
  const user = await currentUser();
  const result = await getDb()
    .prepare(
      `SELECT t.id, t.name, t.description, tm.role
       FROM teams t
       INNER JOIN team_members tm ON tm.team_id = t.id
       WHERE tm.user_id = ?
       ORDER BY t.name ASC`,
    )
    .bind(user.id)
    .all<TeamSummary>();

  return result.results ?? [];
});

export const createTeam = createServerFn({ method: "POST" })
  .validator((data: { name: string; description?: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireManager();
    const name = data.name.trim();
    if (!name) throw new Error("Team name is required.");
    const id = `team-${crypto.randomUUID()}`;
    const now = Date.now();
    await getDb()
      .prepare("INSERT INTO teams (id, name, description, created_by_user_id, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(id, name, data.description?.trim() ?? "", user.id, now)
      .run();
    await getDb()
      .prepare("INSERT INTO team_members (team_id, user_id, role, created_at) VALUES (?, ?, ?, ?)")
      .bind(id, user.id, "owner", now)
      .run();
    await recordScopedMutation({
      entity: "team",
      entityId: id,
      invalidates: ["teams", "projects", "chats"],
      mode: "Team",
      operation: "insert",
      sourceUserId: user.id,
      teamId: id,
    });
    return { id, name };
  });

export const listMyScopedProjects = createServerFn({ method: "POST" })
  .validator((data: { mode: WorkspaceMode; teamId?: string | null }) => data)
  .handler(async ({ data }) => {
    const user = await currentUser();
    const scope = scopeForMode(data.mode);
    const teamId = data.mode === "Team" ? data.teamId ?? "" : null;
    const result = await getDb()
      .prepare(
        `SELECT p.id,
                p.name,
                p.description,
                p.status,
                COALESCE(p.project_instructions, '') as projectInstructions,
                COALESCE(p.asana_task_status_source, 'native') as asanaTaskStatusSource,
                p.asana_task_status_custom_field_gid as asanaTaskStatusCustomFieldGid,
                p.asana_task_status_custom_field_name as asanaTaskStatusCustomFieldName
         FROM projects p
         INNER JOIN workspaces w ON w.id = p.workspace_id
         INNER JOIN project_members pm ON pm.project_id = p.id
         WHERE w.scope = ?
           AND pm.user_id = ?
           AND (
             (? = 'team' AND pm.team_id = ?)
             OR (? <> 'team' AND pm.team_id IS NULL)
           )
         ORDER BY p.sort_order ASC, p.name ASC`,
      )
      .bind(scope, user.id, scope, teamId, scope)
      .all<Omit<ProjectSummary, "projectChats">>();

    const projects = result.results ?? [];
    const projectChatsByProjectId = await listProjectChatsForUser(user.id, data.mode, data.teamId ?? null);
    return projects.map((project) => ({
      ...project,
      projectChats: projectChatsByProjectId[project.id] ?? [],
    }));
  });

export const createScopedProject = createServerFn({ method: "POST" })
  .validator((data: CreateProjectInput) => data)
  .handler(async ({ data }) => {
    const user = await requireManager();
    const name = data.name.trim();
    const description = data.description.trim();
    if (!name) throw new Error("Project name is required.");
    if (data.mode === "Team" && !data.teamId) throw new Error("Select a team before creating a team project.");

    const scope = scopeForMode(data.mode);
    const workspace = await getDb()
      .prepare("SELECT id FROM workspaces WHERE scope = ? LIMIT 1")
      .bind(scope)
      .first<{ id: string }>();
    if (!workspace) throw new Error(`${data.mode} workspace was not found.`);

    const sort = await getDb()
      .prepare("SELECT COALESCE(MAX(sort_order), 0) + 1 as sortOrder FROM projects WHERE workspace_id = ?")
      .bind(workspace.id)
      .first<{ sortOrder: number }>();

    const id = projectId(name);
    await getDb()
      .prepare(
        `INSERT INTO projects (
          id, workspace_id, name, description, status, project_instructions,
          asana_task_status_source, asana_task_status_custom_field_gid,
          asana_task_status_custom_field_name, sort_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, workspace.id, name, description, data.status, "", "native", null, null, sort?.sortOrder ?? 1)
      .run();
    await getDb()
      .prepare("INSERT OR IGNORE INTO project_members (project_id, user_id, team_id, created_at) VALUES (?, ?, ?, ?)")
      .bind(id, user.id, data.mode === "Team" ? data.teamId : null, Date.now())
      .run();
    await recordScopedMutation({
      entity: "project",
      entityId: id,
      invalidates: ["projects", "chats", "workspace"],
      mode: data.mode,
      operation: "insert",
      projectId: id,
      sourceUserId: user.id,
      teamId: data.teamId ?? null,
      workspaceId: workspace.id,
    });

    return {
      id,
      name,
      description,
      projectInstructions: "",
      asanaTaskStatusSource: "native",
      asanaTaskStatusCustomFieldGid: null,
      asanaTaskStatusCustomFieldName: null,
      status: data.status,
      projectChats: [],
    } satisfies ProjectSummary;
  });

export const updateScopedProjectInstructions = createServerFn({ method: "POST" })
  .validator((data: UpdateProjectInstructionsInput) => data)
  .handler(async ({ data }) => {
    const user = await requireManager();
    if (!data.projectId) throw new Error("Project is required.");
    if (data.mode === "Team" && !data.teamId) throw new Error("Select a team before editing a team project.");

    await requireProjectMember(user.id, data.projectId, data.mode === "Team" ? data.teamId ?? null : null);

    const description = data.description.trim();
    const projectInstructions = data.projectInstructions.trim();
    const asanaTaskStatusSource = data.asanaTaskStatusSource === "custom_field" ? "custom_field" : "native";
    const asanaTaskStatusCustomFieldGid = asanaTaskStatusSource === "custom_field" ? data.asanaTaskStatusCustomFieldGid?.trim() || null : null;
    const asanaTaskStatusCustomFieldName = asanaTaskStatusSource === "custom_field" ? data.asanaTaskStatusCustomFieldName?.trim() || null : null;
    if (asanaTaskStatusSource === "custom_field" && !asanaTaskStatusCustomFieldGid && !asanaTaskStatusCustomFieldName) {
      throw new Error("Select an Asana custom field before using custom field task status.");
    }
    await getDb()
      .prepare(
        `UPDATE projects
         SET description = ?,
             project_instructions = ?,
             asana_task_status_source = ?,
             asana_task_status_custom_field_gid = ?,
             asana_task_status_custom_field_name = ?
         WHERE id = ?`,
      )
      .bind(description, projectInstructions, asanaTaskStatusSource, asanaTaskStatusCustomFieldGid, asanaTaskStatusCustomFieldName, data.projectId)
      .run();

    const project = await getDb()
      .prepare(
        `SELECT p.id,
                p.name,
                p.description,
                p.workspace_id as workspaceId,
                p.status,
                COALESCE(p.project_instructions, '') as projectInstructions,
                COALESCE(p.asana_task_status_source, 'native') as asanaTaskStatusSource,
                p.asana_task_status_custom_field_gid as asanaTaskStatusCustomFieldGid,
                p.asana_task_status_custom_field_name as asanaTaskStatusCustomFieldName
         FROM projects p
         WHERE p.id = ?
         LIMIT 1`,
      )
      .bind(data.projectId)
      .first<Omit<ProjectSummary, "projectChats"> & { workspaceId: string }>();
    if (!project) throw new Error("Project was not found.");
    const { workspaceId, ...projectSummary } = project;

    await recordScopedMutation({
      entity: "project",
      entityId: data.projectId,
      invalidates: ["projects", "chats", "workspace"],
      mode: data.mode,
      operation: "update",
      projectId: data.projectId,
      sourceUserId: user.id,
      teamId: data.teamId ?? null,
      workspaceId,
    });

    const projectChatsByProjectId = await listProjectChatsForUser(user.id, data.mode, data.teamId ?? null);
    return {
      ...projectSummary,
      projectChats: projectChatsByProjectId[projectSummary.id] ?? [],
    } satisfies ProjectSummary;
  });

export const deleteScopedProject = createServerFn({ method: "POST" })
  .validator((data: DeleteProjectInput) => data)
  .handler(async ({ data }) => {
    const user = await requireManager();
    if (!data.projectId) throw new Error("Project is required.");
    if (data.mode === "Team" && !data.teamId) throw new Error("Select a team before deleting a team project.");
    await requireProjectMember(user.id, data.projectId, data.mode === "Team" ? data.teamId ?? null : null);

    const project = await getDb()
      .prepare(
        `SELECT p.id, p.workspace_id as workspaceId
         FROM projects p
         INNER JOIN workspaces w ON w.id = p.workspace_id
         WHERE p.id = ?
           AND w.scope = ?
         LIMIT 1`,
      )
      .bind(data.projectId, scopeForMode(data.mode))
      .first<{ id: string; workspaceId: string }>();
    if (!project) throw new Error("Project was not found.");

    const projectChats = await getDb()
      .prepare("SELECT id FROM chats WHERE project_id = ?")
      .bind(data.projectId)
      .all<{ id: string }>();
    const chatIds = (projectChats.results ?? []).map((chat) => chat.id);
    if (chatIds.length > 0) {
      const placeholders = chatIds.map(() => "?").join(", ");
      await getDb()
        .prepare(`DELETE FROM chat_members WHERE chat_id IN (${placeholders})`)
        .bind(...chatIds)
        .run();
      await getDb()
        .prepare(`DELETE FROM chat_messages WHERE chat_id IN (${placeholders})`)
        .bind(...chatIds)
        .run();
      await getDb()
        .prepare(`DELETE FROM chats WHERE id IN (${placeholders})`)
        .bind(...chatIds)
        .run();
    }

    await getDb()
      .prepare("DELETE FROM scoped_invites WHERE scope = 'project' AND target_id = ?")
      .bind(data.projectId)
      .run();
    await getDb()
      .prepare("DELETE FROM project_members WHERE project_id = ?")
      .bind(data.projectId)
      .run();
    await getDb()
      .prepare("DELETE FROM projects WHERE id = ?")
      .bind(data.projectId)
      .run();
    await recordScopedMutation({
      entity: "project",
      entityId: data.projectId,
      invalidates: ["projects", "chats", "workspace"],
      mode: data.mode,
      operation: "delete",
      projectId: data.projectId,
      sourceUserId: user.id,
      teamId: data.teamId ?? null,
      workspaceId: project.workspaceId,
    });

    return { id: data.projectId };
  });

async function listProjectChatsForUser(userId: string, mode: WorkspaceMode, teamId?: string | null) {
  const scope = scopeForMode(mode);
  const result = await getDb()
    .prepare(
      `SELECT c.id, c.title, c.description, c.project_id as projectId
       FROM chats c
       INNER JOIN workspaces w ON w.id = c.workspace_id
       INNER JOIN project_members pm ON pm.project_id = c.project_id
       WHERE w.scope = ?
         AND c.section = 'project'
         AND pm.user_id = ?
         AND (
           (? = 'team' AND pm.team_id = ?)
           OR (? <> 'team' AND pm.team_id IS NULL)
         )
       ORDER BY c.sort_order ASC, c.title ASC`,
    )
    .bind(scope, userId, scope, mode === "Team" ? teamId ?? "" : null, scope)
    .all<ChatSummary & { projectId: string }>();

  return (result.results ?? []).reduce<Record<string, ChatSummary[]>>((groups, chat) => {
    groups[chat.projectId] ??= [];
    groups[chat.projectId].push({ id: chat.id, title: chat.title, description: chat.description });
    return groups;
  }, {});
}

async function listMessagesForChats({
  mode,
  projectChatsByProjectId,
  workspaceChats,
}: {
  mode: WorkspaceMode;
  projectChatsByProjectId: Record<string, ChatSummary[]>;
  workspaceChats: ChatSummary[];
}) {
  const chatScopes = [
    ...workspaceChats.map((chat) => ({ chatId: chat.id, key: getConversationKey(mode, null, chat.id) })),
    ...Object.entries(projectChatsByProjectId).flatMap(([projectId, chats]) =>
      chats.map((chat) => ({ chatId: chat.id, key: getConversationKey(mode, projectId, chat.id) })),
    ),
  ];
  if (chatScopes.length === 0) return {};

  const placeholders = chatScopes.map(() => "?").join(", ");
  const result = await getDb()
    .prepare(
      `SELECT chat_id as chatId, id, parent_id as parentId, author, role, avatar, message_time as time, body as text, artifact_title as artifactTitle, artifact_type as artifactType, artifact_meta as artifactMeta, attachments_json as attachmentsJson
       FROM chat_messages
       WHERE chat_id IN (${placeholders})
       ORDER BY created_at ASC`,
    )
    .bind(...chatScopes.map((chat) => chat.chatId))
    .all<{
      chatId: string;
      id: string;
      parentId: string | null;
      author: string;
      role: "user" | "assistant" | "system";
      avatar: string | null;
      time: string;
      text: string;
      artifactTitle: string | null;
      artifactType: "doc" | "ppt" | "sheet" | null;
      artifactMeta: string | null;
      attachmentsJson: string | null;
    }>();

  const keyByChatId = new Map(chatScopes.map((chat) => [chat.chatId, chat.key]));
  return (result.results ?? []).reduce<Record<string, ChatMessage[]>>((groups, message) => {
    if (isSeedChatMessage(message.id)) return groups;
    const key = keyByChatId.get(message.chatId);
    if (!key) return groups;
    groups[key] ??= [];
    groups[key].push({
      id: message.id,
      parentId: message.parentId ?? undefined,
      author: message.author,
      role: message.role,
      avatar: message.avatar ?? undefined,
      time: message.time,
      text: message.text,
      artifact: message.artifactTitle && message.artifactType && message.artifactMeta
        ? { title: message.artifactTitle, type: message.artifactType, meta: message.artifactMeta }
        : undefined,
      attachments: parseChatAttachments(message.attachmentsJson),
    });
    return groups;
  }, {});
}

function isSeedChatMessage(id: string) {
  return id.startsWith("msg-personal-") || id.startsWith("msg-team-") || id.startsWith("msg-org-");
}

export const listMyScopedChats = createServerFn({ method: "POST" })
  .validator((data: { mode: WorkspaceMode; teamId?: string | null }) => data)
  .handler(async ({ data }) => {
    const user = await currentUser();
    const scope = scopeForMode(data.mode);
    let workspaceChats: ChatSummary[] = [];

    if (data.mode === "Team") {
      if (data.teamId) {
        await requireTeamMember(user.id, data.teamId);
        const result = await getDb()
          .prepare(
            `SELECT c.id, c.title, c.description
             FROM chats c
             INNER JOIN workspaces w ON w.id = c.workspace_id
             INNER JOIN chat_members cm ON cm.chat_id = c.id
             WHERE w.scope = 'team'
               AND c.section = 'workspace'
               AND c.project_id IS NULL
               AND cm.team_id = ?
             ORDER BY c.sort_order ASC, c.title ASC`,
          )
          .bind(data.teamId)
          .all<ChatSummary>();
        workspaceChats = result.results ?? [];
      }
    } else {
      const result = await getDb()
        .prepare(
          `SELECT c.id, c.title, c.description
           FROM chats c
           INNER JOIN workspaces w ON w.id = c.workspace_id
           INNER JOIN chat_members cm ON cm.chat_id = c.id
           WHERE w.scope = ?
             AND c.section = 'workspace'
             AND c.project_id IS NULL
             AND cm.user_id = ?
             AND cm.team_id IS NULL
           ORDER BY c.sort_order ASC, c.title ASC`,
        )
        .bind(scope, user.id)
        .all<ChatSummary>();
      workspaceChats = result.results ?? [];
    }

    const projectChatsByProjectId = await listProjectChatsForUser(user.id, data.mode, data.teamId ?? null);

    return {
      workspaceChats,
      projectChatsByProjectId,
      conversations: await listMessagesForChats({ mode: data.mode, projectChatsByProjectId, workspaceChats }),
    } satisfies ScopedChatsResult;
  });

export const persistScopedRagChatTurn = createServerFn({ method: "POST" })
  .validator((data: PersistScopedRagChatInput) => data)
  .handler(async ({ context, data }) => {
    const user = await currentUser();
    if (!canManage(user)) throw new Error("Viewer accounts have view-only access.");

    const prompt = data.prompt.trim();
    const response = data.response.trim() || "The model did not return a response.";
    if (!prompt) throw new Error("Prompt is required.");
    if (!data.chatId.trim()) throw new Error("Chat is required.");
    if (!data.projectId.trim()) throw new Error("Project is required.");
    if (data.mode === "Team" && !data.teamId) throw new Error("Select a team before using this team project chat.");

    const workspaceId = await getWorkspaceId(data.mode);
    await requireProjectMember(user.id, data.projectId, data.mode === "Team" ? data.teamId ?? null : null);
    const chat = await getDb()
      .prepare(
        `SELECT id,
                title,
                description,
                (SELECT COUNT(*)
                 FROM chat_messages
                 WHERE chat_id = chats.id) as messageCount
         FROM chats
         WHERE id = ?
           AND workspace_id = ?
           AND section = 'project'
           AND project_id = ?
         LIMIT 1`,
      )
      .bind(data.chatId, workspaceId, data.projectId)
      .first<{ id: string; title: string; description: string | null; messageCount: number }>();
    if (!chat) throw new Error("Chat was not found in this project.");

    const generatedTitle = chat.messageCount === 0 && shouldAutoRenameInitialChat(chat)
      ? await generateInitialChatTitle(context, prompt)
      : null;
    if (generatedTitle && generatedTitle !== chat.title) {
      await getDb()
        .prepare("UPDATE chats SET title = ? WHERE id = ?")
        .bind(generatedTitle, data.chatId)
        .run();
    }

    const userMessage: ChatMessage = {
      id: messageId("stream-user", data.userMessageId),
      author: "You",
      role: "user",
      avatar: avatarAlex,
      time: nowLabel(),
      text: prompt,
    };
    const assistantMessage: ChatMessage = {
      id: messageId("stream-assistant", data.assistantMessageId),
      author: "VertexAI",
      role: "assistant",
      time: nowLabel(),
      text: response,
    };
    const insertedMessages = [
      await insertScopedChatMessage({
        chatId: data.chatId,
        workspaceId,
        projectId: data.projectId,
        mode: data.mode,
        message: userMessage,
      }),
      await insertScopedChatMessage({
        chatId: data.chatId,
        workspaceId,
        projectId: data.projectId,
        mode: data.mode,
        message: assistantMessage,
      }),
    ];

    await publishChatMessageInserts(
      (env as Env).CHAT_SYNC,
      chatSyncScopeKey({
        mode: data.mode,
        teamId: data.teamId ?? null,
        userId: user.id,
        workspaceId,
      }),
      insertedMessages,
    );
    await recordScopedMutation({
      chatId: data.chatId,
      entity: "chat_message",
      entityId: assistantMessage.id,
      invalidates: ["chats", "projects"],
      mode: data.mode,
      operation: "insert",
      projectId: data.projectId,
      sourceUserId: user.id,
      teamId: data.teamId ?? null,
      workspaceId,
    });
    if (generatedTitle && generatedTitle !== chat.title) {
      await recordScopedMutation({
        chatId: data.chatId,
        entity: "chat",
        entityId: data.chatId,
        invalidates: ["chats", "projects"],
        mode: data.mode,
        operation: "rename",
        projectId: data.projectId,
        sourceUserId: user.id,
        teamId: data.teamId ?? null,
        workspaceId,
      });
    }

    return { chatTitle: generatedTitle ?? chat.title, messages: insertedMessages };
  });

export const createScopedChat = createServerFn({ method: "POST" })
  .validator((data: CreateChatInput) => data)
  .handler(async ({ data }) => {
    const user = await requireManager();
    const title = data.title.trim();
    const description = data.description.trim();
    if (!title) throw new Error("Chat name is required.");
    if (data.section === "project" && !data.projectId) throw new Error("Select a project before creating a project chat.");
    if (data.mode === "Team" && !data.teamId) throw new Error("Select a team before creating a team chat.");
    if (data.section === "workspace" && data.mode === "Team") await requireTeamMember(user.id, data.teamId ?? "");
    if (data.section === "project") await requireProjectMember(user.id, data.projectId ?? "", data.mode === "Team" ? data.teamId ?? null : null);

    const workspaceId = await getWorkspaceId(data.mode);
    const sort = await getDb()
      .prepare("SELECT COALESCE(MAX(sort_order), 0) + 1 as sortOrder FROM chats WHERE workspace_id = ? AND section = ? AND ((? IS NULL AND project_id IS NULL) OR project_id = ?)")
      .bind(workspaceId, data.section, data.projectId ?? null, data.projectId ?? null)
      .first<{ sortOrder: number }>();

    const id = chatId(title);
    await getDb()
      .prepare("INSERT INTO chats (id, workspace_id, project_id, section, title, description, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(id, workspaceId, data.section === "project" ? data.projectId : null, data.section, title, description, sort?.sortOrder ?? 1)
      .run();

    if (data.section === "workspace") {
      await getDb()
        .prepare("INSERT INTO chat_members (chat_id, user_id, team_id, created_at) VALUES (?, ?, ?, ?)")
        .bind(id, data.mode === "Team" ? null : user.id, data.mode === "Team" ? data.teamId ?? null : null, Date.now())
        .run();
    }
    await recordScopedMutation({
      chatId: id,
      entity: "chat",
      entityId: id,
      invalidates: ["chats", "projects"],
      mode: data.mode,
      operation: "insert",
      projectId: data.section === "project" ? data.projectId ?? null : null,
      sourceUserId: user.id,
      teamId: data.teamId ?? null,
      workspaceId,
    });

    return { id, title, description } satisfies ChatSummary;
  });

export const branchScopedChat = createServerFn({ method: "POST" })
  .validator((data: BranchChatInput) => data)
  .handler(async ({ context, data }): Promise<BranchChatResult> => {
    const user = await requireManager();
    if (!data.chatId) throw new Error("Chat is required.");
    if (!data.messageId) throw new Error("Message is required.");
    if (data.mode === "Team" && !data.teamId) throw new Error("Select a team before branching a team chat.");

    const workspaceId = await getWorkspaceId(data.mode);
    let sourceChat: ChatSummary | null = null;
    if (data.section === "project") {
      if (!data.projectId) throw new Error("Project is required.");
      await requireProjectMember(user.id, data.projectId, data.mode === "Team" ? data.teamId ?? null : null);
      sourceChat = await getDb()
        .prepare("SELECT id, title, description FROM chats WHERE id = ? AND workspace_id = ? AND section = 'project' AND project_id = ? LIMIT 1")
        .bind(data.chatId, workspaceId, data.projectId)
        .first<ChatSummary>();
    } else if (data.mode === "Team") {
      await requireTeamMember(user.id, data.teamId ?? "");
      sourceChat = await getDb()
        .prepare(
          `SELECT c.id, c.title, c.description
           FROM chats c
           INNER JOIN chat_members cm ON cm.chat_id = c.id
           WHERE c.id = ?
             AND c.workspace_id = ?
             AND c.section = 'workspace'
             AND c.project_id IS NULL
             AND cm.team_id = ?
           LIMIT 1`,
        )
        .bind(data.chatId, workspaceId, data.teamId ?? "")
        .first<ChatSummary>();
    } else {
      sourceChat = await getDb()
        .prepare(
          `SELECT c.id, c.title, c.description
           FROM chats c
           INNER JOIN chat_members cm ON cm.chat_id = c.id
           WHERE c.id = ?
             AND c.workspace_id = ?
             AND c.section = 'workspace'
             AND c.project_id IS NULL
             AND cm.user_id = ?
             AND cm.team_id IS NULL
           LIMIT 1`,
        )
        .bind(data.chatId, workspaceId, user.id)
        .first<ChatSummary>();
    }
    if (!sourceChat) throw new Error("Chat was not found.");

    const sourceMessage = await getDb()
      .prepare(
        `SELECT id,
                author,
                role,
                avatar,
                message_time as time,
                body as text,
                artifact_title as artifactTitle,
                artifact_type as artifactType,
                artifact_meta as artifactMeta,
                attachments_json as attachmentsJson
         FROM chat_messages
         WHERE id = ?
           AND chat_id = ?
         LIMIT 1`,
      )
      .bind(data.messageId, data.chatId)
      .first<{
        id: string;
        author: string;
        role: "user" | "assistant" | "system";
        avatar: string | null;
        time: string;
        text: string;
        artifactTitle: string | null;
        artifactType: "doc" | "ppt" | "sheet" | null;
        artifactMeta: string | null;
        attachmentsJson: string | null;
      }>();
    if (!sourceMessage) throw new Error("Message was not found in this chat.");

    const sort = await getDb()
      .prepare("SELECT COALESCE(MAX(sort_order), 0) + 1 as sortOrder FROM chats WHERE workspace_id = ? AND section = ? AND ((? IS NULL AND project_id IS NULL) OR project_id = ?)")
      .bind(workspaceId, data.section, data.projectId ?? null, data.projectId ?? null)
      .first<{ sortOrder: number }>();
    const title = await generateBranchChatTitle(context, sourceChat.title, sourceMessage.text);
    const description = branchChatDescription(sourceMessage.text);
    const nextChatId = chatId(title);
    await getDb()
      .prepare("INSERT INTO chats (id, workspace_id, project_id, section, title, description, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(nextChatId, workspaceId, data.section === "project" ? data.projectId : null, data.section, title, description, sort?.sortOrder ?? 1)
      .run();

    if (data.section === "workspace") {
      await getDb()
        .prepare("INSERT INTO chat_members (chat_id, user_id, team_id, created_at) VALUES (?, ?, ?, ?)")
        .bind(nextChatId, data.mode === "Team" ? null : user.id, data.mode === "Team" ? data.teamId ?? null : null, Date.now())
        .run();
    }

    const rootMessage: ChatMessage = {
      id: `msg-branch-root-${crypto.randomUUID()}`,
      parentId: sourceMessage.id,
      author: sourceMessage.author,
      role: sourceMessage.role,
      avatar: sourceMessage.avatar ?? undefined,
      time: sourceMessage.time,
      text: sourceMessage.text,
      artifact: sourceMessage.artifactTitle && sourceMessage.artifactType && sourceMessage.artifactMeta
        ? { title: sourceMessage.artifactTitle, type: sourceMessage.artifactType, meta: sourceMessage.artifactMeta }
        : undefined,
      attachments: parseChatAttachments(sourceMessage.attachmentsJson),
    };
    await getDb()
      .prepare(
        `INSERT INTO chat_messages (
          id,
          chat_id,
          parent_id,
          workspace_id,
          author,
          role,
          avatar,
          message_time,
          body,
          artifact_title,
          artifact_type,
          artifact_meta,
          attachments_json,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        rootMessage.id,
        nextChatId,
        sourceMessage.id,
        workspaceId,
        rootMessage.author,
        rootMessage.role,
        rootMessage.avatar ?? null,
        rootMessage.time,
        rootMessage.text,
        rootMessage.artifact?.title ?? null,
        rootMessage.artifact?.type ?? null,
        rootMessage.artifact?.meta ?? null,
        rootMessage.attachments?.length ? JSON.stringify(rootMessage.attachments) : null,
        new Date().toISOString(),
      )
      .run();
    await recordScopedMutation({
      chatId: nextChatId,
      entity: "chat",
      entityId: nextChatId,
      invalidates: ["chats", "projects"],
      mode: data.mode,
      operation: "branch",
      projectId: data.section === "project" ? data.projectId ?? null : null,
      sourceUserId: user.id,
      teamId: data.teamId ?? null,
      workspaceId,
    });

    return {
      chat: { id: nextChatId, title, description },
      rootMessage,
    };
  });

export const deleteScopedChat = createServerFn({ method: "POST" })
  .validator((data: DeleteChatInput) => data)
  .handler(async ({ data }) => {
    const user = await requireManager();
    if (!data.chatId) throw new Error("Chat is required.");
    if (data.mode === "Team" && !data.teamId) throw new Error("Select a team before deleting a team chat.");

    const workspaceId = await getWorkspaceId(data.mode);
    if (data.section === "project") {
      if (!data.projectId) throw new Error("Project is required.");
      await requireProjectMember(user.id, data.projectId, data.mode === "Team" ? data.teamId ?? null : null);
      const chat = await getDb()
        .prepare("SELECT id FROM chats WHERE id = ? AND workspace_id = ? AND section = 'project' AND project_id = ? LIMIT 1")
        .bind(data.chatId, workspaceId, data.projectId)
        .first<{ id: string }>();
      if (!chat) throw new Error("Chat was not found.");
    } else if (data.mode === "Team") {
      await requireTeamMember(user.id, data.teamId ?? "");
      const chat = await getDb()
        .prepare(
          `SELECT c.id
           FROM chats c
           INNER JOIN chat_members cm ON cm.chat_id = c.id
           WHERE c.id = ?
             AND c.workspace_id = ?
             AND c.section = 'workspace'
             AND c.project_id IS NULL
             AND cm.team_id = ?
           LIMIT 1`,
        )
        .bind(data.chatId, workspaceId, data.teamId ?? "")
        .first<{ id: string }>();
      if (!chat) throw new Error("Chat was not found.");
    } else {
      const chat = await getDb()
        .prepare(
          `SELECT c.id
           FROM chats c
           INNER JOIN chat_members cm ON cm.chat_id = c.id
           WHERE c.id = ?
             AND c.workspace_id = ?
             AND c.section = 'workspace'
             AND c.project_id IS NULL
             AND cm.user_id = ?
             AND cm.team_id IS NULL
           LIMIT 1`,
        )
        .bind(data.chatId, workspaceId, user.id)
        .first<{ id: string }>();
      if (!chat) throw new Error("Chat was not found.");
    }

    await getDb().prepare("DELETE FROM chat_members WHERE chat_id = ?").bind(data.chatId).run();
    await getDb().prepare("DELETE FROM chat_messages WHERE chat_id = ?").bind(data.chatId).run();
    await getDb().prepare("DELETE FROM chats WHERE id = ?").bind(data.chatId).run();
    await recordScopedMutation({
      chatId: data.chatId,
      entity: "chat",
      entityId: data.chatId,
      invalidates: ["chats", "projects"],
      mode: data.mode,
      operation: "delete",
      projectId: data.section === "project" ? data.projectId ?? null : null,
      sourceUserId: user.id,
      teamId: data.teamId ?? null,
      workspaceId,
    });

    return { id: data.chatId };
  });

export const renameScopedChat = createServerFn({ method: "POST" })
  .validator((data: RenameChatInput) => data)
  .handler(async ({ data }) => {
    const user = await requireManager();
    const title = normalizeChatTitle(data.title);
    if (!title) throw new Error("Chat name is required.");
    if (!data.chatId) throw new Error("Chat is required.");
    if (data.mode === "Team" && !data.teamId) throw new Error("Select a team before renaming a team chat.");

    const workspaceId = await getWorkspaceId(data.mode);
    if (data.section === "project") {
      if (!data.projectId) throw new Error("Project is required.");
      await requireProjectMember(user.id, data.projectId, data.mode === "Team" ? data.teamId ?? null : null);
      const chat = await getDb()
        .prepare("SELECT id FROM chats WHERE id = ? AND workspace_id = ? AND section = 'project' AND project_id = ? LIMIT 1")
        .bind(data.chatId, workspaceId, data.projectId)
        .first<{ id: string }>();
      if (!chat) throw new Error("Chat was not found.");
    } else if (data.mode === "Team") {
      await requireTeamMember(user.id, data.teamId ?? "");
      const chat = await getDb()
        .prepare(
          `SELECT c.id
           FROM chats c
           INNER JOIN chat_members cm ON cm.chat_id = c.id
           WHERE c.id = ?
             AND c.workspace_id = ?
             AND c.section = 'workspace'
             AND c.project_id IS NULL
             AND cm.team_id = ?
           LIMIT 1`,
        )
        .bind(data.chatId, workspaceId, data.teamId ?? "")
        .first<{ id: string }>();
      if (!chat) throw new Error("Chat was not found.");
    } else {
      const chat = await getDb()
        .prepare(
          `SELECT c.id
           FROM chats c
           INNER JOIN chat_members cm ON cm.chat_id = c.id
           WHERE c.id = ?
             AND c.workspace_id = ?
             AND c.section = 'workspace'
             AND c.project_id IS NULL
             AND cm.user_id = ?
             AND cm.team_id IS NULL
           LIMIT 1`,
        )
        .bind(data.chatId, workspaceId, user.id)
        .first<{ id: string }>();
      if (!chat) throw new Error("Chat was not found.");
    }

    await getDb().prepare("UPDATE chats SET title = ? WHERE id = ?").bind(title, data.chatId).run();
    await recordScopedMutation({
      chatId: data.chatId,
      entity: "chat",
      entityId: data.chatId,
      invalidates: ["chats", "projects"],
      mode: data.mode,
      operation: "rename",
      projectId: data.section === "project" ? data.projectId ?? null : null,
      sourceUserId: user.id,
      teamId: data.teamId ?? null,
      workspaceId,
    });
    return { id: data.chatId, title };
  });

export const createScopedInvite = createServerFn({ method: "POST" })
  .validator((data: { scope: ScopedInviteScope; targetId: string; targetName: string; email: string; targetTeamId?: string | null }) => data)
  .handler(async ({ data }) => {
    const user = await requireManager();
    const email = normalizeEmail(data.email);
    if (!email) throw new Error("Email is required.");
    const id = `scoped-invite-${crypto.randomUUID()}`;
    await getDb()
      .prepare(
        "INSERT INTO scoped_invites (id, scope, target_id, target_team_id, target_name, email, invited_by_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(id, data.scope, data.targetId, data.targetTeamId ?? null, data.targetName, email, user.id, Date.now())
      .run();
    await recordScopedMutation({
      entity: "scoped_invite",
      entityId: id,
      invalidates: ["teams", "projects", "chats"],
      mode: data.targetTeamId ? "Team" : "Org",
      operation: "insert",
      projectId: data.scope === "project" ? data.targetId : null,
      sourceUserId: user.id,
      teamId: data.targetTeamId ?? (data.scope === "team" ? data.targetId : null),
    });
    return { id, scope: data.scope, targetName: data.targetName, email };
  });

export const listMyScopedInvites = createServerFn({ method: "GET" }).handler(async () => {
  const user = await currentUser();
  const result = await getDb()
    .prepare(
      `SELECT id, scope, target_id as targetId, target_team_id as targetTeamId, target_name as targetName, email, accepted_at as acceptedAt, revoked_at as revokedAt, created_at as createdAt
       FROM scoped_invites
       WHERE email = ?
       ORDER BY created_at DESC`,
    )
    .bind(normalizeEmail(user.email))
    .all<{ id: string; scope: ScopedInviteScope; targetId: string; targetName: string; email: string; acceptedAt: number | null; revokedAt: number | null; createdAt: number }>();

  return (result.results ?? []).map((invite) => ({
    ...invite,
    status: invite.revokedAt ? "Revoked" : invite.acceptedAt ? "Accepted" : "Pending",
    createdLabel: new Date(invite.createdAt).toLocaleString(),
  }));
});

export const acceptScopedInvite = createServerFn({ method: "POST" })
  .validator((data: { inviteId: string }) => data)
  .handler(async ({ data }) => {
    const user = await currentUser();
    const invite = await getDb()
      .prepare(
        "SELECT id, scope, target_id as targetId, target_team_id as targetTeamId, target_name as targetName, email, accepted_at as acceptedAt, revoked_at as revokedAt FROM scoped_invites WHERE id = ? LIMIT 1",
      )
      .bind(data.inviteId)
      .first<{ id: string; scope: ScopedInviteScope; targetId: string; targetTeamId: string | null; targetName: string; email: string; acceptedAt: number | null; revokedAt: number | null }>();

    if (!invite) throw new Error("Invite was not found.");
    if (normalizeEmail(invite.email) !== normalizeEmail(user.email)) throw new Error("This invite belongs to another email address.");
    if (invite.revokedAt) throw new Error("This invite has been revoked.");
    const now = Date.now();
    if (!invite.acceptedAt) {
      if (invite.scope === "team") {
        await getDb()
          .prepare("INSERT OR IGNORE INTO team_members (team_id, user_id, role, created_at) VALUES (?, ?, ?, ?)")
          .bind(invite.targetId, user.id, "member", now)
          .run();
      } else {
        await getDb()
          .prepare("INSERT OR IGNORE INTO project_members (project_id, user_id, team_id, created_at) VALUES (?, ?, ?, ?)")
          .bind(invite.targetId, user.id, invite.targetTeamId, now)
          .run();
      }
      await getDb().prepare("UPDATE scoped_invites SET accepted_at = ? WHERE id = ?").bind(now, invite.id).run();
      await recordScopedMutation({
        entity: "scoped_invite",
        entityId: invite.id,
        invalidates: ["teams", "projects", "chats"],
        mode: invite.targetTeamId ? "Team" : "Org",
        operation: "accept",
        projectId: invite.scope === "project" ? invite.targetId : null,
        sourceUserId: user.id,
        teamId: invite.targetTeamId ?? (invite.scope === "team" ? invite.targetId : null),
      });
    }
    return { id: invite.id, scope: invite.scope, targetName: invite.targetName };
  });
