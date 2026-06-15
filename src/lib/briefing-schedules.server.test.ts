import { describe, expect, it } from "vitest";
import { computeNextRunAtFromInput } from "@/lib/briefing-schedules.server";
import type { BriefingScheduleInput } from "@/lib/briefing-schedules";

const baseInput: BriefingScheduleInput = {
  chatId: null,
  enabled: true,
  localTime: "08:00",
  monthDay: null,
  newChatTitle: null,
  projectId: "project-1",
  promptInstructions: "",
  recurrence: "weekdays",
  reportingWindowHours: 168,
  runOnceAt: null,
  timeZone: "America/New_York",
  title: "Morning status",
  weekdays: [1, 3],
};

describe("briefing schedule next-run calculation", () => {
  it("returns null for disabled schedules", () => {
    expect(computeNextRunAtFromInput({ ...baseInput, enabled: false }, new Date("2026-06-15T10:00:00.000Z"))).toBeNull();
  });

  it("uses future one-time run dates only", () => {
    expect(
      computeNextRunAtFromInput(
        {
          ...baseInput,
          recurrence: "once",
          runOnceAt: "2026-06-16T14:00:00.000Z",
        },
        new Date("2026-06-15T10:00:00.000Z"),
      )?.toISOString(),
    ).toBe("2026-06-16T14:00:00.000Z");

    expect(
      computeNextRunAtFromInput(
        {
          ...baseInput,
          recurrence: "once",
          runOnceAt: "2026-06-14T14:00:00.000Z",
        },
        new Date("2026-06-15T10:00:00.000Z"),
      ),
    ).toBeNull();
  });

  it("schedules weekday runs in the configured time zone", () => {
    const next = computeNextRunAtFromInput(
      {
        ...baseInput,
        recurrence: "weekdays",
        localTime: "08:00",
      },
      new Date("2026-06-12T20:00:00.000Z"),
    );

    expect(next?.toISOString()).toBe("2026-06-15T12:00:00.000Z");
  });

  it("uses selected weekdays for weekly schedules", () => {
    const next = computeNextRunAtFromInput(
      {
        ...baseInput,
        recurrence: "weekly",
        weekdays: [3],
        localTime: "09:30",
      },
      new Date("2026-06-15T16:00:00.000Z"),
    );

    expect(next?.toISOString()).toBe("2026-06-17T13:30:00.000Z");
  });

  it("clamps monthly schedules to the last day of shorter months", () => {
    const next = computeNextRunAtFromInput(
      {
        ...baseInput,
        recurrence: "monthly",
        monthDay: 31,
        localTime: "08:00",
      },
      new Date("2026-04-30T14:00:00.000Z"),
    );

    expect(next?.toISOString()).toBe("2026-05-31T12:00:00.000Z");
  });

  it("normalizes invalid recurrence and local time input to safe weekly defaults", () => {
    const next = computeNextRunAtFromInput(
      {
        ...baseInput,
        recurrence: "never" as BriefingScheduleInput["recurrence"],
        localTime: "bad",
        weekdays: [],
      },
      new Date("2026-06-12T20:00:00.000Z"),
    );

    expect(next?.toISOString()).toBe("2026-06-19T12:00:00.000Z");
  });
});
