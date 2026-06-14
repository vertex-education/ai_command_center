/// <reference path="../../../worker-configuration.d.ts" />

import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { getAuth } from "@/lib/auth";
import { parseRealtimeEventRow, type RealtimeMutationEvent } from "@/lib/realtime-events";
import type { WorkspaceMode } from "@/lib/pmo-data";

type SessionUser = {
  id: string;
};

type AuthSession = {
  user: SessionUser;
};

type EventSubscriptionScope = {
  mode: WorkspaceMode;
  workspaceId: string;
  teamId: string | null;
  userId: string;
};

const validModes: WorkspaceMode[] = ["Personal", "Team", "Org"];
const encoder = new TextEncoder();
const pollIntervalMs = 2_500;
const heartbeatIntervalMs = 20_000;

async function handleEvents({ request }: { request: Request }) {
  const session = await getAuth(request).api.getSession({ headers: request.headers });
  const user = (session as AuthSession | null)?.user;
  if (!user) return new Response("Unauthorized", { status: 401 });

  const url = new URL(request.url);
  const mode = normalizeMode(url.searchParams.get("mode"));
  if (!mode) return new Response("Workspace mode is required.", { status: 400 });

  const teamId = url.searchParams.get("teamId")?.trim() || null;
  if (mode === "Team" && !teamId) return new Response("Team id is required.", { status: 400 });

  try {
    const scope = await getEventScope({ mode, teamId, userId: user.id });
    const requestedLastEventId = parseLastEventId(
      request.headers.get("Last-Event-ID") ?? url.searchParams.get("lastEventId"),
    );
    return streamEvents({ request, scope, lastEventId: requestedLastEventId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Event stream is unavailable.";
    return new Response(message, { status: 403 });
  }
}

export function normalizeMode(value: string | null): WorkspaceMode | null {
  return validModes.includes(value as WorkspaceMode) ? value as WorkspaceMode : null;
}

export function parseLastEventId(value: string | null) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

async function getEventScope({
  mode,
  teamId,
  userId,
}: {
  mode: WorkspaceMode;
  teamId: string | null;
  userId: string;
}): Promise<EventSubscriptionScope> {
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

  return { mode, workspaceId: workspace.id, teamId, userId };
}

function streamEvents({
  request,
  scope,
  lastEventId,
}: {
  request: Request;
  scope: EventSubscriptionScope;
  lastEventId: number;
}) {
  let cursor = lastEventId;
  let closed = false;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        closed = true;
        if (pollTimer) clearTimeout(pollTimer);
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        try {
          controller.close();
        } catch {
          // The stream may already be closed by the runtime.
        }
      };

      const poll = async () => {
        if (closed) return;
        try {
          const events = await listEvents(scope, cursor);
          for (const event of events) {
            cursor = Math.max(cursor, event.id);
            controller.enqueue(encoder.encode(sseEncode("mutation", event.id, event)));
          }
        } catch (error) {
          controller.enqueue(encoder.encode(sseEncode("stream-error", undefined, {
            message: error instanceof Error ? error.message : "Could not read mutation events.",
          })));
        } finally {
          if (!closed) pollTimer = setTimeout(poll, pollIntervalMs);
        }
      };

      controller.enqueue(encoder.encode(`: connected ${Date.now()}\n\n`));
      heartbeatTimer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: keepalive ${Date.now()}\n\n`));
        } catch {
          close();
        }
      }, heartbeatIntervalMs);
      request.signal.addEventListener("abort", close, { once: true });
      void poll();
    },
    cancel() {
      closed = true;
      if (pollTimer) clearTimeout(pollTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

async function listEvents(scope: EventSubscriptionScope, lastEventId: number) {
  const result = await env.DB.prepare(
    `SELECT id,
            workspace_id as workspaceId,
            team_id as teamId,
            project_id as projectId,
            chat_id as chatId,
            mode,
            entity,
            entity_id as entityId,
            operation,
            invalidates_json as invalidatesJson,
            source_user_id as sourceUserId,
            source_client_id as sourceClientId,
            created_at as createdAt
     FROM events
     WHERE id > ?
       AND workspace_id = ?
       AND (
         (? = 'Team' AND (team_id = ? OR team_id IS NULL))
         OR (? = 'Personal' AND source_user_id = ?)
         OR (? = 'Org')
       )
     ORDER BY id ASC
     LIMIT 50`,
  )
    .bind(lastEventId, scope.workspaceId, scope.mode, scope.teamId, scope.mode, scope.userId, scope.mode)
    .all<{
      id: number;
      workspaceId: string;
      teamId: string | null;
      projectId: string | null;
      chatId: string | null;
      mode: WorkspaceMode;
      entity: string;
      entityId: string;
      operation: string;
      invalidatesJson: string;
      sourceUserId: string;
      sourceClientId: string | null;
      createdAt: number;
    }>();

  return (result.results ?? []).map(parseRealtimeEventRow);
}

export function sseEncode(event: string, id: number | undefined, data: unknown) {
  const idLine = id === undefined ? "" : `id: ${id}\n`;
  return `${idLine}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export const Route = createFileRoute("/api/events")({
  server: {
    handlers: {
      GET: handleEvents,
    },
  },
});
