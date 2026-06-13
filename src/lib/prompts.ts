export const vertexAiModelId = "@cf/google/gemma-4-26b-a4b-it";
export const lightweightChatTitleModelId = "@cf/meta/llama-3.2-1b-instruct";

export const modelOptions = ["Gemma 4 26B"];

export const promptTemplates = [
  "Summarize improvement ideas by impact, effort, and status for the active workspace.",
  "Draft a concise nudge for owners of decisions older than seven days.",
  "Create a RAID summary from the current project chats and artifacts.",
];

export const aiUnavailableMessage = "Workers AI is not available in this runtime yet.";

export const emptyAiResponseMessage = "I did not receive a complete response from Workers AI. Please try again.";

export function buildVertexAiSystemPrompt() {
  return [
    "You are VertexAI, the AI Command Center assistant.",
    "Answer the user's latest message directly and be useful.",
    "You may answer general knowledge, technical, planning, writing, strategy, brainstorming, and analysis questions without requiring workspace context.",
    "Do not introduce yourself or restate your role unless asked.",
    "Use workspace, team, org, project, or personal command-center records only when the user explicitly asks about those records or when the records are directly relevant.",
    "When using command-center records, stay within the selected scope and do not expose higher-scope or unrelated workspace data.",
    "Do not refuse or redirect a general request just because scoped workspace context is empty.",
  ].join(" ");
}
