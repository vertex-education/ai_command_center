import { useEffect, useRef, useState, type ComponentType } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Bug,
  CheckCircle2,
  ClipboardList,
  Download,
  Eye,
  FileText,
  GitBranch,
  Lightbulb,
  Send,
  Share2,
  ShieldCheck,
  X,
  Zap,
} from "lucide-react";
import { ArtifactRenderer, hasRiskFlagSchema, normalizeMarkdownPreview } from "@/components/ArtifactRenderer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table } from "@/components/ui/table";
import {
  normalizeChatOperationalEntities,
  type ChatOperationalEntity,
  type ChatEntityStatus,
  type ChatEntityType,
} from "@/lib/chat-entities";
import {
  downloadChatExport,
  downloadHtmlTable,
  exportFormatLabel,
  parseChatExportRequest,
  rowsFromHtmlTable,
  type ChatExportFormat,
} from "@/lib/chat-export";
import { cn } from "@/lib/utils";
import {
  type Approval,
  type Artifact,
  type ChatMessage,
  type ChatReasoningLevel,
  type CreateWorkflowSuggestionInput,
  type CreateTaskInput,
  type Decision,
  type Idea,
  type LlmDevTrace,
  type PmoWorkspaceState,
  type Risk,
  type Task,
  type WorkspaceMode,
  pmoWorkspaceQueryKey,
  saveTableArtifact,
  workspaceModes,
} from "@/lib/pmo-data";
import { type ChatWithScopedRagCitation } from "@/lib/rag";
import { addArtifactToWorkspaceCache, emptyChatImageSrc } from "./shared";
import { parsePreviewRows } from "./dialogs";
import { artifactIcon } from "./common";

