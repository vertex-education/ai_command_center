/// <reference path="../../worker-configuration.d.ts" />

import { env } from "cloudflare:workers";
import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/start-server-core";
import { runTrackedAiGateway } from "@/lib/ai-gateway";
import { fetchAsanaProjectContextForCurrentUser } from "@/lib/asana-integration.server";
import { getAuth } from "@/lib/auth";
import { publishChatMessageInserts, type ChatMessageInsertEvent } from "@/lib/chat-sync";
import { recordRealtimeMutationEvent, type RealtimeInvalidationTarget } from "@/lib/realtime-events";
import {
  xlsxBlobFromRows,
  type ExportTable,
} from "@/lib/chat-export";
import {
  aiUnavailableMessage,
  buildVertexAiSystemPrompt,
  emptyAiResponseMessage,
  lightweightChatTitleModelId,
  modelOptions,
  prependDynamicWorkspaceContextHeader,
  promptTemplates,
  vertexAiModelId,
} from "@/lib/prompts";
import { fetchConsolidatedWebSearch } from "@/lib/rag";

export type IdeaStatus = "Not Started" | "Reviewing" | "Convert to Project" | "Dismiss";
export type TabName = "Chat" | "Ideas" | "Artifacts" | "Decisions" | "Approvals" | "Tasks" | "Prompts";
export type RailName = "Workspaces" | "Chats" | "Ideas" | "Artifacts" | "Decisions" | "Approvals" | "Tasks" | "Prompts";
export type WorkspaceMode = "Personal" | "Team" | "Org";
export type WorkspaceScope = "personal" | "team" | "org";
export type ChatSection = "project" | "workspace";
export type ChatReasoningLevel = "low" | "medium" | "high";
export type ProjectStatus = "Active" | "Watch" | "Planning" | "Blocked" | "In Progress";
export type AsanaTaskStatusSource = "native" | "custom_field";

export type ChatSummary = {
  id: string;
  title: string;
  description: string;
};

export type ProjectSummary = {
  id: string;
  name: string;
  description: string;
  projectInstructions: string;
  asanaTaskStatusSource: AsanaTaskStatusSource;
  asanaTaskStatusCustomFieldGid: string | null;
  asanaTaskStatusCustomFieldName: string | null;
  status: ProjectStatus;
  projectChats: ChatSummary[];
};

export type Idea = {
  id: string;
  projectId: string | null;
  title: string;
  originalText?: string;
  status: IdeaStatus;
  category: string;
  owner: string;
  avatar: string;
  created: string;
  votes: number;
  impact: number;
  effort: number;
  confidence: number;
  summary: string;
  nextStep: string;
  tags: string[];
  metrics: string[];
  thread: string[];
};

type IdeaAssessment = Pick<Idea, "impact" | "effort" | "confidence" | "nextStep" | "metrics" | "thread">;

export type ChatMessage = {
  id: string;
  parentId?: string;
  author: string;
  role: "user" | "assistant" | "system";
  avatar?: string;
  time: string;
  text: string;
  clientStatus?: "sending";
  artifact?: {
    title: string;
    meta: string;
    type: "doc" | "ppt" | "sheet";
  };
  attachments?: ChatAttachment[];
};

export type ChatAttachment = {
  id: string;
  name: string;
  extension: "pdf" | "xlsx" | "pptx" | "docx" | "csv" | "txt";
  mimeType: string;
  size: number;
  extractedText: string;
  status: "ready" | "partial" | "error";
  error?: string;
};

export type Artifact = {
  id: string;
  projectId: string | null;
  parentArtifactId?: string | null;
  sourceChatTitle?: string;
  title: string;
  type: string;
  owner: string;
  date: string;
  status: "Final" | "Draft" | "Pinned";
  summary: string;
  href: string;
  r2Key: string;
  preview: string[];
  previewJson?: JsonValue;
  pinnedTo: WorkspaceMode[];
  version: number;
  commitMessage: string;
  versionHistory?: ArtifactVersion[];
  clientStatus?: "deleting" | "pinning" | "saving";
};

export type ArtifactVersion = Omit<Artifact, "versionHistory" | "clientStatus">;

export type Decision = {
  id: string;
  projectId: string | null;
  title: string;
  originalText?: string;
  status: "Not Completed" | "Completed";
  owner: string;
  due: string;
  pinned?: boolean;
};

export type Approval = {
  id: string;
  projectId: string | null;
  title: string;
  originalText?: string;
  owner: string;
  due: string;
  status: "Not Reviewed" | "Reviewing" | "Approved" | "Not Approved";
  pinned?: boolean;
  clientStatus?: "pending";
};

export type Task = {
  id: string;
  projectId: string | null;
  title: string;
  originalText?: string;
  owner: string;
  source: string;
  status: "Open" | "Completed";
  pinned?: boolean;
  clientStatus?: "pending";
};

export type CreateTaskInput = {
  mode: WorkspaceMode;
  projectId?: string | null;
  title: string;
  originalText?: string;
  owner?: string;
  source?: string;
};

export type CreateWorkflowSuggestionInput = CreateTaskInput;

export type ActivityItem = {
  id: string;
  label: string;
  detail: string;
  time: string;
};

export type ScopedWorkspaceState = {
  scope: WorkspaceScope;
  mode: WorkspaceMode;
  projectsHeading: string;
  projectChatsHeading: string;
  workspaceChatsHeading: string;
  unassignedProjectLabel: string;
  projects: ProjectSummary[];
  workspaceChats: ChatSummary[];
  ideas: Idea[];
  conversations: Record<string, ChatMessage[]>;
  artifacts: Artifact[];
  decisions: Decision[];
  approvals: Approval[];
  tasks: Task[];
  pinnedIdeaIds: string[];
  accessLevel: "Read / Write" | "View only";
  activity: ActivityItem[];
  updatedAt: string;
};

export type PmoWorkspaceState = {
  productName: string;
  workspaces: Record<WorkspaceMode, ScopedWorkspaceState>;
};

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

type WebSearchResult = {
  title: string;
  url: string;
  snippet: string;
  source: string;
};

type WebSearchTrace = {
  enabled: boolean;
  query: string;
  provider: string;
  results: WebSearchResult[];
  error?: string;
};

export type LlmDevTrace = {
  id: string;
  timestamp: string;
  durationMs: number;
  model: string;
  chatId: string;
  chatTitle: string;
  mode: WorkspaceMode;
  projectId: string | null;
  webSearch?: WebSearchTrace;
  asanaSearchEnabled?: boolean;
  request: {
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
    max_completion_tokens: number;
    reasoningLevel: ChatReasoningLevel;
    reasoning_effort?: "low" | "medium" | "high";
    timeoutMs: number;
    temperature: number;
  };
  responseText: string;
  thinkingText: string;
  diagnostics: {
    finishReason: string | null;
    usage: JsonValue | null;
    tokenUsage: {
      inputTokens: number | null;
      outputTokens: number | null;
      totalTokens: number | null;
    };
    responseTextChars: number;
    thinkingTextChars: number;
  };
  rawResponse: JsonValue;
  error?: string;
};

type SendChatMessageResult = {
  workspace: PmoWorkspaceState;
  llmTrace: LlmDevTrace | null;
};

type SendChatMessageInput = {
  mode: WorkspaceMode;
  teamId?: string | null;
  projectId: string | null;
  chatId: string;
  chatTitle: string;
  text: string;
  model: string;
  reasoningLevel?: ChatReasoningLevel;
  webSearchEnabled?: boolean;
  asanaSearchEnabled?: boolean;
  attachments?: ChatAttachment[];
};

type ChatDynamicWorkspaceContext = {
  workspaceName: string;
  projectName: string | null;
  projectDescription: string | null;
  projectInstructions: string | null;
  projectStatus: string | null;
};

const chatTitleStopWords = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "for",
  "from",
  "i",
  "in",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "or",
  "please",
  "the",
  "this",
  "to",
  "with",
  "you",
]);

function conciseChatTitleFromRequest(text: string) {
  const cleaned = text
    .replace(/[`*_#>\[\](){}]/g, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\b(can|could|would|will)\s+you\b/gi, " ")
    .replace(/\b(i\s+want|i\s+need|i\s+would\s+like|please|help\s+me)\b/gi, " ")
    .replace(/\b(create|make|build|write|generate|give|tell|show)\s+(me\s+)?\b/gi, " ")
    .replace(/[^a-z0-9\s&/+-]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = cleaned
    .split(" ")
    .map((word) => word.trim())
    .filter(Boolean)
    .filter((word, index) => index < 2 || !chatTitleStopWords.has(word.toLowerCase()))
    .slice(0, 6);
  const title = (words.length > 0 ? words : ["New", "request"]).join(" ");
  const conciseTitle = title.length > 48 ? `${title.slice(0, 45).trim()}...` : title;
  return conciseTitle.charAt(0).toUpperCase() + conciseTitle.slice(1);
}

function normalizeGeneratedChatTitle(title: string, fallback: string) {
  const cleaned = title
    .split("\n")[0]
    .replace(/^title\s*:\s*/i, "")
    .replace(/^["'`]+|["'`.]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const usable = cleaned && cleaned.length >= 3 ? cleaned : fallback;
  const conciseTitle = usable.length > 60 ? usable.slice(0, 57).trim() : usable;
  return conciseTitle.charAt(0).toUpperCase() + conciseTitle.slice(1);
}

async function generateChatTitleFromInitialMessage(context: unknown, text: string) {
  const fallback = conciseChatTitleFromRequest(text);
  const ai = (context as CloudflareContext).cloudflare?.env?.AI;
  if (!ai) return fallback;

  try {
    const result = await withAiTimeout(
      (signal) => runTrackedAiGateway(
        ai,
        lightweightChatTitleModelId,
        {
          messages: [
            {
              role: "system",
              content: [
                "Name this chat from the user's initial message.",
                "Return only a concise title, no quotes, no punctuation at the end.",
                "Use 3 to 7 words. Preserve useful project, artifact, or technical nouns.",
              ].join(" "),
            },
            { role: "user", content: text.slice(0, 2_000) },
          ],
          max_completion_tokens: 24,
          temperature: 0.1,
        },
        {
          feature: "chat-title",
          signal,
          metadata: {
            feature: "chat-title",
            model: lightweightChatTitleModelId,
          },
        },
      ),
      5_000,
    );
    const generatedTitle = normalizeGeneratedChatTitle(extractAiResponse(result), fallback);
    console.info("[VertexAI] Chat title generated", {
      model: lightweightChatTitleModelId,
      title: generatedTitle,
      usedFallback: generatedTitle === fallback,
    });
    return generatedTitle;
  } catch (error) {
    console.warn("[VertexAI] Chat title generation fell back", {
      model: lightweightChatTitleModelId,
      message: error instanceof Error ? error.message : "Unknown title generation error.",
    });
    return fallback;
  }
}

export type AddIdeaInput = {
  title: string;
  category: string;
  status: IdeaStatus;
  impact: "High" | "Medium" | "Low";
  summary: string;
};

export const avatarAlex =
  "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=120&q=80";
export const avatarJordan =
  "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=120&q=80";
export const avatarTaylor =
  "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&w=120&q=80";
export const avatarMaya =
  "https://images.unsplash.com/photo-1544723795-3fb6469f5b39?auto=format&fit=crop&w=120&q=80";
export const avatarPriya =
  "https://images.unsplash.com/photo-1531123897727-8f129e1688ce?auto=format&fit=crop&w=120&q=80";

export const statusMeta: Record<IdeaStatus, { label: string; tone: "info" | "warning" | "success" | "destructive" | "secondary"; description: string }> = {
  "Not Started": { label: "Not Started", tone: "secondary", description: "Captured and not started." },
  Reviewing: { label: "Reviewing", tone: "warning", description: "Being evaluated." },
  "Convert to Project": { label: "Convert to Project", tone: "success", description: "Converted into a scoped project." },
  Dismiss: { label: "Dismiss", tone: "destructive", description: "Dismissed from consideration." },
};

export const tabs: TabName[] = ["Chat", "Artifacts", "Ideas", "Decisions", "Approvals", "Tasks", "Prompts"];
export const workspaceModes: WorkspaceMode[] = ["Personal", "Team", "Org"];
export const statusFilters: Array<IdeaStatus | "All"> = ["All", "Not Started", "Reviewing", "Convert to Project", "Dismiss"];
export { modelOptions, promptTemplates };

const scopeByMode: Record<WorkspaceMode, WorkspaceScope> = {
  Personal: "personal",
  Team: "team",
  Org: "org",
};

const assistantName = "VertexAI";
type ChatReasoningProfile = {
  label: string;
  shortLabel: string;
  maxCompletionTokens: number;
  timeoutMs: number;
  reasoningEffort?: "low" | "medium" | "high";
  thinkingEnabled: boolean;
};

export const chatReasoningProfiles: Record<ChatReasoningLevel, ChatReasoningProfile> = {
  low: {
    label: "Low reasoning",
    shortLabel: "Low",
    maxCompletionTokens: 4_096,
    timeoutMs: 45_000,
    thinkingEnabled: false,
  },
  medium: {
    label: "Medium reasoning",
    shortLabel: "Med",
    maxCompletionTokens: 16_384,
    timeoutMs: 120_000,
    reasoningEffort: "medium",
    thinkingEnabled: true,
  },
  high: {
    label: "High reasoning",
    shortLabel: "High",
    maxCompletionTokens: 32_768,
    timeoutMs: 180_000,
    reasoningEffort: "high",
    thinkingEnabled: true,
  },
};

export const chatReasoningLevels: ChatReasoningLevel[] = ["low", "medium", "high"];

function normalizeReasoningLevel(value: unknown): ChatReasoningLevel {
  if (value === "off" || value === "quick") return "low";
  if (value === "deep") return "medium";
  if (value === "max") return "high";
  return typeof value === "string" && value in chatReasoningProfiles ? value as ChatReasoningLevel : "low";
}

function buildReasoningInstruction(level: ChatReasoningLevel) {
  if (level === "high") {
    return [
      "Reasoning depth: High.",
      "Use exhaustive, comprehensive analysis for non-trivial requests.",
      "Prefer a complete answer over brevity: cover the user's question from multiple angles, include relevant evidence, explain the reasoning path, and make implicit project context explicit.",
      "Include assumptions, constraints, relevant evidence, tradeoffs, alternatives, risks, edge cases, implementation implications, a recommendation, next steps, and confidence when those elements are useful.",
      "Use clear sections, bullets, tables, or step-by-step structure when they make the answer easier to scan.",
      "If required information is missing, state what is missing instead of guessing.",
    ].join(" ");
  }

  if (level === "medium") {
    return [
      "Reasoning depth: Medium.",
      "Use thorough analysis for non-trivial requests.",
      "Provide enough context that the answer can stand alone: include key assumptions, relevant evidence, main tradeoffs, practical implications, and a recommendation when useful.",
      "Cover the important caveats and next steps, but reserve exhaustive edge-case enumeration for High reasoning or when the user asks for it.",
      "Use concise sections or bullets instead of compressing the answer into a short paragraph.",
    ].join(" ");
  }

  return [
    "Reasoning depth: Low.",
    "Thinking mode is off for quicker responses.",
    "Answer directly and concisely unless the user asks for detail.",
  ].join(" ");
}

type CloudflareContext = {
  cloudflare?: {
    env?: {
      AI?: Ai;
      FIRECRAWL_API_KEY?: string;
      TAVILY_API_KEY?: string;
    };
  };
};

type WorkersAiTextResponse = {
  text?: string;
  content?: unknown;
  output?: unknown;
  output_text?: string;
  response?: string;
  result?: {
    text?: string;
    content?: unknown;
    output?: unknown;
    output_text?: string;
    response?: string;
  };
};

type WorkersAiChatResponse = WorkersAiTextResponse & Partial<ChatCompletionsOutput>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function extractTextFromContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => extractTextFromContent(item))
      .filter(Boolean)
      .join("");
  }
  if (!isRecord(value)) return "";

  for (const key of ["text", "content", "response", "output_text", "value"]) {
    const text = extractTextFromContent(value[key]);
    if (text) return text;
  }

  return "";
}

