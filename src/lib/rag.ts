/// <reference path="../../worker-configuration.d.ts" />

import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { setResponseStatus } from "@tanstack/react-start/server";
import { getRequest } from "@tanstack/start-server-core";
import { runTrackedAiGateway } from "@/lib/ai-gateway";
import { recordAdminUsageEvent } from "@/lib/admin-metrics.server";
import { fetchAsanaProjectContextForCurrentUser } from "@/lib/asana-integration.server";
import { getAuth } from "@/lib/auth";
import {
  entityPermissionMatrix,
  normalizeVertexRole,
  roleCanAccessConfidentialArtifacts,
  roleCanModifyState,
  roleDisplayName,
  type VertexAuthRole,
} from "@/lib/auth-access-control";
import { parseChatOperationalEntityJson, type ChatOperationalEntity } from "@/lib/chat-entities";
import type { DocumentIngestionJob } from "@/lib/document-ingestion-queue";
import { classifyPromptIntent, type PromptIntent } from "@/lib/intent-routing";
import {
  buildDynamicWorkspaceContextHeader,
  buildInferenceAuthorizationDirective,
  buildVertexAiSystemPrompt,
  prependDynamicWorkspaceContextHeader,
  prependInferenceAuthorizationDirective,
  type InferenceAuthorizationContext,
} from "@/lib/prompts";
import { createRiskFlagJsonBlocks, formatRiskFlagBlocks } from "@/lib/risk-contract";

const embeddingModelId = "@cf/baai/bge-large-en-v1.5";
const generationModelId = "@cf/google/gemma-4-26b-a4b-it";
const entityExtractionModelId = "@cf/google/gemma-4-26b-a4b-it";
const embeddingBatchSize = 50;
const webSearchTimeoutMs = 10_000;

type RagEnv = Env & {
  VECTORIZE?: Vectorize;
  DOCUMENT_INGESTION_QUEUE?: Queue<DocumentIngestionJob>;
  FIRECRAWL_API_KEY?: string;
  TAVILY_API_KEY?: string;
};

type AuthSession = {
  user?: {
    id?: string;
    role?: string | null;
  };
};

export type StreamReasoningLevel = "low" | "medium" | "high";

type ScopedAccessContext = InferenceAuthorizationContext & {
  userId: string;
  workspaceScope: "personal" | "team" | "org";
  teamId: string | null;
};

export type StreamContextBudget = {
  asanaMaxChars: number;
  maxCompletionTokens: number;
  maxContextTokens: number;
  ragTopK: number;
  reasoningEffort?: "medium" | "high";
  softOverageMultiplier: number;
  thinkingEnabled: boolean;
};

const streamContextBudgets: Record<StreamReasoningLevel, StreamContextBudget> = {
  low: {
    asanaMaxChars: 4_000,
    maxCompletionTokens: 1_200,
    maxContextTokens: 6_000,
    ragTopK: 4,
    softOverageMultiplier: 1.7,
    thinkingEnabled: false,
  },
  medium: {
    asanaMaxChars: 8_000,
    maxCompletionTokens: 8_192,
    maxContextTokens: 14_000,
    ragTopK: 8,
    reasoningEffort: "medium",
    softOverageMultiplier: 1.8,
    thinkingEnabled: true,
  },
  high: {
    asanaMaxChars: 14_000,
    maxCompletionTokens: 16_384,
    maxContextTokens: 28_000,
    ragTopK: 12,
    reasoningEffort: "high",
    softOverageMultiplier: 2.2,
    thinkingEnabled: true,
  },
};

export type IngestGeneratedArtifactInput = {
  rawText: string;
  fileName: string;
  teamId: string;
  projectId: string;
  sensitivityLabel?: "Standard" | "Confidential";
  restricted?: boolean;
};

export type IngestGeneratedArtifactResult = {
  r2Key: string;
  documentName: string;
  status: "queued";
};

export type ChatWithScopedRagInput = {
  prompt: string;
  teamId?: string;
  workspaceId: string;
  projectId?: string | null;
  chatId?: string;
  assistantMessageId?: string | null;
  asanaSearchEnabled?: boolean;
  reasoningLevel?: StreamReasoningLevel;
  webSearchEnabled?: boolean;
};

export type ChatWithScopedRagResult = {
  response: string;
  citations: Array<{
    id: string;
    documentName: string;
    r2Key: string;
    score: number | null;
  }>;
};

export type ChatWithScopedRagCitation = ChatWithScopedRagResult["citations"][number];

type HistoricalPromptContext = {
  context: string;
  citations: ChatWithScopedRagCitation[];
};

type EmbeddingResponse = {
  data?: number[][];
};

type DocumentChunkRow = {
  id: string;
  documentName: string;
  r2Key: string;
  content: string;
  sensitivityLabel: string;
  restricted: boolean;
};

type ScopedPromptContext = {
  workspaceName: string;
  projectName: string | null;
  projectDescription: string | null;
  projectInstructions: string | null;
  projectStatus: string | null;
};

type StreamTraceMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type StreamTracePayload = {
  request: {
    messages: StreamTraceMessage[];
  };
  context: {
    asanaContextChars: number;
    citations: number;
    contextNotice: string | null;
    historicalContextChars: number;
    webContextChars: number;
  };
};

export type TavilySearchPayload = {
  answer?: unknown;
  results?: unknown;
};

export type FirecrawlSearchPayload = {
  data?: unknown;
};

function getRuntimeEnv() {
  return env as RagEnv;
}

function getDb() {
  const db = getRuntimeEnv().DB;
  if (!db) throw new Error("D1 binding DB is required for scoped RAG.");
  return db;
}

function getBucket() {
  const bucket = getRuntimeEnv().ARTIFACTS_BUCKET;
  if (!bucket) throw new Error("R2 binding ARTIFACTS_BUCKET is required for scoped RAG.");
  return bucket;
}

function getVectorize() {
  const vectorize = getRuntimeEnv().VECTORIZE;
  if (!vectorize) throw new Error("Vectorize binding VECTORIZE is required for scoped RAG.");
  return vectorize;
}

function getQueue() {
  const queue = getRuntimeEnv().DOCUMENT_INGESTION_QUEUE;
  if (!queue) throw new Error("Queue binding DOCUMENT_INGESTION_QUEUE is required for scoped RAG.");
  return queue;
}

function getAi() {
  const ai = getRuntimeEnv().AI;
  if (!ai) throw new Error("Workers AI binding AI is required for scoped RAG.");
  return ai;
}

async function currentUserId() {
  const request = getRequest();
  const session = (await getAuth(request).api.getSession({ headers: request.headers })) as AuthSession | null;
  const userId = session?.user?.id;
  if (!userId) throw new Error("Sign in is required.");
  return userId;
}

function buildAuthorizationContext(role: VertexAuthRole): InferenceAuthorizationContext {
  return {
    role,
    roleLabel: roleDisplayName(role),
    canModifyState: roleCanModifyState(role),
    canAccessConfidentialArtifacts: roleCanAccessConfidentialArtifacts(role),
    entityPermissions: entityPermissionMatrix(role),
  };
}

