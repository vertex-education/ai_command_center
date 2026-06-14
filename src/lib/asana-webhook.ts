/// <reference path="../../worker-configuration.d.ts" />

import { env } from "cloudflare:workers";
import { publishChatMessageInserts, type ChatMessageInsertEvent } from "@/lib/chat-sync";
import { recordRealtimeMutationEvent } from "@/lib/realtime-events";
import type { ChatMessage, WorkspaceMode } from "@/lib/pmo-data";

type AsanaWebhookEnv = Env & {
  ASANA_WEBHOOK_SECRET?: string;
  ASANA_WEBHOOK_PROJECT_MAP?: string;
  ASANA_WEBHOOK_SOURCE_USER_ID?: string;
};

type AsanaWebhookPayload = {
  events?: AsanaWebhookEvent[];
};

type AsanaWebhookEvent = {
  action?: string;
  change?: {
    action?: string;
    field?: string;
    new_value?: unknown;
    old_value?: unknown;
  };
  parent?: AsanaResource;
  resource?: AsanaResource;
  user?: AsanaResource;
};

type AsanaResource = {
  gid?: string;
  name?: string;
  resource_type?: string;
};

type ProjectMapEntry = string | {
  projectId?: string;
  chatId?: string;
  mode?: WorkspaceMode;
  teamId?: string | null;
};

type ProjectChatTarget = {
  chatId: string;
  projectId: string;
  teamId: string | null;
  mode: WorkspaceMode;
  workspaceId: string;
};

const signatureHeaderNames = ["X-Asana-Request-Signature", "X-Hook-Signature"];
const webhookSourceClientId = "asana-webhook";
const encoder = new TextEncoder();

export async function handleAsanaWebhookRequest(request: Request) {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const handshakeSecret = request.headers.get("X-Hook-Secret");
  if (handshakeSecret) {
    return new Response(null, {
      status: 204,
      headers: { "X-Hook-Secret": handshakeSecret },
    });
  }

  const rawBody = await request.arrayBuffer();
  const signature = getSignatureHeader(request.headers);
  if (!signature) return Response.json({ error: "Missing Asana webhook signature." }, { status: 401 });

  const webhookEnv = env as AsanaWebhookEnv;
  const secret = webhookEnv.ASANA_WEBHOOK_SECRET?.trim();
  if (!secret) return Response.json({ error: "Asana webhook secret is not configured." }, { status: 500 });

  const verified = await verifyAsanaSignature({ rawBody, secret, signature });
  if (!verified) return Response.json({ error: "Invalid Asana webhook signature." }, { status: 401 });

  let payload: AsanaWebhookPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(rawBody)) as AsanaWebhookPayload;
  } catch {
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const events = Array.isArray(payload.events) ? payload.events : [];
  if (events.length === 0) return Response.json({ accepted: true, delivered: false, reason: "No events in payload." });

  const target = await resolveProjectChatTarget(events, webhookEnv);
  if (!target) {
    console.warn(JSON.stringify({
      event: "asana_webhook_unmatched",
      taskGids: extractTaskGids(events),
      projectGids: extractProjectGids(events),
    }));
    return Response.json({ accepted: true, delivered: false, reason: "No matching project chat." }, { status: 202 });
  }

  const sourceUserId = await resolveSourceUserId(webhookEnv);
  if (!sourceUserId) {
    return Response.json({ accepted: true, delivered: false, reason: "No source user configured." }, { status: 202 });
  }

  const message = buildAsanaChatMessage(events);
  const persistedEvent = await persistAsanaChatMessage(target, message);
  await publishChatMessageInserts(
    webhookEnv.CHAT_SYNC,
    chatSyncScopeKey({ mode: target.mode, teamId: target.teamId, userId: sourceUserId, workspaceId: target.workspaceId }),
    [persistedEvent],
  );
  await recordRealtimeMutationEvent(webhookEnv.DB, {
    chatId: target.chatId,
    entity: "asana_task",
    entityId: extractTaskGids(events).at(0) ?? target.projectId,
    invalidates: ["workspace", "chats", "projects"],
    mode: target.mode,
    operation: "update",
    projectId: target.projectId,
    sourceClientId: webhookSourceClientId,
    sourceUserId,
    teamId: target.mode === "Team" ? target.teamId : null,
    workspaceId: target.workspaceId,
  });

  return Response.json({
    accepted: true,
    delivered: true,
    chatId: target.chatId,
    projectId: target.projectId,
    eventCount: events.length,
  });
}

function getSignatureHeader(headers: Headers) {
  for (const name of signatureHeaderNames) {
    const value = headers.get(name);
    if (value) return value;
  }
  return null;
}

