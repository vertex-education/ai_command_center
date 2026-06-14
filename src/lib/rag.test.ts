import { describe, expect, it } from "vitest";
import {
  applyContextBudgets,
  assertRequiredString,
  contentTypeFor,
  createR2Key,
  createTextSseResponse,
  firecrawlMarkdownFromPayload,
  normalizeSensitivityLabel,
  normalizeStreamReasoningLevel,
  safeFileName,
  tavilySummaryFromPayload,
  truncateForRagPrompt,
  type StreamContextBudget,
} from "@/lib/rag";

const budget: StreamContextBudget = {
  asanaMaxChars: 4_000,
  maxCompletionTokens: 1_200,
  maxContextTokens: 100,
  ragTopK: 4,
  softOverageMultiplier: 2,
  thinkingEnabled: false,
};

describe("scoped RAG utilities", () => {
  it("normalizes required strings, filenames, content types, and sensitivity labels", () => {
    expect(assertRequiredString(" project-1 ", "Project ID")).toBe("project-1");
    expect(() => assertRequiredString(" ", "Project ID")).toThrow("Project ID is required.");
    expect(safeFileName("../Folder/Launch Plan!.md")).toBe("Launch-Plan-.md");
    expect(contentTypeFor("summary.md")).toBe("text/markdown; charset=utf-8");
    expect(contentTypeFor("notes.txt")).toBe("text/plain; charset=utf-8");
    expect(contentTypeFor("page.html")).toBe("text/html; charset=utf-8");
    expect(contentTypeFor("file.pdf")).toBe("application/pdf");
    expect(contentTypeFor("archive.bin")).toBe("application/octet-stream");
    expect(normalizeSensitivityLabel(undefined, false)).toBe("Standard");
    expect(normalizeSensitivityLabel("Confidential", false)).toBe("Confidential");
    expect(normalizeSensitivityLabel("Standard", true)).toBe("Confidential");
  });

  it("builds scoped R2 keys with sanitized filenames", () => {
    expect(createR2Key("team-1", "project-1", "Launch Plan!.md")).toMatch(
      /^rag\/team-1\/project-1\/\d+-[0-9a-f-]+-Launch-Plan-\.md$/i,
    );
  });

  it("normalizes stream reasoning level and prompt truncation", () => {
    expect(normalizeStreamReasoningLevel("medium")).toBe("medium");
    expect(normalizeStreamReasoningLevel("high")).toBe("high");
    expect(normalizeStreamReasoningLevel("max")).toBe("low");
    expect(truncateForRagPrompt("  A   B   C  ", 10)).toBe("A B C");
    expect(truncateForRagPrompt("x".repeat(20), 8)).toBe("xxxxxxx...");
  });

  it("creates text SSE responses with citations, token, and done events", async () => {
    const response = createTextSseResponse("Hello", [{
      id: "chunk-1",
      documentName: "Plan",
      r2Key: "rag/key",
      score: 0.8,
    }]);

    expect(response.headers.get("Content-Type")).toBe("text/event-stream; charset=utf-8");
    const text = await response.text();
    expect(text).toContain("event: citations");
    expect(text).toContain('"documentName":"Plan"');
    expect(text).toContain('event: token\ndata: {"token":"Hello"}');
    expect(text).toContain('event: done\ndata: {"response":"Hello"');
  });

  it("blocks oversized context for low or medium reasoning", () => {
    const result = applyContextBudgets({
      asanaContext: null,
      budget,
      historicalContext: { context: "x".repeat(1_000), citations: [] },
      reasoningLevel: "low",
    });

    expect(result.blockedMessage).toContain("too much for low reasoning");
    expect(result.asanaContext).toBeNull();
  });

  it("trims context and emits a notice when it exceeds the soft budget", () => {
    const result = applyContextBudgets({
      asanaContext: "asana ".repeat(80),
      budget: { ...budget, softOverageMultiplier: 100 },
      historicalContext: { context: "history ".repeat(100), citations: [] },
      reasoningLevel: "high",
      webContext: "web ".repeat(80),
    });

    expect(result.blockedMessage).toBeNull();
    expect(result.notice).toContain("Context was trimmed");
    expect(result.historicalContext.context).toContain("[Context trimmed to fit the selected reasoning mode.]");
  });

  it("summarizes Tavily and Firecrawl payloads with safe fallbacks", () => {
    expect(tavilySummaryFromPayload({ answer: "Current summary." })).toBe("Current summary.");
    expect(tavilySummaryFromPayload({
      results: [{ title: "Result", url: "https://example.com", content: "Snippet" }],
    })).toBe("Result - https://example.com - Snippet");
    expect(tavilySummaryFromPayload({})).toBe("Tavily did not return an AI-generated summary.");

    expect(firecrawlMarkdownFromPayload({
      data: [{ title: "Source", url: "https://example.com", markdown: "# Source\nDetails" }],
    })).toContain("### Source\nURL: https://example.com\n# Source Details");
    expect(firecrawlMarkdownFromPayload({ data: [] })).toBe("Firecrawl did not return markdown content.");
  });
});
