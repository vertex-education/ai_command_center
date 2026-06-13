/// <reference path="../../worker-configuration.d.ts" />

import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { setResponseStatus } from "@tanstack/react-start/server";
import { getRequest } from "@tanstack/start-server-core";
import { getAuth } from "@/lib/auth";
import type { DocumentIngestionJob } from "@/lib/document-ingestion-queue";
import { buildVertexAiSystemPrompt } from "@/lib/prompts";

const embeddingModelId = "@cf/baai/bge-large-en-v1.5";
const generationModelId = "@cf/google/gemma-4-26b-a4b-it";
const intentRoutingModelId = "@cf/meta/llama-3.2-1b-instruct";
const embeddingBatchSize = 50;

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

export type IngestGeneratedArtifactInput = {
  rawText: string;
  fileName: string;
  teamId: string;
  projectId: string;
};

export type IngestGeneratedArtifactResult = {
  r2Key: string;
  documentName: string;
  status: "queued";
};

export type ChatWithScopedRagInput = {
  prompt: string;
  teamId: string;
  workspaceId: string;
  projectId: string;
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

type EmbeddingResponse = {
  data?: number[][];
};

type DocumentChunkRow = {
  id: string;
  documentName: string;
  r2Key: string;
  content: string;
};

type ScopedPromptContext = {
  workspaceName: string;
  projectName: string;
  projectDescription: string;
  projectStatus: string;
};

type TavilySearchPayload = {
  answer?: unknown;
  results?: unknown;
};

type FirecrawlSearchPayload = {
  data?: unknown;
};

type PromptIntent = "RAG_SEARCH" | "DIRECT_CHAT" | "ARTIFACT_GENERATION";

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

async function requireScopedProjectAccess(teamId: string, projectId: string) {
  const userId = await currentUserId();
  const db = getDb();

  const teamMembership = await db
    .prepare("SELECT team_id FROM team_members WHERE team_id = ? AND user_id = ? LIMIT 1")
    .bind(teamId, userId)
    .first<{ team_id: string }>();
  if (!teamMembership) throw new Error("You are not a member of this team.");

  const projectMembership = await db
    .prepare(
      `SELECT project_id
       FROM project_members
       WHERE project_id = ?
         AND team_id = ?
         AND user_id = ?
       LIMIT 1`,
    )
    .bind(projectId, teamId, userId)
    .first<{ project_id: string }>();
  if (!projectMembership) throw new Error("You are not assigned to this project.");
}

async function fetchScopedPromptContext(workspaceId: string, projectId: string) {
  const context = await getDb()
    .prepare(
      `SELECT w.name as workspaceName,
              p.name as projectName,
              p.description as projectDescription,
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
  return [
    "Current Workspace Context",
    `Workspace: ${context.workspaceName}`,
    `Project: ${context.projectName}`,
    `Project status: ${context.projectStatus}`,
    `Project description: ${context.projectDescription || "No project description is recorded."}`,
  ].join("\n");
}

function prependScopedContextToSystemPrompt(basePrompt: string, context: ScopedPromptContext) {
  return [
    buildScopedEnvironmentContext(context),
    "",
    basePrompt,
  ].join("\n");
}

function assertRequiredString(value: string, label: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required.`);
  return trimmed;
}

function safeFileName(fileName: string) {
  const normalized = fileName.trim().replace(/\\/g, "/").split("/").pop() ?? "artifact.md";
  return normalized.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-|-$/g, "") || "artifact.md";
}

function contentTypeFor(fileName: string) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".md")) return "text/markdown; charset=utf-8";
  if (lower.endsWith(".txt")) return "text/plain; charset=utf-8";
  if (lower.endsWith(".html")) return "text/html; charset=utf-8";
  if (lower.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
}

function createR2Key(teamId: string, projectId: string, fileName: string) {
  return `rag/${teamId}/${projectId}/${Date.now()}-${crypto.randomUUID()}-${safeFileName(fileName)}`;
}

