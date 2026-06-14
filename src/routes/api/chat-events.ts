/// <reference path="../../../worker-configuration.d.ts" />

import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import type { ChatSyncConnectionPayload } from "@/lib/chat-sync";
import { getAuth } from "@/lib/auth";
import type { WorkspaceMode } from "@/lib/pmo-data";

type SessionUser = {
  id: string;
  email?: string | null;
  name?: string | null;
};

type AuthSession = {
  user: SessionUser;
};

type ChatSubscriptionScope = {
  chatIds: Set<string>;
  presenceScopeKey: string;
  workspaceId: string;
};

const validModes: WorkspaceMode[] = ["Personal", "Team", "Org"];

async function handleChatEvents({ request }: { request: Request }) {
  const session = await getAuth(request).api.getSession({ headers: request.headers });
  const user = (session as AuthSession | null)?.user;
  if (!user) return new Response("Unauthorized", { status: 401 });

  const url = new URL(request.url);
  const mode = normalizeMode(url.searchParams.get("mode"));
  if (!mode) return new Response("Workspace mode is required.", { status: 400 });

  const teamId = url.searchParams.get("teamId")?.trim() || null;
  if (mode === "Team" && !teamId) return new Response("Team id is required.", { status: 400 });

  try {
    const scope = await getSubscriptionScope({ mode, teamId, userId: user.id });
    return connectToChatSyncObject(scope, {
      chatIds: [...scope.chatIds],
      user: {
        id: user.id,
        name: user.name?.trim() || user.email?.trim() || "Workspace user",
        email: user.email?.trim() || "",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Chat stream is unavailable.";
    return new Response(message, { status: 403 });
  }
}

export function normalizeMode(value: string | null): WorkspaceMode | null {
  return validModes.includes(value as WorkspaceMode) ? value as WorkspaceMode : null;
}

async function getSubscriptionScope({
  mode,
  teamId,
  userId,
}: {
  mode: WorkspaceMode;
  teamId: string | null;
  userId: string;
}): Promise<ChatSubscriptionScope> {
  const workspace = await env.DB.prepare("SELECT id FROM workspaces WHERE scope = ? LIMIT 1")
    .bind(mode.toLowerCase())
    .first<{ id: string }>();
  if (!workspace) throw new Error(`${mode} workspace was not found.`);

  if (mode === "Team") {
    const teamMember = await env.DB.prepare("SELECT team_id FROM team_members WHERE team_id = ? AND user_id = ? LIMIT 1")
      .bind(teamId ?? "", userId)
      .first<{ team_id: string }>();
    if (!teamMember) throw new Error("You are not a member of this team.");
  }

  const chatIds = new Set<string>();

  if (mode === "Team") {
    const workspaceChats = await env.DB.prepare(
      `SELECT c.id
       FROM chats c
       INNER JOIN chat_members cm ON cm.chat_id = c.id
       WHERE c.workspace_id = ?
         AND c.section = 'workspace'
         AND c.project_id IS NULL
         AND cm.team_id = ?`,
    )
      .bind(workspace.id, teamId)
      .all<{ id: string }>();
    for (const chat of workspaceChats.results ?? []) chatIds.add(chat.id);
  } else {
    const workspaceChats = await env.DB.prepare(
      `SELECT c.id
       FROM chats c
       INNER JOIN chat_members cm ON cm.chat_id = c.id
       WHERE c.workspace_id = ?
         AND c.section = 'workspace'
         AND c.project_id IS NULL
         AND cm.user_id = ?
         AND cm.team_id IS NULL`,
    )
      .bind(workspace.id, userId)
      .all<{ id: string }>();
    for (const chat of workspaceChats.results ?? []) chatIds.add(chat.id);
  }

  const projectChats = await env.DB.prepare(
    `SELECT c.id
     FROM chats c
     INNER JOIN project_members pm ON pm.project_id = c.project_id
     WHERE c.workspace_id = ?
       AND c.section = 'project'
       AND pm.user_id = ?
       AND (
         (? = 'Team' AND pm.team_id = ?)
         OR (? <> 'Team' AND pm.team_id IS NULL)
       )`,
  )
    .bind(workspace.id, userId, mode, mode === "Team" ? teamId : null, mode)
    .all<{ id: string }>();
  for (const chat of projectChats.results ?? []) chatIds.add(chat.id);

  return {
    chatIds,
    workspaceId: workspace.id,
    presenceScopeKey: presenceScopeKey({ mode, teamId, userId, workspaceId: workspace.id }),
  };
}

export function presenceScopeKey({
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

function connectToChatSyncObject(scope: ChatSubscriptionScope, payload: ChatSyncConnectionPayload) {
  const stub = env.CHAT_SYNC.getByName(scope.presenceScopeKey);
  return stub.fetch("https://chat-sync.local/connect", {
    method: "POST",
    body: JSON.stringify(payload),
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/chat-events")({
  server: {
    handlers: {
      GET: handleChatEvents,
    },
  },
});
