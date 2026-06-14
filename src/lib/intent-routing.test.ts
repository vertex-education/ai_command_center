import { describe, expect, it } from "vitest";
import { inferPromptIntentFallback, normalizePromptIntent } from "@/lib/intent-routing";

describe("prompt intent routing", () => {
  it("accepts only the supported model labels after light normalization", () => {
    expect(normalizePromptIntent(" RAG_SEARCH. ")).toBe("RAG_SEARCH");
    expect(normalizePromptIntent("web_search\n")).toBe("WEB_SEARCH");
    expect(normalizePromptIntent("direct_chat")).toBe("DIRECT_CHAT");
    expect(normalizePromptIntent("artifact-generation")).toBe("ARTIFACT_GENERATION");
    expect(normalizePromptIntent("search_workspace")).toBeNull();
  });

  it("routes current or URL-backed questions to live web search", () => {
    expect(inferPromptIntentFallback("What is the latest policy update today?")).toBe("WEB_SEARCH");
    expect(inferPromptIntentFallback("Summarize https://example.com/source for this project")).toBe("WEB_SEARCH");
  });

  it("routes standalone artifact creation requests to artifact generation", () => {
    expect(inferPromptIntentFallback("Create a launch readiness report for the steering committee")).toBe("ARTIFACT_GENERATION");
    expect(inferPromptIntentFallback("Generate an export artifact from this plan")).toBe("ARTIFACT_GENERATION");
  });

  it("routes workspace history and file questions to scoped RAG search", () => {
    expect(inferPromptIntentFallback("What did the previous project decision say?")).toBe("RAG_SEARCH");
    expect(inferPromptIntentFallback("Summarize the uploaded artifact and cite the source record")).toBe("RAG_SEARCH");
  });

  it("keeps general conversation on direct chat", () => {
    expect(inferPromptIntentFallback("Brainstorm a better meeting agenda")).toBe("DIRECT_CHAT");
  });
});