async function embedTexts(texts: string[]) {
  const ai = getAi();
  const embeddings: number[][] = [];

  for (let index = 0; index < texts.length; index += embeddingBatchSize) {
    const batch = texts.slice(index, index + embeddingBatchSize);
    const result = (await ai.run(embeddingModelId, { text: batch, pooling: "cls" })) as EmbeddingResponse;
    if (!result.data || result.data.length !== batch.length) {
      throw new Error("Embedding response did not match the requested chunk count.");
    }
    embeddings.push(...result.data);
  }

  return embeddings;
}

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

function normalizePromptIntent(value: string): PromptIntent | null {
  const normalized = value.trim().toUpperCase().replace(/[^A-Z_]/g, "");
  if (normalized === "RAG_SEARCH" || normalized === "DIRECT_CHAT" || normalized === "ARTIFACT_GENERATION") return normalized;
  return null;
}

async function classifyPromptIntent(prompt: string): Promise<PromptIntent> {
  try {
    const result = await getAi().run(intentRoutingModelId, {
      messages: [
        {
          role: "system",
          content: [
            "Classify the user's latest prompt for a scoped command-center assistant.",
            "Return exactly one label with no explanation: RAG_SEARCH, DIRECT_CHAT, or ARTIFACT_GENERATION.",
            "Use RAG_SEARCH when the user asks about existing workspace, team, project, uploaded artifact, document, file, record, history, source, citation, or prior generated content.",
            "Use DIRECT_CHAT for greetings, administrative questions, general conversation, planning, brainstorming, explanation, or requests that do not need scoped records.",
            "Use ARTIFACT_GENERATION when the user asks to draft, write, create, generate, format, or produce a standalone artifact from the prompt itself.",
            "When unsure, choose RAG_SEARCH.",
          ].join(" "),
        },
        { role: "user", content: prompt },
      ],
      max_completion_tokens: 8,
      temperature: 0,
    });

    const intent = normalizePromptIntent(extractGeneratedText(result));
    return intent ?? "RAG_SEARCH";
  } catch (error) {
    console.warn("[ScopedRAG] Intent routing failed; falling back to RAG_SEARCH.", {
      message: error instanceof Error ? error.message : "Unknown intent routing error.",
    });
    return "RAG_SEARCH";
  }
}

function buildContext(chunks: DocumentChunkRow[]) {
  if (chunks.length === 0) return "No scoped historical chunks were found.";

  return chunks
    .map(
      (chunk, index) =>
        `[${index + 1}] document="${chunk.documentName}" r2_key="${chunk.r2Key}" vector_id="${chunk.id}"\n${chunk.content}`,
    )
    .join("\n\n");
}

