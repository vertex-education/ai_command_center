import { DurableObject } from "cloudflare:workers";
import type { ChatMessage, WorkspaceMode } from "@/lib/pmo-data";

export type ChatMessageInsertEvent = {
  id: string;
  chatId: string;
  workspaceId: string;
  projectId: string | null;
  mode: WorkspaceMode;
  message: ChatMessage;
};

export type WorkspacePresenceUser = {
  id: string;
  name: string;
  email: string;
};

export type ChatSyncConnectionPayload = {
  chatIds: string[];
  user: WorkspacePresenceUser;
};

type ChatSyncConnection = {
  id: string;
  chatIds: Set<string>;
  controller: ReadableStreamDefaultController<Uint8Array>;
  user: WorkspacePresenceUser;
};

export class ChatSyncDurableObject extends DurableObject<Env> {
  private readonly encoder = new TextEncoder();
  private readonly connections = new Map<string, ChatSyncConnection>();

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/connect") {
      return this.connectStream(request);
    }
    if (request.method === "POST" && url.pathname === "/publish") {
      return this.publish(request);
    }
    return new Response("Not found", { status: 404 });
  }

  private async connectStream(request: Request) {
    const payload = await request.json<ChatSyncConnectionPayload>();
    const connectionId = crypto.randomUUID();
    let heartbeat: ReturnType<typeof setInterval> | null = null;

    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.connections.set(connectionId, {
          id: connectionId,
          chatIds: new Set(payload.chatIds),
          controller,
          user: payload.user,
        });
        this.send(controller, "ready", { chatCount: payload.chatIds.length });
        this.broadcastPresence();
        heartbeat = setInterval(() => this.send(controller, "heartbeat", { at: Date.now() }), 25_000);
        request.signal.addEventListener("abort", () => {
          if (heartbeat) clearInterval(heartbeat);
          this.removeConnection(connectionId);
        }, { once: true });
      },
      cancel: () => {
        if (heartbeat) clearInterval(heartbeat);
        this.removeConnection(connectionId);
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }

  private async publish(request: Request) {
    const events = await request.json<ChatMessageInsertEvent[]>();
    for (const event of events) {
      for (const connection of this.connections.values()) {
        if (!connection.chatIds.has(event.chatId)) continue;
        this.send(connection.controller, "chat-message", event);
      }
    }
    return Response.json({ delivered: true });
  }

  private removeConnection(connectionId: string) {
    const removed = this.connections.delete(connectionId);
    if (removed) this.broadcastPresence();
  }

  private broadcastPresence() {
    const usersById = new Map<string, WorkspacePresenceUser>();
    for (const connection of this.connections.values()) {
      usersById.set(connection.user.id, connection.user);
    }

    const users = [...usersById.values()].sort((a, b) => a.name.localeCompare(b.name));
    for (const connection of this.connections.values()) {
      this.send(connection.controller, "presence", users);
    }
  }

  private send(controller: ReadableStreamDefaultController<Uint8Array>, event: string, data: unknown) {
    try {
      controller.enqueue(this.encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
    } catch {
      // The stream can close between a disconnect and a broadcast.
    }
  }
}

export async function publishChatMessageInserts(
  namespace: DurableObjectNamespace | undefined,
  scopeKey: string,
  events: ChatMessageInsertEvent[],
) {
  if (!namespace || events.length === 0) return;
  const stub = namespace.getByName(scopeKey);
  const response = await stub.fetch("https://chat-sync.local/publish", {
    method: "POST",
    body: JSON.stringify(events),
    headers: { "Content-Type": "application/json" },
  });
  if (!response.ok) {
    console.warn(`Chat sync publish failed with status ${response.status}.`);
  }
}