async function currentUserAuthorizationContext() {
  const userId = await currentUserId();
  const activeUser = await getDb().prepare('SELECT role FROM "user" WHERE id = ? LIMIT 1').bind(userId).first<{ role: string | null }>();
  if (!activeUser) throw new Error("Signed-in user was not found.");
  return {
    userId,
    ...buildAuthorizationContext(normalizeVertexRole(activeUser.role)),
  };
}

async function requireScopedProjectAccess(workspaceId: string, projectId: string, teamId: string | null): Promise<ScopedAccessContext> {
  const userAuthorization = await currentUserAuthorizationContext();
  const db = getDb();

  const project = await db
    .prepare(
      `SELECT w.scope as workspaceScope
       FROM projects p
       INNER JOIN workspaces w ON w.id = p.workspace_id
       WHERE p.id = ?
         AND w.id = ?
       LIMIT 1`,
    )
    .bind(projectId, workspaceId)
    .first<{ workspaceScope: "personal" | "team" | "org" }>();
  if (!project) throw new Error("Project was not found in the selected workspace.");

  if (project.workspaceScope === "team") {
    if (!teamId) throw new Error("Select a team before using this team project chat.");
    const teamMembership = await db
      .prepare("SELECT team_id FROM team_members WHERE team_id = ? AND user_id = ? LIMIT 1")
      .bind(teamId, userAuthorization.userId)
      .first<{ team_id: string }>();
    if (!teamMembership) throw new Error("You are not a member of this team.");
  }

  const projectMembership = await db
    .prepare(
      `SELECT project_id
       FROM project_members
       WHERE project_id = ?
         AND user_id = ?
         AND (
           (? = 'team' AND team_id = ?)
           OR (? <> 'team' AND team_id IS NULL)
         )
       LIMIT 1`,
    )
    .bind(projectId, userAuthorization.userId, project.workspaceScope, teamId, project.workspaceScope)
    .first<{ project_id: string }>();
  if (!projectMembership) throw new Error("You are not assigned to this project.");

  return {
    ...userAuthorization,
    workspaceScope: project.workspaceScope,
    teamId: project.workspaceScope === "team" ? teamId : null,
  };
}

async function requireScopedWorkspaceChatAccess(
  workspaceId: string,
  chatId: string | null,
  teamId: string | null,
): Promise<ScopedAccessContext> {
  if (!chatId) throw new Error("Chat is required for workspace streaming.");
  const userAuthorization = await currentUserAuthorizationContext();
  const db = getDb();
  const workspace = await db
    .prepare("SELECT scope as workspaceScope FROM workspaces WHERE id = ? LIMIT 1")
    .bind(workspaceId)
    .first<{ workspaceScope: "personal" | "team" | "org" }>();
  if (!workspace) throw new Error("Workspace was not found.");

  if (workspace.workspaceScope === "team") {
    if (!teamId) throw new Error("Select a team before using this team chat.");
    const teamMembership = await db
      .prepare("SELECT team_id FROM team_members WHERE team_id = ? AND user_id = ? LIMIT 1")
      .bind(teamId, userAuthorization.userId)
      .first<{ team_id: string }>();
    if (!teamMembership) throw new Error("You are not a member of this team.");

    const chat = await db
      .prepare(
        `SELECT c.id
         FROM chats c
         INNER JOIN chat_members cm ON cm.chat_id = c.id
         WHERE c.id = ?
           AND c.workspace_id = ?
           AND c.section = 'workspace'
           AND c.project_id IS NULL
           AND cm.team_id = ?
         LIMIT 1`,
      )
      .bind(chatId, workspaceId, teamId)
      .first<{ id: string }>();
    if (!chat) throw new Error("Chat was not found in this team workspace.");
  } else {
    const chat = await db
      .prepare(
        `SELECT c.id
         FROM chats c
         INNER JOIN chat_members cm ON cm.chat_id = c.id
         WHERE c.id = ?
           AND c.workspace_id = ?
           AND c.section = 'workspace'
           AND c.project_id IS NULL
           AND cm.user_id = ?
           AND cm.team_id IS NULL
         LIMIT 1`,
      )
      .bind(chatId, workspaceId, userAuthorization.userId)
      .first<{ id: string }>();
    if (!chat) throw new Error("Chat was not found in this workspace.");
  }

  return {
    ...userAuthorization,
    workspaceScope: workspace.workspaceScope,
    teamId: workspace.workspaceScope === "team" ? teamId : null,
  };
}

async function requireProjectAccessByProjectId(teamId: string | null, projectId: string) {
  const project = await getDb()
    .prepare("SELECT workspace_id as workspaceId FROM projects WHERE id = ? LIMIT 1")
    .bind(projectId)
    .first<{ workspaceId: string }>();
  if (!project) throw new Error("Project was not found.");
  return requireScopedProjectAccess(project.workspaceId, projectId, teamId);
}

async function fetchScopedPromptContext(workspaceId: string, projectId: string | null) {
  if (!projectId) {
    const context = await getDb()
      .prepare("SELECT name as workspaceName FROM workspaces WHERE id = ? LIMIT 1")
      .bind(workspaceId)
      .first<{ workspaceName: string }>();
    if (!context) throw new Error("Workspace was not found.");
    return {
      workspaceName: context.workspaceName,
      projectName: null,
      projectDescription: null,
      projectInstructions: null,
      projectStatus: null,
    } satisfies ScopedPromptContext;
  }

  const context = await getDb()
    .prepare(
      `SELECT w.name as workspaceName,
              p.name as projectName,
              p.description as projectDescription,
              COALESCE(p.project_instructions, '') as projectInstructions,
              p.status as projectStatus
       FROM projects p
       INNER JOIN workspaces w ON w.id = p.workspace_id
       WHERE w.id = ?
         AND p.id = ?
       LIMIT 1`,
    )
    .bind(workspaceId, projectId)
    .first<ScopedPromptContext>();

  if (!context) throw new Error("Project was not found in the selected workspace.");
  return context;
}

function buildScopedEnvironmentContext(context: ScopedPromptContext) {
  return buildDynamicWorkspaceContextHeader({
    workspaceName: context.workspaceName,
    projectName: context.projectName,
    projectDescription: context.projectDescription,
    projectInstructions: context.projectInstructions,
    projectStatus: context.projectStatus,
  });
}

function prependScopedContextToSystemPrompt(basePrompt: string, context: ScopedPromptContext) {
  return prependDynamicWorkspaceContextHeader(basePrompt, {
    workspaceName: context.workspaceName,
    projectName: context.projectName,
    projectDescription: context.projectDescription,
    projectInstructions: context.projectInstructions,
    projectStatus: context.projectStatus,
  });
}

function prependScopedAuthorizationToSystemPrompt(basePrompt: string, authorization: InferenceAuthorizationContext) {
  return prependInferenceAuthorizationDirective(basePrompt, authorization);
}

