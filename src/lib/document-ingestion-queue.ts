/// <reference path="../../worker-configuration.d.ts" />

import { runTrackedWorkersAiWithGateway } from "@/lib/ai-gateway";

export type ScopeLevel = "org" | "team" | "personal";

export type RegistryDocumentIngestionJob = {
  kind?: "artifact-registry-upload";
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

export type ScopedRagDocumentIngestionJob = {
  kind: "scoped-rag-generated-artifact";
  r2Key: string;
  documentName: string;
  teamId: string;
  projectId: string;
};

export type DocumentIngestionJob = RegistryDocumentIngestionJob | ScopedRagDocumentIngestionJob;

type EmbeddingResponse = {
  data?: number[][];
};

export type DocumentIngestionEnv = Env & {
  ARTIFACTS_BUCKET: R2Bucket;
  DB: D1Database;
  VECTORIZE: Vectorize;
  AI: Ai;
};

const embeddingModelId = "@cf/baai/bge-large-en-v1.5";
const maxChunkChars = 1_600;
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

type MarkdownBlock = {
  text: string;
  kind: "code" | "text";
};

function isFenceLine(line: string) {
  const match = line.match(/^\s*(```+|~~~+)/);
  return match?.[1] ?? null;
}

function isTopLevelHeading(line: string) {
  return /^#{1,3}\s+\S/.test(line);
}

function trimBlock(lines: string[]) {
  return lines.join("\n").trim();
}

function splitOversizedTextBlock(block: string) {
  if (block.length <= maxChunkChars) return [block];

  const chunks: string[] = [];
  let start = 0;

  while (start < block.length) {
    const hardEnd = Math.min(start + maxChunkChars, block.length);
    if (hardEnd >= block.length) {
      chunks.push(block.slice(start).trim());
      break;
    }

    const candidate = block.slice(start, hardEnd);
    const lineBreak = candidate.lastIndexOf("\n");
    const sentenceBreak = candidate.lastIndexOf(". ");
    const wordBreak = candidate.lastIndexOf(" ");
    const breakAt = lineBreak > 200
      ? lineBreak
      : sentenceBreak > 200
        ? sentenceBreak + 1
        : wordBreak > 200
          ? wordBreak
          : candidate.length;

    chunks.push(block.slice(start, start + breakAt).trim());
    start += breakAt;
    while (block[start] === "\n" || block[start] === " ") start += 1;
  }

  return chunks.filter(Boolean);
}

function splitSectionIntoSemanticBlocks(section: string) {
  const lines = section.split("\n");
  const blocks: MarkdownBlock[] = [];
  let current: string[] = [];
  let inCodeBlock = false;
  let fenceMarker: string | null = null;

  const flush = () => {
    const text = trimBlock(current);
    if (text) blocks.push({ text, kind: inCodeBlock ? "code" : "text" });
    current = [];
  };

  for (const line of lines) {
    const fence = isFenceLine(line);

    if (fence && !inCodeBlock) {
      flush();
      inCodeBlock = true;
      fenceMarker = fence[0];
      current.push(line);
      continue;
    }

    current.push(line);

    if (fence && inCodeBlock && fence[0] === fenceMarker) {
      flush();
      inCodeBlock = false;
      fenceMarker = null;
      continue;
    }

    if (!inCodeBlock && line.trim() === "") {
      flush();
    }
  }

  flush();
  return blocks;
}

function splitOversizedSection(section: string) {
  const blocks = splitSectionIntoSemanticBlocks(section);
  const chunks: string[] = [];
  let current = "";

  for (const block of blocks) {
    const blockChunks = block.kind === "code" || block.text.length <= maxChunkChars
      ? [block.text]
      : splitOversizedTextBlock(block.text);

    for (const blockChunk of blockChunks) {
      if (!current) {
        current = blockChunk;
        continue;
      }

      const next = `${current}\n\n${blockChunk}`;
      if (next.length <= maxChunkChars) {
        current = next;
      } else {
        chunks.push(current);
        current = blockChunk;
      }
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function chunkText(rawText: string) {
  const text = rawText.replace(/\r\n/g, "\n").trim();
  if (!text) return [];

  const sections: string[] = [];
  let current: string[] = [];
  let inCodeBlock = false;
  let fenceMarker: string | null = null;

  for (const line of text.split("\n")) {
    const fence = isFenceLine(line);
    if (fence) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        fenceMarker = fence[0];
      } else if (fence[0] === fenceMarker) {
        inCodeBlock = false;
        fenceMarker = null;
      }
    }

    if (!inCodeBlock && isTopLevelHeading(line) && current.length > 0) {
      sections.push(trimBlock(current));
      current = [];
    }

    current.push(line);
  }

  const tail = trimBlock(current);
  if (tail) sections.push(tail);

  return sections.flatMap((section) => (
    section.length <= maxChunkChars ? [section] : splitOversizedSection(section)
  )).filter(Boolean);
}

async function embedTexts(
  env: DocumentIngestionEnv,
  texts: string[],
  scope: {
    feature: string;
    teamId?: string | null;
    projectId?: string | null;
    metadata?: Record<string, string | number | boolean | null>;
  },
) {
  const embeddings: number[][] = [];

  for (let index = 0; index < texts.length; index += embeddingBatchSize) {
    const batch = texts.slice(index, index + embeddingBatchSize);
    const result = (await runTrackedWorkersAiWithGateway(env.AI, embeddingModelId, { text: batch, pooling: "cls" }, {
      feature: scope.feature,
      usageDb: env.DB,
      teamId: scope.teamId,
      projectId: scope.projectId,
      metadata: {
        feature: scope.feature,
        model: embeddingModelId,
        batchSize: batch.length,
        batchIndex: index / embeddingBatchSize,
        ...scope.metadata,
      },
    })) as EmbeddingResponse;
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

function isConfidentialTag(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized === "confidential" || normalized === "restricted";
}

function inferSensitivityLabel({
  customTags = [],
  documentName,
  metadata,
}: {
  customTags?: string[];
  documentName: string;
  metadata?: Record<string, string>;
}) {
  const metadataValues = metadata
    ? [
        metadata.confidentiality,
        metadata.sensitivity,
        metadata.sensitivity_label,
        metadata.classification,
        metadata.restricted,
        metadata.access,
      ].filter((value): value is string => typeof value === "string")
    : [];
  const values = [...customTags, ...metadataValues, documentName];
  return values.some(isConfidentialTag) ? "Confidential" : "Standard";
}

async function updateArtifactStatus(env: DocumentIngestionEnv, artifactId: string, status: "processing" | "completed" | "failed", errorMessage?: string, chunkCount = 0) {
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

async function processRegistryUploadJob(env: DocumentIngestionEnv, job: RegistryDocumentIngestionJob) {
  await updateArtifactStatus(env, job.artifactId, "processing");

  const object = await env.ARTIFACTS_BUCKET.get(job.r2Key);
  if (!object) throw new Error(`R2 object not found: ${job.r2Key}`);

  const fileBuffer = await object.arrayBuffer();
  const extractedText = await extractText(fileBuffer, fileExtension(job.originalFilename));
  const chunks = chunkText(extractedText);
  if (chunks.length === 0) throw new Error("No text chunks were created.");

  const embeddings = await embedTexts(env, chunks, {
    feature: "document-embedding",
    projectId: job.projectId,
    metadata: {
      scopeLevel: job.scopeLevel,
      scopeId: job.scopeId,
      documentType: job.documentType,
      artifactId: job.artifactId,
    },
  });
  const createdAt = new Date().toISOString();
  const rows = chunks.map((content, index) => ({
    id: `chunk-${crypto.randomUUID()}`,
    vectorId: `vector-${job.artifactId}-${index}`,
    chunkIndex: index,
    content,
    embedding: embeddings[index],
  }));
  const customTags = customTagsIndexValue(job.customTags);
  const sensitivityLabel = inferSensitivityLabel({
    customTags: job.customTags,
    documentName: job.originalFilename,
    metadata: object.customMetadata,
  });
  const restricted = sensitivityLabel === "Confidential";

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
        confidentiality: sensitivityLabel,
        restricted,
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

async function processScopedRagGeneratedArtifactJob(env: DocumentIngestionEnv, job: ScopedRagDocumentIngestionJob) {
  const object = await env.ARTIFACTS_BUCKET.get(job.r2Key);
  if (!object) throw new Error(`R2 object not found: ${job.r2Key}`);

  const rawText = await object.text();
  const chunks = chunkText(rawText);
  if (chunks.length === 0) throw new Error("No text chunks were created.");
  const sensitivityLabel = inferSensitivityLabel({
    documentName: job.documentName,
    metadata: object.customMetadata,
  });
  const restricted = sensitivityLabel === "Confidential";

  const embeddings = await embedTexts(env, chunks, {
    feature: "scoped-rag-generated-artifact-embedding",
    teamId: job.teamId,
    projectId: job.projectId,
    metadata: {
      documentName: job.documentName,
    },
  });
  const createdAt = new Date().toISOString();
  const rows = chunks.map((content, index) => ({
    id: `chunk-${crypto.randomUUID()}`,
    content,
    embedding: embeddings[index],
    chunkIndex: index,
  }));

  await env.VECTORIZE.upsert(
    rows.map((row) => ({
      id: row.id,
      values: row.embedding,
      metadata: {
        team_id: job.teamId,
        project_id: job.projectId,
        document_name: job.documentName,
        r2_key: job.r2Key,
        confidentiality: sensitivityLabel,
        restricted,
        chunk_index: row.chunkIndex,
      },
    })),
  );

  await env.DB.batch(
    rows.map((row) =>
      env.DB.prepare(
        `INSERT INTO document_chunks (
          id,
          team_id,
          project_id,
          document_name,
          r2_key,
          content,
          sensitivity_label,
          restricted,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(row.id, job.teamId, job.projectId, job.documentName, job.r2Key, row.content, sensitivityLabel, restricted ? 1 : 0, createdAt),
    ),
  );
}

function isScopedRagGeneratedArtifactJob(job: DocumentIngestionJob): job is ScopedRagDocumentIngestionJob {
  return job.kind === "scoped-rag-generated-artifact";
}

export async function processDocumentIngestionJob(env: DocumentIngestionEnv, job: DocumentIngestionJob) {
  if (isScopedRagGeneratedArtifactJob(job)) {
    await processScopedRagGeneratedArtifactJob(env, job);
    return;
  }

  await processRegistryUploadJob(env, job);
}

export async function handleDocumentIngestionQueue(batch: MessageBatch<DocumentIngestionJob>, env: DocumentIngestionEnv) {
  for (const message of batch.messages) {
    try {
      await processDocumentIngestionJob(env, message.body);
      message.ack();
    } catch (error) {
      const job = message.body;
      if (job && !isScopedRagGeneratedArtifactJob(job) && job.artifactId) {
        await updateArtifactStatus(env, job.artifactId, "failed", error instanceof Error ? error.message : "Unknown ingestion failure");
      }
      message.retry();
    }
  }
}
