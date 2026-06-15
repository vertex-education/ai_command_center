import { runTrackedAiGateway } from "@/lib/ai-gateway";

export const intentRoutingModelId = "@cf/meta/llama-3-8b-instruct";

export const promptIntentLabels = [
  "RAG_SEARCH",
  "DIRECT_CHAT",
  "WEB_SEARCH",
  "ENTITY_EXTRACTION",
  "TASK_EXTRACTION",
  "ARTIFACT_GENERATION",
] as const;

export type PromptIntent = (typeof promptIntentLabels)[number];

const promptIntentLabelSet = new Set<string>(promptIntentLabels);

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
  if (promptIntentLabelSet.has(normalized)) return normalized as PromptIntent;
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

  const ragPatterns = [/\b(citation|source)\b/];
  if (ragPatterns.some((pattern) => pattern.test(normalized))) return "RAG_SEARCH";

  const extractionVerbPattern = /\b(extract|identify|find|pull|list)\b/;
  const taskTermPattern = /\b(action item|action items|task|tasks)\b/;
  const nonTaskEntityTermPattern =
    /\b(approval|approvals|risk|risks|idea|ideas|entity|entities|owner|owners|deadline|deadlines|due date|due dates)\b/;
  const promptLocalSourcePattern = /\b(from this|from the text|from the note|in this message|below)\b/;

  const asksForExtraction = extractionVerbPattern.test(normalized);
  const hasTaskTerms = taskTermPattern.test(normalized);
  const hasNonTaskEntityTerms = nonTaskEntityTermPattern.test(normalized);
  const hasPromptLocalSource = promptLocalSourcePattern.test(normalized);

  if ((asksForExtraction || hasPromptLocalSource) && hasTaskTerms && !hasNonTaskEntityTerms) {
    return "TASK_EXTRACTION";
  }

  if ((asksForExtraction || hasPromptLocalSource) && (hasTaskTerms || hasNonTaskEntityTerms)) {
    return "ENTITY_EXTRACTION";
  }

  return "DIRECT_CHAT";
}

export async function classifyPromptIntent(prompt: string, ai: Ai): Promise<PromptIntent> {
  try {
    const result = await runTrackedAiGateway(
      ai,
      intentRoutingModelId,
      {
        messages: [
          {
            role: "system",
            content: [
              "Classify the user's latest prompt for a scoped command-center assistant.",
              `Return exactly one label with no explanation: ${promptIntentLabels.join(", ")}.`,
              "Use RAG_SEARCH when the user asks about existing workspace, team, project, uploaded artifact, document, file, record, history, source, citation, or prior generated content.",
              "Use WEB_SEARCH when the user asks for current, recent, latest, online, web, internet, news, pricing, public, cited external, or URL-based information.",
              "Use DIRECT_CHAT for greetings, administrative questions, general conversation, planning, brainstorming, explanation, or requests that do not need scoped records or external facts.",
              "Use TASK_EXTRACTION when the user asks to extract, identify, or list concrete tasks or action items from text in the prompt.",
              "Use ENTITY_EXTRACTION when the user asks to extract, identify, or list approvals, risks, ideas, owners, deadlines, or mixed operational entities from text in the prompt.",
              "Use ARTIFACT_GENERATION when the user asks to draft, write, create, generate, format, compose, build, or produce a standalone artifact from the prompt itself.",
              "When unsure, choose RAG_SEARCH.",
            ].join(" "),
          },
          { role: "user", content: prompt },
        ],
        max_completion_tokens: 8,
        chat_template_kwargs: {
          enable_thinking: false,
          thinking: false,
        },
        temperature: 0,
      },
      {
        feature: "intent-routing",
        fallbackModel: null,
        metadata: {
          feature: "intent-routing",
          model: intentRoutingModelId,
          turnLevelThinkingEnabled: false,
        },
      },
    );

    return normalizePromptIntent(extractGeneratedText(result)) ?? inferPromptIntentFallback(prompt);
  } catch (error) {
    console.warn("[IntentRouting] Intent routing failed; falling back to RAG_SEARCH.", {
      message: error instanceof Error ? error.message : "Unknown intent routing error.",
    });
    return "RAG_SEARCH";
  }
}