export function assertRequiredString(value: string, label: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required.`);
  return trimmed;
}

export function safeFileName(fileName: string) {
  const normalized = fileName.trim().replace(/\\/g, "/").split("/").pop() ?? "artifact.md";
  return normalized.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-|-$/g, "") || "artifact.md";
}

export function contentTypeFor(fileName: string) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".md")) return "text/markdown; charset=utf-8";
  if (lower.endsWith(".txt")) return "text/plain; charset=utf-8";
  if (lower.endsWith(".html")) return "text/html; charset=utf-8";
  if (lower.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
}

export function createR2Key(teamId: string, projectId: string, fileName: string) {
  return `rag/${teamId}/${projectId}/${Date.now()}-${crypto.randomUUID()}-${safeFileName(fileName)}`;
}

export function normalizeSensitivityLabel(value: string | undefined, restricted: boolean | undefined) {
  if (restricted) return "Confidential";
  return value === "Confidential" ? "Confidential" : "Standard";
}

async function embedTexts(
  texts: string[],
  scope?: {
    feature?: string;
    teamId?: string | null;
    userId?: string | null;
    workspaceId?: string | null;
    projectId?: string | null;
  },
) {
  const ai = getAi();
  const embeddings: number[][] = [];

  for (let index = 0; index < texts.length; index += embeddingBatchSize) {
    const batch = texts.slice(index, index + embeddingBatchSize);
    const feature = scope?.feature ?? "scoped-rag-embedding";
    const result = (await runTrackedAiGateway(
      ai,
      embeddingModelId,
      { text: batch, pooling: "cls" },
      {
        feature,
        teamId: scope?.teamId,
        projectId: scope?.projectId,
        identity: {
          userId: scope?.userId,
          workspaceId: scope?.workspaceId,
          teamId: scope?.teamId,
          projectId: scope?.projectId,
          scopeType: "scoped-rag",
        },
        metadata: {
          feature,
          model: embeddingModelId,
          userId: scope?.userId ?? null,
          workspaceId: scope?.workspaceId ?? null,
          teamId: scope?.teamId ?? null,
          projectId: scope?.projectId ?? null,
          batchSize: batch.length,
          batchIndex: index / embeddingBatchSize,
        },
      },
    )) as EmbeddingResponse;
    if (!result.data || result.data.length !== batch.length) {
      throw new Error("Embedding response did not match the requested chunk count.");
    }
    embeddings.push(...result.data);
  }

  return embeddings;
}

function extractStreamToken(payload: unknown) {
  if (typeof payload === "string") return payload;
  if (!payload || typeof payload !== "object") return "";

  const record = payload as Record<string, unknown>;
  for (const key of ["response", "text", "content", "output_text"]) {
    const value = record[key];
    if (typeof value === "string") return value;
  }

  const choices = record.choices;
  if (Array.isArray(choices)) {
    return choices
      .map((choice) => {
        if (!choice || typeof choice !== "object") return "";
        const item = choice as Record<string, unknown>;
        const delta = item.delta;
        if (delta && typeof delta === "object") {
          const content = (delta as Record<string, unknown>).content;
          return typeof content === "string" ? content : "";
        }
        const message = item.message;
        if (message && typeof message === "object") {
          const content = (message as Record<string, unknown>).content;
          return typeof content === "string" ? content : "";
        }
        return typeof item.text === "string" ? item.text : "";
      })
      .join("");
  }

  return "";
}

function extractStreamThinking(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  for (const key of ["thinking", "reasoning", "reasoning_content", "thought"]) {
    const value = record[key];
    if (typeof value === "string") return value;
  }

  const choices = record.choices;
  if (!Array.isArray(choices)) return "";
  return choices
    .map((choice) => {
      if (!choice || typeof choice !== "object") return "";
      const item = choice as Record<string, unknown>;
      const delta = item.delta;
      if (delta && typeof delta === "object") {
        const deltaRecord = delta as Record<string, unknown>;
        for (const key of ["thinking", "reasoning", "reasoning_content", "thought"]) {
          const value = deltaRecord[key];
          if (typeof value === "string") return value;
        }
      }
      const message = item.message;
      if (message && typeof message === "object") {
        const messageRecord = message as Record<string, unknown>;
        for (const key of ["thinking", "reasoning", "reasoning_content", "thought"]) {
          const value = messageRecord[key];
          if (typeof value === "string") return value;
        }
      }
      return "";
    })
    .join("");
}

function buildContext(chunks: DocumentChunkRow[]) {
  if (chunks.length === 0) return "No scoped historical chunks were found.";

  return chunks
    .map(
      (chunk, index) =>
        `[${index + 1}] document="${chunk.documentName}" r2_key="${chunk.r2Key}" vector_id="${chunk.id}" sensitivity="${chunk.sensitivityLabel}" restricted="${chunk.restricted ? "true" : "false"}"\n${chunk.content}`,
    )
    .join("\n\n");
}

export function intentRequiresVectorSearch(intent: PromptIntent) {
  return intent === "RAG_SEARCH" || intent === "WEB_SEARCH";
}

function emptyHistoricalPromptContext(): HistoricalPromptContext {
  return {
    context: "",
    citations: [],
  };
}

function buildScopedVectorFilter(projectId: string, authorization: ScopedAccessContext) {
  return {
    project_id: { $eq: projectId },
    ...(authorization.workspaceScope === "team" && authorization.teamId ? { team_id: { $eq: authorization.teamId } } : {}),
    ...(authorization.canAccessConfidentialArtifacts
      ? {}
      : {
          confidentiality: { $ne: "Confidential" },
          restricted: { $ne: true },
        }),
  };
}

async function fetchScopedHistoricalPromptContext({
  prompt,
  teamId,
  workspaceId,
  projectId,
  feature,
  authorization,
  topK,
}: {
  prompt: string;
  teamId?: string | null;
  workspaceId: string;
  projectId: string;
  feature: string;
  authorization: ScopedAccessContext;
  topK: number;
}): Promise<HistoricalPromptContext> {
  const [promptEmbedding] = await embedTexts([prompt], {
    feature: "scoped-rag-query-embedding",
    teamId,
    userId: authorization.userId,
    workspaceId,
    projectId,
  });
  const vectorStartedAt = Date.now();
  const matches = await getVectorize().query(promptEmbedding, {
    topK,
    returnMetadata: "indexed",
    filter: buildScopedVectorFilter(projectId, authorization),
  });
  await recordAdminUsageEvent({
    provider: "vectorize",
    feature,
    durationMs: Date.now() - vectorStartedAt,
    teamId,
    projectId,
    metadata: {
      workspaceId,
      topK,
      matches: matches.matches.length,
      userRole: authorization.role,
      workspaceScope: authorization.workspaceScope,
      confidentialFiltered: !authorization.canAccessConfidentialArtifacts,
    },
  });

  const vectorIds = matches.matches.map((match) => match.id);
  const chunks = await fetchChunksByIds(vectorIds);
  const scoresById = new Map(matches.matches.map((match) => [match.id, typeof match.score === "number" ? match.score : null]));
  const citations: ChatWithScopedRagCitation[] = chunks.map((chunk) => ({
    id: chunk.id,
    documentName: chunk.documentName,
    r2Key: chunk.r2Key,
    score: scoresById.get(chunk.id) ?? null,
  }));

  return {
    context: buildContext(chunks),
    citations,
  };
}

async function fetchChunksByIds(ids: string[]) {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(", ");
  const result = await getDb()
    .prepare(
      `SELECT id,
              document_name as documentName,
              r2_key as r2Key,
              content,
              COALESCE(sensitivity_label, 'Standard') as sensitivityLabel,
              COALESCE(restricted, 0) as restricted
       FROM document_chunks
       WHERE id IN (${placeholders})`,
    )
    .bind(...ids)
    .all<DocumentChunkRow>();

  const rowsById = new Map((result.results ?? []).map((row) => [row.id, row]));
  return ids.map((id) => rowsById.get(id)).filter((row): row is DocumentChunkRow => Boolean(row));
}

function sseEncode(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function extractTextFromAiContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => extractTextFromAiContent(item))
      .filter(Boolean)
      .join("");
  }
  if (!isRecord(value)) return "";

  for (const key of ["text", "content", "response", "output_text", "value"]) {
    const text = extractTextFromAiContent(value[key]);
    if (text) return text;
  }

  return "";
}

function extractAiTextResponse(result: unknown) {
  if (typeof result === "string") return result;
  if (!isRecord(result)) return "";
  const nestedResult = isRecord(result.result) ? result.result : null;
  const choices = Array.isArray(result.choices) ? result.choices : [];
  const firstChoice = isRecord(choices[0]) ? choices[0] : null;
  const firstMessage = firstChoice && isRecord(firstChoice.message) ? firstChoice.message : null;
  const firstDelta = firstChoice && isRecord(firstChoice.delta) ? firstChoice.delta : null;
  const candidates = [
    result.response,
    result.text,
    result.output_text,
    extractTextFromAiContent(result.content),
    nestedResult?.response,
    nestedResult?.text,
    nestedResult?.output_text,
    extractTextFromAiContent(nestedResult?.content),
    extractTextFromAiContent(result.output),
    extractTextFromAiContent(nestedResult?.output),
    extractTextFromAiContent(firstMessage?.content),
    extractTextFromAiContent(firstMessage?.text),
    extractTextFromAiContent(firstDelta?.content),
  ];
  return candidates.find((candidate) => typeof candidate === "string" && candidate.trim())?.toString() ?? "";
}

async function repairOperationalEntityJson({
  ai,
  chatId,
  projectId,
  rawOutput,
  schema,
  teamId,
  userId,
  workspaceId,
}: {
  ai: Ai;
  chatId: string | null;
  projectId: string | null;
  rawOutput: string;
  schema: string;
  teamId: string | null;
  userId?: string | null;
  workspaceId: string;
}) {
  const result = await runTrackedAiGateway(
    ai,
    entityExtractionModelId,
    {
      messages: [
        {
          role: "system",
          content: [
            "You repair malformed entity extraction output into strict JSON.",
            schema,
            "Use only facts already present in the malformed output. Do not add new entities.",
            "Return [] if no valid entity can be recovered.",
          ].join("\n\n"),
        },
        {
          role: "user",
          content: [
            "Malformed extraction output:",
            truncateForRagPrompt(rawOutput, 6_000),
            "",
            "Return only the repaired strict JSON array.",
          ].join("\n"),
        },
      ],
      max_completion_tokens: 700,
      temperature: 0,
    },
    {
      feature: "scoped-rag-entity-json-repair",
      teamId,
      projectId,
      chatId,
      identity: {
        userId,
        workspaceId,
        teamId,
        projectId,
        scopeType: "scoped-rag",
      },
      metadata: {
        feature: "scoped-rag-entity-repair",
        model: entityExtractionModelId,
        userId: userId ?? null,
        teamId: teamId?.slice(0, 80) ?? null,
        projectId: projectId?.slice(0, 80) ?? null,
        chatId: chatId?.slice(0, 80) ?? null,
        workspaceId,
      },
    },
  );

  return parseChatOperationalEntityJson(extractAiTextResponse(result));
}

async function extractOperationalEntities({
  assistantResponse,
  chatId,
  projectId,
  prompt,
  teamId,
  userId,
  workspaceId,
}: {
  assistantResponse: string;
  chatId: string | null;
  projectId: string | null;
  prompt: string;
  teamId: string | null;
  userId?: string | null;
  workspaceId: string;
}): Promise<ChatOperationalEntity[]> {
  const trimmedPrompt = truncateForRagPrompt(prompt, 3_000);
  const trimmedResponse = truncateForRagPrompt(assistantResponse, 4_000);
  if (!trimmedPrompt && !trimmedResponse) return [];

  const schema = [
    "Return only a strict JSON array. Do not include markdown, prose, comments, or code fences.",
    "Each array item must match this exact object shape:",
    "{",
    '  "id": "stable short id string",',
    '  "type": "Task" | "Approval" | "Idea" | "Risk",',
    '  "title": "short actionable title",',
    '  "description": "one sentence grounded in the chat",',
    '  "owner": "person/team if explicit, otherwise null",',
    '  "dueDate": "date/deadline if explicit, otherwise null",',
    '  "priority": "Low" | "Medium" | "High" | null,',
    '  "severity": "low" | "medium" | "high" | "critical" | null,',
    '  "sourceQuote": "short quote from the prompt or response",',
    '  "confidence": 0.0',
    "}",
    "Definitions:",
    "Task = concrete follow-up work to do.",
    "Approval = explicit decision or permission needed from a person/group.",
    "Idea = suggestion, improvement, opportunity, or possible artifact to explore.",
    "Risk = blocker, dependency, uncertainty, or negative outcome to monitor.",
    "For Risk items, set severity based on operational impact and urgency. For non-Risk items, set severity to null.",
    "Extract only distinct operational entities that are actually present. If none are present, return [].",
  ].join("\n");

  try {
    const ai = getAi();
    const result = await runTrackedAiGateway(
      ai,
      entityExtractionModelId,
      {
        messages: [
          { role: "system", content: schema },
          {
            role: "user",
            content: [
              "Analyze this chat turn for operational entities.",
              "",
              "User prompt:",
              trimmedPrompt,
              "",
              "Assistant response:",
              trimmedResponse,
            ].join("\n"),
          },
        ],
        max_completion_tokens: 700,
        temperature: 0,
      },
      {
        feature: "scoped-rag-entity-extraction",
        teamId,
        projectId,
        chatId,
        identity: {
          userId,
          workspaceId,
          teamId,
          projectId,
          scopeType: "scoped-rag",
        },
        metadata: {
          feature: "scoped-rag-entities",
          model: entityExtractionModelId,
          userId: userId ?? null,
          teamId: teamId?.slice(0, 80) ?? null,
          projectId: projectId?.slice(0, 80) ?? null,
          chatId: chatId?.slice(0, 80) ?? null,
          workspaceId,
        },
      },
    );
    const text = extractAiTextResponse(result);
    try {
      return parseChatOperationalEntityJson(text);
    } catch {
      return repairOperationalEntityJson({
        ai,
        chatId,
        projectId,
        rawOutput: text,
        schema,
        teamId,
        userId,
        workspaceId,
      });
    }
  } catch (error) {
    console.warn("[ScopedRag] Entity extraction failed.", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return [];
  }
}

function createAiSseResponse(
  aiStream: ReadableStream<Uint8Array>,
  citations: ChatWithScopedRagCitation[],
  trace: StreamTracePayload,
  entityContext: {
    assistantMessageId?: string | null;
    chatId: string | null;
    projectId: string | null;
    prompt: string;
    teamId: string | null;
    userId?: string | null;
    workspaceId: string;
  },
) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueue = (event: string, payload: unknown) => controller.enqueue(encoder.encode(sseEncode(event, payload)));
      const reader = aiStream.getReader();
      let buffer = "";
      let fullResponse = "";
      let fullThinking = "";

      enqueue("trace", trace);
      enqueue("citations", { citations });

      try {
        const processRawEvent = (rawEvent: string) => {
          for (const line of rawEvent.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const dataLine = trimmed.slice(5).trim();
            if (!dataLine || dataLine === "[DONE]") continue;

            try {
              const payload = JSON.parse(dataLine);
              const thinking = extractStreamThinking(payload);
              if (thinking) {
                fullThinking += thinking;
                enqueue("thinking", { thinking });
              }
              const token = extractStreamToken(payload);
              if (token) {
                fullResponse += token;
                enqueue("token", { token });
              }
            } catch {
              fullResponse += dataLine;
              enqueue("token", { token: dataLine });
            }
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split("\n\n");
          buffer = events.pop() ?? "";

          for (const rawEvent of events) {
            processRawEvent(rawEvent);
          }
        }

        const tail = decoder.decode();
        if (tail) buffer += tail;
        if (buffer.trim()) {
          for (const rawEvent of buffer.split("\n\n")) {
            processRawEvent(rawEvent);
          }
          buffer = "";
        }
        if (!fullResponse.trim()) {
          fullResponse = "The model did not return a response.";
          enqueue("token", { token: fullResponse });
        }
        const responseForEntityExtraction = fullResponse.trim();
        const entityExtraction = extractOperationalEntities({
          assistantResponse: responseForEntityExtraction,
          ...entityContext,
        });
        const entities = await entityExtraction;
        const riskFlagBlocks = entityContext.projectId
          ? formatRiskFlagBlocks(
              createRiskFlagJsonBlocks(entities, {
                assistantMessageId: entityContext.assistantMessageId,
                projectId: entityContext.projectId,
                workspaceId: entityContext.workspaceId,
              }),
            )
          : "";
        if (riskFlagBlocks) {
          fullResponse += riskFlagBlocks;
          enqueue("token", { token: riskFlagBlocks });
        }
        const finalResponse = fullResponse.trim();
        enqueue("entities", { entities });
        enqueue("done", { response: finalResponse, thinking: fullThinking.trim(), citations, entities });
      } catch (error) {
        enqueue("stream-error", { message: error instanceof Error ? error.message : "Scoped RAG stream failed." });
      } finally {
        reader.releaseLock();
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}

function generationFeatureForIntent(intent: Exclude<PromptIntent, "WEB_SEARCH">) {
  if (intent === "RAG_SEARCH") return "scoped-rag-search-generation";
  if (intent === "ENTITY_EXTRACTION") return "scoped-rag-entity-generation";
  if (intent === "ARTIFACT_GENERATION") return "scoped-rag-artifact-generation";
  return "scoped-rag-direct-chat";
}

function generationMetadataFeatureForIntent(intent: Exclude<PromptIntent, "WEB_SEARCH">) {
  if (intent === "RAG_SEARCH") return "scoped-rag-search";
  if (intent === "ENTITY_EXTRACTION") return "scoped-rag-entity";
  if (intent === "ARTIFACT_GENERATION") return "scoped-rag-artifact";
  return "scoped-rag-direct";
}

function buildIntentGenerationInstruction(intent: Exclude<PromptIntent, "WEB_SEARCH">) {
  if (intent === "ENTITY_EXTRACTION") {
    return "Focus on extracting concrete operational entities from the user's prompt. Include owners, due dates, priority, and source wording only when they are explicit.";
  }
  if (intent === "ARTIFACT_GENERATION") {
    return "Produce the requested standalone artifact in clear Markdown. Use only provided prompt context unless scoped context is explicitly supplied.";
  }
  if (intent === "RAG_SEARCH") {
    return "Ground the answer in the supplied scoped vector/RAG context. Cite supporting artifact keys inline using [r2_key: path] when relying on artifact chunks.";
  }
  return "Answer directly from the prompt and scoped workspace context. Do not claim to have searched project artifacts, web sources, or external systems.";
}

async function createScopedGenerationResponse({
  intent,
  prompt,
  projectId,
  chatId,
  assistantMessageId,
  authorization,
  scopedPromptContext,
  teamId,
  workspaceId,
  asanaContext,
  historicalContext,
  maxCompletionTokens,
  reasoningLevel,
  reasoningProfile,
  contextNotice,
}: {
  intent: Exclude<PromptIntent, "WEB_SEARCH">;
  prompt: string;
  teamId: string | null;
  workspaceId: string;
  projectId: string | null;
  chatId: string | null;
  assistantMessageId?: string | null;
  authorization: ScopedAccessContext;
  scopedPromptContext: ScopedPromptContext;
  asanaContext: string | null;
  historicalContext: HistoricalPromptContext | null;
  maxCompletionTokens: number;
  reasoningLevel: StreamReasoningLevel;
  reasoningProfile: StreamContextBudget;
  contextNotice: string | null;
}) {
  const citations = historicalContext?.citations ?? [];
  const vectorContext = historicalContext?.context.trim() ? historicalContext.context : null;
  const ai = getAi();
  const systemPrompt = prependScopedAuthorizationToSystemPrompt(
    prependScopedContextToSystemPrompt(
      `${buildVertexAiSystemPrompt()} ${buildStreamReasoningInstruction(reasoningLevel)} ${buildIntentGenerationInstruction(intent)}`,
      scopedPromptContext,
    ),
    authorization,
  );
  const messages: StreamTraceMessage[] = [
    { role: "system", content: systemPrompt },
    ...(asanaContext
      ? [
          {
            role: "user" as const,
            content: `Current Asana project context:\n${asanaContext}`,
          },
        ]
      : []),
    ...(contextNotice
      ? [
          {
            role: "user" as const,
            content: `Context budget notice: ${contextNotice}`,
          },
        ]
      : []),
    ...(vectorContext
      ? [
          {
            role: "user" as const,
            content: [
              "Scoped vector/RAG context:",
              vectorContext,
              "",
              "Use this vector context when it is relevant. Cite supporting artifact keys inline using [r2_key: path] when relying on artifact chunks.",
            ].join("\n"),
          },
        ]
      : []),
    { role: "user", content: prompt },
  ];
  const aiStream = (await runTrackedAiGateway(
    ai,
    generationModelId,
    {
      messages,
      max_completion_tokens: maxCompletionTokens,
      reasoning_effort: reasoningProfile.reasoningEffort,
      stream: true,
      chat_template_kwargs: {
        enable_thinking: reasoningProfile.thinkingEnabled,
        thinking: reasoningProfile.thinkingEnabled,
      },
      temperature: 0.2,
    },
    {
      feature: generationFeatureForIntent(intent),
      teamId,
      projectId,
      chatId,
      identity: {
        userId: authorization.userId,
        workspaceId,
        teamId,
        projectId,
        scopeType: authorization.workspaceScope,
      },
      metadata: {
        feature: generationMetadataFeatureForIntent(intent),
        model: generationModelId,
        userId: authorization.userId,
        teamId: teamId?.slice(0, 80) ?? null,
        projectId: projectId?.slice(0, 80) ?? null,
        chatId: chatId?.slice(0, 80) ?? null,
        workspaceId,
        intent,
        vectorizeBypassed: !historicalContext,
        userRole: authorization.role,
        confidentialFiltered: !authorization.canAccessConfidentialArtifacts,
        maxCompletionTokens,
        streamed: true,
        citations: citations.length,
      },
    },
  )) as unknown as ReadableStream<Uint8Array>;

  return createAiSseResponse(
    aiStream,
    citations,
    {
      request: { messages },
      context: {
        asanaContextChars: asanaContext?.length ?? 0,
        citations: citations.length,
        contextNotice,
        historicalContextChars: vectorContext?.length ?? 0,
        webContextChars: 0,
      },
    },
    { assistantMessageId, chatId, projectId, prompt, teamId, userId: authorization.userId, workspaceId },
  );
}

async function createWebSearchGenerationResponse({
  prompt,
  projectId,
  chatId,
  assistantMessageId,
  authorization,
  scopedPromptContext,
  teamId,
  workspaceId,
  asanaContext,
  contextNotice,
  historicalContext,
  maxCompletionTokens,
  reasoningLevel,
  reasoningProfile,
  webContext,
}: {
  prompt: string;
  teamId: string | null;
  workspaceId: string;
  projectId: string | null;
  chatId: string | null;
  assistantMessageId?: string | null;
  authorization: ScopedAccessContext;
  scopedPromptContext: ScopedPromptContext;
  asanaContext: string | null;
  contextNotice: string | null;
  historicalContext: {
    context: string;
    citations: ChatWithScopedRagCitation[];
  };
  maxCompletionTokens: number;
  reasoningLevel: StreamReasoningLevel;
  reasoningProfile: StreamContextBudget;
  webContext: string;
}) {
  const scopeLabel = projectId ? "team-project" : "workspace";
  const systemPrompt = [
    buildInferenceAuthorizationDirective(authorization),
    "",
    buildScopedEnvironmentContext(scopedPromptContext),
    "",
    `You are a scoped ${scopeLabel} assistant.`,
    "Use the real-time web context below for current or external facts and any supplied historical chunks for internal history.",
    "If the web providers are unavailable or do not return useful evidence, say that live web search did not return enough usable information.",
    "Cite supporting artifact keys inline using the format [r2_key: path] when relying on historical chunks.",
    "If supplied historical chunks do not contain enough evidence, say that the scoped artifact history does not contain enough information.",
    "Do not invent citations, source URLs, dates, prices, laws, policies, or public facts.",
    buildStreamReasoningInstruction(reasoningLevel),
    "",
    "Real-Time Web Context:",
    webContext,
    "",
    ...(contextNotice ? ["Context budget notice:", contextNotice, ""] : []),
    ...(asanaContext ? ["Asana project context:", asanaContext, ""] : []),
    "Scoped historical chunks:",
    historicalContext.context,
  ].join("\n");

  const ai = getAi();
  const messages: StreamTraceMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: prompt },
  ];
  const aiStream = (await runTrackedAiGateway(
    ai,
    generationModelId,
    {
      messages,
      max_completion_tokens: maxCompletionTokens,
      reasoning_effort: reasoningProfile.reasoningEffort,
      stream: true,
      chat_template_kwargs: {
        enable_thinking: reasoningProfile.thinkingEnabled,
        thinking: reasoningProfile.thinkingEnabled,
      },
      temperature: 0.2,
    },
    {
      feature: "scoped-rag-web-search",
      teamId,
      projectId,
      chatId,
      identity: {
        userId: authorization.userId,
        workspaceId,
        teamId,
        projectId,
        scopeType: authorization.workspaceScope,
      },
      metadata: {
        feature: "scoped-rag-web",
        model: generationModelId,
        userId: authorization.userId,
        teamId: teamId?.slice(0, 80) ?? null,
        projectId: projectId?.slice(0, 80) ?? null,
        chatId: chatId?.slice(0, 80) ?? null,
        workspaceId,
        intent: "WEB_SEARCH",
        vectorizeBypassed: !projectId,
        userRole: authorization.role,
        confidentialFiltered: !authorization.canAccessConfidentialArtifacts,
        maxCompletionTokens,
        streamed: true,
        citations: historicalContext.citations.length,
      },
    },
  )) as unknown as ReadableStream<Uint8Array>;

  return createAiSseResponse(
    aiStream,
    historicalContext.citations,
    {
      request: { messages },
      context: {
        asanaContextChars: asanaContext?.length ?? 0,
        citations: historicalContext.citations.length,
        contextNotice,
        historicalContextChars: historicalContext.context.length,
        webContextChars: webContext.length,
      },
    },
    { assistantMessageId, chatId, projectId, prompt, teamId, userId: authorization.userId, workspaceId },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function truncateForRagPrompt(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1).trim()}...` : normalized;
}

