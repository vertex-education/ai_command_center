import { describe, expect, it } from "vitest";
import {
  buildAsanaChatMessage,
  chatSyncScopeKey,
  extractEventStatus,
  extractProjectGids,
  extractProjectNames,
  extractTaskGids,
  formatAsanaEventLine,
  getSignatureHeader,
  hexToBytes,
  mapAsanaWebhookTaskStatusToWorkflowStatus,
  modeForScope,
  normalizeSignature,
  normalizeTaskStateEvent,
  parseProjectMap,
  resolveWebhookScope,
  uniqueStrings,
  verifyAsanaSignature,
  webhookSecretKey,
  type AsanaWebhookEvent,
} from "@/lib/asana-webhook";

async function hmacSignature(secret: string, body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const taskEvent: AsanaWebhookEvent = {
  action: "changed",
  change: {
    action: "changed",
    field: "completed",
    new_value: true,
  },
  parent: {
    gid: "project-1",
    name: "Vertex Hub",
    resource_type: "project",
  },
  resource: {
    gid: "task-1",
    name: "Prepare rollout plan",
    resource_type: "task",
  },
  user: {
    gid: "user-1",
    name: "Maya Chen",
    resource_type: "user",
  },
};

describe("Asana webhook utilities", () => {
  it("builds stable secret scope keys from webhook query parameters", () => {
    const request = new Request("https://app.test/api/webhooks/asana?asanaWorkspaceGid=workspace-1&asanaProjectGid=project-1");

    expect(resolveWebhookScope(request)).toEqual({
      workspaceKey: "workspace-1",
      secretKey: "workspace-1:project-1",
    });
    expect(webhookSecretKey("workspace-1:project-1")).toBe("asana:webhook-secret:workspace-1:project-1");
  });

  it("reads either supported Asana signature header", () => {
    expect(getSignatureHeader(new Headers({ "X-Hook-Signature": "abc" }))).toBe("abc");
    expect(getSignatureHeader(new Headers({ "X-Asana-Request-Signature": "def" }))).toBe("def");
    expect(getSignatureHeader(new Headers())).toBeNull();
  });

  it("normalizes and decodes signatures safely", () => {
    expect(normalizeSignature(" sha256=ABCD ")).toBe("abcd");
    expect(hexToBytes("0a10ff")).toEqual(new Uint8Array([10, 16, 255]));
    expect(hexToBytes("xyz")).toBeNull();
    expect(hexToBytes("abc")).toBeNull();
  });

  it("validates Asana HMAC signatures over the raw request body", async () => {
    const body = JSON.stringify({ events: [taskEvent] });
    const signature = await hmacSignature("secret-value", body);

    await expect(
      verifyAsanaSignature({
        rawBody: new TextEncoder().encode(body).buffer,
        secret: "secret-value",
        signature,
      }),
    ).resolves.toBe(true);

    await expect(
      verifyAsanaSignature({
        rawBody: new TextEncoder().encode(body).buffer,
        secret: "wrong-secret",
        signature,
      }),
    ).resolves.toBe(false);
  });

  it("normalizes task-state events and extracts status changes", () => {
    expect(extractEventStatus(taskEvent)).toBe("completed");
    expect(mapAsanaWebhookTaskStatusToWorkflowStatus("completed")).toBe("Completed");
    expect(mapAsanaWebhookTaskStatusToWorkflowStatus("incomplete")).toBe("Open");
    expect(mapAsanaWebhookTaskStatusToWorkflowStatus("custom")).toBeNull();
    expect(normalizeTaskStateEvent("workspace-1", taskEvent)).toMatchObject({
      asanaTaskGid: "task-1",
      asanaWorkspaceGid: "workspace-1",
      asanaProjectGid: "project-1",
      taskName: "Prepare rollout plan",
      action: "changed",
      changeField: "completed",
      status: "completed",
    });
  });

  it("extracts unique task and project identifiers from event batches", () => {
    const projectEvent: AsanaWebhookEvent = {
      resource: { gid: "project-1", name: "Vertex Hub", resource_type: "project" },
    };

    expect(uniqueStrings([" a ", "a", undefined, "b"])).toEqual(["a", "b"]);
    expect(extractTaskGids([taskEvent, taskEvent])).toEqual(["task-1"]);
    expect(extractProjectGids([taskEvent, projectEvent])).toEqual(["project-1"]);
    expect(extractProjectNames([taskEvent, projectEvent])).toEqual(["Vertex Hub"]);
  });

  it("parses optional project map JSON without guessing invalid values", () => {
    expect(
      parseProjectMap(
        JSON.stringify({
          "project-1": { projectId: "vertex-project-1", chatId: "chat-1", mode: "Team" },
          "task-2": "vertex-project-2",
        }),
      ),
    ).toEqual({
      "project-1": { projectId: "vertex-project-1", chatId: "chat-1", mode: "Team" },
      "task-2": "vertex-project-2",
    });
    expect(parseProjectMap("not-json")).toBeNull();
  });

  it("formats chat messages and realtime scope keys for delivered updates", () => {
    expect(formatAsanaEventLine(taskEvent)).toBe("- Prepare rollout plan: changed completed by Maya Chen.");
    expect(buildAsanaChatMessage([taskEvent])).toMatchObject({
      author: "Asana",
      role: "system",
    });
    expect(buildAsanaChatMessage([taskEvent]).text).toContain("Asana task update: Prepare rollout plan");

    expect(modeForScope("team")).toBe("Team");
    expect(modeForScope("org")).toBe("Org");
    expect(modeForScope("personal")).toBe("Personal");
    expect(chatSyncScopeKey({ mode: "Team", workspaceId: "ws-team", teamId: "team-1", userId: "user-1" })).toBe("ws-team:team:team-1");
    expect(chatSyncScopeKey({ mode: "Org", workspaceId: "ws-org", teamId: null, userId: "user-1" })).toBe("ws-org:org");
    expect(chatSyncScopeKey({ mode: "Personal", workspaceId: "ws-personal", teamId: null, userId: "user-1" })).toBe(
      "ws-personal:user:user-1",
    );
  });
});
