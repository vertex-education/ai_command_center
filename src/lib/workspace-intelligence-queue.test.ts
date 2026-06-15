import { describe, expect, it } from "vitest";
import { normalizeExtractedTasks, parseStrictJsonArray } from "@/lib/workspace-intelligence-queue";
import { isWorkspaceIntelligenceJob, type WorkspaceIntelligenceJob } from "@/lib/workspace-intelligence-types";

const taskJob: WorkspaceIntelligenceJob = {
  kind: "workspace-task-extraction",
  projectId: "project-1",
  prompt: "Please follow up with finance by Friday.",
  requestId: "wi-1",
  requestedAt: 123,
  sourceMessageId: "msg-1",
  teamId: "team-1",
  userId: "user-1",
  workspaceId: "ws-team",
};

describe("workspace intelligence queue", () => {
  it("validates supported queue job shapes", () => {
    expect(isWorkspaceIntelligenceJob(taskJob)).toBe(true);
    expect(
      isWorkspaceIntelligenceJob({
        kind: "workspace-idea-evaluation",
        ideaId: "idea-1",
        ideaText: "Add SSO audit automation",
        projectId: "project-1",
        requestId: "wi-2",
        requestedAt: 456,
        userId: null,
        workspaceId: "ws-team",
      }),
    ).toBe(true);
    expect(isWorkspaceIntelligenceJob({ ...taskJob, requestedAt: "now" })).toBe(false);
  });

  it("requires strict JSON arrays and rejects object payloads", () => {
    expect(parseStrictJsonArray('[{"task_description":"Do the thing","confidence_score":0.9}]')).toHaveLength(1);
    expect(() => parseStrictJsonArray('{"task_description":"not an array"}')).toThrow("Expected a strict JSON array.");
  });

  it("normalizes extracted task rows conservatively", () => {
    expect(
      normalizeExtractedTasks(
        JSON.stringify([
          { task_description: "  Follow up   with finance. ", confidence_score: 1.2 },
          { taskDescription: "Draft rollout plan", confidenceScore: "0.7" },
          { task_description: "", confidence_score: 0.4 },
        ]),
      ),
    ).toEqual([
      { taskDescription: "Follow up with finance.", confidenceScore: 1 },
      { taskDescription: "Draft rollout plan", confidenceScore: 0.7 },
    ]);
  });
});