async function fetchChunksByIds(ids: string[]) {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(", ");
  const result = await getDb()
    .prepare(
      `SELECT id, document_name as documentName, r2_key as r2Key, content
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

function createAiSseResponse(aiStream: ReadableStream<Uint8Array>, citations: ChatWithScopedRagCitation[]) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueue = (event: string, payload: unknown) => controller.enqueue(encoder.encode(sseEncode(event, payload)));
      const reader = aiStream.getReader();
      let buffer = "";
      let fullResponse = "";

      enqueue("citations", { citations });

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split("\n\n");
          buffer = events.pop() ?? "";

          for (const rawEvent of events) {
            for (const line of rawEvent.split("\n")) {
              const trimmed = line.trim();
              if (!trimmed.startsWith("data:")) continue;
              const dataLine = trimmed.slice(5).trim();
              if (!dataLine || dataLine === "[DONE]") continue;

              try {
                const token = extractStreamToken(JSON.parse(dataLine));
                if (!token) continue;
                fullResponse += token;
                enqueue("token", { token });
              } catch {
                fullResponse += dataLine;
                enqueue("token", { token: dataLine });
              }
            }
          }
        }

        const tail = decoder.decode();
        if (tail) buffer += tail;
        if (!fullResponse.trim()) enqueue("token", { token: "The model did not return a response." });
        enqueue("done", { response: fullResponse.trim(), citations });
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
      "Connection": "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function truncateForRagPrompt(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1).trim()}...` : normalized;
}

function requiresExternalWebKnowledge(prompt: string) {
  const normalized = prompt.toLowerCase();
  const liveWebPatterns = [
    /\b(today|yesterday|this week|this month|this year|currently|current|latest|recent|recently|newest|now|as of)\b/,
    /\b(web|internet|online|search|look up|lookup|browse|google|source|sources|cite|citation)\b/,
    /\b(news|announcement|release|released|pricing|price|stock|weather|schedule|score|law|regulation|policy)\b/,
    /\b(202[5-9]|203\d)\b/,
    /https?:\/\//,
  ];
  return liveWebPatterns.some((pattern) => pattern.test(normalized));
}

async function fetchTavilySearch(query: string, apiKey: string) {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify({
      query,
      search_depth: "advanced",
      include_answer: true,
      include_raw_content: false,
      max_results: 5,
    }),
  });

  if (!response.ok) throw new Error(`Tavily search failed with HTTP ${response.status}.`);
  return await response.json() as TavilySearchPayload;
}

async function fetchFirecrawlSearch(query: string, apiKey: string) {
  const response = await fetch("https://api.firecrawl.dev/v1/search", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify({
      query,
      limit: 5,
      scrapeOptions: {
        formats: [{ type: "markdown" }],
      },
    }),
  });

  if (!response.ok) throw new Error(`Firecrawl search failed with HTTP ${response.status}.`);
  return await response.json() as FirecrawlSearchPayload;
}

