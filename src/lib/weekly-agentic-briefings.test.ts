import { describe, expect, it } from "vitest";
import { formatBriefingSourceContext, shouldRunWeeklyAgenticBriefing, weeklyAgenticBriefingCron } from "@/lib/weekly-agentic-briefings";

describe("weekly agentic briefings", () => {
  it("runs only for the configured weekly cron", () => {
    expect(shouldRunWeeklyAgenticBriefing(weeklyAgenticBriefingCron)).toBe(true);
    expect(shouldRunWeeklyAgenticBriefing("0 * * * *")).toBe(false);
    expect(shouldRunWeeklyAgenticBriefing(undefined)).toBe(false);
  });

  it("formats source context as bounded XML-safe evidence", () => {
    const context = formatBriefingSourceContext({
      actions: [{ title: "Approve <launch>" }],
      chatMessages: [{ body: "Use only real updates." }],
      ideas: [{ title: "Improve reporting" }],
      webContext: "External <context>",
      windowEnd: "2026-06-15T12:00:00.000Z",
      windowStart: "2026-06-08T12:00:00.000Z",
      workspace: { id: "ws-team", name: "Team & Ops" },
    });

    expect(context).toContain('<workspace id="ws-team" name="Team &amp; Ops" />');
    expect(context).toContain("Approve &lt;launch&gt;");
    expect(context).toContain("External &lt;context&gt;");
  });
});
