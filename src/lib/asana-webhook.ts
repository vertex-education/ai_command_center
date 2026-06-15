/// <reference path="../../worker-configuration.d.ts" />

import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { asanaWebhookTaskStates } from "../../db/schema";
import { publishChatMessageInserts, type ChatMessageInsertEvent } from "@/lib/chat-sync";
import { recordRealtimeMutationEvent } from "@/lib/realtime-events";
import type { ChatMessage, WorkspaceMode } from "@/lib/pmo-data";

type AsanaWebhookEnv = Env & {
  ASANA_WEBHOOK_SECRETS?: KVNamespace;
  ASANA_WEBHOOK_SECRET?: string;
  ASANA_WEBHOOK_PROJECT_MAP?: string;
  ASANA_WEBHOOK_SOURCE_USER_ID?: string;
};

type AsanaWebhookPayload =
  | AsanaWebhookEvent[]
  | {
      events?: AsanaWebhookEvent[];
    };

export type AsanaWebhookEvent = {
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

type ProjectMapEntry =
  | string
  | {
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

export async function handleAsanaWebhookRequest(request: Request, runtimeEnv: AsanaWebhookEnv = env as AsanaWebhookEnv) {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const webhookScope = resolveWebhookScope(request);
  if (!webhookScope.workspaceKey) {
    return Response.json({ error: "Asana webhook workspaceId or asanaWorkspaceGid is required." }, { status: 400 });
  }

  const handshakeSecret = request.headers.get("X-Hook-Secret");
  if (handshakeSecret) {
    await storeWebhookSecret(runtimeEnv, webhookScope.secretKey, handshakeSecret);
    return new Response(null, {
      status: 200,
      headers: { "X-Hook-Secret": handshakeSecret },
    });
  }

  const rawBody = await request.arrayBuffer();
  const signature = getSignatureHeader(request.headers);
  if (!signature) return Response.json({ error: "Missing Asana webhook signature." }, { status: 401 });

  const webhookEnv = runtimeEnv;
  const secret = await loadWebhookSecret(webhookEnv, webhookScope.secretKey);
  if (!secret) return Response.json({ error: "Asana webhook secret is not configured." }, { status: 500 });

  const verified = await verifyAsanaSignature({ rawBody, secret, signature });
  if (!verified) return Response.json({ error: "Invalid Asana webhook signature." }, { status: 401 });

  let payload: AsanaWebhookPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(rawBody)) as AsanaWebhookPayload;
  } catch {
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const events = Array.isArray(payload) ? payload : Array.isArray(payload.events) ? payload.events : [];
  if (events.length === 0) return Response.json({ accepted: true, delivered: false, reason: "No events in payload." });

  await upsertAsanaTaskStates(webhookEnv, webhookScope.workspaceKey, events);
  const localTaskUpdates = await applyAsanaWebhookEventsToLocalTasks(webhookEnv, events);

  const target = await resolveProjectChatTarget(events, webhookEnv);
  if (!target) {
    const sourceUserId = await resolveSourceUserId(webhookEnv);
    if (sourceUserId && localTaskUpdates.length > 0) {
      await publishLocalTaskUpdateEvents(webhookEnv, localTaskUpdates, sourceUserId);
    }
    console.warn(
      JSON.stringify({
        event: "asana_webhook_unmatched",
        taskGids: extractTaskGids(events),
        projectGids: extractProjectGids(events),
      }),
    );
    return Response.json(
      {
        accepted: true,
        delivered: localTaskUpdates.length > 0,
        reason: localTaskUpdates.length > 0 ? "Updated local task state without a matching project chat." : "No matching project chat.",
      },
      { status: 202 },
    );
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
  if (localTaskUpdates.length > 0) {
    await publishLocalTaskUpdateEvents(webhookEnv, localTaskUpdates, sourceUserId);
  }

  return Response.json({
    accepted: true,
    delivered: true,
    chatId: target.chatId,
    projectId: target.projectId,
    eventCount: events.length,
  });
}

export function resolveWebhookScope(request: Request) {
  const url = new URL(request.url);
  const workspaceKey = url.searchParams.get("workspaceId")?.trim() || url.searchParams.get("asanaWorkspaceGid")?.trim() || "";
  const resourceKey = url.searchParams.get("asanaProjectGid")?.trim() || url.searchParams.get("webhookKey")?.trim() || "";
  return {
    workspaceKey,
    secretKey: resourceKey ? `${workspaceKey}:${resourceKey}` : workspaceKey,
  };
}

export function webhookSecretKey(secretKey: string) {
  return `asana:webhook-secret:${secretKey}`;
}

async function storeWebhookSecret(webhookEnv: AsanaWebhookEnv, secretKey: string, secret: string) {
  const namespace = webhookEnv.ASANA_WEBHOOK_SECRETS;
  if (!namespace) throw new Error("ASANA_WEBHOOK_SECRETS KV binding is not configured.");
  await namespace.put(webhookSecretKey(secretKey), secret);
}

async function loadWebhookSecret(webhookEnv: AsanaWebhookEnv, secretKey: string) {
  const kvSecret = await webhookEnv.ASANA_WEBHOOK_SECRETS?.get(webhookSecretKey(secretKey));
  return kvSecret?.trim() || webhookEnv.ASANA_WEBHOOK_SECRET?.trim() || "";
}

export function getSignatureHeader(headers: Headers) {
  for (const name of signatureHeaderNames) {
    const value = headers.get(name);
    if (value) return value;
  }
  return null;
}

export async function verifyAsanaSignature({ rawBody, secret, signature }: { rawBody: ArrayBuffer; secret: string; signature: string }) {
  const signatureBytes = hexToBytes(normalizeSignature(signature));
  if (!signatureBytes) return false;

  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  return crypto.subtle.verify("HMAC", key, signatureBytes, rawBody);
}

export function normalizeSignature(signature: string) {
  return signature
    .trim()
    .toLowerCase()
    .replace(/^sha256=/, "");
}

export function hexToBytes(hex: string) {
  if (!/^[0-9a-f]+$/.test(hex) || hex.length % 2 !== 0) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < hex.length; index += 2) {
    bytes[index / 2] = Number.parseInt(hex.slice(index, index + 2), 16);
  }
  return bytes;
}

async function upsertAsanaTaskStates(webhookEnv: AsanaWebhookEnv, workspaceKey: string, events: AsanaWebhookEvent[]) {
  const taskEvents = events
    .map((event) => normalizeTaskStateEvent(workspaceKey, event))
    .filter((event): event is AsanaTaskStateUpsert => Boolean(event));
  if (taskEvents.length === 0) return;

  const db = drizzle(webhookEnv.DB);
  for (const taskEvent of taskEvents) {
    await db
      .insert(asanaWebhookTaskStates)
      .values(taskEvent)
      .onConflictDoUpdate({
        target: asanaWebhookTaskStates.asanaTaskGid,
        set: {
          asanaWorkspaceGid: taskEvent.asanaWorkspaceGid,
          vertexWorkspaceId: taskEvent.vertexWorkspaceId,
          asanaProjectGid: taskEvent.asanaProjectGid,
          taskName: taskEvent.taskName,
          action: taskEvent.action,
          changeAction: taskEvent.changeAction,
          changeField: taskEvent.changeField,
          status: taskEvent.status,
          lastEventAt: taskEvent.lastEventAt,
          rawEventJson: taskEvent.rawEventJson,
          updatedAt: taskEvent.updatedAt,
        },
      })
      .run();
  }
}

type AsanaTaskStateUpsert = typeof asanaWebhookTaskStates.$inferInsert;

export function normalizeTaskStateEvent(workspaceKey: string, event: AsanaWebhookEvent): AsanaTaskStateUpsert | null {
  const task = event.resource?.resource_type === "task" ? event.resource : event.parent?.resource_type === "task" ? event.parent : null;
  const asanaTaskGid = task?.gid?.trim();
  if (!task || !asanaTaskGid) return null;

  const now = new Date();
  return {
    asanaTaskGid,
    asanaWorkspaceGid: workspaceKey,
    vertexWorkspaceId: null,
    asanaProjectGid: event.parent?.resource_type === "project" ? (event.parent.gid ?? null) : null,
    taskName: task.name ?? null,
    action: event.action ?? "changed",
    changeAction: event.change?.action ?? null,
    changeField: event.change?.field ?? null,
    status: extractEventStatus(event),
    lastEventAt: now,
    rawEventJson: JSON.stringify(event),
    updatedAt: now,
  };
}

export function extractEventStatus(event: AsanaWebhookEvent) {
  const field = event.change?.field?.trim().toLowerCase();
  if (!field || !["status", "completed", "approval_status", "custom_fields"].includes(field)) return null;
  const value = event.change?.new_value;
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "completed" : "incomplete";
  if (isObjectRecord(value)) {
    const name = value.name;
    if (typeof name === "string") return name;
    const text = value.text_value;
    if (typeof text === "string") return text;
  }
  return value === null ? null : String(value);
}

type LocalTaskWebhookUpdate = {
  action: string;
  asanaTaskGid: string;
  changeField: string | null;
  localStatus: "Open" | "Completed" | null;
  taskName: string | null;
};

type UpdatedLocalTask = {
  asanaTaskGid: string;
  chatId: string | null;
  localTaskId: string;
  mode: WorkspaceMode;
  projectId: string | null;
  teamId: string | null;
  workspaceId: string;
};

async function applyAsanaWebhookEventsToLocalTasks(webhookEnv: AsanaWebhookEnv, events: AsanaWebhookEvent[]) {
  const updates = collectLocalTaskWebhookUpdates(events);
  const updatedTasks: UpdatedLocalTask[] = [];
  for (const update of updates) {
    const row = await findLocalTaskByAsanaGid(webhookEnv.DB, update.asanaTaskGid);
    if (!row) continue;

    const nextTitle = update.changeField === "name" && update.taskName ? update.taskName : row.title;
    const nextStatus = update.localStatus ?? row.status;
    const nextSyncError =
      update.action === "deleted" ? "Asana task was deleted." : update.action === "undeleted" ? null : row.asanaSyncError;

    await webhookEnv.DB.prepare(
      `UPDATE workspace_actions
       SET title = ?,
           status = ?,
           asana_sync_error = ?
       WHERE id = ?
         AND workspace_id = ?
         AND kind = 'task'`,
    )
      .bind(nextTitle, nextStatus, nextSyncError, row.id, row.workspaceId)
      .run();

    updatedTasks.push({
      asanaTaskGid: update.asanaTaskGid,
      chatId: row.chatId,
      localTaskId: row.id,
      mode: row.mode,
      projectId: row.projectId,
      teamId: row.teamId,
      workspaceId: row.workspaceId,
    });
  }
  return updatedTasks;
}

function collectLocalTaskWebhookUpdates(events: AsanaWebhookEvent[]) {
  const updatesByTaskGid = new Map<string, LocalTaskWebhookUpdate>();
  for (const event of events) {
    const task = event.resource?.resource_type === "task" ? event.resource : event.parent?.resource_type === "task" ? event.parent : null;
    const asanaTaskGid = task?.gid?.trim();
    if (!task || !asanaTaskGid) continue;
    updatesByTaskGid.set(asanaTaskGid, {
      action: event.action ?? "changed",
      asanaTaskGid,
      changeField: event.change?.field?.trim().toLowerCase() || null,
      localStatus: mapAsanaWebhookTaskStatusToWorkflowStatus(extractEventStatus(event)),
      taskName: task.name?.trim() || null,
    });
  }
  return [...updatesByTaskGid.values()];
}

export function mapAsanaWebhookTaskStatusToWorkflowStatus(status: string | null) {
  const normalized = status?.trim().toLowerCase();
  if (!normalized) return null;
  if (["complete", "completed", "done", "true"].includes(normalized)) return "Completed" as const;
  if (["incomplete", "open", "not completed", "false"].includes(normalized)) return "Open" as const;
  return null;
}

async function findLocalTaskByAsanaGid(db: D1Database, asanaTaskGid: string) {
  const row = await db
    .prepare(
      `SELECT wa.id,
              wa.workspace_id as workspaceId,
              wa.project_id as projectId,
              wa.title,
              wa.status,
              wa.asana_sync_error as asanaSyncError,
              w.scope as workspaceScope,
              c.id as chatId,
              pm.team_id as teamId
       FROM workspace_actions wa
       INNER JOIN workspaces w ON w.id = wa.workspace_id
       LEFT JOIN chats c ON c.project_id = wa.project_id
        AND c.workspace_id = wa.workspace_id
        AND c.section = 'project'
       LEFT JOIN project_members pm ON pm.project_id = wa.project_id
       WHERE wa.asana_task_gid = ?
         AND wa.kind = 'task'
       ORDER BY c.sort_order ASC
       LIMIT 1`,
    )
    .bind(asanaTaskGid)
    .first<{
      id: string;
      workspaceId: string;
      projectId: string | null;
      title: string;
      status: "Open" | "Completed";
      asanaSyncError: string | null;
      workspaceScope: "personal" | "team" | "org";
      chatId: string | null;
      teamId: string | null;
    }>();
  if (!row) return null;
  return {
    ...row,
    mode: modeForScope(row.workspaceScope),
  };
}

async function publishLocalTaskUpdateEvents(webhookEnv: AsanaWebhookEnv, updates: UpdatedLocalTask[], sourceUserId: string) {
  for (const update of updates) {
    await recordRealtimeMutationEvent(webhookEnv.DB, {
      chatId: update.chatId,
      entity: "task",
      entityId: update.localTaskId,
      invalidates: ["workspace", "projects"],
      mode: update.mode,
      operation: "update",
      projectId: update.projectId,
      sourceClientId: webhookSourceClientId,
      sourceUserId,
      teamId: update.mode === "Team" ? update.teamId : null,
      workspaceId: update.workspaceId,
    });
  }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
      console.warn(
        JSON.stringify({
          event: "asana_mapping_lookup_failed",
          error: error instanceof Error ? error.message : "Unknown Asana mapping lookup failure",
        }),
      );
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

export function parseProjectMap(value: string | undefined) {
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
  const preferred = preferredChatId ? await queryProjectChat(db, "c.id = ? AND p.id = ?", [preferredChatId, projectId]) : null;
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

export function modeForScope(scope: "personal" | "team" | "org"): WorkspaceMode {
  if (scope === "team") return "Team";
  if (scope === "org") return "Org";
  return "Personal";
}

async function resolveSourceUserId(webhookEnv: AsanaWebhookEnv) {
  const configured = webhookEnv.ASANA_WEBHOOK_SOURCE_USER_ID?.trim();
  if (configured) {
    const user = await webhookEnv.DB.prepare("SELECT id FROM user WHERE id = ? LIMIT 1").bind(configured).first<{ id: string }>();
    if (user) return user.id;
  }

  const fallback = await webhookEnv.DB.prepare(
    "SELECT id FROM user WHERE banned = 0 ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'manager' THEN 1 WHEN 'contributor' THEN 2 WHEN 'user' THEN 2 ELSE 3 END, createdAt ASC LIMIT 1",
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

export function buildAsanaChatMessage(events: AsanaWebhookEvent[]): ChatMessage {
  const primary = events[0];
  const task =
    primary?.resource?.resource_type === "task"
      ? primary.resource
      : events.find((event) => event.resource?.resource_type === "task")?.resource;
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

export function formatAsanaEventLine(event: AsanaWebhookEvent) {
  const action = event.change?.action || event.action || "updated";
  const field = event.change?.field ? ` ${event.change.field}` : "";
  const actor = event.user?.name ? ` by ${event.user.name}` : "";
  const resource = event.resource?.name || event.resource?.gid || "task";
  return `- ${resource}: ${action}${field}${actor}.`;
}

export function extractTaskGids(events: AsanaWebhookEvent[]) {
  return uniqueStrings(
    events.flatMap((event) => [
      event.resource?.resource_type === "task" ? event.resource.gid : undefined,
      event.parent?.resource_type === "task" ? event.parent.gid : undefined,
    ]),
  );
}

export function extractProjectGids(events: AsanaWebhookEvent[]) {
  return uniqueStrings(
    events.flatMap((event) => [
      event.resource?.resource_type === "project" ? event.resource.gid : undefined,
      event.parent?.resource_type === "project" ? event.parent.gid : undefined,
    ]),
  );
}

export function extractProjectNames(events: AsanaWebhookEvent[]) {
  return uniqueStrings(
    events.flatMap((event) => [
      event.resource?.resource_type === "project" ? event.resource.name : undefined,
      event.parent?.resource_type === "project" ? event.parent.name : undefined,
    ]),
  );
}

export function uniqueStrings(values: Array<string | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

export function chatSyncScopeKey({
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