function tavilySummaryFromPayload(payload: TavilySearchPayload) {
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

function firecrawlMarkdownFromPayload(payload: FirecrawlSearchPayload) {
  const rows = Array.isArray(payload.data) ? payload.data : [];
  const sections = rows
    .map((item, index) => {
      if (!isRecord(item)) return "";
      const title = typeof item.title === "string" ? item.title : `Result ${index + 1}`;
      const url = typeof item.url === "string" ? item.url : "";
      const markdown = typeof item.markdown === "string"
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

export async function fetchConsolidatedWebSearch(query: string, env: RagEnv) {
  const tasks: Array<Promise<{ provider: "tavily" | "firecrawl"; payload: TavilySearchPayload | FirecrawlSearchPayload }>> = [];

  if (env.TAVILY_API_KEY) {
    tasks.push(fetchTavilySearch(query, env.TAVILY_API_KEY).then((payload) => ({ provider: "tavily" as const, payload })));
  }

  if (env.FIRECRAWL_API_KEY) {
    tasks.push(fetchFirecrawlSearch(query, env.FIRECRAWL_API_KEY).then((payload) => ({ provider: "firecrawl" as const, payload })));
  }

  if (tasks.length === 0) {
    return "Tavily summary unavailable: TAVILY_API_KEY is not configured.\n\nDeep Dive Content\nFirecrawl markdown unavailable: FIRECRAWL_API_KEY is not configured.";
  }

  const settled = await Promise.allSettled(tasks);
  let tavilySummary = env.TAVILY_API_KEY ? "Tavily search failed or returned no usable summary." : "Tavily summary unavailable: TAVILY_API_KEY is not configured.";
  let firecrawlMarkdown = env.FIRECRAWL_API_KEY ? "Firecrawl search failed or returned no markdown content." : "Firecrawl markdown unavailable: FIRECRAWL_API_KEY is not configured.";
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
  ].filter(Boolean).join("\n");
}

export const ingestGeneratedArtifact = createServerFn({ method: "POST" })
  .validator((data: IngestGeneratedArtifactInput) => data)
  .handler(async ({ data }): Promise<IngestGeneratedArtifactResult> => {
    const teamId = assertRequiredString(data.teamId, "Team ID");
    const projectId = assertRequiredString(data.projectId, "Project ID");
    const documentName = safeFileName(assertRequiredString(data.fileName, "File name"));
    const rawText = assertRequiredString(data.rawText, "Raw text");

    await requireScopedProjectAccess(teamId, projectId);

    const r2Key = createR2Key(teamId, projectId, documentName);
    await getBucket().put(r2Key, rawText, {
      httpMetadata: {
        contentType: contentTypeFor(documentName),
      },
      customMetadata: {
        team_id: teamId,
        project_id: projectId,
        document_name: documentName,
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
  const teamId = assertRequiredString(data.teamId, "Team ID");
  const workspaceId = assertRequiredString(data.workspaceId, "Workspace ID");
  const projectId = assertRequiredString(data.projectId, "Project ID");
  const prompt = assertRequiredString(data.prompt, "Prompt");

  await requireScopedProjectAccess(teamId, projectId);
  const scopedPromptContext = await fetchScopedPromptContext(workspaceId, projectId);

  const intent = await classifyPromptIntent(prompt);
  if (intent === "DIRECT_CHAT" || intent === "ARTIFACT_GENERATION") {
    const aiStream = (await getAi().run(generationModelId, {
      messages: [
        { role: "system", content: prependScopedContextToSystemPrompt(buildVertexAiSystemPrompt(), scopedPromptContext) },
        { role: "user", content: prompt },
      ],
      max_completion_tokens: 1_200,
      stream: true,
      temperature: 0.2,
    })) as unknown as ReadableStream<Uint8Array>;

    return createAiSseResponse(aiStream, []);
  }

  const runtimeEnv = getRuntimeEnv();
  const webContext = requiresExternalWebKnowledge(prompt)
    ? await fetchConsolidatedWebSearch(prompt, runtimeEnv)
    : "";

  const [promptEmbedding] = await embedTexts([prompt]);
  const matches = await getVectorize().query(promptEmbedding, {
    topK: 8,
    returnMetadata: "indexed",
    filter: {
      team_id: { $eq: teamId },
      project_id: { $eq: projectId },
    },
  });

  const vectorIds = matches.matches.map((match) => match.id);
  const chunks = await fetchChunksByIds(vectorIds);
  const context = buildContext(chunks);
  const scoresById = new Map(matches.matches.map((match) => [match.id, typeof match.score === "number" ? match.score : null]));
  const citations: ChatWithScopedRagCitation[] = chunks.map((chunk) => ({
    id: chunk.id,
    documentName: chunk.documentName,
    r2Key: chunk.r2Key,
    score: scoresById.get(chunk.id) ?? null,
  }));

  const systemPrompt = [
    buildScopedEnvironmentContext(scopedPromptContext),
    "",
    "You are a scoped team-project assistant.",
    webContext
      ? "Use the real-time web context for external current facts, and use the historical chunks for prior generated artifacts."
      : "Use only the historical chunks included below when answering questions about prior generated artifacts.",
    "Cite supporting artifact keys inline using the format [r2_key: path].",
    "If the chunks do not contain enough evidence, say that the scoped artifact history does not contain enough information.",
    "Do not invent citations, file names, paths, dates, or facts.",
    "",
    ...(webContext ? ["Real-Time Web Context:", webContext, ""] : []),
    "Scoped historical chunks:",
    context,
  ].join("\n");

  const aiStream = (await getAi().run(generationModelId, {
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ],
    max_completion_tokens: 1_200,
    stream: true,
    temperature: 0.2,
  })) as unknown as ReadableStream<Uint8Array>;

  return createAiSseResponse(aiStream, citations);
}

export const chatWithScopedRag = createServerFn({ method: "POST" })
  .validator((data: ChatWithScopedRagInput) => data)
  .handler(async ({ data }): Promise<Response> => createScopedRagStreamResponse(data));
