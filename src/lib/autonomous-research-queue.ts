/// <reference path="../../worker-configuration.d.ts" />

import { ingestScopedRagMarkdownDocument, type DocumentIngestionEnv, type VectorMetadata } from "@/lib/document-ingestion-queue";

export const autonomousResearchQueueName = "autonomous-research-queue";
export const autonomousResearchMetadataSource = "autonomous_research";

export type AutonomousResearchEntityType = "project" | "idea";
export type AutonomousResearchWorkspaceMode = "Personal" | "Team" | "Org";

export type AutonomousResearchJob = {
  kind: "autonomous-research-index";
  requestId: string;
  requestedAt: number;
  entityType: AutonomousResearchEntityType;
  entityId: string;
  workspaceId: string;
  workspaceMode: AutonomousResearchWorkspaceMode;
  teamId: string | null;
  projectId: string | null;
  title: string;
  description: string;
  tags: string[];
  sourceUserId: string | null;
};

export type AutonomousResearchTriggerInput = Omit<AutonomousResearchJob, "kind" | "requestId" | "requestedAt"> & {
  requestId?: string;
  requestedAt?: number;
};

export type AutonomousResearchProducerEnv = {
  AUTONOMOUS_RESEARCH_QUEUE?: Queue<AutonomousResearchJob>;
};

export type AutonomousResearchEnv = DocumentIngestionEnv & {
  FIRECRAWL_API_KEY?: string;
  FIRECRAWL_API_BASE_URL?: string;
};

export type FirecrawlResearchDocument = {
  title: string;
  url: string;
  markdown: string;
  query: string;
};

type FirecrawlSearchPayload = {
  data?: unknown;
  results?: unknown;
};

class PermanentAutonomousResearchError extends Error {
  readonly permanent = true;
}

export class FirecrawlResearchApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const firecrawlSearchTimeoutMs = 20_000;
const defaultFirecrawlSearchUrl = "https://api.firecrawl.dev/v2/search";
const maxQueriesPerJob = 3;
const maxDocumentsPerJob = 6;
const maxDocumentsPerQuery = 3;
const maxMarkdownCharsPerDocument = 12_000;
const maxConsumerAttempts = 3;