export function ChatView({
  approvals,
  activeMode,
  activeProjectId,
  canBranch,
  canEdit,
  chatTitle,
  decisions,
  ideas,
  isTyping,
  llmTraces,
  messages,
  pendingApproval,
  pendingTask,
  pendingTaskRemovalId,
  pendingTaskTitle,
  tasks,
  onBranchContext,
  onCreateApproval,
  onCreateDecision,
  onCreateIdea,
  onCreateTask,
  onSyncEntityToAsana,
  onToggleApproval,
  onToggleTask,
  showTokenUsage,
}: {
  approvals: Approval[];
  activeMode: WorkspaceMode;
  activeProjectId: string | null;
  canBranch: boolean;
  canEdit: boolean;
  chatTitle?: string;
  decisions: Decision[];
  ideas: Idea[];
  isTyping: boolean;
  llmTraces: LlmDevTrace[];
  messages: ChatMessage[];
  pendingApproval: boolean;
  pendingTask: boolean;
  pendingTaskRemovalId: string | null;
  pendingTaskTitle: string | null;
  tasks: Task[];
  onBranchContext: (message: ChatMessage) => void;
  onCreateApproval: (input: CreateWorkflowSuggestionInput) => void;
  onCreateDecision: (input: CreateWorkflowSuggestionInput) => void;
  onCreateIdea: (input: CreateWorkflowSuggestionInput) => void;
  onCreateTask: (input: CreateTaskInput) => void;
  onSyncEntityToAsana: (entity: ChatOperationalEntity) => Promise<void>;
  onToggleApproval: (id: string) => void;
  onToggleTask: (id: string) => void;
  showTokenUsage: boolean;
}) {
  const messageEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const [entityStatuses, setEntityStatuses] = useState<Record<string, ChatEntityStatus>>({});

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages, isTyping]);

  useEffect(() => {
    cleanRenderedChatText(chatContainerRef.current);
  }, [messages]);

  const showEmptyChatPlaceholder = messages.length === 0 && !isTyping;
  const showTypingIndicator = isTyping && !messages.some((message) => message.role === "assistant" && message.clientStatus === "sending");

  return (
    <div className="scrollbar-thin min-h-0 flex-1 space-y-4 overflow-y-auto p-4" ref={chatContainerRef}>
      {showEmptyChatPlaceholder ? (
        <div className="flex min-h-full items-center justify-center px-4 py-12">
          <div className="flex max-w-sm flex-col items-center text-center">
            <img alt="" aria-hidden="true" className="mb-5 h-32 w-44 object-contain" src={emptyChatImageSrc} />
            <h2 className="text-lg font-semibold text-foreground">Start a New Chat</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Send a message to begin. The chat name will update after the first response is complete.
            </p>
          </div>
        </div>
      ) : null}
      {messages.map((message, index) => {
        const isUser = message.role === "user";
        const previousUserMessage = [...messages.slice(0, index)].reverse().find((item) => item.role === "user");
        const tokenUsage = !isUser ? getTokenUsageForMessage(message, llmTraces) : null;
        return (
          <article className={cn("flex gap-3", isUser ? "justify-end" : "justify-start")} key={message.id}>
            {!isUser ? (
              <div className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                V
              </div>
            ) : null}
            <div className={cn("max-w-[78%] space-y-1", isUser && "items-end text-right")}>
              <div className={cn("flex flex-wrap items-center gap-2 text-xs text-muted-foreground", isUser && "justify-end")}>
                <strong className="text-sm text-foreground">{isUser ? "You" : "VertexAI"}</strong>
                <span>{message.time}</span>
                {message.clientStatus === "sending" ? (
                  <span className="rounded-md border bg-background px-1.5 py-0.5 text-[11px] font-semibold uppercase text-muted-foreground">
                    Sending
                  </span>
                ) : null}
                {!isUser && showTokenUsage && tokenUsage ? <TokenUsageBadge usage={tokenUsage} /> : null}
              </div>
              <div
                className={cn(
                  "rounded-2xl px-4 py-3 text-left text-sm leading-6 shadow-xs",
                  isUser ? "rounded-br-sm bg-primary text-primary-foreground" : "rounded-bl-sm border bg-muted/60 text-foreground",
                  message.clientStatus === "sending" && "opacity-75",
                )}
              >
                {isUser ? (
                  normalizeChatPlainText(message.text)
                ) : (
                  <AssistantResponseContent
                    approvals={approvals}
                    canEdit={canEdit}
                    chatTitle={chatTitle}
                    activeMode={activeMode}
                    activeProjectId={activeProjectId}
                    decisions={decisions}
                    ideas={ideas}
                    pendingApproval={pendingApproval}
                    pendingTask={pendingTask}
                    pendingTaskRemovalId={pendingTaskRemovalId}
                    pendingTaskTitle={pendingTaskTitle}
                    requestedFormats={parseChatExportRequest(previousUserMessage?.text ?? "")}
                    requestedIdeas={wasIdeaRequest(previousUserMessage?.text ?? "")}
                    requestedJson={wasJsonRequested(previousUserMessage?.text ?? "")}
                    tasks={tasks}
                    title={previousUserMessage?.text ?? "Vertex AI chat export"}
                    text={message.text}
                    onCreateApproval={onCreateApproval}
                    onCreateDecision={onCreateDecision}
                    onCreateIdea={onCreateIdea}
                    onCreateTask={onCreateTask}
                    onToggleApproval={onToggleApproval}
                    onToggleTask={onToggleTask}
                  />
                )}
              </div>
              {message.attachments?.length ? (
                <div className={cn("flex flex-wrap gap-1.5", isUser && "justify-end")}>
                  {message.attachments.map((attachment) => (
                    <span
                      key={attachment.id}
                      className={cn(
                        "inline-flex max-w-full items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-xs text-foreground",
                        attachment.status === "partial" && "border-amber-300 bg-amber-50",
                        attachment.status === "error" && "border-destructive/40 bg-destructive/5 text-destructive",
                      )}
                      title={attachment.error ?? `${attachment.name} was included as Gemma 4 context`}
                    >
                      <FileText className="size-3.5 shrink-0" />
                      <span className="max-w-48 truncate font-medium">{attachment.name}</span>
                      <span className="shrink-0 text-muted-foreground">{attachment.extension.toUpperCase()}</span>
                    </span>
                  ))}
                </div>
              ) : null}
              {!isUser && message.entities?.length ? (
                <ChatEntityCards
                  canEdit={canEdit}
                  entities={message.entities}
                  statuses={entityStatuses}
                  onAcknowledge={(id) => setEntityStatuses((current) => ({ ...current, [id]: "acknowledged" }))}
                  onReject={(id) => setEntityStatuses((current) => ({ ...current, [id]: "rejected" }))}
                  onSyncToAsana={async (entity) => {
                    setEntityStatuses((current) => ({ ...current, [entity.id]: "acknowledged" }));
                    try {
                      await onSyncEntityToAsana(entity);
                      setEntityStatuses((current) => ({ ...current, [entity.id]: "queued" }));
                    } catch {
                      setEntityStatuses((current) => ({ ...current, [entity.id]: "active" }));
                    }
                  }}
                />
              ) : null}
              {canBranch && message.clientStatus !== "sending" ? (
                <div className="flex justify-start">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 px-2 text-xs"
                    title="Branch Context"
                    aria-label={`Branch context from ${isUser ? "your" : "VertexAI"} message at ${message.time}`}
                    onClick={() => onBranchContext(message)}
                  >
                    <GitBranch className="size-3.5" />
                    <span>Branch Context</span>
                  </Button>
                </div>
              ) : null}
              {message.artifact ? (
                <button className="mt-2 grid min-h-14 max-w-lg grid-cols-[34px_minmax(0,1fr)_24px] items-center gap-2 rounded-md border bg-card p-2 text-left">
                  <span className="grid size-8 place-items-center rounded-md bg-primary text-primary-foreground">
                    {artifactIcon(message.artifact.type)}
                  </span>
                  <span className="min-w-0">
                    <strong className="block truncate text-sm">{message.artifact.title}</strong>
                    <em className="block text-xs not-italic text-muted-foreground">{message.artifact.meta}</em>
                  </span>
                  <Eye className="size-4 text-muted-foreground" />
                </button>
              ) : null}
            </div>
            {isUser ? (
              <div className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-sm font-semibold text-muted-foreground">
                You
              </div>
            ) : null}
          </article>
        );
      })}
      {showTypingIndicator ? (
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <div className="grid size-9 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">V</div>
          <div className="rounded-2xl rounded-bl-sm border bg-muted/60 px-4 py-3">
            <span className="animate-pulse">VertexAI is typing...</span>
          </div>
        </div>
      ) : null}
      <div className="h-32 shrink-0" ref={messageEndRef} />
    </div>
  );
}