export function normalizeStreamReasoningLevel(value: unknown): StreamReasoningLevel {
  return value === "medium" || value === "high" ? value : "low";
}

function buildStreamReasoningInstruction(level: StreamReasoningLevel) {
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

function estimateTokens(value: string) {
  return Math.ceil(value.length / 3.6);
}

function charsForTokenBudget(tokens: number) {
  return Math.max(0, Math.floor(tokens * 3.6));
}

function trimToTokenBudget(value: string, maxTokens: number) {
  const maxChars = charsForTokenBudget(maxTokens);
  if (estimateTokens(value) <= maxTokens) return { text: value, trimmed: false };
  return {
    text: `${value.slice(0, Math.max(0, maxChars - 80)).trim()}\n[Context trimmed to fit the selected reasoning mode.]`,
    trimmed: true,
  };
}

function higherReasoningLabel(level: StreamReasoningLevel) {
  if (level === "low") return "Medium or High";
  if (level === "medium") return "High";
  return "an admin-approved larger context limit";
}

export function createTextSseResponse(message: string, citations: ChatWithScopedRagCitation[] = []) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(sseEncode("citations", { citations })));
      controller.enqueue(encoder.encode(sseEncode("token", { token: message })));
      controller.enqueue(encoder.encode(sseEncode("done", { response: message, citations })));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}

