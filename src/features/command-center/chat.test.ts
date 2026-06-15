import { describe, expect, it } from "vitest";
import { normalizeChatPlainText, scopedRagStreamUrl } from "./chat";

describe("chat text rendering", () => {
  it("normalizes bare LaTeX arrow commands in plain text messages", () => {
    expect(
      normalizeChatPlainText(
        "Status Progress Tracker: Uploaded \u2192 \\rightarrow \u2192 Validated \u2192 \\rightarrow \u2192 Internal Review \u2192 \\rightarrow \u2192 Approved",
      ),
    ).toBe("Status Progress Tracker: Uploaded \u2192 Validated \u2192 Internal Review \u2192 Approved");
    expect(
      normalizeChatPlainText(
        'Status Progress Tracker: A visual "stepper" (like a pizza tracker) for every batch: Uploaded \u2192 \\rightarrow \u2192 Validated \u2192 \\rightarrow \u2192 Internal Review \u2192 \\rightarrow \u2192 Approved \u2192 \\rightarrow \u2192 Synced to Asana . ',
      ),
    ).toBe(
      'Status Progress Tracker: A visual "stepper" (like a pizza tracker) for every batch: Uploaded \u2192 Validated \u2192 Internal Review \u2192 Approved \u2192 Synced to Asana . ',
    );
  });

  it("omits projectId from workspace-scoped stream URLs", () => {
    const url = scopedRagStreamUrl({
      asanaSearchEnabled: false,
      chatId: "chat-1",
      projectId: null,
      prompt: "hello",
      reasoningLevel: "low",
      teamId: "team-1",
      webSearchEnabled: false,
      workspaceId: "ws-team",
    });

    expect(url).toContain("stream=scoped-rag");
    expect(url).not.toContain("projectId=");
  });
});