export const entityTypeStyles: Record<ChatEntityType, { icon: ComponentType<{ className?: string }>; label: string; tone: string }> = {
  Task: { icon: ClipboardList, label: "Task", tone: "border-blue-200 bg-blue-50 text-blue-900" },
  Approval: { icon: ShieldCheck, label: "Approval", tone: "border-emerald-200 bg-emerald-50 text-emerald-900" },
  Idea: { icon: Lightbulb, label: "Idea", tone: "border-amber-200 bg-amber-50 text-amber-900" },
  Risk: { icon: Bug, label: "Risk", tone: "border-rose-200 bg-rose-50 text-rose-900" },
};

export function ChatEntityCards({
  canEdit,
  entities,
  statuses,
  onAcknowledge,
  onReject,
  onSyncToAsana,
}: {
  canEdit: boolean;
  entities: ChatOperationalEntity[];
  statuses: Record<string, ChatEntityStatus>;
  onAcknowledge: (id: string) => void;
  onReject: (id: string) => void;
  onSyncToAsana: (entity: ChatOperationalEntity) => Promise<void>;
}) {
  const [syncingEntityId, setSyncingEntityId] = useState<string | null>(null);
  const visibleEntities = entities.filter((entity) => statuses[entity.id] !== "rejected");
  if (!visibleEntities.length) return null;

  return (
    <div className="mt-2 grid gap-2">
      {visibleEntities.map((entity) => {
        const style = entityTypeStyles[entity.type];
        const Icon = style.icon;
        const status = statuses[entity.id] ?? entity.status ?? "active";
        const isSyncing = syncingEntityId === entity.id;
        const confidence = `${Math.round(entity.confidence * 100)}%`;
        return (
          <Card className="max-w-xl rounded-md border bg-card shadow-xs" key={entity.id}>
            <CardContent className="p-3">
              <div className="flex min-w-0 items-start gap-3">
                <span className={cn("grid size-9 shrink-0 place-items-center rounded-md border", style.tone)}>
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="rounded-md">
                      {style.label}
                    </Badge>
                    {entity.priority ? (
                      <Badge variant="secondary" className="rounded-md">
                        {entity.priority}
                      </Badge>
                    ) : null}
                    <span className="text-xs text-muted-foreground">{confidence} confidence</span>
                    {status !== "active" ? <span className="text-xs font-medium capitalize text-muted-foreground">{status}</span> : null}
                  </div>
                  <h3 className="mt-1 text-sm font-semibold leading-5">{entity.title}</h3>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{entity.description}</p>
                  {entity.owner || entity.dueDate ? (
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                      {entity.owner ? <span>Owner: {entity.owner}</span> : null}
                      {entity.dueDate ? <span>Due: {entity.dueDate}</span> : null}
                    </div>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => onAcknowledge(entity.id)}>
                      <CheckCircle2 className="size-3.5" />
                      <span>Acknowledge</span>
                    </Button>
                    <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5" onClick={() => onReject(entity.id)}>
                      <X className="size-3.5" />
                      <span>Reject</span>
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 gap-1.5"
                      disabled={!canEdit || isSyncing || status === "queued" || status === "synced"}
                      title={canEdit ? "Create a task from this entity and sync it to Asana" : "Viewer access is read-only"}
                      onClick={async () => {
                        setSyncingEntityId(entity.id);
                        try {
                          await onSyncToAsana(entity);
                        } finally {
                          setSyncingEntityId(null);
                        }
                      }}
                    >
                      <Share2 className="size-3.5" />
                      <span>{isSyncing ? "Queueing..." : status === "queued" ? "Queued" : "Sync to Asana"}</span>
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

export type MessageTokenUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

export function getTokenUsageForMessage(message: ChatMessage, traces: LlmDevTrace[]): MessageTokenUsage | null {
  const trace = traces.find((item) => item.responseText === message.text);
  if (!trace) return null;
  const usage = trace.diagnostics.tokenUsage;
  if (usage.inputTokens === null && usage.outputTokens === null && usage.totalTokens === null) return null;
  return usage;
}

export function TokenUsageBadge({ usage }: { usage: MessageTokenUsage }) {
  const input = usage.inputTokens !== null ? usage.inputTokens.toLocaleString() : "?";
  const output = usage.outputTokens !== null ? usage.outputTokens.toLocaleString() : "?";
  const total = usage.totalTokens !== null ? usage.totalTokens.toLocaleString() : "?";
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md border bg-background px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
      title={`Input ${input}, output ${output}, total ${total} tokens`}
    >
      <Zap className="size-3" />
      <span>in {input}</span>
      <span>/</span>
      <span>out {output}</span>
      <span>/</span>
      <span>total {total}</span>
    </span>
  );
}

export function estimateTextTokens(value: string) {
  return Math.max(1, Math.ceil(value.trim().length / 4));
}

export type ScopedRagSseHandlers = {
  onCitations: (citations: ChatWithScopedRagCitation[]) => void;
  onEntities: (entities: ChatOperationalEntity[]) => void;
  onError: (message: string) => void;
  onThinking: (thinking: string) => void;
  onToken: (token: string) => void;
  onTrace: (trace: { context: LlmDevTrace["rawResponse"]; messages: LlmDevTrace["request"]["messages"] }) => void;
};

export function consumeScopedRagEventSource(
  input: {
    assistantMessageId?: string | null;
    asanaSearchEnabled: boolean;
    chatId: string;
    projectId: string | null;
    prompt: string;
    reasoningLevel: ChatReasoningLevel;
    teamId: string;
    webSearchEnabled: boolean;
    workspaceId: string;
  },
  handlers: ScopedRagSseHandlers,
) {
  return new Promise<void>((resolve, reject) => {
    const eventSource = new EventSource(scopedRagStreamUrl(input));
    let completed = false;

    eventSource.addEventListener("trace", (event) => {
      const trace = parseScopedRagTracePayload(parseScopedRagSsePayload(event as MessageEvent));
      if (trace) handlers.onTrace(trace);
    });

    eventSource.addEventListener("citations", (event) => {
      const payload = parseScopedRagSsePayload(event as MessageEvent);
      const citations = typeof payload === "object" && payload ? (payload as { citations?: unknown }).citations : null;
      if (Array.isArray(citations)) handlers.onCitations(citations.filter(isScopedRagCitation));
    });

    eventSource.addEventListener("thinking", (event) => {
      const payload = parseScopedRagSsePayload(event as MessageEvent);
      const thinking = typeof payload === "object" && payload ? (payload as { thinking?: unknown }).thinking : payload;
      if (typeof thinking === "string") handlers.onThinking(thinking);
    });

    eventSource.addEventListener("entities", (event) => {
      const payload = parseScopedRagSsePayload(event as MessageEvent);
      const entities = typeof payload === "object" && payload ? (payload as { entities?: unknown }).entities : null;
      handlers.onEntities(normalizeChatOperationalEntities(entities));
    });

    eventSource.addEventListener("token", (event) => {
      const payload = parseScopedRagSsePayload(event as MessageEvent);
      const token = typeof payload === "object" && payload ? (payload as { token?: unknown }).token : payload;
      if (typeof token === "string") handlers.onToken(token);
    });

    eventSource.addEventListener("done", () => {
      completed = true;
      eventSource.close();
      resolve();
    });

    eventSource.addEventListener("stream-error", (event) => {
      if (completed) return;
      const payload = parseScopedRagSsePayload(event as MessageEvent);
      const message = typeof payload === "object" && payload ? (payload as { message?: unknown }).message : payload;
      const errorMessage = typeof message === "string" ? message : "Scoped RAG stream failed.";
      completed = true;
      eventSource.close();
      try {
        handlers.onError(errorMessage);
      } catch {
        // The promise rejection below is the consumer-facing failure path.
      }
      reject(new Error(errorMessage));
    });

    eventSource.onerror = () => {
      if (completed) return;
      const errorMessage = "Scoped RAG stream connection failed.";
      completed = true;
      eventSource.close();
      reject(new Error(errorMessage));
    };
  });
}

export function scopedRagStreamUrl(input: {
  assistantMessageId?: string | null;
  asanaSearchEnabled: boolean;
  chatId: string;
  projectId: string | null;
  prompt: string;
  reasoningLevel: ChatReasoningLevel;
  teamId: string;
  webSearchEnabled: boolean;
  workspaceId: string;
}) {
  const params = new URLSearchParams({
    stream: "scoped-rag",
    prompt: input.prompt,
    teamId: input.teamId,
    workspaceId: input.workspaceId,
    chatId: input.chatId,
    asanaSearchEnabled: input.asanaSearchEnabled ? "1" : "0",
    reasoningLevel: input.reasoningLevel,
    webSearchEnabled: input.webSearchEnabled ? "1" : "0",
  });
  if (input.projectId) params.set("projectId", input.projectId);
  if (input.assistantMessageId) params.set("assistantMessageId", input.assistantMessageId);
  return `/sse/workspace-events?${params.toString()}`;
}

export function parseScopedRagSsePayload(event: MessageEvent) {
  let payload: unknown;
  try {
    payload = JSON.parse(event.data);
  } catch {
    payload = event.data;
  }
  return payload;
}

export function parseScopedRagTracePayload(payload: unknown): {
  context: LlmDevTrace["rawResponse"];
  messages: LlmDevTrace["request"]["messages"];
} | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  const request = record.request;
  const messages = request && typeof request === "object" && !Array.isArray(request) ? (request as { messages?: unknown }).messages : null;
  if (!Array.isArray(messages)) return null;

  const parsedMessages = messages
    .map((message) => {
      if (!message || typeof message !== "object" || Array.isArray(message)) return null;
      const item = message as { role?: unknown; content?: unknown };
      if (item.role !== "system" && item.role !== "user" && item.role !== "assistant") return null;
      if (typeof item.content !== "string") return null;
      return { role: item.role, content: item.content };
    })
    .filter((message): message is LlmDevTrace["request"]["messages"][number] => Boolean(message));
  if (parsedMessages.length === 0) return null;

  return {
    context: isJsonValue(record.context) ? record.context : null,
    messages: parsedMessages,
  };
}

export function isJsonValue(value: unknown): value is LlmDevTrace["rawResponse"] {
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value !== "object") return false;
  return Object.values(value as Record<string, unknown>).every(isJsonValue);
}

export function isScopedRagCitation(value: unknown): value is ChatWithScopedRagCitation {
  if (!value || typeof value !== "object") return false;
  const citation = value as Partial<ChatWithScopedRagCitation>;
  return typeof citation.id === "string" && typeof citation.documentName === "string" && typeof citation.r2Key === "string";
}

export function formatScopedRagCitations(citations: ChatWithScopedRagCitation[]) {
  if (!citations.length) return "";
  const uniqueCitations = citations.filter((citation, index, list) => list.findIndex((item) => item.r2Key === citation.r2Key) === index);
  const rows = uniqueCitations.map((citation) => {
    const score = citation.score === null ? "" : `, score ${citation.score.toFixed(3)}`;
    return `- ${citation.documentName} ([r2_key: ${citation.r2Key}]${score})`;
  });
  return ["**Sources**", ...rows].join("\n");
}

export type ParsedAssistantResponse =
  | { kind: "json"; content: string }
  | { kind: "markdown"; content: string }
  | { kind: "text"; content: string };

export function wasJsonRequested(prompt: string) {
  return /\b(json|schema|object|array)\b/i.test(prompt) && /\b(return|respond|output|format|give|as|in)\b/i.test(prompt);
}

export function wasIdeaRequest(prompt: string) {
  return (
    /\b(idea|ideas|opportunit(?:y|ies)|suggestion|suggestions|brainstorm|recommendations?|improvements?|enhancements?)\b/i.test(prompt) &&
    /\b(give|suggest|recommend|brainstorm|identify|surface|list|propose|what|how|ways)\b/i.test(prompt)
  );
}

export function parseAssistantResponse(text: string, requestedJson: boolean): ParsedAssistantResponse {
  const trimmed = text.trim();
  const jsonCandidate = extractJsonCandidate(trimmed);
  if (jsonCandidate) {
    try {
      const parsed = JSON.parse(jsonCandidate);
      if (requestedJson || hasWorkflowActionSchema(parsed) || hasRiskFlagSchema(parsed)) {
        return { kind: "json", content: JSON.stringify(parsed, null, 2) };
      }
      const extracted = extractReadableJson(parsed);
      return {
        kind: looksLikeMarkdown(extracted) ? "markdown" : "text",
        content: extracted,
      };
    } catch {
      // Fall through to normal markdown/text detection.
    }
  }

  return looksLikeMarkdown(trimmed) ? { kind: "markdown", content: trimmed } : { kind: "text", content: trimmed };
}

export function normalizeChatPlainText(content: string) {
  return normalizeMarkdownPreview(content, "text") || content;
}

export const normalizeAssistantPlainText = normalizeChatPlainText;

function cleanRenderedChatText(root: HTMLElement | null) {
  if (!root) return;
  const walker = root.ownerDocument.createTreeWalker(root, 4, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return 2;
      if (parent.closest("code, pre, kbd, samp, .katex")) return 2;
      return 1;
    },
  });
  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
  for (const node of textNodes) {
    const current = node.nodeValue ?? "";
    if (!current.includes("\\") && !/[\u2190\u2192\u2194\u21d0\u21d2\u21d4\u27f5\u27f6\u27f7]/.test(current)) continue;
    const normalized = normalizeChatPlainText(current);
    if (normalized !== current) node.nodeValue = normalized;
  }
}

export function extractJsonCandidate(text: string) {
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) return fenced[1].trim();
  if ((text.startsWith("{") && text.endsWith("}")) || (text.startsWith("[") && text.endsWith("]"))) return text;
  return "";
}

export function hasWorkflowActionSchema(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasWorkflowActionSchema);
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return Object.entries(record).some(([key, nestedValue]) => {
    const normalizedKey = key.toLowerCase().replace(/[^a-z]/g, "");
    if (
      [
        "approval",
        "approvals",
        "pendingapproval",
        "pendingapprovals",
        "decision",
        "decisions",
        "idea",
        "ideas",
        "suggestedidea",
        "suggestedideas",
        "potentialidea",
        "potentialideas",
        "opportunity",
        "opportunities",
        "improvement",
        "improvements",
        "enhancement",
        "enhancements",
        "suggestion",
        "suggestions",
        "task",
        "tasks",
        "assignedtask",
        "assignedtasks",
      ].includes(normalizedKey)
    ) {
      return true;
    }
    return hasWorkflowActionSchema(nestedValue);
  });
}