export function applyContextBudgets({
  asanaContext,
  budget,
  historicalContext,
  reasoningLevel,
  webContext,
}: {
  asanaContext: string | null;
  budget: StreamContextBudget;
  historicalContext: { context: string; citations: ChatWithScopedRagCitation[] };
  reasoningLevel: StreamReasoningLevel;
  webContext?: string | null;
}) {
  const rawContexts = [historicalContext.context, asanaContext ?? "", webContext ?? ""].filter(Boolean);
  const rawContextTokens = rawContexts.reduce((total, item) => total + estimateTokens(item), 0);
  const hardOverage = rawContextTokens > budget.maxContextTokens * budget.softOverageMultiplier;

  if (hardOverage && reasoningLevel !== "high") {
    return {
      blockedMessage: `This search found about ${rawContextTokens.toLocaleString()} input tokens of project context, which is too much for ${reasoningLevel} reasoning. Switch to ${higherReasoningLabel(reasoningLevel)} reasoning or narrow the Asana/RAG search.`,
      asanaContext: null,
      historicalContext,
      notice: null,
      webContext: webContext ?? null,
    };
  }

  const ragBudget = Math.floor(budget.maxContextTokens * 0.5);
  const asanaBudget = Math.floor(budget.maxContextTokens * 0.32);
  const webBudget = Math.max(800, budget.maxContextTokens - ragBudget - asanaBudget);
  const trimmedHistorical = trimToTokenBudget(historicalContext.context, ragBudget);
  const trimmedAsana = asanaContext ? trimToTokenBudget(asanaContext, asanaBudget) : { text: null, trimmed: false };
  const trimmedWeb = webContext ? trimToTokenBudget(webContext, webBudget) : { text: null, trimmed: false };
  const wasTrimmed = trimmedHistorical.trimmed || trimmedAsana.trimmed || trimmedWeb.trimmed;

  return {
    blockedMessage: null,
    asanaContext: trimmedAsana.text,
    historicalContext: {
      context: trimmedHistorical.text,
      citations: historicalContext.citations,
    },
    notice: wasTrimmed
      ? `Context was trimmed to fit ${reasoningLevel} reasoning. Increase reasoning or narrow the request for broader Asana/RAG coverage.`
      : null,
    webContext: trimmedWeb.text,
  };
}