async function verifyAsanaSignature({
  rawBody,
  secret,
  signature,
}: {
  rawBody: ArrayBuffer;
  secret: string;
  signature: string;
}) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, rawBody);
  const expected = toHex(new Uint8Array(digest));
  return timingSafeEqualHex(expected, normalizeSignature(signature));
}

function normalizeSignature(signature: string) {
  return signature.trim().toLowerCase().replace(/^sha256=/, "");
}

function toHex(bytes: Uint8Array) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqualHex(left: string, right: string) {
  if (!/^[0-9a-f]+$/.test(left) || !/^[0-9a-f]+$/.test(right)) return false;
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  let diff = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return diff === 0;
}

async function resolveProjectChatTarget(events: AsanaWebhookEvent[], webhookEnv: AsanaWebhookEnv) {
  const persistedTarget = await resolvePersistedProjectTarget(events, webhookEnv);
  if (persistedTarget) return persistedTarget;

  const mappedTarget = await resolveMappedProjectTarget(events, webhookEnv);
  if (mappedTarget) return mappedTarget;

  const candidateProjectIds = new Set([...extractProjectGids(events), ...extractTaskGids(events)]);
  for (const projectId of candidateProjectIds) {
    const target = await findProjectChatByProjectId(webhookEnv.DB, projectId);
    if (target) return target;
  }

  const candidateProjectNames = extractProjectNames(events);
  for (const projectName of candidateProjectNames) {
    const target = await findProjectChatByProjectName(webhookEnv.DB, projectName);
    if (target) return target;
  }

  return null;
}

async function resolvePersistedProjectTarget(events: AsanaWebhookEvent[], webhookEnv: AsanaWebhookEnv) {
  const candidateKeys = [...extractProjectGids(events), ...extractTaskGids(events)];
  for (const key of candidateKeys) {
    try {
      const row = await webhookEnv.DB.prepare(
        `SELECT vertex_project_id as projectId,
                vertex_chat_id as chatId,
                vertex_team_id as teamId,
                vertex_mode as mode,
                vertex_workspace_id as workspaceId
         FROM asana_project_mappings
         WHERE asana_project_gid = ?
         LIMIT 1`,
      )
        .bind(key)
        .first<{
          projectId: string;
          chatId: string | null;
          teamId: string | null;
          mode: WorkspaceMode;
          workspaceId: string;
        }>();
      if (!row?.chatId) continue;
      return {
        chatId: row.chatId,
        projectId: row.projectId,
        teamId: row.teamId,
        mode: row.mode,
        workspaceId: row.workspaceId,
      } satisfies ProjectChatTarget;
    } catch (error) {
      console.warn(JSON.stringify({
        event: "asana_mapping_lookup_failed",
        error: error instanceof Error ? error.message : "Unknown Asana mapping lookup failure",
      }));
      return null;
    }
  }
  return null;
}

async function resolveMappedProjectTarget(events: AsanaWebhookEvent[], webhookEnv: AsanaWebhookEnv) {
  const projectMap = parseProjectMap(webhookEnv.ASANA_WEBHOOK_PROJECT_MAP);
  if (!projectMap) return null;

  const candidateKeys = [...extractProjectGids(events), ...extractTaskGids(events)];
  for (const key of candidateKeys) {
    const entry = projectMap[key];
    if (!entry) continue;
    const projectId = typeof entry === "string" ? entry : entry.projectId;
    if (!projectId) continue;
    const target = await findProjectChatByProjectId(webhookEnv.DB, projectId, typeof entry === "string" ? undefined : entry.chatId);
    if (!target) continue;
    return {
      ...target,
      mode: typeof entry === "string" || !entry.mode ? target.mode : entry.mode,
      teamId: typeof entry === "string" || entry.teamId === undefined ? target.teamId : entry.teamId,
    };
  }

  return null;
}

function parseProjectMap(value: string | undefined) {
  if (!value?.trim()) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, ProjectMapEntry>;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    console.warn("ASANA_WEBHOOK_PROJECT_MAP is not valid JSON.");
    return null;
  }
}

async function findProjectChatByProjectId(db: D1Database, projectId: string, preferredChatId?: string) {
  const preferred = preferredChatId
    ? await queryProjectChat(db, "c.id = ? AND p.id = ?", [preferredChatId, projectId])
    : null;
  if (preferred) return preferred;
  return queryProjectChat(db, "p.id = ?", [projectId]);
}

async function findProjectChatByProjectName(db: D1Database, projectName: string) {
  return queryProjectChat(db, "lower(p.name) = lower(?)", [projectName]);
}

