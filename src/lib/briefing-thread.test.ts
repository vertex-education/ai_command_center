import { describe, expect, it } from "vitest";
import {
  assertMutableChatThread,
  briefingsChatIdForProject,
  isAutomatedBriefingsChat,
  isReservedBriefingsTitle,
  weeklyBriefingsChatDescription,
} from "@/lib/briefing-thread";

describe("briefing thread helpers", () => {
  it("reserves the exact Briefings project thread title", () => {
    expect(isReservedBriefingsTitle("Briefings")).toBe(true);
    expect(isReservedBriefingsTitle("Executive Briefings")).toBe(false);
  });

  it("detects scheduler-owned briefing threads by id or read-only description", () => {
    expect(isAutomatedBriefingsChat({ id: briefingsChatIdForProject("project-1"), title: "Anything", description: "" })).toBe(true);
    expect(isAutomatedBriefingsChat({ id: "chat-1", title: "Briefings", description: weeklyBriefingsChatDescription })).toBe(true);
    expect(
      isAutomatedBriefingsChat({ id: "org-briefings", title: "Executive Briefings", description: "Leadership-ready summaries." }),
    ).toBe(false);
  });

  it("throws a clear read-only error for automated briefing threads", () => {
    expect(() =>
      assertMutableChatThread({
        id: briefingsChatIdForProject("project-1"),
        title: "Briefings",
        description: weeklyBriefingsChatDescription,
      }),
    ).toThrow(/read-only/i);
  });
});
