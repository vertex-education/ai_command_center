import { describe, expect, it } from "vitest";
import { parseRealtimeEventRow } from "@/lib/realtime-events";

describe("realtime mutation events", () => {
  const baseRow = {
    id: 42,
    workspaceId: "ws-team",
    teamId: "team-1",
    projectId: "project-1",
    chatId: "chat-1",
    mode: "Team" as const,
    entity: "task",
    entityId: "task-1",
    operation: "update",
    sourceUserId: "user-1",
    sourceClientId: "client-1",
    createdAt: 1_787_000_000_000,
  };

  it("parses mutation rows into client event objects", () => {
    expect(parseRealtimeEventRow({
      ...baseRow,
      invalidatesJson: JSON.stringify(["workspace", "projects", "not-real", "chats"]),
    })).toEqual({
      ...baseRow,
      type: "mutation",
      invalidates: ["workspace", "projects", "chats"],
    });
  });

  it("falls back to workspace invalidation for malformed invalidation JSON", () => {
    expect(parseRealtimeEventRow({
      ...baseRow,
      invalidatesJson: "not json",
    }).invalidates).toEqual(["workspace"]);
  });

  it("allows empty invalidation lists when explicitly stored", () => {
    expect(parseRealtimeEventRow({
      ...baseRow,
      invalidatesJson: JSON.stringify([]),
    }).invalidates).toEqual([]);
  });
});
