import { describe, expect, it } from "vitest";
import {
  AsanaApiError,
  buildAsanaCreateTaskPayload,
  isAsanaTaskSyncJob,
  isRetriableAsanaTaskSyncError,
  type AsanaTaskSyncJob,
} from "@/lib/asana-task-sync-queue";

const job: AsanaTaskSyncJob = {
  kind: "asana-task-create",
  mode: "Team",
  notes: "Original text: Confirm launch readiness",
  projectId: "project-1",
  requestId: "asana-sync-1",
  requestedAt: 123,
  sourceClientId: "client-1",
  taskId: "task-1",
  teamId: "team-1",
  title: "Confirm launch readiness",
  userId: "user-1",
  workspaceId: "ws-team",
};

describe("Asana task sync queue", () => {
  it("accepts the formatted Asana task sync queue payload", () => {
    expect(isAsanaTaskSyncJob(job)).toBe(true);
    expect(isAsanaTaskSyncJob({ ...job, kind: "microsoft-graph-change-notification" })).toBe(false);
    expect(isAsanaTaskSyncJob({ ...job, mode: "Invalid" })).toBe(false);
  });

  it("builds project-scoped Asana create task JSON", () => {
    expect(
      buildAsanaCreateTaskPayload({
        asanaProjectGid: "120",
        notes: "Created from VertexAI.",
        title: " Follow up with operations ",
      }),
    ).toEqual({
      name: "Follow up with operations",
      notes: "Created from VertexAI.",
      projects: ["120"],
    });
  });

  it("builds workspace-scoped Asana create task JSON", () => {
    expect(
      buildAsanaCreateTaskPayload({
        assigneeGid: "user-1",
        title: "General follow-up",
        workspaceGid: "workspace-1",
      }),
    ).toEqual({
      name: "General follow-up",
      workspace: "workspace-1",
      assignee: "user-1",
    });
  });

  it("retries only transient Asana API failures", () => {
    expect(isRetriableAsanaTaskSyncError(new AsanaApiError("Rate limited", 429))).toBe(true);
    expect(isRetriableAsanaTaskSyncError(new AsanaApiError("Unavailable", 503))).toBe(true);
    expect(isRetriableAsanaTaskSyncError(new AsanaApiError("Bad request", 400))).toBe(false);
    expect(isRetriableAsanaTaskSyncError(new Error("Reconnect Asana"))).toBe(false);
  });
});
