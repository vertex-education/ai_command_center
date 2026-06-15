/// <reference path="../../worker-configuration.d.ts" />

import { runTrackedAiGateway } from "@/lib/ai-gateway";

export type ScopeLevel = "org" | "team" | "personal";

export type RegistryDocumentIngestionJob = {
  kind: "artifact-registry-upload";
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

export type VectorMetadataValue = string | number | boolean | string[];
export type VectorMetadata = Record<string, VectorMetadataValue>;
export type ScopedRagMarkdownDocumentInput = {
  rawText: string;
  documentName: string;
  r2Key: string;
  teamId: string;
  projectId: string;
  feature: string;
  sensitivityLabel?: "Standard" | "Confidential";
  restricted?: boolean;
  embeddingMetadata?: Record<string, string | number | boolean | null>;
  vectorMetadata?: VectorMetadata;
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
const maxVectorMetadataBytes = 2_048;
const metadataEncoder = new TextEncoder();
const stringMetadataTrimOrder = [
  "custom_tags",
  "document_name",
  "r2_key",
  "document_type",
  "scope_id",
  "project_id",
  "team_id",
  "artifact_id",
  "chunk_id",
];
const removableMetadataKeys = ["custom_tags", "document_name", "r2_key", "document_type", "chunk_id", "artifact_id"];

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

function isFenceLine(line: string) {
  const match = line.match(/^\s*(```+|~~~+)/);
  return match?.[1] ?? null;
}

function isMarkdownHeading(line: string) {
  return /^\s{0,3}#{1,6}\s+\S/.test(line);
}

function trimBlock(lines: string[]) {
  return lines.join("\n").trim();
}

type MarkdownSection = {
  heading: string | null;
  blocks: string[];
};

function parseMarkdownSections(text: string) {
  const sections: MarkdownSection[] = [];
  let currentSection: MarkdownSection = { heading: null, blocks: [] };
  let currentBlock: string[] = [];
  let inCodeBlock = false;
  let fenceMarker: string | null = null;

  const flushBlock = () => {
    const block = trimBlock(currentBlock);
    if (block) currentSection.blocks.push(block);
    currentBlock = [];
  };

  const flushSection = () => {
    flushBlock();
    if (currentSection.heading || currentSection.blocks.length > 0) sections.push(currentSection);
  };

  for (const line of text.split("\n")) {
    const fence = isFenceLine(line);

    if (!inCodeBlock && isMarkdownHeading(line)) {
      flushSection();
      currentSection = { heading: line.trim(), blocks: [] };
      continue;
    }

    if (fence) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        fenceMarker = fence[0];
      } else if (fence[0] === fenceMarker) {
        inCodeBlock = false;
        fenceMarker = null;
      }
    }

    if (!inCodeBlock && line.trim() === "") {
      flushBlock();
      continue;
    }

    currentBlock.push(line);
  }

  flushSection();
  return sections;
}

function chunkSection(section: MarkdownSection) {
  if (section.blocks.length === 0) return section.heading ? [section.heading] : [];

  const chunks: string[] = [];
  let current = section.heading ?? "";

  for (const block of section.blocks) {
    const candidate = current ? `${current}\n\n${block}` : block;
    if (!current || candidate.length <= maxChunkChars || current === section.heading) {
      current = candidate;
      continue;
    }

    chunks.push(current);
    current = section.heading ? `${section.heading}\n\n${block}` : block;
  }

  if (current) chunks.push(current);
  return chunks;
}

export function chunkText(rawText: string) {
  const text = rawText.replace(/\r\n/g, "\n").trim();
  if (!text) return [];
  return parseMarkdownSections(text).flatMap(chunkSection).filter(Boolean);
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
    const result = (await runTrackedAiGateway(
      env.AI,
      embeddingModelId,
      { text: batch, pooling: "cls" },
      {
        feature: scope.feature,
        usageDb: env.DB,
        teamId: scope.teamId,
        projectId: scope.projectId,
        identity: {
          userId: "system",
          teamId: scope.teamId,
          projectId: scope.projectId,
          scopeType: "document-ingestion",
        },
        metadata: {
          feature: scope.feature,
          model: embeddingModelId,
          userId: "system",
          batchSize: batch.length,
          batchIndex: index / embeddingBatchSize,
          ...scope.metadata,
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

export function customTagsIndexValue(customTags: string[]) {
  return customTags
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)
    .join(",");
}

export function isConfidentialTag(value: string) {
  const normalized = value.trim().toLowerCase();
  return /(^|[^a-z])(confidential|restricted)([^a-z]|$)/.test(normalized);
}

export function inferSensitivityLabel({
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

export function vectorMetadataBytes(metadata: VectorMetadata) {
  return metadataEncoder.encode(JSON.stringify(metadata)).byteLength;
}

function truncateStringToUtf8Bytes(value: string, maxBytes: number) {
  if (maxBytes <= 0) return "";
  if (metadataEncoder.encode(value).byteLength <= maxBytes) return value;

  const chars = Array.from(value);
  let low = 0;
  let high = chars.length;

  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = chars.slice(0, mid).join("");
    if (metadataEncoder.encode(candidate).byteLength <= maxBytes) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  return chars.slice(0, low).join("");
}

function shrinkStringMetadataKey(metadata: VectorMetadata, key: string, byteLimit: number) {
  const value = metadata[key];
  if (typeof value !== "string") return;

  let nextValue = value;
  while (nextValue && vectorMetadataBytes(metadata) > byteLimit) {
    const overage = vectorMetadataBytes(metadata) - byteLimit;
    const nextByteTarget = Math.max(0, metadataEncoder.encode(nextValue).byteLength - overage - 16);
    const truncated = truncateStringToUtf8Bytes(nextValue, nextByteTarget);
    metadata[key] = truncated;
    if (truncated === nextValue) break;
    nextValue = truncated;
  }
}

export function clampVectorMetadata(metadata: VectorMetadata, byteLimit = maxVectorMetadataBytes): VectorMetadata {
  const clamped: VectorMetadata = { ...metadata };
  if (vectorMetadataBytes(clamped) <= byteLimit) return clamped;

  for (const key of stringMetadataTrimOrder) {
    shrinkStringMetadataKey(clamped, key, byteLimit);
    if (vectorMetadataBytes(clamped) <= byteLimit) return clamped;
  }

  for (const key of removableMetadataKeys) {
    if (key in clamped) delete clamped[key];
    if (vectorMetadataBytes(clamped) <= byteLimit) return clamped;
  }

  throw new Error(`Vectorize metadata exceeds ${byteLimit} bytes after clamping.`);
}

async function updateArtifactStatus(
  env: DocumentIngestionEnv,
  artifactId: string,
  status: "processing" | "completed" | "failed",
  errorMessage?: string,
  chunkCount = 0,
) {
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
      metadata: clampVectorMetadata({
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
      }),
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
  await ingestScopedRagMarkdownDocument(env, {
    rawText,
    documentName: job.documentName,
    r2Key: job.r2Key,
    teamId: job.teamId,
    projectId: job.projectId,
    feature: "scoped-rag-generated-artifact-embedding",
    sensitivityLabel: inferSensitivityLabel({
      documentName: job.documentName,
      metadata: object.customMetadata,
    }),
    embeddingMetadata: {
      documentName: job.documentName,
    },
  });
}

export async function ingestScopedRagMarkdownDocument(env: DocumentIngestionEnv, input: ScopedRagMarkdownDocumentInput) {
  const chunks = chunkText(input.rawText);
  if (chunks.length === 0) throw new Error("No text chunks were created.");
  const sensitivityLabel = input.sensitivityLabel ?? "Standard";
  const restricted = input.restricted ?? sensitivityLabel === "Confidential";

  const embeddings = await embedTexts(env, chunks, {
    feature: input.feature,
    teamId: input.teamId,
    projectId: input.projectId,
    metadata: input.embeddingMetadata,
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
      metadata: clampVectorMetadata({
        team_id: input.teamId,
        project_id: input.projectId,
        document_name: input.documentName,
        r2_key: input.r2Key,
        confidentiality: sensitivityLabel,
        restricted,
        chunk_index: row.chunkIndex,
        ...(input.vectorMetadata ?? {}),
      }),
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
      ).bind(
        row.id,
        input.teamId,
        input.projectId,
        input.documentName,
        input.r2Key,
        row.content,
        sensitivityLabel,
        restricted ? 1 : 0,
        createdAt,
      ),
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
