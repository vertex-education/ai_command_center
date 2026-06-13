/// <reference path="../worker-configuration.d.ts" />

type ScopeLevel = "org" | "team" | "personal";

type DocumentIngestionJob = {
  artifactId: string;
  r2Key: string;
  originalFilename: string;
  mimeType: string;
  fileSize: number;
  scopeLevel: ScopeLevel;
  scopeId: string;
  projectId: string | null;
  documentType: string;
  customTags: string[];
};

type EmbeddingResponse = {
  data?: number[][];
};

type IngestionEnv = Env & {
  ARTIFACTS_BUCKET: R2Bucket;
  DB: D1Database;
  VECTORIZE: Vectorize;
  AI: Ai;
};

const embeddingModelId = "@cf/baai/bge-large-en-v1.5";
const maxChunkChars = 1_600;
const chunkOverlapChars = 180;
const embeddingBatchSize = 50;

function fileExtension(fileName: string) {
  const match = fileName.toLowerCase().match(/\.([a-z0-9]{1,16})$/);
  return match?.[1] ?? "";
}

async function extractText(fileBuffer: ArrayBuffer, extension: string) {
  // Production extraction belongs here, outside the upload request path.
  // Use a lightweight WASM parser or call an extraction API such as unstructured.io.
  if (extension === "txt" || extension === "md" || extension === "csv" || extension === "html") {
    return new TextDecoder().decode(fileBuffer);
  }

  return [
    `Mock extracted text for .${extension || "unknown"} artifact.`,
    "Replace this function with binary-safe document parsing in the Queue consumer.",
  ].join("\n");
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

async function embedTexts(env: IngestionEnv, texts: string[]) {
  const embeddings: number[][] = [];

  for (let index = 0; index < texts.length; index += embeddingBatchSize) {
    const batch = texts.slice(index, index + embeddingBatchSize);
    const result = (await env.AI.run(embeddingModelId, { text: batch, pooling: "cls" })) as EmbeddingResponse;
    if (!result.data || result.data.length !== batch.length) {
      throw new Error("Embedding response did not match the requested chunk count.");
    }
    embeddings.push(...result.data);
  }

  return embeddings;
}

function customTagsIndexValue(customTags: string[]) {
  return customTags.map((tag) => tag.trim().toLowerCase()).filter(Boolean).join(",");
}

async function updateArtifactStatus(env: IngestionEnv, artifactId: string, status: "processing" | "completed" | "failed", errorMessage?: string, chunkCount = 0) {
  const completedAt = status === "completed" ? new Date().toISOString() : null;
  await env.DB.prepare(
    `UPDATE artifacts_registry
     SET status = ?,
         error_message = ?,
         chunk_count = CASE WHEN ? > 0 THEN ? ELSE chunk_count END,
         updated_at = ?,
         completed_at = COALESCE(?, completed_at)
     WHERE id = ?`,
  )
    .bind(status, errorMessage ?? null, chunkCount, chunkCount, new Date().toISOString(), completedAt, artifactId)
    .run();
}

async function processJob(env: IngestionEnv, job: DocumentIngestionJob) {
  await updateArtifactStatus(env, job.artifactId, "processing");

  const object = await env.ARTIFACTS_BUCKET.get(job.r2Key);
  if (!object) throw new Error(`R2 object not found: ${job.r2Key}`);

  const fileBuffer = await object.arrayBuffer();
  const extractedText = await extractText(fileBuffer, fileExtension(job.originalFilename));
  const chunks = chunkText(extractedText);
  if (chunks.length === 0) throw new Error("No text chunks were created.");

  const embeddings = await embedTexts(env, chunks);
  const createdAt = new Date().toISOString();
  const rows = chunks.map((content, index) => ({
    id: `chunk-${crypto.randomUUID()}`,
    vectorId: `vector-${job.artifactId}-${index}`,
    chunkIndex: index,
    content,
    embedding: embeddings[index],
  }));
  const customTags = customTagsIndexValue(job.customTags);

  await env.VECTORIZE.upsert(
    rows.map((row) => ({
      id: row.vectorId,
      values: row.embedding,
      metadata: {
        artifact_id: job.artifactId,
        chunk_id: row.id,
        r2_key: job.r2Key,
        document_name: job.originalFilename,
        scope_level: job.scopeLevel,
        scope_id: job.scopeId,
        project_id: job.projectId ?? "",
        document_type: job.documentType,
        custom_tags: customTags,
        chunk_index: row.chunkIndex,
      },
    })),
  );

  await env.DB.batch(
    rows.map((row) =>
      env.DB.prepare(
        `INSERT INTO document_chunks_v2 (
          id,
          artifact_id,
          chunk_index,
          vector_id,
          r2_key,
          content,
          scope_level,
          scope_id,
          project_id,
          document_type,
          custom_tags_json,
          token_count,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        row.id,
        job.artifactId,
        row.chunkIndex,
        row.vectorId,
        job.r2Key,
        row.content,
        job.scopeLevel,
        job.scopeId,
        job.projectId,
        job.documentType,
        JSON.stringify(job.customTags),
        Math.ceil(row.content.length / 4),
        createdAt,
      ),
    ),
  );

  await updateArtifactStatus(env, job.artifactId, "completed", undefined, rows.length);
}

export default {
  async queue(batch: MessageBatch<DocumentIngestionJob>, env: IngestionEnv) {
    for (const message of batch.messages) {
      try {
        await processJob(env, message.body);
        message.ack();
      } catch (error) {
        const artifactId = message.body?.artifactId;
        if (artifactId) {
          await updateArtifactStatus(env, artifactId, "failed", error instanceof Error ? error.message : "Unknown ingestion failure");
        }
        message.retry();
      }
    }
  },
};