async function queryProjectChat(db: D1Database, where: string, bindings: unknown[]) {
  const row = await db
    .prepare(
      `SELECT c.id as chatId,
              c.project_id as projectId,
              c.workspace_id as workspaceId,
              w.scope as workspaceScope,
              pm.team_id as teamId
       FROM chats c
       INNER JOIN projects p ON p.id = c.project_id
       INNER JOIN workspaces w ON w.id = c.workspace_id
       LEFT JOIN project_members pm ON pm.project_id = p.id
       WHERE c.section = 'project'
         AND ${where}
       ORDER BY c.sort_order ASC
       LIMIT 1`,
    )
    .bind(...bindings)
    .first<{
      chatId: string;
      projectId: string;
      workspaceId: string;
      workspaceScope: "personal" | "team" | "org";
      teamId: string | null;
    }>();
  if (!row) return null;
  return {
    chatId: row.chatId,
    projectId: row.projectId,
    teamId: row.teamId,
    mode: modeForScope(row.workspaceScope),
    workspaceId: row.workspaceId,
  };
}

function modeForScope(scope: "personal" | "team" | "org"): WorkspaceMode {
  if (scope === "team") return "Team";
  if (scope === "org") return "Org";
  return "Personal";
}

async function resolveSourceUserId(webhookEnv: AsanaWebhookEnv) {
  const configured = webhookEnv.ASANA_WEBHOOK_SOURCE_USER_ID?.trim();
  if (configured) {
    const user = await webhookEnv.DB.prepare("SELECT id FROM user WHERE id = ? LIMIT 1")
      .bind(configured)
      .first<{ id: string }>();
    if (user) return user.id;
  }

  const fallback = await webhookEnv.DB.prepare(
    "SELECT id FROM user WHERE banned = 0 ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'user' THEN 1 ELSE 2 END, createdAt ASC LIMIT 1",
  ).first<{ id: string }>();
  return fallback?.id ?? null;
}

async function persistAsanaChatMessage(target: ProjectChatTarget, message: ChatMessage): Promise<ChatMessageInsertEvent> {
  await (env as AsanaWebhookEnv).DB.prepare(
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
      message.id,
      target.chatId,
      null,
      target.workspaceId,
      message.author,
      message.role,
      message.avatar ?? null,
      message.time,
      message.text,
      null,
      null,
      null,
      null,
      new Date().toISOString(),
    )
    .run();

  return {
    id: message.id,
    chatId: target.chatId,
    workspaceId: target.workspaceId,
    projectId: target.projectId,
    mode: target.mode,
    message,
  };
}

function buildAsanaChatMessage(events: AsanaWebhookEvent[]): ChatMessage {
  const primary = events[0];
  const task = primary?.resource?.resource_type === "task" ? primary.resource : events.find((event) => event.resource?.resource_type === "task")?.resource;
  const taskLabel = task?.name || (task?.gid ? `Task ${task.gid}` : "Asana task");
  const eventLines = events.slice(0, 6).map(formatAsanaEventLine).filter(Boolean);
  const remaining = events.length > eventLines.length ? `\n- ${events.length - eventLines.length} additional update(s).` : "";
  return {
    id: `msg-asana-${crypto.randomUUID()}`,
    author: "Asana",
    role: "system",
    time: new Date().toLocaleString("en-US", { dateStyle: "short", timeStyle: "short", timeZone: "America/New_York" }),
    text: `Asana task update: ${taskLabel}\n${eventLines.join("\n")}${remaining}`,
  };
}

function formatAsanaEventLine(event: AsanaWebhookEvent) {
  const action = event.change?.action || event.action || "updated";
  const field = event.change?.field ? ` ${event.change.field}` : "";
  const actor = event.user?.name ? ` by ${event.user.name}` : "";
  const resource = event.resource?.name || event.resource?.gid || "task";
  return `- ${resource}: ${action}${field}${actor}.`;
}

function extractTaskGids(events: AsanaWebhookEvent[]) {
  return uniqueStrings(events.flatMap((event) => [
    event.resource?.resource_type === "task" ? event.resource.gid : undefined,
    event.parent?.resource_type === "task" ? event.parent.gid : undefined,
  ]));
}

function extractProjectGids(events: AsanaWebhookEvent[]) {
  return uniqueStrings(events.flatMap((event) => [
    event.resource?.resource_type === "project" ? event.resource.gid : undefined,
    event.parent?.resource_type === "project" ? event.parent.gid : undefined,
  ]));
}

function extractProjectNames(events: AsanaWebhookEvent[]) {
  return uniqueStrings(events.flatMap((event) => [
    event.resource?.resource_type === "project" ? event.resource.name : undefined,
    event.parent?.resource_type === "project" ? event.parent.name : undefined,
  ]));
}

function uniqueStrings(values: Array<string | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
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