async function fetchJsonWithTimeout<T>(url: string, init: RequestInit, timeoutMs: number, provider: string) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });

    if (!response.ok) throw new Error(`${provider} search failed with HTTP ${response.status}.`);
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`${provider} search timed out after ${timeoutMs} ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchTavilySearch(query: string, apiKey: string) {
  return fetchJsonWithTimeout<TavilySearchPayload>(
    "https://api.tavily.com/search",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        query,
        search_depth: "advanced",
        include_answer: true,
        include_raw_content: false,
        max_results: 5,
      }),
    },
    webSearchTimeoutMs,
    "Tavily",
  );
}

async function fetchFirecrawlSearch(query: string, apiKey: string) {
  return fetchJsonWithTimeout<FirecrawlSearchPayload>(
    "https://api.firecrawl.dev/v1/search",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        query,
        limit: 5,
        scrapeOptions: {
          formats: ["markdown"],
        },
      }),
    },
    webSearchTimeoutMs,
    "Firecrawl",
  );
}

export function tavilySummaryFromPayload(payload: TavilySearchPayload) {
  if (typeof payload.answer === "string" && payload.answer.trim()) return payload.answer.trim();
  if (!Array.isArray(payload.results)) return "Tavily did not return an AI-generated summary.";

  const snippets = payload.results
    .map((item) => {
      if (!isRecord(item)) return "";
      const title = typeof item.title === "string" ? item.title : "";
      const content = typeof item.content === "string" ? item.content : "";
      const url = typeof item.url === "string" ? item.url : "";
      return [title, url, content].filter(Boolean).join(" - ");
    })
    .filter(Boolean)
    .slice(0, 3);

  return snippets.length ? snippets.join("\n") : "Tavily did not return an AI-generated summary.";
}

export function firecrawlMarkdownFromPayload(payload: FirecrawlSearchPayload) {
  const rows = Array.isArray(payload.data) ? payload.data : [];
  const sections = rows
    .map((item, index) => {
      if (!isRecord(item)) return "";
      const title = typeof item.title === "string" ? item.title : `Result ${index + 1}`;
      const url = typeof item.url === "string" ? item.url : "";
      const markdown =
        typeof item.markdown === "string"
          ? item.markdown
          : typeof item.content === "string"
            ? item.content
            : typeof item.description === "string"
              ? item.description
              : "";
      if (!markdown.trim()) return "";
      return [`### ${title}`, url ? `URL: ${url}` : "", truncateForRagPrompt(markdown, 2_400)].filter(Boolean).join("\n");
    })
    .filter(Boolean)
    .slice(0, 5);

  return sections.length ? sections.join("\n\n") : "Firecrawl did not return markdown content.";
}