function summarizeAiResponseShape(value: unknown): unknown {
  if (typeof value === "string") return "string";
  if (Array.isArray(value)) return value.slice(0, 3).map((item) => summarizeAiResponseShape(item));
  if (!isRecord(value)) return typeof value;

  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 12)
      .map(([key, nestedValue]) => [key, Array.isArray(nestedValue) ? `array(${nestedValue.length})` : isRecord(nestedValue) ? Object.keys(nestedValue).slice(0, 8) : typeof nestedValue]),
  );
}

function cloneJsonValue(value: unknown): JsonValue {
  try {
    return JSON.parse(JSON.stringify(value)) as JsonValue;
  } catch {
    return JSON.parse(JSON.stringify(summarizeAiResponseShape(value))) as JsonValue;
  }
}

function extractThinkingFromResponse(value: unknown, depth = 0): string {
  if (depth > 8) return "";
  if (typeof value === "string") {
    const match = value.match(/<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/i);
    return match?.[1]?.trim() ?? "";
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => extractThinkingFromResponse(item, depth + 1))
      .filter(Boolean)
      .join("\n\n");
  }
  if (!isRecord(value)) return "";

  const thinkingKeys = ["thinking", "reasoning", "reasoning_content", "thought", "thoughts"];
  const direct = thinkingKeys
    .map((key) => extractTextFromContent(value[key]))
    .filter(Boolean)
    .join("\n\n");
  if (direct) return direct;

  return Object.values(value)
    .map((nestedValue) => extractThinkingFromResponse(nestedValue, depth + 1))
    .filter(Boolean)
    .join("\n\n");
}

function findFirstByKey(value: unknown, keys: string[], depth = 0): unknown {
  if (depth > 8 || !value) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = findFirstByKey(item, keys, depth + 1);
      if (nested !== null && nested !== undefined) return nested;
    }
    return null;
  }
  if (!isRecord(value)) return null;

  for (const key of keys) {
    if (value[key] !== undefined && value[key] !== null) return value[key];
  }

  for (const nestedValue of Object.values(value)) {
    const nested = findFirstByKey(nestedValue, keys, depth + 1);
    if (nested !== null && nested !== undefined) return nested;
  }
  return null;
}

function getAiDiagnostics(result: unknown, responseText: string, thinkingText: string): LlmDevTrace["diagnostics"] {
  const finishReason = findFirstByKey(result, ["finish_reason", "finishReason"]);
  const usage = findFirstByKey(result, ["usage"]);
  const usageRecord = isRecord(usage) ? usage : {};
  const inputTokens = numberFromUnknown(usageRecord.prompt_tokens ?? usageRecord.input_tokens);
  const outputTokens = numberFromUnknown(usageRecord.completion_tokens ?? usageRecord.output_tokens);
  const totalTokens = numberFromUnknown(usageRecord.total_tokens);
  return {
    finishReason: typeof finishReason === "string" ? finishReason : null,
    usage: usage ? cloneJsonValue(usage) : null,
    tokenUsage: {
      inputTokens,
      outputTokens,
      totalTokens: totalTokens ?? (inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null),
    },
    responseTextChars: responseText.length,
    thinkingTextChars: thinkingText.length,
  };
}

function numberFromUnknown(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getDb() {
  const db = (env as Env).DB;
  if (!db) throw new Error("D1 binding DB is required.");
  return db;
}

function workspaceIdForMode(mode: WorkspaceMode) {
  return `ws-${scopeByMode[mode]}`;
}

function modeForWorkspaceId(workspaceId: string): WorkspaceMode | null {
  if (workspaceId === "ws-personal") return "Personal";
  if (workspaceId === "ws-team") return "Team";
  if (workspaceId === "ws-org") return "Org";
  return null;
}

function getArtifactsBucket() {
  const bucket = (env as Env).ARTIFACTS_BUCKET;
  if (!bucket) throw new Error("R2 binding ARTIFACTS_BUCKET is required.");
  return bucket;
}

async function withAiTimeout<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error("Workers AI did not respond before the timeout."));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

const workspaceSeed = {
  Personal: {
    projectsHeading: "Personal Projects",
    projectChatsHeading: "Project Chats",
    workspaceChatsHeading: "General Chats",
    unassignedProjectLabel: "General",
  },
  Team: {
    projectsHeading: "Team Projects",
    projectChatsHeading: "Project Chats",
    workspaceChatsHeading: "Team Chats",
    unassignedProjectLabel: "No team project",
  },
  Org: {
    projectsHeading: "Org projects",
    projectChatsHeading: "Project Chats",
    workspaceChatsHeading: "Org Chats",
    unassignedProjectLabel: "No org project",
  },
} satisfies Record<WorkspaceMode, {
  projectsHeading: string;
  projectChatsHeading: string;
  workspaceChatsHeading: string;
  unassignedProjectLabel: string;
}>;

function buildWorkspace(mode: WorkspaceMode): ScopedWorkspaceState {
  const seed = workspaceSeed[mode];

  return {
    scope: scopeByMode[mode],
    mode,
    projectsHeading: seed.projectsHeading,
    projectChatsHeading: seed.projectChatsHeading,
    workspaceChatsHeading: seed.workspaceChatsHeading,
    unassignedProjectLabel: seed.unassignedProjectLabel,
    projects: [],
    workspaceChats: [],
    ideas: [],
    conversations: {},
    artifacts: [],
    decisions: [],
    approvals: [],
    tasks: [],
    pinnedIdeaIds: [],
    accessLevel: "Read / Write",
    activity: [],
    updatedAt: "",
  };
}

const initialWorkspaceState: PmoWorkspaceState = {
  productName: "Vertex AI Command Center",
  workspaces: {
    Personal: buildWorkspace("Personal"),
    Team: buildWorkspace("Team"),
    Org: buildWorkspace("Org"),
  },
};

let workspaceState: PmoWorkspaceState | null = null;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function getMutableRoot() {
  workspaceState ??= clone(initialWorkspaceState);
  return workspaceState;
}

function getMutableWorkspace(mode: WorkspaceMode) {
  return getMutableRoot().workspaces[mode];
}

function nowLabel() {
  return new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function recordActivity(workspace: ScopedWorkspaceState, label: string, detail: string) {
  workspace.updatedAt = new Date().toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  workspace.activity = [
    { id: `activity-${Date.now()}-${Math.round(Math.random() * 1000)}`, label, detail, time: nowLabel() },
    ...workspace.activity,
  ].slice(0, 8);
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 1000)}`;
}

function safeArtifactFileName(value: string) {
  return value
    .trim()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/\d+/g, " ")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 72) || "table-export";
}

function artifactDownloadHref(r2Key: string, fallbackHref: string) {
  return r2Key.includes("/generated/")
    ? `/api/artifacts?key=${encodeURIComponent(r2Key)}`
    : fallbackHref;
}

function requiredFormString(formData: FormData, key: string, label: string) {
  const value = formData.get(key);
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

function optionalFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function rowsSample(rows: ExportTable["rows"]) {
  return rows
    .slice(0, 8)
    .map((row) => Object.entries(row).map(([key, value]) => `${key}: ${value ?? ""}`).join("; "))
    .join("\n")
    .slice(0, 2200);
}

function fallbackArtifactTitle(seedTitle: string, rows: ExportTable["rows"]) {
  const columns = Object.keys(rows[0] ?? {}).slice(0, 4).join(" ");
  const source = `${seedTitle} ${columns}`.trim() || "Table Export";
  return source
    .replace(/\b(option|method|table|export|csv|xlsx)\b/gi, " ")
    .replace(/\d+/g, " ")
    .replace(/[^a-z0-9\s-]/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 7)
    .join(" ") || "Table Export";
}

async function generateArtifactTitle(seedTitle: string, rows: ExportTable["rows"]) {
  const ai = (env as Env).AI;
  if (!ai) return fallbackArtifactTitle(seedTitle, rows);
  const prompt = [
    "Create a concise file name for an XLSX artifact based on this table.",
    "Return only the file name text, no extension, no quotes, no punctuation except hyphens or spaces.",
    "Do not include any digits or numbered versions in the file name.",
    "Use 3 to 7 words. Make it specific to the content.",
    `Current heading: ${seedTitle}`,
    "Rows:",
    rowsSample(rows),
  ].join("\n");
  try {
    const result = await withAiTimeout(
      (signal) => runTrackedAiGateway(
        ai,
        vertexAiModelId,
        {
          messages: [
            { role: "system", content: "You name files clearly and briefly." },
            { role: "user", content: prompt },
          ],
          max_completion_tokens: 32,
          temperature: 0.1,
        },
        {
          feature: "artifact-title",
          signal,
          metadata: {
            feature: "artifact-title",
            model: vertexAiModelId,
          },
        },
      ),
      4500,
    );
    const generated = extractAiResponse(result)
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/["'`]/g, "")
      .replace(/\d+/g, " ")
      .replace(/[^a-z0-9\s-]/gi, " ")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .slice(0, 8)
      .join(" ");
    return generated || fallbackArtifactTitle(seedTitle, rows);
  } catch {
    return fallbackArtifactTitle(seedTitle, rows);
  }
}

function fallbackWorkflowSuggestionTitle(kind: string, title: string) {
  return title
    .replace(/\s+/g, " ")
    .replace(/^[-*•\s]+/, "")
    .replace(/\b(task|approval|decision|idea)\s*[:#]\s*/i, "")
    .trim()
    .split(" ")
    .slice(0, kind === "idea" ? 9 : 11)
    .join(" ")
    .slice(0, 120) || `${kind} suggestion`;
}

async function generateWorkflowSuggestionTitle(kind: "approval" | "decision" | "idea" | "task", title: string) {
  const fallback = fallbackWorkflowSuggestionTitle(kind, title);
  const ai = (env as Env).AI;
  if (!ai) return fallback;
  try {
    const result = await withAiTimeout(
      (signal) => runTrackedAiGateway(
        ai,
        lightweightChatTitleModelId,
        {
          messages: [
            {
              role: "system",
              content: [
                `Rewrite this ${kind} item as a concise list title.`,
                "Return only the title, no quotes, no punctuation at the end.",
                "Keep the concrete noun, owner object, or deliverable. Use 4 to 10 words.",
              ].join(" "),
            },
            { role: "user", content: title.slice(0, 1200) },
          ],
          max_completion_tokens: 32,
          temperature: 0.1,
        },
        {
          feature: `workflow-${kind}-title`,
          signal,
          metadata: {
            feature: `workflow-${kind}-title`,
            model: lightweightChatTitleModelId,
          },
        },
      ),
      3500,
    );
    return fallbackWorkflowSuggestionTitle(kind, extractAiResponse(result)) || fallback;
  } catch {
    return fallback;
  }
}

async function getChatWorkspaceId(chatId: string) {
  const chat = await getDb()
    .prepare("SELECT workspace_id as workspaceId FROM chats WHERE id = ? LIMIT 1")
    .bind(chatId)
    .first<{ workspaceId: string }>();
  if (!chat) throw new Error("Chat was not found.");
  return chat.workspaceId;
}

async function persistChatMessage({
  chatId,
  message,
  mode,
  parentId,
  projectId,
  workspaceId,
}: {
  chatId: string;
  workspaceId: string;
  projectId: string | null;
  mode: WorkspaceMode;
  message: ChatMessage;
  parentId?: string | null;
}): Promise<ChatMessageInsertEvent> {
  await getDb()
    .prepare(
      "INSERT INTO chat_messages (id, chat_id, parent_id, workspace_id, author, role, avatar, message_time, body, artifact_title, artifact_type, artifact_meta, attachments_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      message.id,
      chatId,
      message.parentId ?? parentId ?? null,
      workspaceId,
      message.author,
      message.role,
      message.avatar ?? null,
      message.time,
      message.text,
      message.artifact?.title ?? null,
      message.artifact?.type ?? null,
      message.artifact?.meta ?? null,
      message.attachments?.length ? JSON.stringify(sanitizeChatAttachments(message.attachments)) : null,
      new Date().toISOString(),
    )
    .run();

  return {
    id: message.id,
    chatId,
    workspaceId,
    projectId,
    mode,
    message,
  };
}

async function listPersistedChatMessages(chatId: string) {
  const result = await getDb()
    .prepare("SELECT id, parent_id as parentId, author, role, avatar, message_time as time, body as text, attachments_json as attachmentsJson FROM chat_messages WHERE chat_id = ? ORDER BY created_at ASC")
    .bind(chatId)
    .all<{ id: string; parentId: string | null; author: string; role: "user" | "assistant" | "system"; avatar: string | null; time: string; text: string; attachmentsJson: string | null }>();

  return (result.results ?? []).map((message) => {
    const { attachmentsJson, ...rest } = message;
    return {
      ...rest,
      parentId: message.parentId ?? undefined,
      avatar: message.avatar ?? undefined,
      attachments: parseChatAttachments(attachmentsJson),
    };
  }) satisfies ChatMessage[];
}

export function sanitizeChatAttachments(attachments: ChatAttachment[] | undefined): ChatAttachment[] {
  return (attachments ?? [])
    .filter((attachment) => Boolean(attachment.name))
    .slice(0, 6)
    .map((attachment) => ({
      id: attachment.id || createId("attachment"),
      name: attachment.name.slice(0, 180),
      extension: attachment.extension,
      mimeType: attachment.mimeType.slice(0, 120),
      size: Math.max(0, Number(attachment.size) || 0),
      extractedText: truncateAttachmentContext(attachment.extractedText),
      status: attachment.status,
      error: attachment.error?.slice(0, 240),
    }));
}

export function parseChatAttachments(value: string | null | undefined): ChatAttachment[] | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as ChatAttachment[];
    const sanitized = sanitizeChatAttachments(Array.isArray(parsed) ? parsed : []);
    return sanitized.length ? sanitized : undefined;
  } catch {
    return undefined;
  }
}

