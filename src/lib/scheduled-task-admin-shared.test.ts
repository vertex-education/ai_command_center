import { describe, expect, it } from "vitest";
import {
  formatScheduledTaskInterval,
  isScheduledTaskAdminType,
  parseScheduledTaskJson,
  summarizeScheduledTaskAdminRows,
  toScheduledTaskAdminRow,
  type ScheduledTaskAdminDbRow,
} from "@/lib/scheduled-task-admin-shared";

const baseRow: ScheduledTaskAdminDbRow = {
  id: "system-artifact-validation",
  organizationId: null,
  workspaceId: null,
  type: "Artifact Validation",
  status: "pending",
  enabled: 1,
  priority: 25,
  payloadJson: '{"staleAfterHours":24}',
  scheduleJson: '{"cadence":"hourly"}',
  nextRunAt: Date.parse("2026-01-01T00:00:00.000Z"),
  intervalMinutes: 60,
  retryDelayMinutes: 15,
  attemptCount: 0,
  maxAttempts: 3,
  lockedAt: null,
  lastRunAt: null,
  lastCompletedAt: null,
  lastError: null,
  resultJson: null,
  createdAt: Date.parse("2026-01-01T00:00:00.000Z"),
  updatedAt: Date.parse("2026-01-01T00:00:00.000Z"),
};

describe("scheduled task admin shared helpers", () => {
  it("recognizes supported scheduled task types", () => {
    expect(isScheduledTaskAdminType("Weekly Briefing")).toBe(true);
    expect(isScheduledTaskAdminType("Background Research")).toBe(true);
    expect(isScheduledTaskAdminType("Artifact Validation")).toBe(true);
    expect(isScheduledTaskAdminType("Daily Briefing")).toBe(false);
  });

  it("parses JSON object fields defensively", () => {
    expect(parseScheduledTaskJson('{"cadence":"hourly"}')).toEqual({ cadence: "hourly" });
    expect(parseScheduledTaskJson("[1,2,3]")).toEqual({});
    expect(parseScheduledTaskJson("not json")).toEqual({});
  });

  it("formats common task intervals", () => {
    expect(formatScheduledTaskInterval(null)).toBe("One-time");
    expect(formatScheduledTaskInterval(60)).toBe("Every 1 hour");
    expect(formatScheduledTaskInterval(1_440)).toBe("Every 1 day");
    expect(formatScheduledTaskInterval(10_080)).toBe("Every 1 week");
  });

  it("normalizes a due pending row for the admin settings page", () => {
    const row = toScheduledTaskAdminRow(baseRow, Date.parse("2026-01-01T01:00:00.000Z"));

    expect(row.type).toBe("Artifact Validation");
    expect(row.status).toBe("pending");
    expect(row.enabled).toBe(true);
    expect(row.isDue).toBe(true);
    expect(row.health).toBe("due");
    expect(row.payload).toEqual({ staleAfterHours: 24 });
  });

  it("summarizes task states for admin metric cards", () => {
    const now = Date.parse("2026-01-01T01:00:00.000Z");
    const rows = [
      toScheduledTaskAdminRow(baseRow, now),
      toScheduledTaskAdminRow({ ...baseRow, id: "running-task", status: "running", nextRunAt: now + 60_000 }, now),
      toScheduledTaskAdminRow({ ...baseRow, id: "failed-task", status: "failed", nextRunAt: now + 60_000 }, now),
      toScheduledTaskAdminRow({ ...baseRow, id: "disabled-task", enabled: 0, status: "paused", nextRunAt: now + 60_000 }, now),
    ];

    expect(summarizeScheduledTaskAdminRows(rows)).toMatchObject({
      total: 4,
      enabled: 3,
      due: 1,
      running: 1,
      failed: 1,
      paused: 1,
    });
  });
});