export function extractReadableJson(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null) return "";
  if (Array.isArray(value)) {
    return value
      .map((item) => extractReadableJson(item))
      .filter(Boolean)
      .join("\n");
  }
  if (!value || typeof value !== "object") return "";

  const record = value as Record<string, unknown>;
  for (const key of ["answer", "response", "message", "text", "content", "output", "summary", "result"]) {
    const extracted = extractReadableJson(record[key]);
    if (extracted) return extracted;
  }

  return Object.entries(record)
    .map(([key, nestedValue]) => {
      const extracted = extractReadableJson(nestedValue);
      return extracted ? `${titleCase(key)}: ${extracted}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

export function titleCase(value: string) {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function looksLikeMarkdown(text: string) {
  return [
    /^#{1,6}\s+/m,
    /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/m,
    /^\s*[-*+]\s+/m,
    /^\s*\d+\.\s+/m,
    /```[\s\S]*?```/,
    /`[^`]+`/,
    /\*\*[^*]+\*\*/,
    /\[[^\]]+\]\([^)]+\)/,
    /^\|.+\|$/m,
  ].some((pattern) => pattern.test(text));
}

export function AssistantResponseContent({
  activeMode,
  activeProjectId,
  approvals,
  canEdit,
  chatTitle,
  decisions,
  ideas,
  pendingApproval,
  pendingTask,
  pendingTaskRemovalId,
  pendingTaskTitle,
  requestedFormats,
  requestedIdeas,
  requestedJson,
  tasks,
  text,
  title,
  onCreateApproval,
  onCreateDecision,
  onCreateIdea,
  onCreateTask,
  onToggleApproval,
  onToggleTask,
}: {
  activeMode: WorkspaceMode;
  activeProjectId: string | null;
  approvals: Approval[];
  canEdit: boolean;
  chatTitle?: string;
  decisions: Decision[];
  ideas: Idea[];
  pendingApproval: boolean;
  pendingTask: boolean;
  pendingTaskRemovalId: string | null;
  pendingTaskTitle: string | null;
  requestedFormats: ChatExportFormat[];
  requestedIdeas: boolean;
  requestedJson: boolean;
  tasks: Task[];
  text: string;
  title: string;
  onCreateApproval: (input: CreateWorkflowSuggestionInput) => void;
  onCreateDecision: (input: CreateWorkflowSuggestionInput) => void;
  onCreateIdea: (input: CreateWorkflowSuggestionInput) => void;
  onCreateTask: (input: CreateTaskInput) => void;
  onToggleApproval: (id: string) => void;
  onToggleTask: (id: string) => void;
}) {
  const parsed = parseAssistantResponse(text, requestedJson);
  const workflowActions = {
    approvals,
    decisions,
    ideas,
    tasks,
    canEdit,
    pendingApproval,
    pendingTask,
    pendingTaskRemovalId: pendingTaskRemovalId ?? undefined,
    pendingTaskTitle: pendingTaskTitle ?? undefined,
    preferredSuggestionKind: requestedIdeas ? ("idea" as const) : undefined,
    activeMode,
    activeProjectId,
    sourceTitle: chatTitle,
    onCreateApproval,
    onCreateDecision,
    onCreateIdea,
    onCreateTask,
    onToggleApproval,
    onToggleTask,
  };
  const exportActions = requestedFormats.length ? (
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      {requestedFormats.map((format) => (
        <Button
          key={format}
          type="button"
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 px-2 text-xs"
          onClick={() => downloadChatExport(format, parsed.content, title)}
        >
          <Download className="size-3.5" />
          {exportFormatLabel(format)}
        </Button>
      ))}
    </div>
  ) : null;
  if (parsed.kind === "json") {
    return (
      <div data-source-chat-title={chatTitle ?? ""}>
        {exportActions}
        <ArtifactRenderer fileType="json" previewJson={parsed.content} workflowActions={workflowActions} />
      </div>
    );
  }
  if (parsed.kind === "markdown") {
    return (
      <div data-source-chat-title={chatTitle ?? ""}>
        {exportActions}
        <ArtifactRenderer fileType="markdown" previewJson={{ markdown: parsed.content }} workflowActions={workflowActions} />
      </div>
    );
  }
  return (
    <div data-source-chat-title={chatTitle ?? ""}>
      {exportActions}
      <p className="whitespace-pre-wrap">{normalizeAssistantPlainText(parsed.content)}</p>
    </div>
  );
}