function extractAiResponse(result: unknown) {
  if (typeof result === "string") return result;
  if (result && typeof result === "object") {
    const response = result as WorkersAiChatResponse;
    const firstChoice = response.choices?.[0] as { delta?: { content?: unknown }; message?: { content?: unknown; text?: unknown } } | undefined;
    const candidates = [
      response.response,
      response.text,
      response.output_text,
      extractTextFromContent(response.content),
      response.result?.response,
      response.result?.text,
      response.result?.output_text,
      extractTextFromContent(response.result?.content),
      extractTextFromContent(response.output),
      extractTextFromContent(response.result?.output),
      extractTextFromContent(firstChoice?.message?.content),
      extractTextFromContent(firstChoice?.message?.text),
      extractTextFromContent(firstChoice?.delta?.content),
    ];
    return candidates.find((candidate) => Boolean(candidate)) ?? "";
  }
  return "";
}

function truncateForPrompt(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1).trim()}...` : normalized;
}

function truncateAttachmentContext(value: string, maxLength = 20_000) {
  const normalized = value.replace(/\r/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength).trim()}\n[Attachment text truncated for Gemma context.]`
    : normalized;
}

function buildAttachmentPromptContext(attachments: ChatAttachment[] | undefined) {
  const sanitized = sanitizeChatAttachments(attachments).filter((attachment) => attachment.status !== "error" && attachment.extractedText.trim());
  if (!sanitized.length) return null;
  let totalChars = 0;
  const maxTotalChars = 60_000;
  const sections: string[] = [
    "The user attached the following files. Use their extracted text as context when it is relevant, and call out extraction limits if the status is partial.",
  ];
  for (const [index, attachment] of sanitized.entries()) {
    const remaining = maxTotalChars - totalChars;
    if (remaining <= 0) break;
    const text = truncateAttachmentContext(attachment.extractedText, Math.min(20_000, remaining));
    totalChars += text.length;
    sections.push([
      `[Attachment ${index + 1}] ${attachment.name}`,
      `Type: ${attachment.extension.toUpperCase()}`,
      `Status: ${attachment.status}`,
      `Size: ${attachment.size} bytes`,
      "Extracted text:",
      text,
    ].join("\n"));
  }
  return sections.join("\n\n");
}

function buildMessageContentForHistory(message: ChatMessage) {
  const attachmentSummary = message.attachments?.length
    ? `\nAttached files: ${message.attachments.map((attachment) => `${attachment.name} (${attachment.extension.toUpperCase()}, ${attachment.status})`).join("; ")}`
    : "";
  return `${message.author}: ${message.text}${attachmentSummary}`;
}

async function searchWebForPrompt(
  context: unknown,
  query: string,
  enabled: boolean | undefined,
  usageScope: {
    mode: WorkspaceMode;
    projectId?: string | null;
    chatId: string;
    chatTitle: string;
  },
): Promise<WebSearchTrace> {
  if (!enabled) {
    return {
      enabled: false,
      query,
      provider: "none",
      results: [],
    };
  }

  const env = (context as CloudflareContext).cloudflare?.env;
  const firecrawlApiKey = env?.FIRECRAWL_API_KEY;
  const tavilyApiKey = env?.TAVILY_API_KEY;
  if (!tavilyApiKey && !firecrawlApiKey) {
    return {
      enabled: true,
      query,
      provider: "Tavily + Firecrawl",
      results: [],
      error: "No web search provider is configured. Set TAVILY_API_KEY and FIRECRAWL_API_KEY.",
    };
  }

  try {
    const consolidatedContext = await fetchConsolidatedWebSearch(query, env as unknown as Parameters<typeof fetchConsolidatedWebSearch>[1], {
      projectId: usageScope.projectId,
      chatId: usageScope.chatId,
      metadata: {
        mode: usageScope.mode,
        chatTitle: usageScope.chatTitle.slice(0, 120),
        source: "chat-web-search",
      },
    });
    return {
      enabled: true,
      query,
      provider: "Tavily + Firecrawl",
      results: [{
        title: "Consolidated web context",
        url: "",
        snippet: truncateForPrompt(consolidatedContext, 12_000),
        source: "Tavily + Firecrawl",
      }],
    };
  } catch (error) {
    return {
      enabled: true,
      query,
      provider: "Tavily + Firecrawl",
      results: [],
      error: error instanceof Error ? error.message : "Hybrid web search failed.",
    };
  }
}

function buildWebSearchPromptContext(search: WebSearchTrace) {
  if (!search.enabled) return null;
  const lines = [
    `Web search: enabled`,
    `Provider: ${search.provider}`,
    `Query: ${search.query}`,
  ];
  if (search.error) lines.push(`Search issue: ${search.error}`);
  if (search.results.length) {
    lines.push("Use the following consolidated web context only when it is relevant. Cite source URLs when the context includes them.");
    search.results.forEach((result, index) => {
      lines.push(`[${index + 1}] ${result.title}${result.url ? `\nURL: ${result.url}` : ""}\n${result.snippet}`);
    });
  } else {
    lines.push("No usable web results were available. Say that live web search did not return useful results if current information is required.");
  }
  return lines.join("\n");
}

function chatSafeAiErrorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : "Workers AI request failed.";
  if (/<html[\s>]/i.test(raw) || /504 Gateway Time-out/i.test(raw)) {
    return "Workers AI gateway timed out before returning a response.";
  }
  return raw.replace(/\s+/g, " ").trim() || "Workers AI request failed.";
}

async function runGemmaChat({
  context,
  data,
  existingMessages,
  workspace,
}: {
  context: unknown;
  data: SendChatMessageInput;
  existingMessages: ChatMessage[];
  workspace: ScopedWorkspaceState;
}): Promise<{ text: string; trace: LlmDevTrace }> {
  const reasoningLevel = normalizeReasoningLevel(data.reasoningLevel);
  const reasoningProfile = chatReasoningProfiles[reasoningLevel];
  const webSearch = await searchWebForPrompt(context, data.text, data.webSearchEnabled, {
    mode: data.mode,
    projectId: data.projectId,
    chatId: data.chatId,
    chatTitle: data.chatTitle,
  });
  const webSearchContext = buildWebSearchPromptContext(webSearch);
  const asanaContext = await fetchAsanaProjectContextForCurrentUser({
    enabled: data.asanaSearchEnabled,
    prompt: data.text,
    vertexProjectId: data.projectId,
  });
  const workspaceContext: ChatDynamicWorkspaceContext = data.projectId
    ? await getDb()
      .prepare(
        `SELECT w.name as workspaceName,
                p.name as projectName,
                p.description as projectDescription,
                COALESCE(p.project_instructions, '') as projectInstructions,
                p.status as projectStatus
         FROM projects p
         INNER JOIN workspaces w ON w.id = p.workspace_id
         WHERE p.id = ?
         LIMIT 1`,
      )
      .bind(data.projectId)
      .first<ChatDynamicWorkspaceContext>() ?? {
        workspaceName: `${workspaceModeLabel(data.mode)} Workspace`,
        projectName: null,
        projectDescription: null,
        projectInstructions: null,
        projectStatus: null,
      }
    : {
      ...(await getDb()
      .prepare("SELECT name as workspaceName FROM workspaces WHERE scope = ? LIMIT 1")
      .bind(workspace.scope)
      .first<{ workspaceName: string }>() ?? { workspaceName: `${workspaceModeLabel(data.mode)} Workspace` }),
      projectName: null,
      projectDescription: null,
      projectInstructions: null,
      projectStatus: null,
    };
  const recentMessages: Array<{ role: "user" | "assistant"; content: string }> = existingMessages.slice(-8).map((message) => ({
    role: message.role === "assistant" ? "assistant" : "user",
    content: buildMessageContentForHistory(message),
  }));
  const attachmentContext = buildAttachmentPromptContext(data.attachments);

  const scopeContext = [
    `Workspace scope: ${workspaceModeLabel(data.mode)} (${workspace.scope})`,
    `Selected scope: ${workspaceContext.projectName ?? workspaceModeLabel(data.mode)}`,
    `Active chat: ${data.chatTitle}`,
    "This is routing metadata for command-center record questions, not a limit on general conversation.",
    "Use this scoped context only when it is relevant to the user's request. Otherwise answer the user's request directly.",
  ].filter(Boolean).join("\n");

  const requestPayload: LlmDevTrace["request"] & {
    chat_template_kwargs?: {
      enable_thinking: boolean;
      thinking?: boolean;
    };
  } = {
    messages: [
      {
        role: "system" as const,
        content: prependDynamicWorkspaceContextHeader(
          `${buildVertexAiSystemPrompt()} ${buildReasoningInstruction(reasoningLevel)}`,
          {
            workspaceName: workspaceContext.workspaceName,
            projectName: workspaceContext.projectName,
            projectDescription: workspaceContext.projectDescription,
            projectInstructions: workspaceContext.projectInstructions,
            projectStatus: workspaceContext.projectStatus,
          },
        ),
      },
      {
        role: "user" as const,
        content: `Current scoped context:\n${scopeContext}`,
      },
      ...(webSearchContext
        ? [{
          role: "user" as const,
          content: `Current web context:\n${webSearchContext}`,
        }]
        : []),
      ...(asanaContext
        ? [{
          role: "user" as const,
          content: `Current Asana project context:\n${asanaContext}`,
        }]
        : []),
      ...(attachmentContext
        ? [{
          role: "user" as const,
          content: `Current file attachment context:\n${attachmentContext}`,
        }]
        : []),
      ...recentMessages,
      {
        role: "user" as const,
        content: data.text,
      },
    ],
    max_completion_tokens: reasoningProfile.maxCompletionTokens,
    reasoningLevel,
    reasoning_effort: reasoningProfile.reasoningEffort,
    timeoutMs: reasoningProfile.timeoutMs,
    chat_template_kwargs: {
      enable_thinking: reasoningProfile.thinkingEnabled,
      thinking: reasoningProfile.thinkingEnabled,
    },
    temperature: 0.3,
  };
  const traceBase = {
    id: `llm-trace-${crypto.randomUUID()}`,
    timestamp: new Date().toISOString(),
    model: vertexAiModelId,
    chatId: data.chatId,
    chatTitle: data.chatTitle,
    mode: data.mode,
    projectId: data.projectId,
    webSearch,
    asanaSearchEnabled: Boolean(data.asanaSearchEnabled),
    request: requestPayload,
  };
  const ai = (context as CloudflareContext).cloudflare?.env?.AI;
  if (!ai) {
    return {
      text: aiUnavailableMessage,
      trace: {
        ...traceBase,
        durationMs: 0,
        responseText: aiUnavailableMessage,
        thinkingText: "",
        diagnostics: {
          finishReason: null,
          usage: null,
          tokenUsage: {
            inputTokens: null,
            outputTokens: null,
            totalTokens: null,
          },
          responseTextChars: aiUnavailableMessage.length,
          thinkingTextChars: 0,
        },
        rawResponse: null,
        error: aiUnavailableMessage,
      },
    };
  }

  console.info("[VertexAI] Workers AI request started", {
    chatId: data.chatId,
    mode: data.mode,
    projectId: data.projectId,
    messageCount: requestPayload.messages.length,
    model: vertexAiModelId,
    reasoningLevel,
    maxCompletionTokens: requestPayload.max_completion_tokens,
    timeoutMs: requestPayload.timeoutMs,
  });

  const startedAt = Date.now();
  try {
    const result = await withAiTimeout(
      (signal) => runTrackedAiGateway(
        ai,
        vertexAiModelId,
        requestPayload,
        {
          feature: webSearch ? "gemma-chat-with-web-search" : "gemma-chat",
          projectId: data.projectId,
          chatId: data.chatId,
          signal,
          metadata: {
            feature: webSearch ? "gemma-chat-web" : "gemma-chat",
            mode: data.mode,
            chatId: data.chatId.slice(0, 80),
            projectId: data.projectId?.slice(0, 80) ?? null,
          },
        },
      ),
      reasoningProfile.timeoutMs,
    );

    const responseText = extractAiResponse(result).trim();
    const thinkingText = extractThinkingFromResponse(result);
    const text = responseText || (thinkingText ? "The model returned reasoning output but did not return a final answer. It may have exhausted the completion budget before finishing. Please try again or shorten the prompt." : emptyAiResponseMessage);
    console.info("[VertexAI] Workers AI request completed", {
      chatId: data.chatId,
      responseLength: responseText.length,
    });
    if (!responseText) {
      console.warn("[VertexAI] Workers AI returned an empty response", {
        chatId: data.chatId,
        model: vertexAiModelId,
        responseShape: summarizeAiResponseShape(result),
      });
    }
    const trace = {
      ...traceBase,
      durationMs: Date.now() - startedAt,
      responseText: text,
      thinkingText,
      diagnostics: getAiDiagnostics(result, responseText, thinkingText),
      rawResponse: cloneJsonValue(result),
    };
    return {
      text,
      trace,
    };
  } catch (error) {
    const detail = chatSafeAiErrorMessage(error);
    console.error("[VertexAI] Workers AI request failed", {
      chatId: data.chatId,
      message: detail,
    });
    const text = `I could not complete the Workers AI request. ${detail}`;
    const durationMs = Date.now() - startedAt;
    return {
      text,
      trace: {
        ...traceBase,
        durationMs,
        responseText: text,
        thinkingText: "",
        diagnostics: {
          finishReason: null,
          usage: null,
          tokenUsage: {
            inputTokens: null,
            outputTokens: null,
            totalTokens: null,
          },
          responseTextChars: text.length,
          thinkingTextChars: 0,
        },
        rawResponse: null,
        error: detail,
      },
    };
  }
}

