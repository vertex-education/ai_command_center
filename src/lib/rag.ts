/// <reference path="../../worker-configuration.d.ts" />

import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/start-server-core";
import { getAuth } from "@/lib/auth";

const embeddingModelId = "@cf/baai/bge-large-en-v1.5";
const generationModelId = "@cf/google/gemma-4-26b-a4b-it";
const maxChunkChars = 1_600;
const chunkOverlapChars = 180;
const embeddingBatchSize = 50;

type RagEnv = Env & {
  VECTORIZE?: Vectorize;
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
  chunkIds: string[];
  chunkCount: number;
};

export type ChatWithScopedRagInput = {
  prompt: string;
  teamId: string;
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

type EmbeddingResponse = {
  data?: number[][];
};

type DocumentChunkRow = {
  id: string;
  documentName: string;
  r2Key: string;
  content: string;
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

function chunkText(rawText: string) {
  const text = rawText.replace(/\r\n/g, "\n").trim();
  if (!text) return [];

  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const hardEnd = Math.min(start + maxChunkChars, text.length);
    const softBreak = text.lastIndexOf("\n\n", hardEnd);
    const sentenceBreak = text.lastIndexOf(". ", hardEnd);
    const end = softBreak > start + 500 ? softBreak : sentenceBreak > start + 500 ? sentenceBreak + 1 : hardEnd;
    chunks.push(text.slice(start, end).trim());
    if (end >= text.length) break;
    start = Math.max(0, end - chunkOverlapChars);
  }

  return chunks.filter(Boolean);
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

    const chunks = chunkText(rawText);
    if (chunks.length === 0) throw new Error("No text chunks were created.");

    const embeddings = await embedTexts(chunks);
    const createdAt = new Date().toISOString();
    const rows = chunks.map((content, index) => ({
      id: `chunk-${crypto.randomUUID()}`,
      content,
      embedding: embeddings[index],
      chunkIndex: index,
    }));

    await getVectorize().upsert(
      rows.map((row) => ({
        id: row.id,
        values: row.embedding,
        metadata: {
          team_id: teamId,
          project_id: projectId,
          document_name: documentName,
          r2_key: r2Key,
          chunk_index: row.chunkIndex,
        },
      })),
    );

    await getDb().batch(
      rows.map((row) =>
        getDb()
          .prepare(
            `INSERT INTO document_chunks (id, team_id, project_id, document_name, r2_key, content, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(row.id, teamId, projectId, documentName, r2Key, row.content, createdAt),
      ),
    );

    return {
      r2Key,
      documentName,
      chunkIds: rows.map((row) => row.id),
      chunkCount: rows.length,
    };
  });

export const chatWithScopedRag = createServerFn({ method: "POST" })
  .validator((data: ChatWithScopedRagInput) => data)
  .handler(async ({ data }): Promise<ChatWithScopedRagResult> => {
    const teamId = assertRequiredString(data.teamId, "Team ID");
    const projectId = assertRequiredString(data.projectId, "Project ID");
    const prompt = assertRequiredString(data.prompt, "Prompt");

    await requireScopedProjectAccess(teamId, projectId);

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

    const systemPrompt = [
      "You are a scoped team-project assistant.",
      "Use only the historical chunks included below when answering questions about prior generated artifacts.",
      "Cite supporting artifact keys inline using the format [r2_key: path].",
      "If the chunks do not contain enough evidence, say that the scoped artifact history does not contain enough information.",
      "Do not invent citations, file names, paths, dates, or facts.",
      "",
      "Scoped historical chunks:",
      context,
    ].join("\n");

    const result = await getAi().run(generationModelId, {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      max_completion_tokens: 1_200,
      temperature: 0.2,
    });

    const response = extractGeneratedText(result).trim();
    const scoresById = new Map(matches.matches.map((match) => [match.id, typeof match.score === "number" ? match.score : null]));

    return {
      response: response || "The model did not return a response.",
      citations: chunks.map((chunk) => ({
        id: chunk.id,
        documentName: chunk.documentName,
        r2Key: chunk.r2Key,
        score: scoresById.get(chunk.id) ?? null,
      })),
    };
  });