export function RenderedTableExportControls({
  activeMode,
  activeChatTitle,
  artifacts,
  canEdit,
  onError,
  onSaved,
  projectId,
  selectedArtifact,
}: {
  activeMode: WorkspaceMode;
  activeChatTitle?: string;
  artifacts: Artifact[];
  canEdit: boolean;
  onError: (message: string) => void;
  onSaved: (title: string) => void;
  projectId: string | null;
  selectedArtifact?: Artifact;
}) {
  const queryClient = useQueryClient();
  const savedTablesRef = useRef(new Set<string>());
  const savingTablesRef = useRef(new Set<string>());
  const saveMutation = useMutation({
    mutationFn: (formData: FormData) => saveTableArtifact({ data: formData }),
    onMutate: async (formData) => {
      await queryClient.cancelQueries({ queryKey: pmoWorkspaceQueryKey });
      const previousWorkspace = queryClient.getQueryData<PmoWorkspaceState>(pmoWorkspaceQueryKey);
      const title = typeof formData.get("title") === "string" ? String(formData.get("title")) : "Table export";
      const modeValue = formData.get("mode");
      const optimisticMode = workspaceModes.includes(modeValue as WorkspaceMode) ? (modeValue as WorkspaceMode) : activeMode;
      const projectIdValue = formData.get("project_id");
      const sourceChatTitleValue = formData.get("chat_title");
      const rowsJson = formData.get("rows_json");
      const optimisticPreview = parsePreviewRows(typeof rowsJson === "string" ? rowsJson : "");
      const optimisticR2Key = `optimistic-artifact-${Date.now()}`;
      const optimisticArtifact: Artifact = {
        id: optimisticR2Key,
        projectId: typeof projectIdValue === "string" && projectIdValue ? projectIdValue : null,
        sourceChatTitle: typeof sourceChatTitleValue === "string" && sourceChatTitleValue ? sourceChatTitleValue : undefined,
        title,
        type: "XLSX",
        owner: "You",
        date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
        status: "Draft",
        summary: "Saving XLSX artifact...",
        href: "#",
        r2Key: optimisticR2Key,
        preview: ["Saving table export", title],
        previewJson: {
          kind: "table",
          preview: ["Saving table export", title],
          columns: optimisticPreview.columns,
          rows: optimisticPreview.rows,
        },
        pinnedTo: [],
        version: 1,
        commitMessage: "Saving from chat table export",
        clientStatus: "saving",
      };
      queryClient.setQueryData<PmoWorkspaceState>(pmoWorkspaceQueryKey, (current) =>
        addArtifactToWorkspaceCache(current, optimisticMode, optimisticArtifact),
      );
      return { previousWorkspace };
    },
    onSuccess: async (result, formData) => {
      const tableKey = formData.get("table_key");
      if (typeof tableKey === "string") savedTablesRef.current.add(tableKey);
      if (typeof tableKey === "string") savingTablesRef.current.delete(tableKey);
      const workspace = (result as { workspace?: PmoWorkspaceState } | undefined)?.workspace;
      if (workspace) queryClient.setQueryData(pmoWorkspaceQueryKey, workspace);
      const artifact = (result as { artifact?: Artifact } | undefined)?.artifact;
      const title = artifact?.title ?? formData.get("title");
      onSaved(typeof title === "string" ? title : "Table export");
    },
    onError: (error, _formData, context) => {
      const tableKey = _formData.get("table_key");
      if (typeof tableKey === "string") savingTablesRef.current.delete(tableKey);
      if (context?.previousWorkspace) queryClient.setQueryData(pmoWorkspaceQueryKey, context.previousWorkspace);
      onError(error instanceof Error ? error.message : "Could not save artifact.");
    },
  });
  const saveMutateRef = useRef(saveMutation.mutate);

  useEffect(() => {
    saveMutateRef.current = saveMutation.mutate;
  }, [saveMutation.mutate]);

  useEffect(() => {
    const controlsClass = "rendered-table-export-controls";
    const buttonClass =
      "rounded-md border bg-background px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-accent hover:text-foreground";

    function tableTitle(table: HTMLTableElement) {
      const container = table.closest("section, article, aside, div");
      return container?.querySelector("h1,h2,h3,strong")?.textContent?.trim() || table.getAttribute("aria-label") || "table-export";
    }

    function sourceChatTitle(table: HTMLTableElement) {
      const value = table.closest("[data-source-chat-title]")?.getAttribute("data-source-chat-title")?.trim();
      return value || activeChatTitle || "";
    }

    function tableKey(table: HTMLTableElement) {
      const content = `${activeMode}::${projectId ?? "general"}::${tableTitle(table)}::${table.textContent ?? ""}`;
      let hash = 0;
      for (let index = 0; index < content.length; index += 1) {
        hash = (Math.imul(31, hash) + content.charCodeAt(index)) | 0;
      }
      return `table-${Math.abs(hash)}`;
    }

    function normalizePreviewRows(columns: unknown, rows: unknown) {
      if (!Array.isArray(rows)) return null;
      const normalizedColumns = Array.isArray(columns) ? columns.map((column) => String(column ?? "")) : [];
      const normalizedRows = rows.map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? "")) : [String(row ?? "")]));
      return { columns: normalizedColumns, rows: normalizedRows };
    }

    function tablePreviewSignature(table: HTMLTableElement) {
      const preview = parsePreviewRows(JSON.stringify(rowsFromHtmlTable(table)));
      return JSON.stringify({
        projectId: projectId ?? null,
        columns: preview.columns.map((column) => String(column ?? "")),
        rows: preview.rows.map((row) => row.map((cell) => String(cell ?? ""))),
      });
    }

    function artifactPreviewSignature(artifact: Artifact) {
      if (artifact.type !== "XLSX" || (artifact.projectId ?? null) !== (projectId ?? null)) return null;
      if (!artifact.previewJson || typeof artifact.previewJson !== "object" || Array.isArray(artifact.previewJson)) return null;
      const preview = artifact.previewJson as { columns?: unknown; kind?: unknown; rows?: unknown };
      if (preview.kind !== "table") return null;
      const normalized = normalizePreviewRows(preview.columns, preview.rows);
      if (!normalized) return null;
      return JSON.stringify({
        projectId: artifact.projectId ?? null,
        columns: normalized.columns,
        rows: normalized.rows,
      });
    }

    function tableHasSavedArtifact(table: HTMLTableElement) {
      const signature = tablePreviewSignature(table);
      return artifacts.some((artifact) => artifactPreviewSignature(artifact) === signature);
    }

    function button(label: string, title: string, onClick: () => void) {
      const control = document.createElement("button");
      control.type = "button";
      control.className = buttonClass;
      control.textContent = label;
      control.title = title;
      control.setAttribute("aria-label", title);
      control.addEventListener("click", onClick);
      return control;
    }

    function hasSaveableRows(table: HTMLTableElement) {
      const rows = Array.from(table.querySelectorAll("tbody tr"));
      if (rows.length === 0) return false;
      return rows.some((row) => {
        const cells = Array.from(row.querySelectorAll("td,th"));
        if (cells.length === 0) return false;
        if (cells.length === 1 && cells[0].hasAttribute("colspan")) return false;
        return cells.some((cell) => {
          const text = cell.textContent?.trim() ?? "";
          return text && text.toLowerCase() !== "no results.";
        });
      });
    }

    function populateControls(controls: HTMLElement, table: HTMLTableElement) {
      controls.replaceChildren(
        button("CSV", "Export table as CSV", () => downloadHtmlTable("csv", tableTitle(table), table)),
        button("XLSX", "Export table as XLSX", () => downloadHtmlTable("xlsx", tableTitle(table), table)),
      );

      if (canEdit && hasSaveableRows(table)) {
        const key = tableKey(table);
        const saveTable = (saveButton: HTMLButtonElement, updateArtifact: boolean) => {
          const title = tableTitle(table);
          const formData = new FormData();
          formData.set("mode", activeMode);
          if (projectId) formData.set("project_id", projectId);
          const sourceTitle = sourceChatTitle(table);
          if (sourceTitle) formData.set("chat_title", sourceTitle);
          formData.set("title", title);
          formData.set("table_key", key);
          formData.set("rows_json", JSON.stringify(rowsFromHtmlTable(table)));
          if (updateArtifact && selectedArtifact) {
            formData.set("base_artifact_id", selectedArtifact.id);
            formData.set("commit_message", `Updated from ${sourceTitle || activeChatTitle || "follow-on chat"}`);
          }
          savingTablesRef.current.add(key);
          saveButton.disabled = true;
          saveButton.textContent = "Saving...";
          saveButton.className = `${buttonClass} cursor-wait opacity-60`;
          saveMutateRef.current(formData, {
            onSuccess: () => {
              saveButton.disabled = true;
              saveButton.textContent = "Saved to Artifacts";
              saveButton.className = `${buttonClass} cursor-not-allowed opacity-50`;
            },
            onError: () => {
              saveButton.disabled = false;
              saveButton.textContent = "Save to Artifacts";
              saveButton.className = buttonClass;
            },
          });
        };
        const saveButton = button("Save to Artifacts", "Save table as XLSX artifact", () => {
          saveTable(saveButton, false);
        });
        if (savingTablesRef.current.has(key)) {
          saveButton.disabled = true;
          saveButton.textContent = "Saving...";
          saveButton.className = `${buttonClass} cursor-wait opacity-60`;
        } else if (savedTablesRef.current.has(key) || tableHasSavedArtifact(table)) {
          saveButton.disabled = true;
          saveButton.textContent = "Saved to Artifacts";
          saveButton.className = `${buttonClass} cursor-not-allowed opacity-50`;
        }
        controls.appendChild(saveButton);
        if (selectedArtifact?.id.startsWith("artifact-") && selectedArtifact.type === "XLSX" && selectedArtifact.projectId === projectId) {
          const updateButton = button(
            "Update Selected",
            `Create version ${selectedArtifact.version + 1} of ${selectedArtifact.title}`,
            () => {
              saveTable(updateButton, true);
            },
          );
          controls.appendChild(updateButton);
        }
      }
    }

    function addControls() {
      document.querySelectorAll<HTMLTableElement>("table").forEach((table) => {
        if (!table.closest("[data-rendered-markdown='true']")) return;
        if (table.closest(`.${controlsClass}`)) return;
        const anchor = table.parentElement && !table.parentElement.classList.contains(controlsClass) ? table.parentElement : table;
        const existingControls =
          table.nextElementSibling instanceof HTMLElement && table.nextElementSibling.classList.contains(controlsClass)
            ? table.nextElementSibling
            : table.previousElementSibling instanceof HTMLElement && table.previousElementSibling.classList.contains(controlsClass)
              ? table.previousElementSibling
              : anchor.nextElementSibling instanceof HTMLElement && anchor.nextElementSibling.classList.contains(controlsClass)
                ? anchor.nextElementSibling
                : anchor.previousElementSibling instanceof HTMLElement && anchor.previousElementSibling.classList.contains(controlsClass)
                  ? anchor.previousElementSibling
                  : null;
        if (existingControls) {
          existingControls.className = `${controlsClass} mt-2 flex w-full justify-start gap-1`;
          if (existingControls !== anchor.nextElementSibling) {
            anchor.parentElement?.insertBefore(existingControls, anchor.nextSibling);
          }
          table.dataset.exportControls = "true";
          return;
        }
        if (table.dataset.exportControls === "true") return;
        table.dataset.exportControls = "true";

        const controls = document.createElement("div");
        controls.className = `${controlsClass} mt-2 flex w-full justify-start gap-1`;
        populateControls(controls, table);
        anchor.parentElement?.insertBefore(controls, anchor.nextSibling);
      });
    }

    addControls();
    const observer = new MutationObserver(addControls);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      document.querySelectorAll<HTMLElement>(`.${controlsClass}`).forEach((element) => element.remove());
      document.querySelectorAll<HTMLTableElement>("table[data-export-controls='true']").forEach((table) => {
        delete table.dataset.exportControls;
      });
    };
  }, [activeMode, activeChatTitle, artifacts, canEdit, projectId, selectedArtifact]);

  return null;
}
