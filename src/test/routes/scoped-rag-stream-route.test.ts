import { describe, expect, it } from "vitest";
import { createScopedRagErrorResponse, normalizeReasoningLevel, parseScopedRagStreamInput } from "@/routes/api/scoped-rag-stream";

async function responseText(response: Response) {
  return await response.text();
}

describe("scoped RAG stream route helpers", () => {
  it("parses the URL query contract into scoped RAG input", () => {
    const input = parseScopedRagStreamInput(
      new Request(
        "https://app.test/api/scoped-rag-stream?prompt=hello&teamId=team-1&workspaceId=ws-team&projectId=project-1&chatId=chat-1&asanaSearchEnabled=1&webSearchEnabled=1&reasoningLevel=high",
      ),
    );

    expect(input).toEqual({
      prompt: "hello",
      teamId: "team-1",
      workspaceId: "ws-team",
      projectId: "project-1",
      chatId: "chat-1",
      userMessageId: null,
      assistantMessageId: null,
      asanaSearchEnabled: true,
      webSearchEnabled: true,
      reasoningLevel: "high",
    });
  });

  it("parses missing project ids as workspace-scoped chat input", () => {
    const input = parseScopedRagStreamInput(
      new Request("https://app.test/api/scoped-rag-stream?prompt=hello&teamId=team-1&workspaceId=ws-team&chatId=chat-1"),
    );

    expect(input.projectId).toBeNull();
    expect(input.userMessageId).toBeNull();
    expect(input.asanaSearchEnabled).toBe(false);
  });

  it("normalizes unsupported reasoning levels to low", () => {
    expect(normalizeReasoningLevel("medium")).toBe("medium");
    expect(normalizeReasoningLevel("high")).toBe("high");
    expect(normalizeReasoningLevel("deep")).toBe("low");
    expect(normalizeReasoningLevel(null)).toBe("low");
  });

  it("returns stream-error events as SSE with no-cache headers", async () => {
    const response = createScopedRagErrorResponse("Project ID is required.");

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("no-cache, no-transform");
    expect(await responseText(response)).toBe('event: stream-error\ndata: {"message":"Project ID is required."}\n\n');
  });
});