export async function fetchConsolidatedWebSearch(
  query: string,
  env: RagEnv,
  usageScope: {
    teamId?: string | null;
    projectId?: string | null;
    chatId?: string | null;
    metadata?: Record<string, unknown>;
  } = {},
) {
  const tasks: Array<Promise<{ provider: "tavily" | "firecrawl"; payload: TavilySearchPayload | FirecrawlSearchPayload }>> = [];
  const tavilyApiKey = env.TAVILY_API_KEY;
  const firecrawlApiKey = env.FIRECRAWL_API_KEY;

  if (tavilyApiKey) {
    const startedAt = Date.now();
    tasks.push(
      fetchTavilySearch(query, tavilyApiKey)
        .then(async (payload) => {
          await recordAdminUsageEvent({
            provider: "tavily",
            feature: "web-search",
            durationMs: Date.now() - startedAt,
            teamId: usageScope.teamId,
            projectId: usageScope.projectId,
            chatId: usageScope.chatId,
            metadata: { queryLength: query.length, ...usageScope.metadata },
          });
          return { provider: "tavily" as const, payload };
        })
        .catch(async (error) => {
          await recordAdminUsageEvent({
            provider: "tavily",
            feature: "web-search-error",
            durationMs: Date.now() - startedAt,
            teamId: usageScope.teamId,
            projectId: usageScope.projectId,
            chatId: usageScope.chatId,
            metadata: {
              queryLength: query.length,
              ...usageScope.metadata,
              error: error instanceof Error ? error.message : "Unknown Tavily error.",
            },
          });
          throw error;
        }),
    );
  }

  if (firecrawlApiKey) {
    const startedAt = Date.now();
    tasks.push(
      fetchFirecrawlSearch(query, firecrawlApiKey)
        .then(async (payload) => {
          await recordAdminUsageEvent({
            provider: "firecrawl",
            feature: "web-search",
            durationMs: Date.now() - startedAt,
            teamId: usageScope.teamId,
            projectId: usageScope.projectId,
            chatId: usageScope.chatId,
            metadata: { queryLength: query.length, ...usageScope.metadata },
          });
          return { provider: "firecrawl" as const, payload };
        })
        .catch(async (error) => {
          await recordAdminUsageEvent({
            provider: "firecrawl",
            feature: "web-search-error",
            durationMs: Date.now() - startedAt,
            teamId: usageScope.teamId,
            projectId: usageScope.projectId,
            chatId: usageScope.chatId,
            metadata: {
              queryLength: query.length,
              ...usageScope.metadata,
              error: error instanceof Error ? error.message : "Unknown Firecrawl error.",
            },
          });
          throw error;
        }),
    );
  }

  if (tasks.length === 0) {
    return "Tavily summary unavailable: TAVILY_API_KEY is not configured.\n\nDeep Dive Content\nFirecrawl markdown unavailable: FIRECRAWL_API_KEY is not configured.";
  }

  const settled = await Promise.allSettled(tasks);
  let tavilySummary = tavilyApiKey
    ? "Tavily search failed or returned no usable summary."
    : "Tavily summary unavailable: TAVILY_API_KEY is not configured.";
  let firecrawlMarkdown = firecrawlApiKey
    ? "Firecrawl search failed or returned no markdown content."
    : "Firecrawl markdown unavailable: FIRECRAWL_API_KEY is not configured.";
  const issues: string[] = [];

  for (const result of settled) {
    if (result.status === "rejected") {
      issues.push(result.reason instanceof Error ? result.reason.message : "A web search provider failed.");
      continue;
    }

    if (result.value.provider === "tavily") {
      tavilySummary = tavilySummaryFromPayload(result.value.payload as TavilySearchPayload);
    } else {
      firecrawlMarkdown = firecrawlMarkdownFromPayload(result.value.payload as FirecrawlSearchPayload);
    }
  }

  return [
    "Tavily AI-Generated Summary",
    truncateForRagPrompt(tavilySummary, 2_000),
    "",
    "Deep Dive Content",
    firecrawlMarkdown,
    issues.length ? `\nProvider issues:\n${issues.map((issue) => `- ${issue}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export const ingestGeneratedArtifact = createServerFn({ method: "POST" })
  .validator((data: IngestGeneratedArtifactInput) => data)
  .handler(async ({ data }): Promise<IngestGeneratedArtifactResult> => {
    const teamId = assertRequiredString(data.teamId, "Team ID");
    const projectId = assertRequiredString(data.projectId, "Project ID");
    const documentName = safeFileName(assertRequiredString(data.fileName, "File name"));
    const rawText = assertRequiredString(data.rawText, "Raw text");
    const sensitivityLabel = normalizeSensitivityLabel(data.sensitivityLabel, data.restricted);
    const restricted = data.restricted || sensitivityLabel === "Confidential";

    await requireProjectAccessByProjectId(teamId, projectId);

    const r2Key = createR2Key(teamId, projectId, documentName);
    await getBucket().put(r2Key, rawText, {
      httpMetadata: {
        contentType: contentTypeFor(documentName),
      },
      customMetadata: {
        team_id: teamId,
        project_id: projectId,
        document_name: documentName,
        confidentiality: sensitivityLabel,
        restricted: restricted ? "true" : "false",
      },
    });

    await getQueue().send({
      kind: "scoped-rag-generated-artifact",
      r2Key,
      documentName,
      teamId,
      projectId,
    });

    setResponseStatus(202);

    return {
      r2Key,
      documentName,
      status: "queued",
    };
  });

export async function createScopedRagStreamResponse(data: ChatWithScopedRagInput): Promise<Response> {
  const workspaceId = assertRequiredString(data.workspaceId, "Workspace ID");
  const projectId = data.projectId?.trim() || null;
  const chatId = data.chatId?.trim() || null;
  const assistantMessageId = data.assistantMessageId?.trim() || null;
  const prompt = assertRequiredString(data.prompt, "Prompt");
  const reasoningLevel = normalizeStreamReasoningLevel(data.reasoningLevel);
  const budget = streamContextBudgets[reasoningLevel];
  const inputTeamId = data.teamId?.trim() || null;

  const authorization = projectId
    ? await requireScopedProjectAccess(workspaceId, projectId, inputTeamId)
    : await requireScopedWorkspaceChatAccess(workspaceId, chatId, inputTeamId);
  const scopedPromptContext = await fetchScopedPromptContext(workspaceId, projectId);
  const teamId = authorization.teamId;

  const runtimeEnv = getRuntimeEnv();
  const classifiedIntent = await classifyPromptIntent(prompt, getAi());
  const intent: PromptIntent = data.webSearchEnabled && classifiedIntent === "RAG_SEARCH" ? "WEB_SEARCH" : classifiedIntent;
  const needsVectorSearch = Boolean(projectId) && intentRequiresVectorSearch(intent);
  const needsWebSearch = intent === "WEB_SEARCH";
  const [rawAsanaContext, rawHistoricalContext, rawWebContext] = await Promise.all([
    projectId
      ? fetchAsanaProjectContextForCurrentUser({
          enabled: data.asanaSearchEnabled,
          maxContextChars: budget.asanaMaxChars,
          prompt,
          vertexProjectId: projectId,
        })
      : Promise.resolve(null),
    needsVectorSearch
      ? fetchScopedHistoricalPromptContext({
          prompt,
          teamId,
          workspaceId,
          projectId: projectId ?? "",
          feature: "scoped-rag-stream-vector-query",
          authorization,
          topK: budget.ragTopK,
        })
      : Promise.resolve(emptyHistoricalPromptContext()),
    needsWebSearch
      ? fetchConsolidatedWebSearch(prompt, runtimeEnv, {
          teamId: authorization.teamId,
          projectId,
          chatId,
          metadata: {
            workspaceId,
            reasoningLevel,
            source: "scoped-rag-stream",
            scope: projectId ? "project" : "workspace",
          },
        })
      : Promise.resolve(null),
  ]);
  const budgetedContext = applyContextBudgets({
    asanaContext: rawAsanaContext,
    budget,
    historicalContext: rawHistoricalContext,
    reasoningLevel,
    webContext: rawWebContext,
  });
  if (budgetedContext.blockedMessage) {
    return createTextSseResponse(budgetedContext.blockedMessage, rawHistoricalContext.citations);
  }

  if (!needsWebSearch) {
    return createScopedGenerationResponse({
      intent,
      prompt,
      teamId,
      workspaceId,
      projectId,
      chatId,
      assistantMessageId,
      authorization,
      scopedPromptContext,
      asanaContext: budgetedContext.asanaContext,
      historicalContext: needsVectorSearch ? budgetedContext.historicalContext : null,
      maxCompletionTokens: budget.maxCompletionTokens,
      reasoningLevel,
      reasoningProfile: budget,
      contextNotice: budgetedContext.notice,
    });
  }

  return createWebSearchGenerationResponse({
    prompt,
    teamId,
    workspaceId,
    projectId,
    chatId,
    assistantMessageId,
    authorization,
    scopedPromptContext,
    asanaContext: budgetedContext.asanaContext,
    contextNotice: budgetedContext.notice,
    historicalContext: budgetedContext.historicalContext,
    maxCompletionTokens: budget.maxCompletionTokens,
    reasoningLevel,
    reasoningProfile: budget,
    webContext: budgetedContext.webContext ?? "Live web search did not return usable context.",
  });
}

export const chatWithScopedRag = createServerFn({ method: "POST" })
  .validator((data: ChatWithScopedRagInput) => data)
  .handler(async ({ data }): Promise<Response> => createScopedRagStreamResponse(data));
