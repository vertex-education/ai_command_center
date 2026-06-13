/// <reference path="../../worker-configuration.d.ts" />

import { env } from "cloudflare:workers";
import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/start-server-core";
import { getAuth } from "@/lib/auth";
import {
  xlsxBlobFromRows,
  type ExportTable,
} from "@/lib/chat-export";
import {
  aiUnavailableMessage,
  buildVertexAiSystemPrompt,
  emptyAiResponseMessage,
  modelOptions,
  promptTemplates,
  vertexAiModelId,
} from "@/lib/prompts";

export type IdeaStatus = "New" | "Review" | "Pilot" | "Approved" | "Implemented" | "Blocked";
export type TabName = "Chat" | "Ideas" | "Artifacts" | "Decisions" | "Approvals" | "Tasks" | "Prompts";
export type RailName = "Workspaces" | "Chats" | "Ideas" | "Artifacts" | "Decisions" | "Approvals" | "Tasks" | "Prompts";
export type WorkspaceMode = "Personal" | "Team" | "Org";
export type WorkspaceScope = "personal" | "team" | "org";
export type ChatSection = "project" | "workspace";
export type ChatReasoningLevel = "off" | "quick" | "deep" | "max";

export type ChatSummary = {
  id: string;
  title: string;
  description: string;
};

export type ProjectSummary = {
  id: string;
  name: string;
  description: string;
  status: "Active" | "Watch" | "Planning";
  projectChats: ChatSummary[];
};

export type Idea = {
  id: string;
  projectId: string | null;
  title: string;
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

export type ChatMessage = {
  id: string;
  author: string;
  role: "user" | "assistant" | "system";
  avatar?: string;
  time: string;
  text: string;
  artifact?: {
    title: string;
    meta: string;
    type: "doc" | "ppt" | "sheet";
  };
};

export type Artifact = {
  projectId: string | null;
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
  pinnedTo: WorkspaceMode[];
};

export type Decision = {
  id: string;
  projectId: string | null;
  title: string;
  status: "Open" | "Blocked" | "Done";
  owner: string;
  due: string;
};

export type Approval = {
  id: string;
  projectId: string | null;
  title: string;
  owner: string;
  due: string;
  status: "Needed" | "Requested" | "Approved";
};

export type Task = {
  id: string;
  projectId: string | null;
  title: string;
  owner: string;
  source: string;
  status: "Open" | "In progress" | "Done";
};

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

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type LlmDevTrace = {
  id: string;
  timestamp: string;
  durationMs: number;
  model: string;
  chatId: string;
  chatTitle: string;
  mode: WorkspaceMode;
  projectId: string | null;
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
  New: { label: "New", tone: "info", description: "Captured and ready for triage." },
  Review: { label: "Under review", tone: "warning", description: "Sizing impact, owner, and governance fit." },
  Pilot: { label: "In pilot", tone: "info", description: "Being tested in a live workflow." },
  Approved: { label: "Approved", tone: "success", description: "Ready for rollout." },
  Implemented: { label: "Implemented", tone: "success", description: "Released into the operating model." },
  Blocked: { label: "Blocked", tone: "destructive", description: "Needs a decision, data source, or owner." },
};

export const tabs: TabName[] = ["Chat", "Ideas", "Artifacts", "Decisions", "Approvals", "Tasks", "Prompts"];
export const workspaceModes: WorkspaceMode[] = ["Personal", "Team", "Org"];
export const statusFilters: Array<IdeaStatus | "All"> = ["All", "New", "Review", "Pilot", "Approved", "Implemented", "Blocked"];
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
  off: {
    label: "Standard",
    shortLabel: "Std",
    maxCompletionTokens: 2_400,
    timeoutMs: 45_000,
    thinkingEnabled: false,
  },
  quick: {
    label: "Quick reasoning",
    shortLabel: "Quick",
    maxCompletionTokens: 8_192,
    timeoutMs: 75_000,
    reasoningEffort: "low",
    thinkingEnabled: true,
  },
  deep: {
    label: "Deep reasoning",
    shortLabel: "Deep",
    maxCompletionTokens: 16_384,
    timeoutMs: 120_000,
    reasoningEffort: "medium",
    thinkingEnabled: true,
  },
  max: {
    label: "Max reasoning",
    shortLabel: "Max",
    maxCompletionTokens: 32_768,
    timeoutMs: 180_000,
    reasoningEffort: "high",
    thinkingEnabled: true,
  },
};

export const chatReasoningLevels: ChatReasoningLevel[] = ["off", "quick", "deep", "max"];

function normalizeReasoningLevel(value: unknown): ChatReasoningLevel {
  return typeof value === "string" && value in chatReasoningProfiles ? value as ChatReasoningLevel : "off";
}