const queryStopWords = new Set([
  "about",
  "after",
  "again",
  "against",
  "around",
  "before",
  "being",
  "between",
  "could",
  "education",
  "from",
  "have",
  "into",
  "make",
  "more",
  "need",
  "needs",
  "new",
  "project",
  "system",
  "team",
  "that",
  "their",
  "then",
  "there",
  "these",
  "this",
  "through",
  "vertex",
  "with",
  "work",
  "workflow",
  "would",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function isAutonomousResearchJob(value: unknown): value is AutonomousResearchJob {
  if (!isRecord(value)) return false;
  return (
    value.kind === "autonomous-research-index" &&
    typeof value.requestId === "string" &&
    typeof value.requestedAt === "number" &&
    (value.entityType === "project" || value.entityType === "idea") &&
    typeof value.entityId === "string" &&
    typeof value.workspaceId === "string" &&
    (value.workspaceMode === "Personal" || value.workspaceMode === "Team" || value.workspaceMode === "Org") &&
    (typeof value.teamId === "string" || value.teamId === null) &&
    (typeof value.projectId === "string" || value.projectId === null) &&
    typeof value.title === "string" &&
    typeof value.description === "string" &&
    Array.isArray(value.tags) &&
    value.tags.every((tag) => typeof tag === "string") &&
    (typeof value.sourceUserId === "string" || value.sourceUserId === null)
  );
}

export function buildAutonomousResearchJob(input: AutonomousResearchTriggerInput): AutonomousResearchJob {
  const requestId = input.requestId?.trim() || `autonomous-research-${input.entityType}-${input.entityId}-${crypto.randomUUID()}`;
  return {
    kind: "autonomous-research-index",
    requestId,
    requestedAt: input.requestedAt ?? Date.now(),
    entityType: input.entityType,
    entityId: input.entityId,
    workspaceId: input.workspaceId,
    workspaceMode: input.workspaceMode,
    teamId: input.teamId,
    projectId: input.projectId,
    title: input.title.trim(),
    description: normalizeWhitespace(input.description).slice(0, 2_000),
    tags: input.tags
      .map((tag) => normalizeWhitespace(tag).slice(0, 80))
      .filter(Boolean)
      .slice(0, 12),
    sourceUserId: input.sourceUserId,
  };
}

export async function publishAutonomousResearchTrigger(env: AutonomousResearchProducerEnv, input: AutonomousResearchTriggerInput) {
  const queue = env.AUTONOMOUS_RESEARCH_QUEUE;
  if (!queue) {
    console.warn("Autonomous research queue binding is not configured.", {
      entityType: input.entityType,
      entityId: input.entityId,
    });
    return false;
  }

  const job = buildAutonomousResearchJob(input);
  if (!isAutonomousResearchJob(job)) throw new Error("Invalid autonomous research queue payload.");
  if (!coreDescriptionFromJob(job)) return false;

  try {
    await queue.send(job, { contentType: "json" });
    return true;
  } catch (error) {
    console.error("Autonomous research trigger was not queued.", {
      entityType: job.entityType,
      entityId: job.entityId,
      error: error instanceof Error ? error.message : "Unknown queue publish failure",
    });
    return false;
  }
}

export async function handleAutonomousResearchQueue(batch: MessageBatch<AutonomousResearchJob>, env: AutonomousResearchEnv) {
  for (const message of batch.messages) {
    const job = message.body;
    if (!isAutonomousResearchJob(job)) {
      console.warn("Discarding invalid autonomous research queue payload.", { messageId: message.id });
      message.ack();
      continue;
    }

    try {
      await processAutonomousResearchJob(env, job);
      message.ack();
    } catch (error) {
      const retriable = isRetriableAutonomousResearchError(error);
      const finalAttempt = !retriable || message.attempts >= maxConsumerAttempts;
      console.error("Autonomous research queue job failed.", {
        attempt: message.attempts,
        entityId: job.entityId,
        entityType: job.entityType,
        finalAttempt,
        error: error instanceof Error ? error.message : "Unknown autonomous research failure",
      });

      if (retriable && !finalAttempt) {
        message.retry({ delaySeconds: retryDelaySeconds(message.attempts) });
      } else {
        message.ack();
      }
    }
  }
}

export async function processAutonomousResearchJob(env: AutonomousResearchEnv, job: AutonomousResearchJob) {
  const firecrawlApiKey = env.FIRECRAWL_API_KEY?.trim();
  if (!firecrawlApiKey) throw new PermanentAutonomousResearchError("FIRECRAWL_API_KEY is required for autonomous research.");

  const queries = formulateAutonomousResearchQueries(job);
  if (queries.length === 0) throw new PermanentAutonomousResearchError("No autonomous research queries could be formulated.");

  const documentsByUrl = new Map<string, FirecrawlResearchDocument>();
  for (const query of queries) {
    const payload = await fetchFirecrawlResearch(query, env, firecrawlApiKey);
    for (const document of firecrawlDocumentsFromPayload(payload, query, maxDocumentsPerQuery)) {
      if (!isExternalHttpUrl(document.url)) continue;
      const normalizedUrl = normalizeUrlForDedupe(document.url);
      if (!documentsByUrl.has(normalizedUrl)) documentsByUrl.set(normalizedUrl, document);
      if (documentsByUrl.size >= maxDocumentsPerJob) break;
    }
    if (documentsByUrl.size >= maxDocumentsPerJob) break;
  }

  const documents = [...documentsByUrl.values()];
  if (documents.length === 0) throw new PermanentAutonomousResearchError("Firecrawl did not return usable external markdown.");

  const teamId = job.teamId ?? job.workspaceId;
  const projectId = job.projectId ?? job.entityId;

  for (const document of documents) {
    await ingestScopedRagMarkdownDocument(env, {
      rawText: formatAutonomousResearchMarkdown(job, document),
      documentName: document.title,
      r2Key: document.url,
      workspaceId: job.workspaceId,
      teamId,
      projectId,
      feature: "autonomous-research-embedding",
      embeddingMetadata: {
        entityType: job.entityType,
        entityId: job.entityId,
        source: autonomousResearchMetadataSource,
      },
      vectorMetadata: buildAutonomousResearchVectorMetadata(job, document),
    });
  }

  return {
    documents: documents.length,
    queries: queries.length,
  };
}

export function coreDescriptionFromJob(job: Pick<AutonomousResearchJob, "title" | "description" | "tags">) {
  return normalizeWhitespace([job.title, job.description, job.tags.join(" ")].filter(Boolean).join(" ")).slice(0, 2_400);
}

export function formulateAutonomousResearchQueries(job: Pick<AutonomousResearchJob, "entityType" | "title" | "description" | "tags">) {
  const title = normalizeSearchText(job.title).slice(0, 100);
  const core = coreDescriptionFromJob({ ...job, title });
  const keywords = keywordTokens(core).filter((token) => !title.toLowerCase().split(/\s+/).includes(token));
  const keywordClause = keywords.slice(0, 8).join(" ");
  const focusedClause = keywords.slice(0, 12).join(" ");
  const exactTitle = title.split(/\s+/).length > 1 ? quoteSearchPhrase(title) : title;
  const entityNoun = job.entityType === "project" ? "implementation project" : "improvement idea";

  return uniqueStrings([
    normalizeSearchText([title, keywordClause, "best practices case study"].filter(Boolean).join(" ")),
    normalizeSearchText([exactTitle, keywordClause, entityNoun, "framework"].filter(Boolean).join(" ")),
    normalizeSearchText([focusedClause || title, "risks requirements metrics benchmark"].filter(Boolean).join(" ")),
  ])
    .map((query) => query.slice(0, 220).trim())
    .filter((query) => query.length >= 12)
    .slice(0, maxQueriesPerJob);
}

export function firecrawlDocumentsFromPayload(payload: unknown, query: string, limit = maxDocumentsPerQuery): FirecrawlResearchDocument[] {
  const rows = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.data)
      ? payload.data
      : isRecord(payload) && Array.isArray(payload.results)
        ? payload.results
        : [];

  return rows
    .map((item, index) => {
      if (!isRecord(item)) return null;
      const metadata = isRecord(item.metadata) ? item.metadata : {};
      const url = stringValue(item.url) || stringValue(metadata.url) || stringValue(metadata.sourceURL);
      const title = stringValue(item.title) || stringValue(metadata.title) || `Research result ${index + 1}`;
      const markdown = stringValue(item.markdown) || stringValue(item.content) || stringValue(item.description);
      if (!url || !markdown) return null;
      return {
        title: normalizeWhitespace(title).slice(0, 180),
        url,
        markdown: markdown.replace(/\r\n/g, "\n").trim().slice(0, maxMarkdownCharsPerDocument),
        query,
      } satisfies FirecrawlResearchDocument;
    })
    .filter((item): item is FirecrawlResearchDocument => Boolean(item))
    .slice(0, limit);
}

export function buildAutonomousResearchVectorMetadata(job: AutonomousResearchJob, document: FirecrawlResearchDocument): VectorMetadata {
  return {
    source: autonomousResearchMetadataSource,
    entity_type: job.entityType,
    entity_id: job.entityId,
    workspace_id: job.workspaceId,
    workspace_mode: job.workspaceMode,
    team_id: job.teamId ?? job.workspaceId,
    project_id: job.projectId ?? job.entityId,
    source_url: document.url,
    source_domain: hostnameFromUrl(document.url),
    search_query: document.query,
    research_request_id: job.requestId,
    research_requested_at: job.requestedAt,
    tags: job.tags.join(","),
  };
}

async function fetchFirecrawlResearch(query: string, env: AutonomousResearchEnv, apiKey: string) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), firecrawlSearchTimeoutMs);
  const url = env.FIRECRAWL_API_BASE_URL?.trim() || defaultFirecrawlSearchUrl;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        query,
        limit: maxDocumentsPerQuery,
        scrapeOptions: {
          formats: [{ type: "markdown" }],
          onlyMainContent: true,
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await boundedResponseText(response, 500);
      throw new FirecrawlResearchApiError(errorBody || `Firecrawl search failed with HTTP ${response.status}.`, response.status);
    }

    return (await response.json()) as FirecrawlSearchPayload | FirecrawlSearchPayload[];
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new FirecrawlResearchApiError(`Firecrawl search timed out after ${firecrawlSearchTimeoutMs} ms.`, 408);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function boundedResponseText(response: Response, maxChars: number) {
  const text = await response.text();
  return text.slice(0, maxChars);
}

