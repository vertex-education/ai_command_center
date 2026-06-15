import { describe, expect, it } from "vitest";
import {
  buildAsanaNotesForWorkflowTask,
  buildAttachmentPromptContext,
  buildReasoningInstruction,
  buildWebSearchPromptContext,
  boundedScore,
  chatReasoningProfiles,
  chatSafeAiErrorMessage,
  conciseChatTitleFromRequest,
  cycleApprovalStatus,
  cycleDecisionStatus,
  cycleTaskStatus,
  extractJsonObject,
  getConversationKey,
  initials,
  normalizeGeneratedChatTitle,
  normalizeReasoningLevel,
  parseChatAttachments,
  sanitizeChatAttachments,
  titleMatchesTask,
  truncateAttachmentContext,
  workspaceModeLabel,
  type ChatAttachment,
  type Task,
} from "@/lib/pmo-data";

const attachment: ChatAttachment = {
  id: "",
  name: "Source Notes.txt",
  extension: "txt",
  mimeType: "text/plain",
  size: 120,
  extractedText: "Important evidence.",
  status: "ready",
};

describe("PMO workspace data helpers", () => {
  it("builds stable conversation keys and labels by workspace mode", () => {
    expect(getConversationKey("Team", "project-1", "chat-1")).toBe("team::project-1::chat-1");
    expect(getConversationKey("Personal", null, "chat-1")).toBe("personal::unassigned::chat-1");
    expect(workspaceModeLabel("Org")).toBe("Org");
  });

  it("generates initials and concise chat titles from user text", () => {
    expect(initials("Maya Chen")).toBe("MC");
    expect(conciseChatTitleFromRequest("Can you create a RAID summary for Vertex Hub this week?")).toBe("RAID summary Vertex Hub");
    expect(conciseChatTitleFromRequest("I need help building a very detailed launch readiness checklist for tomorrow")).toBe(
      "Launch readiness checklist",
    );
    expect(normalizeGeneratedChatTitle("Title: launch readiness review.", "Fallback")).toBe("Launch readiness review");
    expect(normalizeGeneratedChatTitle("Create a detailed project governance and status reporting plan", "Fallback")).toBe(
      "Project governance status reporting",
    );
    expect(normalizeGeneratedChatTitle("  ", "Fallback title")).toBe("Fallback title");
  });

  it("normalizes reasoning level aliases and exposes matching instruction profiles", () => {
    expect(normalizeReasoningLevel("quick")).toBe("low");
    expect(normalizeReasoningLevel("deep")).toBe("medium");
    expect(normalizeReasoningLevel("max")).toBe("high");
    expect(normalizeReasoningLevel("unknown")).toBe("low");
    expect(chatReasoningProfiles.high.thinkingEnabled).toBe(true);
    expect(buildReasoningInstruction("low")).toContain("Thinking mode is off");
    expect(buildReasoningInstruction("high")).toContain("exhaustive");
  });

  it("sanitizes and parses persisted chat attachments", () => {
    const sanitized = sanitizeChatAttachments([
      {
        ...attachment,
        name: "a".repeat(200),
        mimeType: "text/plain".repeat(30),
        extractedText: "x".repeat(21_000),
        error: "e".repeat(300),
      },
      { ...attachment, name: "" },
    ]);

    expect(sanitized).toHaveLength(1);
    expect(sanitized[0].name).toHaveLength(180);
    expect(sanitized[0].mimeType).toHaveLength(120);
    expect(sanitized[0].extractedText).toContain("[Attachment text truncated for Gemma context.]");
    expect(sanitized[0].error).toHaveLength(240);

    expect(parseChatAttachments(JSON.stringify([attachment]))).toMatchObject([{ name: "Source Notes.txt" }]);
    expect(parseChatAttachments("not-json")).toBeUndefined();
  });

  it("builds attachment and web search prompt context conservatively", () => {
    expect(truncateAttachmentContext(" A  lot\r\nof   spacing ", 100)).toBe("A lot\nof spacing");
    expect(buildAttachmentPromptContext([attachment])).toContain("[Attachment 1] Source Notes.txt");
    expect(buildAttachmentPromptContext([{ ...attachment, status: "error", extractedText: "" }])).toBeNull();

    expect(
      buildWebSearchPromptContext({
        enabled: false,
        query: "ignored",
        provider: "none",
        results: [],
      }),
    ).toBeNull();
    expect(
      buildWebSearchPromptContext({
        enabled: true,
        query: "Vertex Education",
        provider: "Tavily + Firecrawl",
        results: [],
        error: "No provider configured.",
      }),
    ).toContain("No usable web results were available");
  });

  it("cycles workflow statuses in the UI order", () => {
    expect(cycleDecisionStatus("Not Completed")).toBe("Completed");
    expect(cycleDecisionStatus("Completed")).toBe("Not Completed");
    expect(cycleApprovalStatus("Not Reviewed")).toBe("Reviewing");
    expect(cycleApprovalStatus("Reviewing")).toBe("Approved");
    expect(cycleApprovalStatus("Approved")).toBe("Not Approved");
    expect(cycleApprovalStatus("Not Approved")).toBe("Not Reviewed");
    expect(cycleTaskStatus("Open")).toBe("Completed");
    expect(cycleTaskStatus("Completed")).toBe("Open");
  });

  it("builds Asana task notes from workflow task context", () => {
    const task: Task = {
      id: "task-1",
      projectId: "project-1",
      title: "Follow up with ops",
      originalText: "Ops needs follow-up.",
      owner: "Maya",
      source: "Chat",
      status: "Open",
    };

    expect(titleMatchesTask("Follow up with ops", "Follow-up with ops")).toBe(true);
    expect(buildAsanaNotesForWorkflowTask(task)).toBe(
      ["Original text: Ops needs follow-up.", "Owner: Maya", "Source: Chat", "Created from VertexAI."].join("\n"),
    );
  });

  it("bounds idea scores and extracts JSON objects from model output", () => {
    expect(boundedScore("105", 50)).toBe(100);
    expect(boundedScore("-10", 50)).toBe(0);
    expect(boundedScore("bad", 50)).toBe(50);
    expect(extractJsonObject('```json\n{"impact":80}\n```')).toEqual({ impact: 80 });
    expect(extractJsonObject("not-json")).toBeNull();
  });

  it("scrubs HTML timeout errors before showing chat users", () => {
    expect(chatSafeAiErrorMessage(new Error("<html>504 Gateway Time-out</html>"))).toBe(
      "Workers AI gateway timed out before returning a response.",
    );
    expect(chatSafeAiErrorMessage(new Error("  Service   unavailable  "))).toBe("Service unavailable");
  });
});