type CloudflareContext = {
  cloudflare?: {
    env?: {
      AI?: Ai;
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
    projects: [
      { id: "personal-certification-plan", name: "Certification Plan", description: "Private credential and milestone tracking.", status: "Active" as const },
      { id: "personal-weekly-reset", name: "Weekly Reset", description: "Personal planning workspace for recurring follow-up.", status: "Planning" as const },
    ],
    workspaceChats: [
      { id: "personal-assistant", title: "Personal Command Chat", description: "Private planning and follow-up." },
      { id: "personal-notes", title: "General Chats", description: "Notes that are not tied to a project." },
      { id: "personal-ideas", title: "Idea Scratchpad", description: "Private improvement thinking." },
    ],
    artifacts: [
      ["Personal Focus Plan", "DOCX", "Alex Morgan", "Jun 8, 2026", "Pinned", "/artifacts/personal-focus-plan.docx", "personal/artifacts/personal-focus-plan.docx"],
      ["Personal Tracker", "XLSX", "Alex Morgan", "Jun 9, 2026", "Draft", "/artifacts/personal-tracker.xlsx", "personal/artifacts/personal-tracker.xlsx"],
      ["Private Planning Brief", "PPTX", "Alex Morgan", "Jun 10, 2026", "Final", "/artifacts/personal-planning-brief.pptx", "personal/artifacts/personal-planning-brief.pptx"],
    ],
  },
  Team: {
    projectsHeading: "Team Projects",
    projectChatsHeading: "Project Chats",
    workspaceChatsHeading: "Team Chats",
    unassignedProjectLabel: "No team project",
    projects: [
      { id: "team-vertex-hub", name: "Vertex Hub", description: "Shared PMO launch execution.", status: "Active" as const },
      { id: "team-lms-next-gen", name: "LMS Next Gen", description: "Team delivery, vendor, and UAT coordination.", status: "Watch" as const },
      { id: "team-data-migration", name: "Data Migration", description: "Cross-functional cutover and validation.", status: "Active" as const },
    ],
    workspaceChats: [
      { id: "team-command", title: "Team Chats", description: "PMO team-wide working thread." },
      { id: "team-intake", title: "Intake Council", description: "Shared intake triage and prioritization." },
      { id: "team-risks", title: "Risk & Escalations", description: "Team-level risks outside a single project." },
    ],
    artifacts: [
      ["Team Improvement Register", "XLSX", "PMO Team", "Jun 10, 2026", "Pinned", "/artifacts/team-improvement-register.xlsx", "team/artifacts/team-improvement-register.xlsx"],
      ["Vertex Hub Roadmap Brief", "PPTX", "Taylor Kim", "Jun 7, 2026", "Final", "/artifacts/team-vertex-roadmap-brief.pptx", "team/artifacts/team-vertex-roadmap-brief.pptx"],
      ["Team Launch Checklist", "DOCX", "Maya Chen", "Jun 6, 2026", "Draft", "/artifacts/team-launch-checklist.docx", "team/artifacts/team-launch-checklist.docx"],
    ],
  },
  Org: {
    projectsHeading: "Org projects",
    projectChatsHeading: "Project Chats",
    workspaceChatsHeading: "Org Chats",
    unassignedProjectLabel: "No org project",
    projects: [
      { id: "org-enterprise-ai", name: "Enterprise AI Governance", description: "Organization-wide AI operating model.", status: "Active" as const },
      { id: "org-portfolio-health", name: "Portfolio Health", description: "Executive portfolio reporting and decisions.", status: "Watch" as const },
    ],
    workspaceChats: [
      { id: "org-command", title: "Org Chats", description: "Organization-level executive workspace." },
      { id: "org-policy", title: "Policy Review", description: "Governance and data handling decisions." },
      { id: "org-briefings", title: "Executive Briefings", description: "Leadership-ready summaries." },
    ],
    artifacts: [
      ["Org AI Governance Charter", "DOCX", "Priya Shah", "Jun 11, 2026", "Final", "/artifacts/org-ai-governance-charter.docx", "org/artifacts/org-ai-governance-charter.docx"],
      ["Portfolio Health Model", "XLSX", "Finance Ops", "Jun 10, 2026", "Pinned", "/artifacts/org-portfolio-health-model.xlsx", "org/artifacts/org-portfolio-health-model.xlsx"],
      ["Executive AI Briefing", "PPTX", "Strategy Office", "Jun 9, 2026", "Draft", "/artifacts/org-executive-ai-briefing.pptx", "org/artifacts/org-executive-ai-briefing.pptx"],
    ],
  },
} satisfies Record<WorkspaceMode, {
  projectsHeading: string;
  projectChatsHeading: string;
  workspaceChatsHeading: string;
  unassignedProjectLabel: string;
  projects: Array<Omit<ProjectSummary, "projectChats">>;
  workspaceChats: ChatSummary[];
  artifacts: Array<[string, string, string, string, Artifact["status"], string, string]>;
}>;

const projectChatTemplates: Record<WorkspaceMode, string[]> = {
  Personal: ["Project Notes", "Project Chats", "Private Risks"],
  Team: ["Shared Project Chat", "Project Chats", "Decision Log"],
  Org: ["Org Project Chat", "Project Chats", "Leadership Decisions"],
};

function withProjectChats(mode: WorkspaceMode, project: Omit<ProjectSummary, "projectChats">): ProjectSummary {
  return {
    ...project,
    projectChats: projectChatTemplates[mode].map((title, index) => ({
      id: `${project.id}-chat-${index + 1}`,
      title: `${project.name} ${title}`,
      description: `${workspaceModeLabel(mode)} project chat scoped to ${project.name}.`,
    })),
  };
}

function buildIdea(
  mode: WorkspaceMode,
  index: number,
  title: string,
  category: string,
  status: IdeaStatus,
  owner: string,
  avatar: string,
  project?: ProjectSummary,
): Idea {
  const scopeName = project?.name ?? `${workspaceModeLabel(mode)} workspace`;
  const normalizedIndex = project ? index % 10 : index;
  return {
    id: `${scopeByMode[mode]}-${project?.id ?? "workspace"}-idea-${index}`,
    projectId: project?.id ?? null,
    title,
    status,
    category,
    owner,
    avatar,
    created: index === 1 ? "Today" : `Jun ${11 - index}`,
    votes: Math.max(3, 18 - normalizedIndex * 2),
    impact: Math.max(42, 92 - normalizedIndex * 7),
    effort: Math.min(82, 34 + normalizedIndex * 8),
    confidence: Math.max(58, 88 - normalizedIndex * 4),
    summary: `${scopeName} scoped idea. This record is intentionally different from the other workspace and project scopes so switching views is obvious.`,
    nextStep: `Confirm the ${scopeName.toLowerCase()} owner, artifact evidence, and decision path.`,
    tags: [workspaceModeLabel(mode), project?.name ?? "General", category, status],
    metrics: [`${mode} metric ${index}`, "Scoped evidence only", "No lower-scope exposure"],
    thread: [
      `${workspaceModeLabel(mode)} idea captured in Vertex AI Command Center.`,
      "Assistant linked only same-scope chats, artifacts, and decisions.",
    ],
  };
}

function buildMessages(mode: WorkspaceMode, label: string, projectName?: string): ChatMessage[] {
  const scopeLabel = workspaceModeLabel(mode);
  const context = projectName ? `${scopeLabel} / ${projectName} / ${label}` : `${scopeLabel} / ${label}`;
  return [
    {
      id: `${scopeByMode[mode]}-${label}-1`,
      author: mode === "Org" ? "Priya Shah" : mode === "Team" ? "Taylor Kim" : "Alex Morgan",
      role: "user",
      avatar: mode === "Org" ? avatarPriya : mode === "Team" ? avatarTaylor : avatarAlex,
      time: "9:15 AM",
      text: `Summarize the current ${context} scope and call out the next action.`,
    },
    {
      id: `${scopeByMode[mode]}-${label}-2`,
      author: assistantName,
      role: "assistant",
      time: "9:16 AM",
      text: `I reviewed only ${context}. The visible chats, ideas, artifacts, decisions, approvals, and tasks are isolated to the ${scopeByMode[mode]} scope.`,
      artifact: {
        title: `${scopeLabel} Scope Snapshot`,
        meta: projectName ? "DOCX - Project scoped" : "PPTX - Workspace scoped",
        type: projectName ? "doc" : "ppt",
      },
    },
  ];
}

function buildArtifacts(mode: WorkspaceMode, project?: ProjectSummary): Artifact[] {
  const artifactRows = project
    ? [
        [`${project.name} Scope Brief`, "DOCX", mode === "Org" ? "Priya Shah" : mode === "Team" ? "Taylor Kim" : "Alex Morgan", "Jun 11, 2026", "Draft", `/artifacts/${project.id}-scope-brief.docx`, `${scopeByMode[mode]}/projects/${project.id}/scope-brief.docx`],
        [`${project.name} Metrics Model`, "XLSX", "Jordan Lee", "Jun 10, 2026", "Pinned", `/artifacts/${project.id}-metrics-model.xlsx`, `${scopeByMode[mode]}/projects/${project.id}/metrics-model.xlsx`],
      ] satisfies Array<[string, string, string, string, Artifact["status"], string, string]>
    : workspaceSeed[mode].artifacts;

  return artifactRows.map(([title, type, owner, date, status, href, r2Key]) => ({
    projectId: project?.id ?? null,
    title,
    type,
    owner,
    date,
    status,
    href,
    r2Key,
    summary: `${project?.name ?? workspaceModeLabel(mode)} artifact stored as R2 object ${r2Key}.`,
    preview: [
      `${project?.name ?? workspaceModeLabel(mode)}-only evidence and working notes.`,
      "Dummy artifact content is intentionally unique by workspace.",
      "D1 stores metadata while R2 stores the file bytes.",
    ],
    pinnedTo: status === "Pinned" ? [mode] : [],
  }));
}

function buildWorkspace(mode: WorkspaceMode): ScopedWorkspaceState {
  const seed = workspaceSeed[mode];
  const projects = seed.projects.map((project) => withProjectChats(mode, project));
  const conversations: Record<string, ChatMessage[]> = {};

  for (const chat of seed.workspaceChats) {
    conversations[getConversationKey(mode, null, chat.id)] = buildMessages(mode, chat.title);
  }

  for (const project of projects) {
    for (const chat of project.projectChats) {
      conversations[getConversationKey(mode, project.id, chat.id)] = buildMessages(mode, chat.title, project.name);
    }
  }

  const workspaceIdeas =
    mode === "Personal"
      ? [
          buildIdea(mode, 1, "Private meeting follow-up assistant", "Planning", "Pilot", "Alex Morgan", avatarAlex),
          buildIdea(mode, 2, "Personal artifact reminder", "Artifacts", "Review", "Alex Morgan", avatarAlex),
        ]
      : mode === "Team"
        ? [
            buildIdea(mode, 1, "Team RAID Copilot", "Risk and issue management", "Pilot", "Taylor Kim", avatarTaylor),
            buildIdea(mode, 2, "Team decision aging nudges", "Governance", "Approved", "Jordan Lee", avatarJordan),
            buildIdea(mode, 3, "Team intake triage assistant", "Intake", "Review", "Maya Chen", avatarMaya),
          ]
        : [
            buildIdea(mode, 1, "Org AI governance classifier", "Governance", "Approved", "Priya Shah", avatarPriya),
            buildIdea(mode, 2, "Portfolio health narrative builder", "Planning", "Pilot", "Jordan Lee", avatarJordan),
          buildIdea(mode, 3, "Enterprise artifact retention monitor", "Artifacts", "New", "Taylor Kim", avatarTaylor),
        ];
  const projectIdeas = projects.flatMap((project, index) => [
    buildIdea(mode, index + 10, `${project.name} decision summarizer`, "Governance", "Review", mode === "Org" ? "Priya Shah" : "Taylor Kim", mode === "Org" ? avatarPriya : avatarTaylor, project),
    buildIdea(mode, index + 20, `${project.name} artifact gap detector`, "Artifacts", "Pilot", "Jordan Lee", avatarJordan, project),
  ]);
  const ideas = [...workspaceIdeas, ...projectIdeas];
  const artifacts = [
    ...buildArtifacts(mode),
    ...projects.flatMap((project) => buildArtifacts(mode, project)),
  ];
  const workspaceDecisions: Decision[] = [
    { id: `${scopeByMode[mode]}-workspace-decision-1`, projectId: null, title: `${workspaceModeLabel(mode)} scope owner confirmed`, status: "Open", owner: mode === "Org" ? "Priya Shah" : "Alex Morgan", due: "Due Jun 14" },
    { id: `${scopeByMode[mode]}-workspace-decision-2`, projectId: null, title: `${workspaceModeLabel(mode)} artifact retention path`, status: mode === "Personal" ? "Done" : "Blocked", owner: "Jordan Lee", due: mode === "Personal" ? "Done" : "Due Jun 12" },
  ];
  const projectDecisions: Decision[] = projects.map((project, index) => ({
    id: `${project.id}-decision-${index + 1}`,
    projectId: project.id,
    title: `${project.name} delivery decision`,
    status: project.status === "Watch" ? "Blocked" : "Open",
    owner: mode === "Org" ? "Strategy Office" : "Maya Chen",
    due: `Due Jun ${14 + index}`,
  }));
  const workspaceApprovals: Approval[] = [
    { id: `${scopeByMode[mode]}-workspace-approval-1`, projectId: null, title: `${workspaceModeLabel(mode)} workspace publishing`, owner: mode === "Org" ? "Strategy Office" : "Taylor Kim", due: "Due Jun 15", status: "Needed" },
    { id: `${scopeByMode[mode]}-workspace-approval-2`, projectId: null, title: `${workspaceModeLabel(mode)} data visibility`, owner: "Priya Shah", due: "Requested", status: "Requested" },
  ];
  const projectApprovals: Approval[] = projects.map((project, index) => ({
    id: `${project.id}-approval-${index + 1}`,
    projectId: project.id,
    title: `${project.name} artifact approval`,
    owner: mode === "Personal" ? "Alex Morgan" : "Taylor Kim",
    due: `Due Jun ${15 + index}`,
    status: project.status === "Planning" ? "Needed" : "Requested",
  }));
  const workspaceTasks: Task[] = [
    { id: `${scopeByMode[mode]}-workspace-task-1`, projectId: null, title: `Review ${workspaceModeLabel(mode).toLowerCase()} project chat coverage`, owner: "Maya Chen", source: seed.projectChatsHeading, status: "Open" },
    { id: `${scopeByMode[mode]}-workspace-task-2`, projectId: null, title: `Refresh ${workspaceModeLabel(mode).toLowerCase()} artifacts`, owner: "Alex Morgan", source: "Artifacts", status: "In progress" },
  ];
  const projectTasks: Task[] = projects.map((project, index) => ({
    id: `${project.id}-task-${index + 1}`,
    projectId: project.id,
    title: `${project.name} follow-up from project chat`,
    owner: index % 2 === 0 ? "Maya Chen" : "Jordan Lee",
    source: project.projectChats[0]?.title ?? seed.projectChatsHeading,
    status: project.status === "Active" ? "In progress" : "Open",
  }));

  return {
    scope: scopeByMode[mode],
    mode,
    projectsHeading: seed.projectsHeading,
    projectChatsHeading: seed.projectChatsHeading,
    workspaceChatsHeading: seed.workspaceChatsHeading,
    unassignedProjectLabel: seed.unassignedProjectLabel,
    projects,
    workspaceChats: seed.workspaceChats,
    ideas,
    conversations,
    artifacts,
    decisions: [...workspaceDecisions, ...projectDecisions],
    approvals: [...workspaceApprovals, ...projectApprovals],
    tasks: [...workspaceTasks, ...projectTasks],
    pinnedIdeaIds: ideas.slice(0, 2).map((idea) => idea.id),
    accessLevel: "Read / Write",
    activity: [
      { id: `${scopeByMode[mode]}-activity-1`, label: `${workspaceModeLabel(mode)} scope loaded`, detail: "Data is isolated from the other workspaces.", time: "9:21 AM" },
      { id: `${scopeByMode[mode]}-activity-2`, label: "R2 artifact metadata ready", detail: `${buildArtifacts(mode).length} dummy objects mapped.`, time: "Yesterday" },
    ],
    updatedAt: "Jun 11, 2026 9:21 AM",
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
      (signal) => ai.run(vertexAiModelId, {
        messages: [
          { role: "system", content: "You name files clearly and briefly." },
          { role: "user", content: prompt },
        ],
        max_completion_tokens: 32,
        temperature: 0.1,
      }, { signal }),
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

async function getChatWorkspaceId(chatId: string) {
  const chat = await getDb()
    .prepare("SELECT workspace_id as workspaceId FROM chats WHERE id = ? LIMIT 1")
    .bind(chatId)
    .first<{ workspaceId: string }>();
  if (!chat) throw new Error("Chat was not found.");
  return chat.workspaceId;
}

async function persistChatMessage(chatId: string, workspaceId: string, message: ChatMessage) {
  await getDb()
    .prepare(
      "INSERT INTO chat_messages (id, chat_id, workspace_id, author, role, avatar, message_time, body, artifact_title, artifact_type, artifact_meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      message.id,
      chatId,
      workspaceId,
      message.author,
      message.role,
      message.avatar ?? null,
      message.time,
      message.text,
      message.artifact?.title ?? null,
      message.artifact?.type ?? null,
      message.artifact?.meta ?? null,
      new Date().toISOString(),
    )
    .run();
}

async function listPersistedChatMessages(chatId: string) {
  const result = await getDb()
    .prepare("SELECT id, author, role, avatar, message_time as time, body as text FROM chat_messages WHERE chat_id = ? ORDER BY created_at ASC")
    .bind(chatId)
    .all<{ id: string; author: string; role: "user" | "assistant" | "system"; avatar: string | null; time: string; text: string }>();

  return (result.results ?? []).map((message) => ({
    ...message,
    avatar: message.avatar ?? undefined,
  })) satisfies ChatMessage[];
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

async function runGemmaChat({
  context,
  data,
  existingMessages,
  workspace,
}: {
  context: unknown;
  data: { mode: WorkspaceMode; projectId: string | null; chatId: string; chatTitle: string; text: string; reasoningLevel?: ChatReasoningLevel };
  existingMessages: ChatMessage[];
  workspace: ScopedWorkspaceState;
}): Promise<{ text: string; trace: LlmDevTrace }> {
  const reasoningLevel = normalizeReasoningLevel(data.reasoningLevel);
  const reasoningProfile = chatReasoningProfiles[reasoningLevel];
  const project = data.projectId
    ? await getDb()
      .prepare("SELECT name, description FROM projects WHERE id = ? LIMIT 1")
      .bind(data.projectId)
      .first<{ name: string; description: string }>()
    : null;
  const recentMessages: Array<{ role: "user" | "assistant"; content: string }> = existingMessages.slice(-8).map((message) => ({
    role: message.role === "assistant" ? "assistant" : "user",
    content: `${message.author}: ${message.text}`,
  }));

  const scopeContext = [
    `Workspace scope: ${workspaceModeLabel(data.mode)} (${workspace.scope})`,
    `Selected scope: ${project?.name ?? workspaceModeLabel(data.mode)}`,
    project?.description ? `Project description: ${project.description}` : null,
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
        content: buildVertexAiSystemPrompt(),
      },
      {
        role: "user" as const,
        content: `Current scoped context:\n${scopeContext}`,
      },
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
    const result = await withAiTimeout((signal) => ai.run(vertexAiModelId, requestPayload, { signal }), reasoningProfile.timeoutMs);

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
    return {
      text,
      trace: {
        ...traceBase,
        durationMs: Date.now() - startedAt,
        responseText: text,
        thinkingText,
        diagnostics: getAiDiagnostics(result, responseText, thinkingText),
        rawResponse: cloneJsonValue(result),
      },
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Workers AI request failed.";
    console.error("[VertexAI] Workers AI request failed", {
      chatId: data.chatId,
      message: detail,
    });
    const text = `I could not complete the Workers AI request. ${detail}`;
    return {
      text,
      trace: {
        ...traceBase,
        durationMs: Date.now() - startedAt,
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
  if (status === "Open") return "Done";
  if (status === "Blocked") return "Open";
  return "Open";
}

function cycleApprovalStatus(status: Approval["status"]): Approval["status"] {
  if (status === "Needed") return "Requested";
  if (status === "Requested") return "Approved";
  return "Needed";
}

function cycleTaskStatus(status: Task["status"]): Task["status"] {
  if (status === "Open") return "In progress";
  if (status === "In progress") return "Done";
  return "Open";
}

function impactScore(value: AddIdeaInput["impact"]) {
  if (value === "High") return 86;
  if (value === "Medium") return 68;
  return 46;
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
    workspaceId: string;
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
  }>;
  try {
    const result = await getDb()
      .prepare(
        `SELECT workspace_id as workspaceId,
                title,
                file_type as type,
                owner,
                artifact_date as date,
                status,
                summary,
                r2_key as r2Key,
                href,
                preview_json as previewJson,
                pinned
         FROM artifacts`,
      )
      .all<typeof rows[number]>();
    rows = result.results ?? [];
  } catch {
    return root;
  }

  const modeByWorkspaceId = new Map(Object.entries(scopeByMode).map(([mode, scope]) => [`ws-${scope}`, mode as WorkspaceMode]));
  for (const row of rows) {
    const mode = modeByWorkspaceId.get(row.workspaceId);
    if (!mode) continue;
    let preview: string[] = [];
    let projectId: string | null = null;
    let sourceChatTitle: string | undefined;
    try {
      const parsed = JSON.parse(row.previewJson);
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
    const artifact: Artifact = {
      projectId,
      sourceChatTitle,
      title: row.title,
      type: row.type,
      owner: row.owner,
      date: row.date,
      status: row.status,
      summary: row.summary,
      href: artifactDownloadHref(row.r2Key, row.href),
      r2Key: row.r2Key,
      preview,
      pinnedTo: row.pinned ? [mode] : [],
    };
    const workspace = root.workspaces[mode];
    workspace.artifacts = [
      artifact,
      ...workspace.artifacts.filter((item) => item.r2Key !== artifact.r2Key),
    ];
  }
  return root;
}

export const fetchPmoWorkspace = createServerFn({ method: "GET" }).handler(async () => {
  return mergePersistedArtifacts(clone(getMutableRoot()));
});

async function requireWorkspaceEditor() {
  const request = getRequest();
  const session = await getAuth(request).api.getSession({ headers: request.headers });
  const user = (session as { user?: { id?: string; role?: string | null } } | null)?.user;
  if (user?.role !== "admin" && user?.role !== "user" || !user.id) {
    throw new Error("Viewer accounts have view-only access.");
  }
  return { id: user.id };
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

export const sendChatMessage = createServerFn({ method: "POST" })
  .validator((data: { mode: WorkspaceMode; teamId?: string | null; projectId: string | null; chatId: string; chatTitle: string; text: string; model: string; reasoningLevel?: ChatReasoningLevel }) => data)
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
    if (!text) return { workspace: clone(getMutableRoot()), llmTrace: null };
    const existingMessages = await listPersistedChatMessages(data.chatId);
    const chatTitle = existingMessages.length === 0 ? conciseChatTitleFromRequest(text) : data.chatTitle;

    const userMessage: ChatMessage = {
      id: createId("msg-user"),
      author: "You",
      role: "user",
      avatar: avatarAlex,
      time: nowLabel(),
      text,
    };
    const aiResult = await runGemmaChat({
      context,
      data: { ...data, chatTitle, text },
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
    await persistChatMessage(data.chatId, workspaceId, userMessage);
    await persistChatMessage(data.chatId, workspaceId, response);
    workspace.conversations[conversationKey] = [...existingMessages, userMessage, response];
    recordActivity(workspace, "Chat response generated", `${chatTitle} updated in ${workspaceModeLabel(data.mode)}.`);
    return { workspace: clone(getMutableRoot()), llmTrace: aiResult.trace };
  });

export const addIdea = createServerFn({ method: "POST" })
  .validator((data: AddIdeaInput & { mode?: WorkspaceMode; projectId?: string | null }) => data)
  .handler(async ({ data }) => {
    await requireWorkspaceEditor();
    const mode = data.mode ?? "Personal";
    const workspace = getMutableWorkspace(mode);
    const project = workspace.projects.find((item) => item.id === data.projectId);
    const title = data.title.trim();
    if (!title) return clone(getMutableRoot());

    const nextIdea: Idea = {
      id: createId(`${workspace.scope}-idea`),
      projectId: project?.id ?? null,
      title,
      status: data.status,
      category: data.category,
      owner: "Alex Morgan",
      avatar: avatarAlex,
      created: "Just now",
      votes: 1,
      impact: impactScore(data.impact),
      effort: data.impact === "High" ? 52 : data.impact === "Medium" ? 42 : 30,
      confidence: data.impact === "High" ? 78 : 66,
      summary: data.summary.trim() || `New ${project?.name ?? workspaceModeLabel(mode).toLowerCase()} improvement idea captured from the current scope.`,
      nextStep: "Confirm owner, evidence source, and governance fit.",
      tags: [data.category, data.impact, workspaceModeLabel(mode), project?.name ?? "General"],
      metrics: ["Owner confirmation needed", "Evidence source pending", "Governance review pending"],
      thread: ["Idea captured through Vertex AI Command Center.", "Assistant prepared initial impact and follow-up fields."],
    };

    workspace.ideas = [nextIdea, ...workspace.ideas];
    workspace.pinnedIdeaIds = [nextIdea.id, ...workspace.pinnedIdeaIds];
    recordActivity(workspace, "Idea added", `${nextIdea.title} entered ${workspaceModeLabel(mode)}.`);
    return clone(getMutableRoot());
  });

export const updateIdeaStatus = createServerFn({ method: "POST" })
  .validator((data: { mode: WorkspaceMode; id: string; status: IdeaStatus }) => data)
  .handler(async ({ data }) => {
    await requireWorkspaceEditor();
    const workspace = getMutableWorkspace(data.mode);
    workspace.ideas = workspace.ideas.map((idea) => (idea.id === data.id ? { ...idea, status: data.status } : idea));
    const idea = workspace.ideas.find((item) => item.id === data.id);
    recordActivity(workspace, "Idea status changed", `${idea?.title ?? "Idea"} moved to ${data.status}.`);
    return clone(getMutableRoot());
  });

export const voteIdea = createServerFn({ method: "POST" })
  .validator((data: { mode: WorkspaceMode; id: string }) => data)
  .handler(async ({ data }) => {
    await requireWorkspaceEditor();
    const workspace = getMutableWorkspace(data.mode);
    workspace.ideas = workspace.ideas.map((idea) => (idea.id === data.id ? { ...idea, votes: idea.votes + 1 } : idea));
    const idea = workspace.ideas.find((item) => item.id === data.id);
    recordActivity(workspace, "Idea vote added", `${idea?.title ?? "Idea"} gained a vote.`);
    return clone(getMutableRoot());
  });

export const toggleIdeaPin = createServerFn({ method: "POST" })
  .validator((data: { mode: WorkspaceMode; id: string }) => data)
  .handler(async ({ data }) => {
    await requireWorkspaceEditor();
    const workspace = getMutableWorkspace(data.mode);
    const isPinned = workspace.pinnedIdeaIds.includes(data.id);
    workspace.pinnedIdeaIds = isPinned ? workspace.pinnedIdeaIds.filter((id) => id !== data.id) : [data.id, ...workspace.pinnedIdeaIds];
    const idea = workspace.ideas.find((item) => item.id === data.id);
    recordActivity(workspace, isPinned ? "Idea unpinned" : "Idea pinned", `${idea?.title ?? "Idea"} workspace pin changed.`);
    return clone(getMutableRoot());
  });

export const toggleArtifactPin = createServerFn({ method: "POST" })
  .validator((data: { mode: WorkspaceMode; r2Key: string }) => data)
  .handler(async ({ data }) => {
    await requireWorkspaceEditor();
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
    return mergePersistedArtifacts(clone(getMutableRoot()));
  });

export const deleteArtifact = createServerFn({ method: "POST" })
  .validator((data: { mode: WorkspaceMode; r2Key: string }) => data)
  .handler(async ({ data }) => {
    await requireWorkspaceEditor();
    const workspace = getMutableWorkspace(data.mode);
    const artifact = workspace.artifacts.find((item) => item.r2Key === data.r2Key);
    workspace.artifacts = workspace.artifacts.filter((item) => item.r2Key !== data.r2Key);
    await getDb()
      .prepare("DELETE FROM artifacts WHERE r2_key = ?")
      .bind(data.r2Key)
      .run();
    await getArtifactsBucket().delete(data.r2Key).catch(() => undefined);
    recordActivity(workspace, "Artifact deleted", `${artifact?.title ?? "Artifact"} removed from ${workspaceModeLabel(data.mode)}.`);
    return mergePersistedArtifacts(clone(getMutableRoot()));
  });

export const saveTableArtifact = createServerFn({ method: "POST" })
  .validator((data: FormData) => data)
  .handler(async ({ data }) => {
    await requireWorkspaceEditor();
    const modeValue = requiredFormString(data, "mode", "Workspace mode");
    if (!workspaceModes.includes(modeValue as WorkspaceMode)) throw new Error("Workspace mode is invalid.");
    const mode = modeValue as WorkspaceMode;
    const projectId = optionalFormString(data, "project_id");
    const sourceChatTitle = optionalFormString(data, "chat_title") ?? undefined;
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
    const title = (await generateArtifactTitle(seedTitle, rows)).slice(0, 96);
    const fileName = `${safeArtifactFileName(title)}.xlsx`;
    const xlsxBlob = await xlsxBlobFromRows(title, rows);
    const r2Key = `${scopeByMode[mode]}/generated/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${fileName}`;
    const href = artifactDownloadHref(r2Key, `/artifacts/${fileName}`);
    const artifactDate = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const artifact: Artifact = {
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
      pinnedTo: [],
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
          pinned
        ) VALUES (?, ?, ?, 'XLSX', 'You', ?, 'Draft', ?, ?, ?, ?, 0)`,
      )
      .bind(
        `artifact-${crypto.randomUUID()}`,
        workspaceId,
        title,
        artifactDate,
        artifact.summary,
        r2Key,
        href,
        JSON.stringify({ preview: artifact.preview, projectId, sourceChatTitle }),
      )
      .run();

    workspace.artifacts = [artifact, ...workspace.artifacts.filter((item) => item.r2Key !== r2Key)];
    recordActivity(workspace, "Artifact saved", `${title} saved as XLSX.`);
    return { workspace: clone(getMutableRoot()), artifact };
  });

export const toggleDecisionStatus = createServerFn({ method: "POST" })
  .validator((data: { mode: WorkspaceMode; id: string }) => data)
  .handler(async ({ data }) => {
    await requireWorkspaceEditor();
    const workspace = getMutableWorkspace(data.mode);
    workspace.decisions = workspace.decisions.map((decision) => (decision.id === data.id ? { ...decision, status: cycleDecisionStatus(decision.status) } : decision));
    const decision = workspace.decisions.find((item) => item.id === data.id);
    recordActivity(workspace, "Decision updated", `${decision?.title ?? "Decision"} is now ${decision?.status ?? "updated"}.`);
    return clone(getMutableRoot());
  });

export const toggleApprovalStatus = createServerFn({ method: "POST" })
  .validator((data: { mode: WorkspaceMode; id: string }) => data)
  .handler(async ({ data }) => {
    await requireWorkspaceEditor();
    const workspace = getMutableWorkspace(data.mode);
    workspace.approvals = workspace.approvals.map((approval) => (approval.id === data.id ? { ...approval, status: cycleApprovalStatus(approval.status) } : approval));
    const approval = workspace.approvals.find((item) => item.id === data.id);
    recordActivity(workspace, "Approval updated", `${approval?.title ?? "Approval"} is now ${approval?.status ?? "updated"}.`);
    return clone(getMutableRoot());
  });

export const toggleTaskStatus = createServerFn({ method: "POST" })
  .validator((data: { mode: WorkspaceMode; id: string }) => data)
  .handler(async ({ data }) => {
    await requireWorkspaceEditor();
    const workspace = getMutableWorkspace(data.mode);
    workspace.tasks = workspace.tasks.map((task) => (task.id === data.id ? { ...task, status: cycleTaskStatus(task.status) } : task));
    const task = workspace.tasks.find((item) => item.id === data.id);
    recordActivity(workspace, "Task updated", `${task?.title ?? "Task"} is now ${task?.status ?? "updated"}.`);
    return clone(getMutableRoot());
  });

export const updateAccessLevel = createServerFn({ method: "POST" })
  .validator((data: { mode: WorkspaceMode; accessLevel: ScopedWorkspaceState["accessLevel"] }) => data)
  .handler(async ({ data }) => {
    await requireWorkspaceEditor();
    const workspace = getMutableWorkspace(data.mode);
    workspace.accessLevel = data.accessLevel;
    recordActivity(workspace, "Workspace access updated", `${workspaceModeLabel(data.mode)} access set to ${data.accessLevel}.`);
    return clone(getMutableRoot());
  });

export const pmoWorkspaceQueryKey = ["ai-command-center"] as const;

export const pmoWorkspaceQueryOptions = () =>
  queryOptions({
    queryKey: pmoWorkspaceQueryKey,
    queryFn: () => fetchPmoWorkspace(),
  });