function formatAutonomousResearchMarkdown(job: AutonomousResearchJob, document: FirecrawlResearchDocument) {
  return [
    `# ${document.title}`,
    "",
    `Source URL: ${document.url}`,
    `Source: ${autonomousResearchMetadataSource}`,
    `Entity: ${job.entityType} ${job.entityId}`,
    `Search query: ${document.query}`,
    "",
    document.markdown,
  ].join("\n");
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeSearchText(value: string) {
  return normalizeWhitespace(value.replace(/[^\w\s"'-]/g, " "));
}

function quoteSearchPhrase(value: string) {
  const phrase = normalizeSearchText(value).replace(/"/g, "").trim();
  return phrase ? `"${phrase}"` : "";
}

function keywordTokens(value: string) {
  const counts = new Map<string, { count: number; firstIndex: number }>();
  const tokens = value.toLowerCase().match(/\b[a-z][a-z0-9-]{2,}\b/g) ?? [];
  tokens.forEach((token, index) => {
    if (queryStopWords.has(token) || token.length < 4) return;
    const existing = counts.get(token);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(token, { count: 1, firstIndex: index });
    }
  });

  return [...counts.entries()]
    .sort(([, left], [, right]) => right.count - left.count || left.firstIndex - right.firstIndex)
    .map(([token]) => token)
    .slice(0, 16);
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map(normalizeWhitespace).filter(Boolean))];
}

function isExternalHttpUrl(value: string) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return (url.protocol === "https:" || url.protocol === "http:") && !["localhost", "127.0.0.1", "::1"].includes(hostname);
  } catch {
    return false;
  }
}

function normalizeUrlForDedupe(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return value.trim();
  }
}

function hostnameFromUrl(value: string) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isRetriableAutonomousResearchError(error: unknown) {
  if (error instanceof PermanentAutonomousResearchError) return false;
  if (error instanceof FirecrawlResearchApiError) return error.status === 408 || error.status === 429 || error.status >= 500;
  if (error instanceof DOMException && error.name === "AbortError") return true;
  return false;
}

function retryDelaySeconds(attempt: number) {
  return Math.min(120, Math.max(10, attempt * attempt * 10));
}
