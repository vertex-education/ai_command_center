import { describe, expect, it } from "vitest";
import { classifyPromptIntent, inferPromptIntentFallback, intentRoutingModelId, normalizePromptIntent } from "@/lib/intent-routing";

describe("prompt intent routing", () => {
  it("accepts only the supported model labels after light normalization", () => {
    expect(normalizePromptIntent(" RAG_SEARCH. ")).toBe("RAG_SEARCH");
    expect(normalizePromptIntent("web_search\n")).toBe("WEB_SEARCH");
    expect(normalizePromptIntent("direct_chat")).toBe("DIRECT_CHAT");
    expect(normalizePromptIntent("entity extraction")).toBe("ENTITY_EXTRACTION");
    expect(normalizePromptIntent("task extraction")).toBe("TASK_EXTRACTION");
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
    expect(inferPromptIntentFallback("Extract action items from the uploaded project artifact")).toBe("RAG_SEARCH");
  });

  it("routes prompt-local task extraction to task extraction", () => {
    expect(inferPromptIntentFallback("Extract action items from this note: Maya owns launch QA by Friday")).toBe("TASK_EXTRACTION");
  });

  it("routes prompt-local operational extraction to entity extraction", () => {
    expect(inferPromptIntentFallback("Extract action items and risks from this note: Maya owns launch QA by Friday")).toBe(
      "ENTITY_EXTRACTION",
    );
  });

  it("keeps general conversation on direct chat", () => {
    expect(inferPromptIntentFallback("Brainstorm a better meeting agenda")).toBe("DIRECT_CHAT");
  });

  it("uses Llama 3 8B with turn-level thinking disabled for model classification", async () => {
    let payload: unknown;
    const ai = {
      run(model: string, inputs: Record<string, unknown>, options: unknown) {
        payload = { model, inputs, options };
        return Promise.resolve({ response: "ENTITY_EXTRACTION" });
      },
    } as unknown as Ai;

    await expect(classifyPromptIntent("Extract risks from this note", ai)).resolves.toBe("ENTITY_EXTRACTION");

    expect(payload).toMatchObject({
      model: intentRoutingModelId,
      inputs: {
        max_completion_tokens: 8,
        chat_template_kwargs: {
          enable_thinking: false,
          thinking: false,
        },
      },
    });
  });
});
