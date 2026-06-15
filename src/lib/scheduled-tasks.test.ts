import { describe, expect, it } from "vitest";
import { getNextScheduledTaskRunAt, isScheduledTaskType } from "@/lib/scheduled-tasks";

describe("scheduled task engine helpers", () => {
  it("recognizes supported scheduled task types", () => {
    expect(isScheduledTaskType("Weekly Briefing")).toBe(true);
    expect(isScheduledTaskType("Background Research")).toBe(true);
    expect(isScheduledTaskType("Artifact Validation")).toBe(true);
    expect(isScheduledTaskType("Daily Briefing")).toBe(false);
  });

  it("advances recurring task runs past the current scheduled tick", () => {
    const nextRunAt = getNextScheduledTaskRunAt(
      {
        intervalMinutes: 60,
        nextRunAt: Date.parse("2026-01-01T00:00:00.000Z"),
        type: "Artifact Validation",
      },
      new Date("2026-01-01T03:30:00.000Z"),
    );

    expect(nextRunAt).toBe(Date.parse("2026-01-01T04:00:00.000Z"));
  });

  it("defaults weekly briefing tasks to a weekly recurrence", () => {
    const nextRunAt = getNextScheduledTaskRunAt(
      {
        intervalMinutes: null,
        nextRunAt: Date.parse("2026-01-01T00:00:00.000Z"),
        type: "Weekly Briefing",
      },
      new Date("2026-01-02T00:00:00.000Z"),
    );

    expect(nextRunAt).toBe(Date.parse("2026-01-08T00:00:00.000Z"));
  });

  it("treats non-recurring non-weekly tasks as one-time executions", () => {
    const nextRunAt = getNextScheduledTaskRunAt(
      {
        intervalMinutes: null,
        nextRunAt: Date.parse("2026-01-01T00:00:00.000Z"),
        type: "Background Research",
      },
      new Date("2026-01-02T00:00:00.000Z"),
    );

    expect(nextRunAt).toBeNull();
  });
});