function cycleDecisionStatus(status: Decision["status"]): Decision["status"] {
  return status === "Completed" ? "Not Completed" : "Completed";
}

function cycleApprovalStatus(status: Approval["status"]): Approval["status"] {
  if (status === "Not Reviewed") return "Reviewing";
  if (status === "Reviewing") return "Approved";
  if (status === "Approved") return "Not Approved";
  return "Not Reviewed";
}

function cycleTaskStatus(status: Task["status"]): Task["status"] {
  return status === "Completed" ? "Open" : "Completed";
}

function titleMatchesTask(left: string, right: string) {
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return normalize(left) === normalize(right);
}

function boundedScore(value: unknown, fallback: number) {
  const score = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(score)) return fallback;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function extractJsonObject(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? text.match(/\{[\s\S]*\}/)?.[0] ?? text;
  try {
    const parsed = JSON.parse(candidate);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function loadIdeaAssessmentContext(mode: WorkspaceMode, projectId: string | null) {
  const workspace = await getDb()
    .prepare("SELECT name FROM workspaces WHERE id = ? LIMIT 1")
    .bind(workspaceIdForMode(mode))
    .first<{ name: string }>();
  const project = projectId
    ? await getDb()
      .prepare("SELECT name, description, status, COALESCE(project_instructions, '') as projectInstructions FROM projects WHERE id = ? LIMIT 1")
      .bind(projectId)
      .first<{ name: string; description: string; status: string; projectInstructions: string }>()
    : null;
  return {
    workspaceName: workspace?.name ?? `${workspaceModeLabel(mode)} Workspace`,
    projectName: project?.name ?? null,
    projectDescription: project?.description ?? null,
    projectInstructions: project?.projectInstructions ?? null,
    projectStatus: project?.status ?? null,
  };
}

async function assessIdeaWithGemma({
  context,
  mode,
  idea,
}: {
  context: unknown;
  mode: WorkspaceMode;
  idea: Pick<Idea, "title" | "originalText" | "category" | "owner" | "summary" | "tags" | "projectId">;
}): Promise<IdeaAssessment> {
  const fallbackImpact = idea.tags.includes("High") ? 86 : idea.tags.includes("Low") ? 46 : 68;
  const fallback: IdeaAssessment = {
    impact: fallbackImpact,
    effort: fallbackImpact >= 80 ? 52 : fallbackImpact >= 60 ? 42 : 30,
    confidence: fallbackImpact >= 80 ? 78 : 66,
    nextStep: "gap: Confirm owner, evidence source, and governance fit before prioritizing.",
    metrics: [
      "Impact fallback: Refresh to ask Gemma 4 for a score rationale.",
      "Effort fallback: Refresh to ask Gemma 4 for a score rationale.",
      "Confidence fallback: Refresh to ask Gemma 4 for a score rationale.",
    ],
    thread: ["Idea captured through Vertex AI Command Center.", "Gemma assessment pending until Workers AI is available."],
  };
  const ai = (context as CloudflareContext).cloudflare?.env?.AI;
  if (!ai) return fallback;

  const workspaceContext = await loadIdeaAssessmentContext(mode, idea.projectId);
  const prompt = [
    "Assess this PMO improvement idea for Vertex Education.",
    "Compare the Vertex Education context to the idea's facets: operational fit, likely school/team value, implementation load, data/governance risk, dependency risk, and clarity of the request.",
    "Return only valid JSON with keys impact, effort, confidence, impactReason, effortReason, confidenceReason, considerationType, consideration.",
    "Scores must be integers from 0 to 100. Effort means implementation effort and dependency load, where higher is harder.",
    "Each score reason must be a concise explanation, 8 to 14 words, naming the main driver of that score.",
    "considerationType must be pro, gap, or con.",
    "The consideration must be one concise standout pro, con, or gap for the yellow box.",
    "",
    `Workspace: ${workspaceContext.workspaceName}`,
    `Project: ${workspaceContext.projectName ?? "General workspace"}`,
    `Project description: ${workspaceContext.projectDescription ?? "Not scoped to a project"}`,
    `Project status: ${workspaceContext.projectStatus ?? "N/A"}`,
    `Idea owner: ${idea.owner}`,
    `Idea title: ${idea.title}`,
    `Category: ${idea.category}`,
    `Summary: ${idea.summary}`,
    `Original text: ${idea.originalText ?? ""}`,
    `Tags: ${idea.tags.join(", ")}`,
  ].join("\n");

  try {
    const result = await withAiTimeout(
      (signal) => runTrackedAiGateway(
        ai,
        vertexAiModelId,
        {
          messages: [
            { role: "system", content: "You are Gemma 4 assessing Vertex Education PMO ideas. Be concise and do not invent facts." },
            { role: "user", content: prompt },
          ],
          max_completion_tokens: 420,
          temperature: 0.2,
        },
        {
          feature: "gemma-idea-assessment",
          projectId: idea.projectId,
          signal,
          metadata: {
            feature: "idea-assessment",
            mode,
            projectId: idea.projectId?.slice(0, 80) ?? null,
          },
        },
      ),
      20_000,
    );
    const parsed = extractJsonObject(extractAiResponse(result).trim());
    if (!parsed) return fallback;
    const consideration = typeof parsed.consideration === "string" && parsed.consideration.trim()
      ? parsed.consideration.trim().slice(0, 240)
      : fallback.nextStep.replace(/^(?:pro|gap|con):\s*/i, "");
    const considerationType = typeof parsed.considerationType === "string" && ["pro", "gap", "con"].includes(parsed.considerationType.toLowerCase())
      ? parsed.considerationType.toLowerCase()
      : "gap";
    const reason = (key: "impactReason" | "effortReason" | "confidenceReason") =>
      typeof parsed[key] === "string" && parsed[key].trim()
        ? parsed[key].trim().replace(/\s+/g, " ").slice(0, 120)
        : "";
    const impactReason = reason("impactReason");
    const effortReason = reason("effortReason");
    const confidenceReason = reason("confidenceReason");
    if (!impactReason || !effortReason || !confidenceReason) return fallback;
    return {
      impact: boundedScore(parsed.impact, fallback.impact),
      effort: boundedScore(parsed.effort, fallback.effort),
      confidence: boundedScore(parsed.confidence, fallback.confidence),
      nextStep: `${considerationType}: ${consideration}`,
      metrics: [
        `Impact LLM: ${impactReason}`,
        `Effort LLM: ${effortReason}`,
        `Confidence LLM: ${confidenceReason}`,
      ],
      thread: ["Gemma 4 assessed impact, effort, and confidence against Vertex Education context.", `Last assessment: ${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })}`],
    };
  } catch {
    return fallback;
  }
}

export function getConversationKey(mode: WorkspaceMode, projectId: string | null, chatId: string) {
  return `${scopeByMode[mode]}::${projectId ?? "unassigned"}::${chatId}`;
}

export function workspaceModeLabel(mode: WorkspaceMode) {
  return mode;
}

export function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

async function mergePersistedArtifacts(root: PmoWorkspaceState) {
  let rows: Array<{
    id: string;
    workspaceId: string;
    parentArtifactId: string | null;
    title: string;
    type: string;
    owner: string;
    date: string;
    status: Artifact["status"];
    summary: string;
    r2Key: string;
    href: string;
    previewJson: string;
    pinned: boolean | number;
    version: number;
    commitMessage: string;
  }>;
  try {
    const result = await getDb()
      .prepare(
        `SELECT id,
                workspace_id as workspaceId,
                parent_artifact_id as parentArtifactId,
                title,
                file_type as type,
                owner,
                artifact_date as date,
                status,
                summary,
                r2_key as r2Key,
                href,
                preview_json as previewJson,
                pinned,
                version,
                commit_message as commitMessage
         FROM artifacts`,
      )
      .all<typeof rows[number]>();
    rows = result.results ?? [];
  } catch {
    return root;
  }

  const modeByWorkspaceId = new Map(Object.entries(scopeByMode).map(([mode, scope]) => [`ws-${scope}`, mode as WorkspaceMode]));
  const workspaceIdByArtifactId = new Map(rows.map((row) => [row.id, row.workspaceId]));
  const artifactsById = new Map<string, ArtifactVersion>();
  const parentIds = new Set<string>();
  for (const row of rows) {
    const mode = modeByWorkspaceId.get(row.workspaceId);
    if (!mode) continue;
    if (isSeedArtifactRow(row)) continue;
    const parsedPreview = parseArtifactPreview(row.previewJson);
    const artifact: ArtifactVersion = {
      id: row.id,
      projectId: parsedPreview.projectId,
      parentArtifactId: row.parentArtifactId,
      sourceChatTitle: parsedPreview.sourceChatTitle,
      title: row.title,
      type: row.type,
      owner: row.owner,
      date: row.date,
      status: row.status,
      summary: row.summary,
      href: artifactDownloadHref(row.r2Key, row.href),
      r2Key: row.r2Key,
      preview: parsedPreview.preview,
      previewJson: parsedPreview.previewJson,
      pinnedTo: row.pinned ? [mode] : [],
      version: row.version || 1,
      commitMessage: row.commitMessage || "Artifact version",
    };
    artifactsById.set(row.id, artifact);
    if (row.parentArtifactId) parentIds.add(row.parentArtifactId);
  }

  for (const artifact of artifactsById.values()) {
    const mode = modeByWorkspaceId.get(workspaceIdByArtifactId.get(artifact.id) ?? "");
    if (!mode || parentIds.has(artifact.id)) continue;
    const versionHistory = buildArtifactVersionHistory(artifact, artifactsById);
    const latestArtifact: Artifact = { ...artifact, versionHistory };
    const workspace = root.workspaces[mode];
    workspace.artifacts = [
      latestArtifact,
      ...workspace.artifacts.filter((item) =>
        item.r2Key !== latestArtifact.r2Key
        && item.id !== latestArtifact.id
        && !(item.title === latestArtifact.title && item.projectId === latestArtifact.projectId)
      ),
    ];
  }
  return root;
}

async function mergePersistedIdeas(root: PmoWorkspaceState) {
  let rows: Array<{
    id: string;
    workspaceId: string;
    projectId: string | null;
    title: string;
    originalText: string;
    status: IdeaStatus;
    category: string;
    owner: string;
    avatar: string;
    created: string;
    votes: number;
    impact: number;
    effort: number;
    confidence: number;
    summary: string;
    nextStep: string;
    tagsJson: string;
    metricsJson: string;
    threadJson: string;
    pinned: boolean | number;
  }>;
  try {
    const result = await getDb()
      .prepare(
        `SELECT id,
                workspace_id as workspaceId,
                project_id as projectId,
                title,
                original_text as originalText,
                status,
                category,
                owner,
                avatar,
                created_label as created,
                votes,
                impact,
                effort,
                confidence,
                summary,
                next_step as nextStep,
                tags_json as tagsJson,
                metrics_json as metricsJson,
                thread_json as threadJson,
                pinned
         FROM ideas`,
      )
      .all<typeof rows[number]>();
    rows = result.results ?? [];
  } catch {
    return root;
  }

  for (const row of rows) {
    const mode = modeForWorkspaceId(row.workspaceId);
    if (!mode) continue;
    if (isSeedIdeaRow(row)) continue;
    const workspace = root.workspaces[mode];
    const idea: Idea = {
      id: row.id,
      projectId: row.projectId,
      title: row.title,
      originalText: row.originalText || undefined,
      status: row.status,
      category: row.category,
      owner: row.owner,
      avatar: row.avatar,
      created: row.created,
      votes: row.votes,
      impact: row.impact,
      effort: row.effort,
      confidence: row.confidence,
      summary: row.summary,
      nextStep: row.nextStep,
      tags: parseStringArray(row.tagsJson),
      metrics: parseStringArray(row.metricsJson),
      thread: parseStringArray(row.threadJson),
    };
    workspace.ideas = [idea, ...workspace.ideas.filter((item) => item.id !== idea.id)];
    if (row.pinned && !workspace.pinnedIdeaIds.includes(idea.id)) {
      workspace.pinnedIdeaIds = [idea.id, ...workspace.pinnedIdeaIds];
    }
  }
  return root;
}

async function mergePersistedWorkflowActions(root: PmoWorkspaceState) {
  let rows: Array<{
    id: string;
    workspaceId: string;
    kind: "approval" | "decision" | "task";
    projectId: string | null;
    title: string;
    originalText: string;
    owner: string;
    due: string;
    source: string | null;
    status: string;
    pinned: boolean | number;
  }>;
  try {
    const result = await getDb()
      .prepare(
        `SELECT id,
                workspace_id as workspaceId,
                kind,
                project_id as projectId,
                title,
                original_text as originalText,
                owner,
                due,
                source,
                status,
                pinned
         FROM workspace_actions`,
      )
      .all<typeof rows[number]>();
    rows = result.results ?? [];
  } catch {
    return root;
  }

  for (const row of rows) {
    const mode = modeForWorkspaceId(row.workspaceId);
    if (!mode) continue;
    if (isSeedWorkflowActionRow(row)) continue;
    const workspace = root.workspaces[mode];
    if (row.kind === "task") {
      const task: Task = {
        id: row.id,
        projectId: row.projectId,
        title: row.title,
        originalText: row.originalText || undefined,
        owner: row.owner,
        source: row.source || "VertexAI suggestion",
        status: row.status === "Completed" ? "Completed" : "Open",
        pinned: Boolean(row.pinned),
      };
      workspace.tasks = [task, ...workspace.tasks.filter((item) => item.id !== task.id)];
    } else if (row.kind === "approval") {
      const status = ["Not Reviewed", "Reviewing", "Approved", "Not Approved"].includes(row.status)
        ? row.status as Approval["status"]
        : "Not Reviewed";
      const approval: Approval = {
        id: row.id,
        projectId: row.projectId,
        title: row.title,
        originalText: row.originalText || undefined,
        owner: row.owner,
        due: row.due,
        status,
        pinned: Boolean(row.pinned),
      };
      workspace.approvals = [approval, ...workspace.approvals.filter((item) => item.id !== approval.id)];
    } else {
      const decision: Decision = {
        id: row.id,
        projectId: row.projectId,
        title: row.title,
        originalText: row.originalText || undefined,
        owner: row.owner,
        due: row.due,
        status: row.status === "Completed" ? "Completed" : "Not Completed",
        pinned: Boolean(row.pinned),
      };
      workspace.decisions = [decision, ...workspace.decisions.filter((item) => item.id !== decision.id)];
    }
  }
  return root;
}

async function mergePersistedWorkspace(root: PmoWorkspaceState) {
  const withArtifacts = await mergePersistedArtifacts(root);
  for (const workspace of Object.values(withArtifacts.workspaces)) {
    workspace.ideas = [];
    workspace.pinnedIdeaIds = [];
    workspace.decisions = [];
    workspace.approvals = [];
    workspace.tasks = [];
  }
  return mergePersistedWorkflowActions(await mergePersistedIdeas(withArtifacts));
}

function parseStringArray(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

function isSeedArtifactRow(row: { id: string; r2Key: string; summary: string; owner: string }) {
  return row.id.startsWith("artifact-personal-")
    || row.id.startsWith("artifact-team-")
    || row.id.startsWith("artifact-org-")
    || row.summary.toLowerCase().includes("dummy")
    || /^(personal|team|org)\/artifacts\//.test(row.r2Key);
}

function isSeedIdeaRow(row: { id: string; title: string }) {
  return row.id.startsWith("personal-idea-")
    || row.id.startsWith("team-idea-")
    || row.id.startsWith("org-idea-");
}

function isSeedWorkflowActionRow(row: { id: string; title: string }) {
  return row.id.startsWith("personal-task-")
    || row.id.startsWith("team-task-")
    || row.id.startsWith("org-task-")
    || row.id.startsWith("personal-decision-")
    || row.id.startsWith("team-decision-")
    || row.id.startsWith("org-decision-")
    || row.title.toLowerCase().includes("dummy");
}

function parseArtifactPreview(previewJsonText: string): {
  preview: string[];
  previewJson?: JsonValue;
  projectId: string | null;
  sourceChatTitle?: string;
} {
  let preview: string[] = [];
  let previewJson: JsonValue | undefined;
  let projectId: string | null = null;
  let sourceChatTitle: string | undefined;
  try {
    const parsed = JSON.parse(previewJsonText) as JsonValue;
    previewJson = parsed;
    if (Array.isArray(parsed)) {
      preview = parsed.map((item) => String(item));
    } else if (parsed && typeof parsed === "object") {
      const record = parsed as { preview?: unknown; projectId?: unknown; sourceChatTitle?: unknown };
      preview = Array.isArray(record.preview) ? record.preview.map((item) => String(item)) : [];
      projectId = typeof record.projectId === "string" && record.projectId ? record.projectId : null;
      sourceChatTitle = typeof record.sourceChatTitle === "string" && record.sourceChatTitle ? record.sourceChatTitle : undefined;
    }
  } catch {
    preview = [];
  }
  return { preview, previewJson, projectId, sourceChatTitle };
}

function buildArtifactVersionHistory(latest: ArtifactVersion, artifactsById: Map<string, ArtifactVersion>) {
  const history: ArtifactVersion[] = [];
  const seen = new Set<string>();
  let current: ArtifactVersion | undefined = latest;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    history.push(current);
    current = current.parentArtifactId ? artifactsById.get(current.parentArtifactId) : undefined;
  }
  return history.sort((left, right) => right.version - left.version);
}

export const fetchPmoWorkspace = createServerFn({ method: "GET" }).handler(async () => {
  return mergePersistedWorkspace(clone(getMutableRoot()));
});

async function persistIdea(mode: WorkspaceMode, idea: Idea, pinned: boolean) {
  await getDb()
    .prepare(
      `INSERT OR REPLACE INTO ideas (
         id, workspace_id, project_id, title, original_text, status, category, owner, avatar,
         created_label, votes, impact, effort, confidence, summary, next_step,
         tags_json, metrics_json, thread_json, pinned
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      idea.id,
      workspaceIdForMode(mode),
      idea.projectId,
      idea.title,
      idea.originalText ?? "",
      idea.status,
      idea.category,
      idea.owner,
      idea.avatar,
      idea.created,
      idea.votes,
      idea.impact,
      idea.effort,
      idea.confidence,
      idea.summary,
      idea.nextStep,
      JSON.stringify(idea.tags),
      JSON.stringify(idea.metrics),
      JSON.stringify(idea.thread),
      pinned ? 1 : 0,
    )
    .run();
}

async function persistWorkflowAction(
  mode: WorkspaceMode,
  kind: "approval" | "decision" | "task",
  item: Approval | Decision | Task,
) {
  await getDb()
    .prepare(
      `INSERT OR REPLACE INTO workspace_actions (
         id, workspace_id, kind, project_id, title, original_text, owner, due, source, status, pinned, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      item.id,
      workspaceIdForMode(mode),
      kind,
      item.projectId,
      item.title,
      item.originalText ?? "",
      item.owner,
      kind === "task" ? "" : (item as Approval | Decision).due,
      kind === "task" ? (item as Task).source : null,
      item.status,
      item.pinned ? 1 : 0,
      Date.now(),
    )
    .run();
}

async function updatePersistedWorkflowActionStatus(
  mode: WorkspaceMode,
  kind: "approval" | "decision" | "task",
  id: string,
  status: string,
) {
  await getDb()
    .prepare("UPDATE workspace_actions SET status = ? WHERE id = ? AND workspace_id = ? AND kind = ?")
    .bind(status, id, workspaceIdForMode(mode), kind)
    .run();
}

async function deletePersistedWorkflowAction(mode: WorkspaceMode, kind: "approval" | "decision" | "task", id: string) {
  await getDb()
    .prepare("DELETE FROM workspace_actions WHERE id = ? AND workspace_id = ? AND kind = ?")
    .bind(id, workspaceIdForMode(mode), kind)
    .run();
}

async function updatePersistedWorkflowActionPinned(
  mode: WorkspaceMode,
  kind: "approval" | "decision" | "task",
  id: string,
  pinned: boolean,
) {
  await getDb()
    .prepare("UPDATE workspace_actions SET pinned = ? WHERE id = ? AND workspace_id = ? AND kind = ?")
    .bind(pinned ? 1 : 0, id, workspaceIdForMode(mode), kind)
    .run();
}

async function requireWorkspaceEditor() {
  const request = getRequest();
  const session = await getAuth(request).api.getSession({ headers: request.headers });
  const user = (session as { user?: { id?: string; name?: string | null; email?: string | null; role?: string | null } } | null)?.user;
  if (user?.role !== "admin" && user?.role !== "user" || !user.id) {
    throw new Error("Viewer accounts have view-only access.");
  }
  return {
    id: user.id,
    name: user.name?.trim() || user.email?.trim() || "You",
    email: user.email?.trim() || "",
    clientId: request.headers.get("x-vertex-client-id"),
  };
}

async function recordWorkspaceMutation({
  chatId = null,
  entity,
  entityId,
  invalidates,
  mode,
  operation,
  projectId = null,
  sourceClientId = null,
  sourceUserId,
  teamId = null,
  workspaceId,
}: {
  chatId?: string | null;
  entity: string;
  entityId: string;
  invalidates: RealtimeInvalidationTarget[];
  mode: WorkspaceMode;
  operation: string;
  projectId?: string | null;
  sourceClientId?: string | null;
  sourceUserId: string;
  teamId?: string | null;
  workspaceId?: string;
}) {
  const resolvedWorkspaceId = workspaceId ?? `ws-${scopeByMode[mode]}`;
  await recordRealtimeMutationEvent(getDb(), {
    chatId,
    entity,
    entityId,
    invalidates,
    mode,
    operation,
    projectId,
    sourceClientId,
    sourceUserId,
    teamId,
    workspaceId: resolvedWorkspaceId,
  });
}

async function requireChatContributor({
  chatId,
  mode,
  projectId,
  teamId,
  userId,
}: {
  chatId: string;
  mode: WorkspaceMode;
  projectId: string | null;
  teamId?: string | null;
  userId: string;
}) {
  if (projectId) {
    const membership = await getDb()
      .prepare(
        `SELECT pm.project_id
         FROM project_members pm
         INNER JOIN chats c ON c.project_id = pm.project_id
         WHERE c.id = ?
           AND pm.project_id = ?
           AND pm.user_id = ?
           AND ((? IS NULL AND pm.team_id IS NULL) OR pm.team_id = ?)
         LIMIT 1`,
      )
      .bind(chatId, projectId, userId, mode === "Team" ? teamId ?? null : null, mode === "Team" ? teamId ?? null : null)
      .first<{ project_id: string }>();
    if (!membership) throw new Error("You are not assigned to this project chat.");
    return;
  }

  if (mode === "Team") {
    const membership = await getDb()
      .prepare(
        `SELECT cm.chat_id
         FROM chat_members cm
         INNER JOIN team_members tm ON tm.team_id = cm.team_id
         WHERE cm.chat_id = ?
           AND cm.team_id = ?
           AND tm.user_id = ?
         LIMIT 1`,
      )
      .bind(chatId, teamId ?? "", userId)
      .first<{ chat_id: string }>();
    if (!membership) throw new Error("You are not a member of this team chat.");
    return;
  }

  const membership = await getDb()
    .prepare("SELECT chat_id FROM chat_members WHERE chat_id = ? AND user_id = ? AND team_id IS NULL LIMIT 1")
    .bind(chatId, userId)
    .first<{ chat_id: string }>();
  if (!membership) throw new Error("You are not a member of this chat.");
}

function chatSyncScopeKey({
  mode,
  teamId,
  userId,
  workspaceId,
}: {
  mode: WorkspaceMode;
  teamId: string | null;
  userId: string;
  workspaceId: string;
}) {
  if (mode === "Team") return `${workspaceId}:team:${teamId ?? ""}`;
  if (mode === "Org") return `${workspaceId}:org`;
  return `${workspaceId}:user:${userId}`;
}

export const sendChatMessage = createServerFn({ method: "POST" })
  .validator((data: SendChatMessageInput) => data)
  .handler(async ({ context, data }): Promise<SendChatMessageResult> => {
    const user = await requireWorkspaceEditor();
    await requireChatContributor({
      chatId: data.chatId,
      mode: data.mode,
      projectId: data.projectId,
      teamId: data.teamId,
      userId: user.id,
    });
    const workspace = getMutableWorkspace(data.mode);
    const conversationKey = getConversationKey(data.mode, data.projectId, data.chatId);
    const text = data.text.trim();
    const attachments = sanitizeChatAttachments(data.attachments);
    if (!text && attachments.length === 0) return { workspace: clone(getMutableRoot()), llmTrace: null };
    const existingMessages = await listPersistedChatMessages(data.chatId);
    const titleSeed = text || attachments.map((attachment) => attachment.name).join(", ");
    const chatTitle = existingMessages.length === 0 ? await generateChatTitleFromInitialMessage(context, titleSeed) : data.chatTitle;

    const userMessage: ChatMessage = {
      id: createId("msg-user"),
      author: "You",
      role: "user",
      avatar: avatarAlex,
      time: nowLabel(),
      text: text || "Attached files for review.",
      attachments: attachments.length ? attachments : undefined,
    };
    const aiResult = await runGemmaChat({
      context,
      data: { ...data, chatTitle, text: userMessage.text, attachments },
      existingMessages,
      workspace,
    });
    const response: ChatMessage = {
      id: createId("msg-assistant"),
      author: assistantName,
      role: "assistant",
      time: nowLabel(),
      text: aiResult.text,
    };

    const workspaceId = await getChatWorkspaceId(data.chatId);
    if (chatTitle !== data.chatTitle) {
      await getDb()
        .prepare("UPDATE chats SET title = ? WHERE id = ?")
        .bind(chatTitle, data.chatId)
        .run();
    }
    const insertedMessages = [
      await persistChatMessage({
        chatId: data.chatId,
        workspaceId,
        projectId: data.projectId,
        mode: data.mode,
        message: userMessage,
      }),
      await persistChatMessage({
        chatId: data.chatId,
        workspaceId,
        projectId: data.projectId,
        mode: data.mode,
        message: response,
      }),
    ];
    await publishChatMessageInserts(
      (env as Env).CHAT_SYNC,
      chatSyncScopeKey({
        mode: data.mode,
        teamId: data.teamId ?? null,
        userId: user.id,
        workspaceId,
      }),
      insertedMessages,
    );
    await recordWorkspaceMutation({
      chatId: data.chatId,
      entity: "chat_message",
      entityId: insertedMessages.at(-1)?.id ?? data.chatId,
      invalidates: ["workspace", "chats", "projects"],
      mode: data.mode,
      operation: "insert",
      projectId: data.projectId,
      sourceClientId: user.clientId,
      sourceUserId: user.id,
      teamId: data.mode === "Team" ? data.teamId ?? null : null,
      workspaceId,
    });
    workspace.conversations[conversationKey] = [...existingMessages, userMessage, response];
    recordActivity(workspace, "Chat response generated", `${chatTitle} updated in ${workspaceModeLabel(data.mode)}.`);
    return { workspace: clone(getMutableRoot()), llmTrace: aiResult.trace };
  });

export const addIdea = createServerFn({ method: "POST" })
  .validator((data: AddIdeaInput & { mode?: WorkspaceMode; projectId?: string | null }) => data)
  .handler(async ({ context, data }) => {
    const user = await requireWorkspaceEditor();
    const mode = data.mode ?? "Personal";
    const workspace = getMutableWorkspace(mode);
    const title = data.title.trim();
    if (!title) return mergePersistedWorkspace(clone(getMutableRoot()));

    const baseIdea: Idea = {
      id: createId(`${workspace.scope}-idea`),
      projectId: data.projectId ?? null,
      title,
      originalText: data.summary.trim() || title,
      status: data.status,
      category: data.category,
      owner: user.name,
      avatar: avatarAlex,
      created: "Just now",
      votes: 0,
      impact: 0,
      effort: 0,
      confidence: 0,
      summary: data.summary.trim() || `New ${workspaceModeLabel(mode).toLowerCase()} improvement idea captured from the current scope.`,
      nextStep: "",
      tags: [data.category, data.impact, workspaceModeLabel(mode), data.projectId ? "Project" : "General"],
      metrics: [],
      thread: [],
    };
    const assessment = await assessIdeaWithGemma({ context, mode, idea: baseIdea });
    const nextIdea: Idea = { ...baseIdea, ...assessment };

    workspace.ideas = [nextIdea, ...workspace.ideas];
    await persistIdea(mode, nextIdea, false);
    recordActivity(workspace, "Idea added", `${nextIdea.title} entered ${workspaceModeLabel(mode)}.`);
    await recordWorkspaceMutation({
      entity: "idea",
      entityId: nextIdea.id,
      invalidates: ["workspace"],
      mode,
      operation: "insert",
      projectId: nextIdea.projectId,
      sourceClientId: user.clientId,
      sourceUserId: user.id,
    });
    return mergePersistedWorkspace(clone(getMutableRoot()));
  });

export const updateIdeaStatus = createServerFn({ method: "POST" })
  .validator((data: { mode: WorkspaceMode; id: string; status: IdeaStatus }) => data)
  .handler(async ({ data }) => {
    const user = await requireWorkspaceEditor();
    const workspace = getMutableWorkspace(data.mode);
    workspace.ideas = workspace.ideas.map((idea) => (idea.id === data.id ? { ...idea, status: data.status } : idea));
    const idea = workspace.ideas.find((item) => item.id === data.id);
    await getDb()
      .prepare("UPDATE ideas SET status = ? WHERE id = ? AND workspace_id = ?")
      .bind(data.status, data.id, workspaceIdForMode(data.mode))
      .run();
    recordActivity(workspace, "Idea status changed", `${idea?.title ?? "Idea"} moved to ${data.status}.`);
    await recordWorkspaceMutation({
      entity: "idea",
      entityId: data.id,
      invalidates: ["workspace"],
      mode: data.mode,
      operation: "update",
      projectId: idea?.projectId ?? null,
      sourceClientId: user.clientId,
      sourceUserId: user.id,
    });
    return mergePersistedWorkspace(clone(getMutableRoot()));
  });

export const voteIdea = createServerFn({ method: "POST" })
  .validator((data: { mode: WorkspaceMode; id: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireWorkspaceEditor();
    const workspace = getMutableWorkspace(data.mode);
    workspace.ideas = workspace.ideas.map((idea) => (idea.id === data.id ? { ...idea, votes: idea.votes + 1 } : idea));
    const idea = workspace.ideas.find((item) => item.id === data.id);
    await getDb()
      .prepare("UPDATE ideas SET votes = votes + 1 WHERE id = ? AND workspace_id = ?")
      .bind(data.id, workspaceIdForMode(data.mode))
      .run();
    recordActivity(workspace, "Idea vote added", `${idea?.title ?? "Idea"} gained a vote.`);
    await recordWorkspaceMutation({
      entity: "idea",
      entityId: data.id,
      invalidates: ["workspace"],
      mode: data.mode,
      operation: "vote",
      projectId: idea?.projectId ?? null,
      sourceClientId: user.clientId,
      sourceUserId: user.id,
    });
    return mergePersistedWorkspace(clone(getMutableRoot()));
  });

export const toggleIdeaPin = createServerFn({ method: "POST" })
  .validator((data: { mode: WorkspaceMode; id: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireWorkspaceEditor();
    const workspace = getMutableWorkspace(data.mode);
    const isPinned = workspace.pinnedIdeaIds.includes(data.id);
    workspace.pinnedIdeaIds = isPinned ? workspace.pinnedIdeaIds.filter((id) => id !== data.id) : [data.id, ...workspace.pinnedIdeaIds];
    const idea = workspace.ideas.find((item) => item.id === data.id);
    await getDb()
      .prepare("UPDATE ideas SET pinned = ? WHERE id = ? AND workspace_id = ?")
      .bind(isPinned ? 0 : 1, data.id, workspaceIdForMode(data.mode))
      .run();
    recordActivity(workspace, isPinned ? "Idea unpinned" : "Idea pinned", `${idea?.title ?? "Idea"} workspace pin changed.`);
    await recordWorkspaceMutation({
      entity: "idea",
      entityId: data.id,
      invalidates: ["workspace"],
      mode: data.mode,
      operation: isPinned ? "unpin" : "pin",
      projectId: idea?.projectId ?? null,
      sourceClientId: user.clientId,
      sourceUserId: user.id,
    });
    return mergePersistedWorkspace(clone(getMutableRoot()));
  });

export const toggleWorkflowActionPin = createServerFn({ method: "POST" })
  .validator((data: { mode: WorkspaceMode; kind: "approval" | "decision" | "task"; id: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireWorkspaceEditor();
    const workspace = getMutableWorkspace(data.mode);
    const persistedAction = await getDb()
      .prepare("SELECT title, project_id as projectId, pinned FROM workspace_actions WHERE id = ? AND workspace_id = ? AND kind = ? LIMIT 1")
      .bind(data.id, workspaceIdForMode(data.mode), data.kind)
      .first<{ title: string; projectId: string | null; pinned: boolean | number }>();
    const collection = data.kind === "task"
      ? workspace.tasks
      : data.kind === "approval"
        ? workspace.approvals
        : workspace.decisions;
    const item = collection.find((entry) => entry.id === data.id);
    const nextPinned = !(persistedAction ? Boolean(persistedAction.pinned) : Boolean(item?.pinned));

    if (data.kind === "task") {
      workspace.tasks = workspace.tasks.map((task) => task.id === data.id ? { ...task, pinned: nextPinned } : task);
    } else if (data.kind === "approval") {
      workspace.approvals = workspace.approvals.map((approval) => approval.id === data.id ? { ...approval, pinned: nextPinned } : approval);
    } else {
      workspace.decisions = workspace.decisions.map((decision) => decision.id === data.id ? { ...decision, pinned: nextPinned } : decision);
    }

    await updatePersistedWorkflowActionPinned(data.mode, data.kind, data.id, nextPinned);
    const label = data.kind === "task" ? "Task" : data.kind === "approval" ? "Approval" : "Decision";
    recordActivity(workspace, nextPinned ? `${label} pinned` : `${label} unpinned`, `${item?.title ?? persistedAction?.title ?? label} workspace pin changed.`);
    await recordWorkspaceMutation({
      entity: data.kind,
      entityId: data.id,
      invalidates: ["workspace"],
      mode: data.mode,
      operation: nextPinned ? "pin" : "unpin",
      projectId: item?.projectId ?? persistedAction?.projectId ?? null,
      sourceClientId: user.clientId,
      sourceUserId: user.id,
    });
    return mergePersistedWorkspace(clone(getMutableRoot()));
  });

export const toggleArtifactPin = createServerFn({ method: "POST" })
  .validator((data: { mode: WorkspaceMode; r2Key: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireWorkspaceEditor();
    const workspace = getMutableWorkspace(data.mode);
    const persistedArtifact = await getDb()
      .prepare("SELECT pinned FROM artifacts WHERE r2_key = ? LIMIT 1")
      .bind(data.r2Key)
      .first<{ pinned: boolean | number }>();
    const memoryArtifact = workspace.artifacts.find((item) => item.r2Key === data.r2Key);
    const isPinned = persistedArtifact
      ? Boolean(persistedArtifact.pinned)
      : Boolean(memoryArtifact?.pinnedTo.includes(data.mode));
    const nextPinned = !isPinned;

    workspace.artifacts = workspace.artifacts.map((artifact) => {
      if (artifact.r2Key !== data.r2Key) return artifact;
      return { ...artifact, pinnedTo: isPinned ? artifact.pinnedTo.filter((mode) => mode !== data.mode) : [...artifact.pinnedTo, data.mode] };
    });
    await getDb()
      .prepare("UPDATE artifacts SET pinned = ? WHERE r2_key = ?")
      .bind(nextPinned ? 1 : 0, data.r2Key)
      .run();
    const artifact = workspace.artifacts.find((item) => item.r2Key === data.r2Key) ?? memoryArtifact;
    recordActivity(workspace, "Artifact pin changed", `${artifact?.title ?? "Artifact"} updated for ${workspaceModeLabel(data.mode)}.`);
    await recordWorkspaceMutation({
      entity: "artifact",
      entityId: data.r2Key,
      invalidates: ["workspace"],
      mode: data.mode,
      operation: nextPinned ? "pin" : "unpin",
      projectId: artifact?.projectId ?? null,
      sourceClientId: user.clientId,
      sourceUserId: user.id,
    });
    return mergePersistedWorkspace(clone(getMutableRoot()));
  });

export const deleteArtifact = createServerFn({ method: "POST" })
  .validator((data: { mode: WorkspaceMode; r2Key: string }) => data)
  .handler(async () => {
    await requireWorkspaceEditor();
    throw new Error("Artifacts are immutable. Use version history to restore an earlier state instead of deleting historical records.");
  });

type ArtifactVersionSourceRow = {
  id: string;
  workspaceId: string;
  parentArtifactId: string | null;
  title: string;
  fileType: string;
  owner: string;
  artifactDate: string;
  status: Artifact["status"];
  summary: string;
  r2Key: string;
  href: string;
  previewJson: string;
  pinned: boolean | number;
  version: number;
};

async function findArtifactVersionSource(id: string) {
  return getDb()
    .prepare(
      `SELECT id,
              workspace_id as workspaceId,
              parent_artifact_id as parentArtifactId,
              title,
              file_type as fileType,
              owner,
              artifact_date as artifactDate,
              status,
              summary,
              r2_key as r2Key,
              href,
              preview_json as previewJson,
              pinned,
              version
       FROM artifacts
       WHERE id = ?
       LIMIT 1`,
    )
    .bind(id)
    .first<ArtifactVersionSourceRow>();
}

async function findLatestArtifactVersionInLineage(id: string) {
  return getDb()
    .prepare(
      `WITH RECURSIVE ancestors(id, parent_artifact_id) AS (
         SELECT id, parent_artifact_id
         FROM artifacts
         WHERE id = ?
         UNION ALL
         SELECT artifacts.id, artifacts.parent_artifact_id
         FROM artifacts
         INNER JOIN ancestors ON ancestors.parent_artifact_id = artifacts.id
       ),
       root(id) AS (
         SELECT id
         FROM ancestors
         WHERE parent_artifact_id IS NULL
         LIMIT 1
       ),
       descendants(id, version, pinned, r2Key) AS (
         SELECT artifacts.id, artifacts.version, artifacts.pinned, artifacts.r2_key
         FROM artifacts
         INNER JOIN root ON artifacts.id = root.id
         UNION ALL
         SELECT artifacts.id, artifacts.version, artifacts.pinned, artifacts.r2_key
         FROM artifacts
         INNER JOIN descendants ON artifacts.parent_artifact_id = descendants.id
       )
       SELECT id, version, pinned, r2Key
       FROM descendants
       WHERE id NOT IN (SELECT parent_artifact_id FROM artifacts WHERE parent_artifact_id IS NOT NULL)
       ORDER BY version DESC
       LIMIT 1`,
    )
    .bind(id)
    .first<{ id: string; version: number; pinned: boolean | number; r2Key: string }>();
}

function versionedR2KeyFrom(baseKey: string, nextVersion: number) {
  const lastSlash = baseKey.lastIndexOf("/");
  const folder = lastSlash >= 0 ? baseKey.slice(0, lastSlash + 1) : "";
  const fileName = lastSlash >= 0 ? baseKey.slice(lastSlash + 1) : baseKey;
  const dot = fileName.lastIndexOf(".");
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const extension = dot > 0 ? fileName.slice(dot) : "";
  return `${folder}versions/${stem}-v${nextVersion}-${crypto.randomUUID()}${extension}`;
}

export const restoreArtifactVersion = createServerFn({ method: "POST" })
  .validator((data: { mode: WorkspaceMode; artifactId: string; commitMessage?: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireWorkspaceEditor();
    const source = await findArtifactVersionSource(data.artifactId);
    if (!source) throw new Error("Artifact version was not found.");
    const workspaceId = `ws-${scopeByMode[data.mode]}`;
    if (source.workspaceId !== workspaceId) throw new Error("Artifact version is outside the selected workspace.");

    const latest = await findLatestArtifactVersionInLineage(source.id);
    if (!latest) throw new Error("Latest artifact version was not found.");

    const object = await getArtifactsBucket().get(source.r2Key);
    if (!object?.body) throw new Error("Historical artifact file was not found.");

    const nextVersion = (latest.version || source.version || 1) + 1;
    const nextId = `artifact-${crypto.randomUUID()}`;
    const nextR2Key = versionedR2KeyFrom(latest.r2Key, nextVersion);
    await getArtifactsBucket().put(nextR2Key, await object.arrayBuffer(), {
      httpMetadata: object.httpMetadata,
      customMetadata: {
        ...(object.customMetadata ?? {}),
        restored_from_artifact_id: source.id,
        parent_artifact_id: latest.id,
        version: String(nextVersion),
      },
    });
    const href = artifactDownloadHref(nextR2Key, source.href);
    const commitMessage = (data.commitMessage?.trim() || `Restored version ${source.version}`).slice(0, 160);

    await getDb()
      .prepare(
        `INSERT INTO artifacts (
          id,
          workspace_id,
          title,
          file_type,
          owner,
          artifact_date,
          status,
          summary,
          r2_key,
          href,
          preview_json,
          pinned,
          version,
          parent_artifact_id,
          commit_message
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        nextId,
        source.workspaceId,
        source.title,
        source.fileType,
        source.owner,
        new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
        source.status,
        source.summary,
        nextR2Key,
        href,
        source.previewJson,
        latest.pinned ? 1 : 0,
        nextVersion,
        latest.id,
        commitMessage,
      )
      .run();

    const workspace = getMutableWorkspace(data.mode);
    recordActivity(workspace, "Artifact restored", `${source.title} restored as version ${nextVersion}.`);
    await recordWorkspaceMutation({
      entity: "artifact",
      entityId: nextId,
      invalidates: ["workspace"],
      mode: data.mode,
      operation: "restore",
      sourceClientId: user.clientId,
      sourceUserId: user.id,
    });
    return mergePersistedWorkspace(clone(getMutableRoot()));
  });

export const saveTableArtifact = createServerFn({ method: "POST" })
  .validator((data: FormData) => data)
  .handler(async ({ data }) => {
    const user = await requireWorkspaceEditor();
    const modeValue = requiredFormString(data, "mode", "Workspace mode");
    if (!workspaceModes.includes(modeValue as WorkspaceMode)) throw new Error("Workspace mode is invalid.");
    const mode = modeValue as WorkspaceMode;
    const projectId = optionalFormString(data, "project_id");
    const sourceChatTitle = optionalFormString(data, "chat_title") ?? undefined;
    const baseArtifactId = optionalFormString(data, "base_artifact_id");
    const commitMessage = (optionalFormString(data, "commit_message") ?? "Updated from follow-on chat").slice(0, 160);
    const seedTitle = requiredFormString(data, "title", "Artifact title").slice(0, 96);
    const rowsJson = requiredFormString(data, "rows_json", "Table rows");
    let rows: ExportTable["rows"];
    try {
      const parsed = JSON.parse(rowsJson);
      if (!Array.isArray(parsed)) throw new Error("Rows must be an array.");
      rows = parsed as ExportTable["rows"];
    } catch {
      throw new Error("Table rows are invalid.");
    }
    if (rows.length === 0) throw new Error("The table does not contain rows to save.");

    const workspace = getMutableWorkspace(mode);
    const workspaceId = `ws-${scopeByMode[mode]}`;
    const baseArtifact = baseArtifactId ? await findArtifactVersionSource(baseArtifactId) : null;
    if (baseArtifactId && (!baseArtifact || baseArtifact.workspaceId !== workspaceId)) {
      throw new Error("The artifact being updated is not available in this workspace.");
    }
    const latestBaseArtifact = baseArtifact ? await findLatestArtifactVersionInLineage(baseArtifact.id) : null;
    if (baseArtifact && !latestBaseArtifact) throw new Error("Latest artifact version was not found.");
    const title = baseArtifact?.title ?? (await generateArtifactTitle(seedTitle, rows)).slice(0, 96);
    const nextVersion = latestBaseArtifact ? (latestBaseArtifact.version || 1) + 1 : 1;
    const fileName = `${safeArtifactFileName(title)}.xlsx`;
    const xlsxBlob = await xlsxBlobFromRows(title, rows);
    const r2Key = baseArtifact
      ? versionedR2KeyFrom(latestBaseArtifact?.r2Key ?? baseArtifact.r2Key, nextVersion)
      : `${scopeByMode[mode]}/generated/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${fileName}`;
    const href = artifactDownloadHref(r2Key, `/artifacts/${fileName}`);
    const artifactDate = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const artifactId = `artifact-${crypto.randomUUID()}`;
    const artifact: Artifact = {
      id: artifactId,
      projectId,
      sourceChatTitle,
      title,
      type: "XLSX",
      owner: "You",
      date: artifactDate,
      status: "Draft",
      summary: "XLSX artifact saved from a rendered table.",
      href,
      r2Key,
      preview: ["Saved table export", fileName],
      previewJson: buildTablePreviewJson(rows, ["Saved table export", fileName], projectId, sourceChatTitle),
      pinnedTo: latestBaseArtifact?.pinned ? [mode] : [],
      version: nextVersion,
      parentArtifactId: latestBaseArtifact?.id ?? null,
      commitMessage: baseArtifact ? commitMessage : "Saved from chat table export",
    };

    await getArtifactsBucket().put(r2Key, xlsxBlob, {
      httpMetadata: {
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
      customMetadata: {
        title,
        workspace_mode: mode,
        project_id: projectId ?? "",
        source_chat_title: sourceChatTitle ?? "",
        parent_artifact_id: latestBaseArtifact?.id ?? "",
        version: String(nextVersion),
      },
    });

    await getDb()
      .prepare(
        `INSERT INTO artifacts (
          id,
          workspace_id,
          title,
          file_type,
          owner,
          artifact_date,
          status,
          summary,
          r2_key,
          href,
          preview_json,
          pinned,
          version,
          parent_artifact_id,
          commit_message
        ) VALUES (?, ?, ?, 'XLSX', 'You', ?, 'Draft', ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        artifactId,
        workspaceId,
        title,
        artifactDate,
        artifact.summary,
        r2Key,
        href,
        JSON.stringify(artifact.previewJson),
        latestBaseArtifact?.pinned ? 1 : 0,
        nextVersion,
        latestBaseArtifact?.id ?? null,
        artifact.commitMessage,
      )
      .run();

    workspace.artifacts = [artifact, ...workspace.artifacts.filter((item) => item.r2Key !== r2Key && item.id !== baseArtifact?.id)];
    recordActivity(workspace, baseArtifact ? "Artifact version saved" : "Artifact saved", `${title} saved as version ${nextVersion}.`);
    await recordWorkspaceMutation({
      entity: "artifact",
      entityId: artifactId,
      invalidates: ["workspace"],
      mode,
      operation: baseArtifact ? "version" : "insert",
      projectId,
      sourceClientId: user.clientId,
      sourceUserId: user.id,
    });
    const mergedWorkspace = await mergePersistedWorkspace(clone(getMutableRoot()));
    return { workspace: mergedWorkspace, artifact };
  });

function buildTablePreviewJson(
  rows: ExportTable["rows"],
  preview: string[],
  projectId: string | null,
  sourceChatTitle: string | undefined,
): JsonValue {
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const dataRows = rows.slice(0, 100).map((row) => columns.map((column) => String(row[column] ?? "")));
  return {
    kind: "table",
    preview,
    projectId,
    sourceChatTitle: sourceChatTitle ?? null,
    columns,
    rows: dataRows,
  };
}

export const toggleDecisionStatus = createServerFn({ method: "POST" })
  .validator((data: { mode: WorkspaceMode; id: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireWorkspaceEditor();
    const workspace = getMutableWorkspace(data.mode);
    workspace.decisions = workspace.decisions.map((decision) => (decision.id === data.id ? { ...decision, status: cycleDecisionStatus(decision.status) } : decision));
    const decision = workspace.decisions.find((item) => item.id === data.id);
    if (decision) await updatePersistedWorkflowActionStatus(data.mode, "decision", data.id, decision.status);
    recordActivity(workspace, "Decision updated", `${decision?.title ?? "Decision"} is now ${decision?.status ?? "updated"}.`);
    await recordWorkspaceMutation({
      entity: "decision",
      entityId: data.id,
      invalidates: ["workspace"],
      mode: data.mode,
      operation: "update",
      projectId: decision?.projectId ?? null,
      sourceClientId: user.clientId,
      sourceUserId: user.id,
    });
    return mergePersistedWorkspace(clone(getMutableRoot()));
  });

export const toggleApprovalStatus = createServerFn({ method: "POST" })
  .validator((data: { mode: WorkspaceMode; id: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireWorkspaceEditor();
    const workspace = getMutableWorkspace(data.mode);
    workspace.approvals = workspace.approvals.map((approval) => (approval.id === data.id ? { ...approval, status: cycleApprovalStatus(approval.status) } : approval));
    const approval = workspace.approvals.find((item) => item.id === data.id);
    if (approval) await updatePersistedWorkflowActionStatus(data.mode, "approval", data.id, approval.status);
    recordActivity(workspace, "Approval updated", `${approval?.title ?? "Approval"} is now ${approval?.status ?? "updated"}.`);
    await recordWorkspaceMutation({
      entity: "approval",
      entityId: data.id,
      invalidates: ["workspace"],
      mode: data.mode,
      operation: "update",
      projectId: approval?.projectId ?? null,
      sourceClientId: user.clientId,
      sourceUserId: user.id,
    });
    return mergePersistedWorkspace(clone(getMutableRoot()));
  });

export const toggleTaskStatus = createServerFn({ method: "POST" })
  .validator((data: { mode: WorkspaceMode; id: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireWorkspaceEditor();
    const workspace = getMutableWorkspace(data.mode);
    workspace.tasks = workspace.tasks.map((task) => (task.id === data.id ? { ...task, status: cycleTaskStatus(task.status) } : task));
    const task = workspace.tasks.find((item) => item.id === data.id);
    if (task) await updatePersistedWorkflowActionStatus(data.mode, "task", data.id, task.status);
    recordActivity(workspace, "Task updated", `${task?.title ?? "Task"} is now ${task?.status ?? "updated"}.`);
    await recordWorkspaceMutation({
      entity: "task",
      entityId: data.id,
      invalidates: ["workspace"],
      mode: data.mode,
      operation: "update",
      projectId: task?.projectId ?? null,
      sourceClientId: user.clientId,
      sourceUserId: user.id,
    });
    return mergePersistedWorkspace(clone(getMutableRoot()));
  });

export const updateTaskStatus = createServerFn({ method: "POST" })
  .validator((data: { mode: WorkspaceMode; id: string; status: Task["status"] }) => data)
  .handler(async ({ data }) => {
    const user = await requireWorkspaceEditor();
    const workspace = getMutableWorkspace(data.mode);
    workspace.tasks = workspace.tasks.map((task) => (task.id === data.id ? { ...task, status: data.status } : task));
    const task = workspace.tasks.find((item) => item.id === data.id);
    await updatePersistedWorkflowActionStatus(data.mode, "task", data.id, data.status);
    recordActivity(workspace, "Task status changed", `${task?.title ?? "Task"} moved to ${data.status}.`);
    await recordWorkspaceMutation({
      entity: "task",
      entityId: data.id,
      invalidates: ["workspace"],
      mode: data.mode,
      operation: "update",
      projectId: task?.projectId ?? null,
      sourceClientId: user.clientId,
      sourceUserId: user.id,
    });
    return mergePersistedWorkspace(clone(getMutableRoot()));
  });

export const updateApprovalStatus = createServerFn({ method: "POST" })
  .validator((data: { mode: WorkspaceMode; id: string; status: Approval["status"] }) => data)
  .handler(async ({ data }) => {
    const user = await requireWorkspaceEditor();
    const workspace = getMutableWorkspace(data.mode);
    workspace.approvals = workspace.approvals.map((approval) => (approval.id === data.id ? { ...approval, status: data.status } : approval));
    const approval = workspace.approvals.find((item) => item.id === data.id);
    await updatePersistedWorkflowActionStatus(data.mode, "approval", data.id, data.status);
    recordActivity(workspace, "Approval status changed", `${approval?.title ?? "Approval"} moved to ${data.status}.`);
    await recordWorkspaceMutation({
      entity: "approval",
      entityId: data.id,
      invalidates: ["workspace"],
      mode: data.mode,
      operation: "update",
      projectId: approval?.projectId ?? null,
      sourceClientId: user.clientId,
      sourceUserId: user.id,
    });
    return mergePersistedWorkspace(clone(getMutableRoot()));
  });

export const updateDecisionStatus = createServerFn({ method: "POST" })
  .validator((data: { mode: WorkspaceMode; id: string; status: Decision["status"] }) => data)
  .handler(async ({ data }) => {
    const user = await requireWorkspaceEditor();
    const workspace = getMutableWorkspace(data.mode);
    workspace.decisions = workspace.decisions.map((decision) => (decision.id === data.id ? { ...decision, status: data.status } : decision));
    const decision = workspace.decisions.find((item) => item.id === data.id);
    await updatePersistedWorkflowActionStatus(data.mode, "decision", data.id, data.status);
    recordActivity(workspace, "Decision status changed", `${decision?.title ?? "Decision"} moved to ${data.status}.`);
    await recordWorkspaceMutation({
      entity: "decision",
      entityId: data.id,
      invalidates: ["workspace"],
      mode: data.mode,
      operation: "update",
      projectId: decision?.projectId ?? null,
      sourceClientId: user.clientId,
      sourceUserId: user.id,
    });
    return mergePersistedWorkspace(clone(getMutableRoot()));
  });

export const createTaskFromSuggestion = createServerFn({ method: "POST" })
  .validator((data: CreateTaskInput) => data)
  .handler(async ({ data }) => {
    const user = await requireWorkspaceEditor();
    const title = (await generateWorkflowSuggestionTitle("task", data.title)).slice(0, 140);
    if (!title) throw new Error("Task title is required.");
    const workspace = getMutableWorkspace(data.mode);
    const existingTask = workspace.tasks.find((task) => titleMatchesTask(task.title, title) && (data.projectId ?? null) === task.projectId);
    if (existingTask) return { workspace: await mergePersistedWorkspace(clone(getMutableRoot())), task: existingTask };

    const task: Task = {
      id: createId(`${scopeByMode[data.mode]}-llm-task`),
      projectId: data.projectId ?? null,
      title,
      originalText: data.originalText?.trim().slice(0, 1000) || data.title.trim().slice(0, 1000),
      owner: data.owner?.trim().slice(0, 80) || "You",
      source: data.source?.trim().slice(0, 96) || "VertexAI suggestion",
      status: "Open",
    };
    workspace.tasks = [task, ...workspace.tasks];
    await persistWorkflowAction(data.mode, "task", task);
    recordActivity(workspace, "Task created", `${task.title} was added from VertexAI suggestions.`);
    await recordWorkspaceMutation({
      entity: "task",
      entityId: task.id,
      invalidates: ["workspace"],
      mode: data.mode,
      operation: "insert",
      projectId: task.projectId,
      sourceClientId: user.clientId,
      sourceUserId: user.id,
    });
    return { workspace: await mergePersistedWorkspace(clone(getMutableRoot())), task };
  });

export const createApprovalFromSuggestion = createServerFn({ method: "POST" })
  .validator((data: CreateWorkflowSuggestionInput) => data)
  .handler(async ({ data }) => {
    const user = await requireWorkspaceEditor();
    const title = (await generateWorkflowSuggestionTitle("approval", data.title)).slice(0, 140);
    if (!title) throw new Error("Approval title is required.");
    const workspace = getMutableWorkspace(data.mode);
    const existingApproval = workspace.approvals.find((approval) => titleMatchesTask(approval.title, title) && (data.projectId ?? null) === approval.projectId);
    if (existingApproval) return { workspace: await mergePersistedWorkspace(clone(getMutableRoot())), approval: existingApproval };
    const approval: Approval = {
      id: createId(`${scopeByMode[data.mode]}-llm-approval`),
      projectId: data.projectId ?? null,
      title,
      originalText: data.originalText?.trim().slice(0, 1000) || data.title.trim().slice(0, 1000),
      owner: data.owner?.trim().slice(0, 80) || "You",
      due: "Requested",
      status: "Not Reviewed",
    };
    workspace.approvals = [approval, ...workspace.approvals];
    await persistWorkflowAction(data.mode, "approval", approval);
    recordActivity(workspace, "Approval created", `${approval.title} was added from VertexAI suggestions.`);
    await recordWorkspaceMutation({
      entity: "approval",
      entityId: approval.id,
      invalidates: ["workspace"],
      mode: data.mode,
      operation: "insert",
      projectId: approval.projectId,
      sourceClientId: user.clientId,
      sourceUserId: user.id,
    });
    return { workspace: await mergePersistedWorkspace(clone(getMutableRoot())), approval };
  });

export const createDecisionFromSuggestion = createServerFn({ method: "POST" })
  .validator((data: CreateWorkflowSuggestionInput) => data)
  .handler(async ({ data }) => {
    const user = await requireWorkspaceEditor();
    const title = (await generateWorkflowSuggestionTitle("decision", data.title)).slice(0, 140);
    if (!title) throw new Error("Decision title is required.");
    const workspace = getMutableWorkspace(data.mode);
    const existingDecision = workspace.decisions.find((decision) => titleMatchesTask(decision.title, title) && (data.projectId ?? null) === decision.projectId);
    if (existingDecision) return { workspace: await mergePersistedWorkspace(clone(getMutableRoot())), decision: existingDecision };
    const decision: Decision = {
      id: createId(`${scopeByMode[data.mode]}-llm-decision`),
      projectId: data.projectId ?? null,
      title,
      originalText: data.originalText?.trim().slice(0, 1000) || data.title.trim().slice(0, 1000),
      owner: data.owner?.trim().slice(0, 80) || "You",
      due: "Due soon",
      status: "Not Completed",
    };
    workspace.decisions = [decision, ...workspace.decisions];
    await persistWorkflowAction(data.mode, "decision", decision);
    recordActivity(workspace, "Decision created", `${decision.title} was added from VertexAI suggestions.`);
    await recordWorkspaceMutation({
      entity: "decision",
      entityId: decision.id,
      invalidates: ["workspace"],
      mode: data.mode,
      operation: "insert",
      projectId: decision.projectId,
      sourceClientId: user.clientId,
      sourceUserId: user.id,
    });
    return { workspace: await mergePersistedWorkspace(clone(getMutableRoot())), decision };
  });

export const createIdeaFromSuggestion = createServerFn({ method: "POST" })
  .validator((data: CreateWorkflowSuggestionInput) => data)
  .handler(async ({ context, data }) => {
    const user = await requireWorkspaceEditor();
    const title = (await generateWorkflowSuggestionTitle("idea", data.title)).slice(0, 120);
    if (!title) throw new Error("Idea title is required.");
    const workspace = getMutableWorkspace(data.mode);
    const existingIdea = workspace.ideas.find((idea) => titleMatchesTask(idea.title, title) && (data.projectId ?? null) === idea.projectId);
    if (existingIdea) return mergePersistedWorkspace(clone(getMutableRoot()));
    const baseIdea: Idea = {
      id: createId(`${workspace.scope}-llm-idea`),
      projectId: data.projectId ?? null,
      title,
      originalText: data.originalText?.trim().slice(0, 1000) || data.title.trim().slice(0, 1000),
      status: "Not Started",
      category: "Workflow",
      owner: data.owner?.trim().slice(0, 80) || "You",
      avatar: avatarAlex,
      created: "Just now",
      votes: 0,
      impact: 0,
      effort: 0,
      confidence: 0,
      summary: data.source ? `Captured from ${data.source}.` : "Captured from VertexAI suggestions.",
      nextStep: "",
      tags: ["Workflow", "Medium", workspaceModeLabel(data.mode), data.projectId ? "Project" : "General"],
      metrics: [],
      thread: [],
    };
    const assessment = await assessIdeaWithGemma({ context, mode: data.mode, idea: baseIdea });
    const idea: Idea = { ...baseIdea, ...assessment };
    workspace.ideas = [idea, ...workspace.ideas];
    await persistIdea(data.mode, idea, false);
    recordActivity(workspace, "Idea created", `${idea.title} was added from VertexAI suggestions.`);
    await recordWorkspaceMutation({
      entity: "idea",
      entityId: idea.id,
      invalidates: ["workspace"],
      mode: data.mode,
      operation: "insert",
      projectId: idea.projectId,
      sourceClientId: user.clientId,
      sourceUserId: user.id,
    });
    return mergePersistedWorkspace(clone(getMutableRoot()));
  });

export const refreshIdeaAssessment = createServerFn({ method: "POST" })
  .validator((data: { mode: WorkspaceMode; id: string }) => data)
  .handler(async ({ context, data }) => {
    const user = await requireWorkspaceEditor();
    const workspace = getMutableWorkspace(data.mode);
    const idea = workspace.ideas.find((item) => item.id === data.id);
    if (!idea) return mergePersistedWorkspace(clone(getMutableRoot()));
    const assessment = await assessIdeaWithGemma({ context, mode: data.mode, idea });
    const nextIdea: Idea = { ...idea, ...assessment };
    workspace.ideas = workspace.ideas.map((item) => (item.id === data.id ? nextIdea : item));
    await persistIdea(data.mode, nextIdea, workspace.pinnedIdeaIds.includes(data.id));
    recordActivity(workspace, "Idea assessment refreshed", `${nextIdea.title} was rescored by Gemma 4.`);
    await recordWorkspaceMutation({
      entity: "idea",
      entityId: data.id,
      invalidates: ["workspace"],
      mode: data.mode,
      operation: "assessment-refresh",
      projectId: nextIdea.projectId,
      sourceClientId: user.clientId,
      sourceUserId: user.id,
    });
    return mergePersistedWorkspace(clone(getMutableRoot()));
  });

export const removeSuggestedTask = createServerFn({ method: "POST" })
  .validator((data: { mode: WorkspaceMode; id: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireWorkspaceEditor();
    const workspace = getMutableWorkspace(data.mode);
    const task = workspace.tasks.find((item) => item.id === data.id);
    if (!task) return mergePersistedWorkspace(clone(getMutableRoot()));
    workspace.tasks = workspace.tasks.filter((item) => item.id !== data.id);
    await deletePersistedWorkflowAction(data.mode, "task", data.id);
    recordActivity(workspace, "Task removed", `${task.title} was removed from tasks.`);
    await recordWorkspaceMutation({
      entity: "task",
      entityId: data.id,
      invalidates: ["workspace"],
      mode: data.mode,
      operation: "delete",
      projectId: task.projectId,
      sourceClientId: user.clientId,
      sourceUserId: user.id,
    });
    return mergePersistedWorkspace(clone(getMutableRoot()));
  });

export const removeSuggestedDecision = createServerFn({ method: "POST" })
  .validator((data: { mode: WorkspaceMode; id: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireWorkspaceEditor();
    const workspace = getMutableWorkspace(data.mode);
    const decision = workspace.decisions.find((item) => item.id === data.id);
    if (!decision) return mergePersistedWorkspace(clone(getMutableRoot()));
    workspace.decisions = workspace.decisions.filter((item) => item.id !== data.id);
    await deletePersistedWorkflowAction(data.mode, "decision", data.id);
    recordActivity(workspace, "Decision removed", `${decision.title} was removed from decisions.`);
    await recordWorkspaceMutation({
      entity: "decision",
      entityId: data.id,
      invalidates: ["workspace"],
      mode: data.mode,
      operation: "delete",
      projectId: decision.projectId,
      sourceClientId: user.clientId,
      sourceUserId: user.id,
    });
    return mergePersistedWorkspace(clone(getMutableRoot()));
  });

export const removeSuggestedApproval = createServerFn({ method: "POST" })
  .validator((data: { mode: WorkspaceMode; id: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireWorkspaceEditor();
    const workspace = getMutableWorkspace(data.mode);
    const approval = workspace.approvals.find((item) => item.id === data.id);
    if (!approval) return mergePersistedWorkspace(clone(getMutableRoot()));
    workspace.approvals = workspace.approvals.filter((item) => item.id !== data.id);
    await deletePersistedWorkflowAction(data.mode, "approval", data.id);
    recordActivity(workspace, "Approval removed", `${approval.title} was removed from approvals.`);
    await recordWorkspaceMutation({
      entity: "approval",
      entityId: data.id,
      invalidates: ["workspace"],
      mode: data.mode,
      operation: "delete",
      projectId: approval.projectId,
      sourceClientId: user.clientId,
      sourceUserId: user.id,
    });
    return mergePersistedWorkspace(clone(getMutableRoot()));
  });

export const removeSuggestedIdea = createServerFn({ method: "POST" })
  .validator((data: { mode: WorkspaceMode; id: string }) => data)
  .handler(async ({ data }) => {
    const user = await requireWorkspaceEditor();
    const workspace = getMutableWorkspace(data.mode);
    const idea = workspace.ideas.find((item) => item.id === data.id);
    if (!idea) return mergePersistedWorkspace(clone(getMutableRoot()));
    workspace.ideas = workspace.ideas.filter((item) => item.id !== data.id);
    workspace.pinnedIdeaIds = workspace.pinnedIdeaIds.filter((id) => id !== data.id);
    await getDb()
      .prepare("DELETE FROM ideas WHERE id = ? AND workspace_id = ?")
      .bind(data.id, workspaceIdForMode(data.mode))
      .run();
    recordActivity(workspace, "Idea removed", `${idea.title} was removed from ideas.`);
    await recordWorkspaceMutation({
      entity: "idea",
      entityId: data.id,
      invalidates: ["workspace"],
      mode: data.mode,
      operation: "delete",
      projectId: idea.projectId,
      sourceClientId: user.clientId,
      sourceUserId: user.id,
    });
    return mergePersistedWorkspace(clone(getMutableRoot()));
  });

export const updateAccessLevel = createServerFn({ method: "POST" })
  .validator((data: { mode: WorkspaceMode; accessLevel: ScopedWorkspaceState["accessLevel"] }) => data)
  .handler(async ({ data }) => {
    const user = await requireWorkspaceEditor();
    const workspace = getMutableWorkspace(data.mode);
    workspace.accessLevel = data.accessLevel;
    recordActivity(workspace, "Workspace access updated", `${workspaceModeLabel(data.mode)} access set to ${data.accessLevel}.`);
    await recordWorkspaceMutation({
      entity: "workspace",
      entityId: `ws-${scopeByMode[data.mode]}`,
      invalidates: ["workspace"],
      mode: data.mode,
      operation: "update",
      sourceClientId: user.clientId,
      sourceUserId: user.id,
    });
    return clone(getMutableRoot());
  });

export const pmoWorkspaceQueryKey = ["ai-command-center"] as const;

export const pmoWorkspaceQueryOptions = () =>
  queryOptions({
    queryKey: pmoWorkspaceQueryKey,
    queryFn: () => fetchPmoWorkspace(),
  });
