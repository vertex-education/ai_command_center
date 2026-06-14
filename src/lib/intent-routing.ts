import { runTrackedAiGateway } from "@/lib/ai-gateway";

export const intentRoutingModelId = "@cf/meta/llama-3-8b-instruct";

export type PromptIntent = "RAG_SEARCH" | "WEB_SEARCH" | "DIRECT_CHAT" | "ARTIFACT_GENERATION";

function extractGeneratedText(result: unknown) {
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object") return "";

  const record = result as Record<string, unknown>;
  const response = record.response;
  if (typeof response === "string") return response;

  const text = record.text;
  if (typeof text === "string") return text;

  const choices = record.choices;
  if (Array.isArray(choices)) {
    return choices
      .map((choice) => {
        if (!choice || typeof choice !== "object") return "";
        const item = choice as Record<string, unknown>;
        const message = item.message;
        if (message && typeof message === "object") {
          const content = (message as Record<string, unknown>).content;
          return typeof content === "string" ? content : "";
        }
        return typeof item.text === "string" ? item.text : "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  return "";
}

export function normalizePromptIntent(value: string): PromptIntent | null {
  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (
    normalized === "RAG_SEARCH" ||
    normalized === "WEB_SEARCH" ||
    normalized === "DIRECT_CHAT" ||
    normalized === "ARTIFACT_GENERATION"
  ) {
    return normalized;
  }
  return null;
}

export function inferPromptIntentFallback(prompt: string): PromptIntent {
  const normalized = prompt.toLowerCase();
  const artifactPatterns = [
    /\b(draft|write|create|generate|produce|format|compose|build)\b.*\b(artifact|brief|memo|doc|document|slide|deck|table|report|plan|email)\b/,
    /\b(create|generate|produce)\b.*\b(file|export|artifact)\b/,
  ];
  if (artifactPatterns.some((pattern) => pattern.test(normalized))) return "ARTIFACT_GENERATION";

  const strongRagPatterns = [
    /\b(uploaded|existing|previous|prior|history|historical|artifact|document|file|record)\b/,
    /\b(project|workspace|team)\b.*\b(status|artifact|history|document|file|decision|task)\b/,
  ];
  if (strongRagPatterns.some((pattern) => pattern.test(normalized))) return "RAG_SEARCH";

  const liveWebPatterns = [
    /\b(today|yesterday|this week|this month|this year|currently|current|latest|recent|recently|newest|now|as of)\b/,
    /\b(web|internet|online|search|look up|lookup|browse|google|source|sources|cite|citation)\b/,
    /\b(news|announcement|release|released|pricing|price|stock|weather|schedule|score|law|regulation|policy)\b/,
    /\b(202[5-9]|203\d)\b/,
    /https?:\/\//,
  ];
  if (liveWebPatterns.some((pattern) => pattern.test(normalized))) return "WEB_SEARCH";

  const ragPatterns = [
    /\b(citation|source)\b/,
  ];
  if (ragPatterns.some((pattern) => pattern.test(normalized))) return "RAG_SEARCH";

  return "DIRECT_CHAT";
}

export async function classifyPromptIntent(prompt: string, ai: Ai): Promise<PromptIntent> {
  try {
    const result = await runTrackedAiGateway(ai, intentRoutingModelId, {
      messages: [
        {
          role: "system",
          content: [
            "Classify the user's latest prompt for a scoped command-center assistant.",
            "Return exactly one label with no explanation: RAG_SEARCH, WEB_SEARCH, DIRECT_CHAT, or ARTIFACT_GENERATION.",
            "Use RAG_SEARCH when the user asks about existing workspace, team, project, uploaded artifact, document, file, record, history, source, citation, or prior generated content.",
            "Use WEB_SEARCH when the user asks for current, recent, latest, online, web, internet, news, pricing, public, cited external, or URL-based information.",
            "Use DIRECT_CHAT for greetings, administrative questions, general conversation, planning, brainstorming, explanation, or requests that do not need scoped records or external facts.",
            "Use ARTIFACT_GENERATION when the user asks to draft, write, create, generate, format, compose, build, or produce a standalone artifact from the prompt itself.",
            "When unsure, choose RAG_SEARCH.",
          ].join(" "),
        },
        { role: "user", content: prompt },
      ],
      max_completion_tokens: 8,
      temperature: 0,
    }, {
      feature: "intent-routing",
      metadata: {
        feature: "intent-routing",
        model: intentRoutingModelId,
      },
    });

    return normalizePromptIntent(extractGeneratedText(result)) ?? inferPromptIntentFallback(prompt);
  } catch (error) {
    console.warn("[IntentRouting] Intent routing failed; falling back to RAG_SEARCH.", {
      message: error instanceof Error ? error.message : "Unknown intent routing error.",
    });
    return "RAG_SEARCH";
  }
}
