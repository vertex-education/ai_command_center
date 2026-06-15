/// <reference path="../../worker-configuration.d.ts" />

import { runTrackedAiGateway } from "@/lib/ai-gateway";
import { ensureVectorTenantId } from "@/lib/vector-tenant-map";

export type ScopeLevel = "org" | "team" | "personal";

export type KnowledgeItemType =
  | "approval"
  | "artifact"
  | "asana_snapshot"
  | "chat_message"
  | "decision"
  | "idea"
  | "project"
  | "r2_object"
  | "risk"
  | "task"
  | "workspace_record";

export type KnowledgeSourceType = "asana" | "chat" | "r2" | "rag" | "upload" | "workspace";

export type KnowledgeItemUpsertJob = {
  kind: "knowledge-item-upsert";
  itemId: string;
  itemType: KnowledgeItemType;
  sourceType: KnowledgeSourceType;
  title: string;
  workspaceId: string;
  workspaceScope: ScopeLevel;
  teamId?: string | null;
  projectId?: string | null;
  r2Key?: string | null;
  sourceUrl?: string | null;
  rawText?: string | null;
  contentType?: string | null;
  sensitivityLabel?: "Standard" | "Confidential";
  restricted?: boolean;
  versionLabel?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
  embeddingFeature?: string;
};

export type DocumentIngestionJob = KnowledgeItemUpsertJob;

type EmbeddingResponse = {
  data?: number[][];
};

export type VectorMetadataValue = string | number | boolean | string[];
export type VectorMetadata = Record<string, VectorMetadataValue>;
export type KnowledgeMarkdownDocumentInput = {
  rawText: string;
  title: string;
  itemType: KnowledgeItemType;
  sourceType: KnowledgeSourceType;
  workspaceId: string;
  workspaceScope: ScopeLevel;
  teamId?: string | null;
  projectId?: string | null;
  itemId?: string | null;
  r2Key?: string | null;
  sourceUrl?: string | null;
  contentType?: string | null;
  versionLabel?: string | null;
  sensitivityLabel?: "Standard" | "Confidential";
  restricted?: boolean;
  metadata?: Record<string, string | number | boolean | null>;
  embeddingFeature?: string;
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

function normalizedTeamId(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed || null;
}

function vectorMetadataString(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function vectorScopeMetadata({
  projectId,
  teamId,
  workspaceId,
}: {
  projectId?: string | null;
  teamId?: string | null;
  workspaceId: string;
}) {
  const metadata: VectorMetadata = {
    workspace_id: workspaceId,
  };
  const scopedTeamId = vectorMetadataString(teamId);
  const scopedProjectId = vectorMetadataString(projectId);
  if (scopedTeamId) metadata.team_id = scopedTeamId;
  if (scopedProjectId) metadata.project_id = scopedProjectId;
  return metadata;
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

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

function scalarMetadataFromVectorMetadata(metadata: VectorMetadata | undefined) {
  if (!metadata) return {};
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [key, Array.isArray(value) ? value.join(",") : value]),
  ) satisfies Record<string, string | number | boolean | null>;
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

async function upsertKnowledgeItemStatus(
  env: DocumentIngestionEnv,
  job: KnowledgeItemUpsertJob,
  status: "processing" | "completed" | "failed",
  {
    contentHash,
    errorMessage,
    indexedAt,
  }: {
    contentHash?: string | null;
    errorMessage?: string | null;
    indexedAt?: string | null;
  } = {},
) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO knowledge_items (
      id,
      item_type,
      source_type,
      title,
      workspace_id,
      workspace_scope,
      team_id,
      project_id,
      r2_key,
      source_url,
      content_hash,
      version_label,
      sensitivity_label,
      restricted,
      status,
      metadata_json,
      created_at,
      updated_at,
      indexed_at,
      error_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      item_type = excluded.item_type,
      source_type = excluded.source_type,
      title = excluded.title,
      workspace_id = excluded.workspace_id,
      workspace_scope = excluded.workspace_scope,
      team_id = excluded.team_id,
      project_id = excluded.project_id,
      r2_key = excluded.r2_key,
      source_url = excluded.source_url,
      content_hash = COALESCE(excluded.content_hash, knowledge_items.content_hash),
      version_label = excluded.version_label,
      sensitivity_label = excluded.sensitivity_label,
      restricted = excluded.restricted,
      status = excluded.status,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at,
      indexed_at = COALESCE(excluded.indexed_at, knowledge_items.indexed_at),
      error_message = excluded.error_message`,
  )
    .bind(
      job.itemId,
      job.itemType,
      job.sourceType,
      job.title,
      job.workspaceId,
      job.workspaceScope,
      normalizedTeamId(job.teamId),
      job.projectId?.trim() || null,
      job.r2Key?.trim() || null,
      job.sourceUrl?.trim() || null,
      contentHash ?? null,
      job.versionLabel?.trim() || null,
      job.sensitivityLabel ?? "Standard",
      job.restricted || job.sensitivityLabel === "Confidential" ? 1 : 0,
      status,
      JSON.stringify(job.metadata ?? {}),
      now,
      now,
      indexedAt ?? null,
      errorMessage ?? null,
    )
    .run();
}

async function resolveKnowledgeItemText(env: DocumentIngestionEnv, job: KnowledgeItemUpsertJob) {
  const rawText = job.rawText?.trim();
  if (rawText) return rawText;
  if (!job.r2Key) throw new Error("Knowledge item requires raw text or an R2 key.");

  const object = await env.ARTIFACTS_BUCKET.get(job.r2Key);
  if (!object) throw new Error(`R2 object not found: ${job.r2Key}`);
  const fileBuffer = await object.arrayBuffer();
  return extractText(fileBuffer, fileExtension(job.title || job.r2Key));
}

async function removePreviousKnowledgeChunks(env: DocumentIngestionEnv, itemId: string) {
  const previous = await env.DB.prepare("SELECT vector_id as vectorId FROM knowledge_chunks WHERE item_id = ?")
    .bind(itemId)
    .all<{ vectorId: string }>();
  const vectorIds = (previous.results ?? []).map((row) => row.vectorId).filter(Boolean);
  if (vectorIds.length > 0) {
    try {
      await env.VECTORIZE.deleteByIds(vectorIds);
    } catch (error) {
      console.warn("Previous knowledge vectors could not be deleted.", {
        itemId,
        message: error instanceof Error ? error.message : "Unknown Vectorize delete failure",
      });
    }
  }
  await env.DB.prepare("DELETE FROM knowledge_chunks WHERE item_id = ?").bind(itemId).run();
}

export async function processKnowledgeItemUpsertJob(env: DocumentIngestionEnv, job: KnowledgeItemUpsertJob) {
  await upsertKnowledgeItemStatus(env, job, "processing");

  const rawText = await resolveKnowledgeItemText(env, job);
  const chunks = chunkText(rawText);
  if (chunks.length === 0) throw new Error("No text chunks were created.");

  const contentHash = await sha256Hex(rawText);
  const sensitivityLabel = job.sensitivityLabel ?? "Standard";
  const restricted = job.restricted || sensitivityLabel === "Confidential";
  const teamId = normalizedTeamId(job.teamId);
  const projectId = job.projectId?.trim() || null;
  const vectorTenantId = await ensureVectorTenantId(env.DB, {
    workspaceId: job.workspaceId,
    teamId,
    projectId,
  });
  const embeddings = await embedTexts(env, chunks, {
    feature: job.embeddingFeature ?? "knowledge-item-embedding",
    teamId,
    projectId,
    metadata: {
      itemId: job.itemId,
      itemType: job.itemType,
      sourceType: job.sourceType,
    },
  });
  const createdAt = new Date().toISOString();
  const rows = chunks.map((content, index) => ({
    id: `knowledge-chunk-${crypto.randomUUID()}`,
    vectorId: `knowledge-vector-${crypto.randomUUID()}`,
    chunkIndex: index,
    content,
    embedding: embeddings[index],
  }));

  await removePreviousKnowledgeChunks(env, job.itemId);
  await env.VECTORIZE.upsert(
    rows.map((row) => ({
      id: row.vectorId,
      values: row.embedding,
      metadata: clampVectorMetadata({
        ...vectorScopeMetadata({
          workspaceId: job.workspaceId,
          teamId,
          projectId,
        }),
        vector_tenant_id: vectorTenantId,
        item_id: job.itemId,
        item_type: job.itemType,
        source_type: job.sourceType,
        workspace_scope: job.workspaceScope,
        document_name: job.title,
        r2_key: job.r2Key ?? "",
        source_url: job.sourceUrl ?? "",
        confidentiality: sensitivityLabel,
        restricted,
        chunk_index: row.chunkIndex,
      }),
    })),
  );

  await env.DB.batch(
    rows.map((row) =>
      env.DB.prepare(
        `INSERT INTO knowledge_chunks (
          id,
          item_id,
          chunk_index,
          vector_id,
          vector_tenant_id,
          workspace_id,
          workspace_scope,
          team_id,
          project_id,
          title,
          r2_key,
          source_type,
          item_type,
          content,
          sensitivity_label,
          restricted,
          token_count,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        row.id,
        job.itemId,
        row.chunkIndex,
        row.vectorId,
        vectorTenantId,
        job.workspaceId,
        job.workspaceScope,
        teamId,
        projectId,
        job.title,
        job.r2Key?.trim() || null,
        job.sourceType,
        job.itemType,
        row.content,
        sensitivityLabel,
        restricted ? 1 : 0,
        Math.ceil(row.content.length / 4),
        createdAt,
      ),
    ),
  );

  await upsertKnowledgeItemStatus(env, job, "completed", {
    contentHash,
    indexedAt: createdAt,
  });
}

export async function ingestKnowledgeMarkdownDocument(env: DocumentIngestionEnv, input: KnowledgeMarkdownDocumentInput) {
  const itemId =
    input.itemId?.trim() ||
    `knowledge-${input.sourceType}-${(
      await sha256Hex(
        [
          input.workspaceId,
          input.workspaceScope,
          input.teamId ?? "",
          input.projectId ?? "",
          input.sourceType,
          input.itemType,
          input.r2Key ?? "",
          input.sourceUrl ?? "",
          input.title,
        ].join("|"),
      )
    ).slice(0, 32)}`;

  await processKnowledgeItemUpsertJob(env, {
    kind: "knowledge-item-upsert",
    itemId,
    itemType: input.itemType,
    sourceType: input.sourceType,
    title: input.title,
    workspaceId: input.workspaceId,
    workspaceScope: input.workspaceScope,
    teamId: input.teamId,
    projectId: input.projectId,
    r2Key: input.r2Key,
    sourceUrl: input.sourceUrl,
    rawText: input.rawText,
    contentType: input.contentType,
    sensitivityLabel: input.sensitivityLabel,
    restricted: input.restricted,
    versionLabel: input.versionLabel,
    metadata: {
      ...(input.metadata ?? {}),
      ...scalarMetadataFromVectorMetadata(input.vectorMetadata),
    },
    embeddingFeature: input.embeddingFeature,
  });

  return { itemId };
}

function isKnowledgeItemUpsertJob(job: DocumentIngestionJob): job is KnowledgeItemUpsertJob {
  return job.kind === "knowledge-item-upsert";
}

export async function processDocumentIngestionJob(env: DocumentIngestionEnv, job: DocumentIngestionJob) {
  if (isKnowledgeItemUpsertJob(job)) {
    await processKnowledgeItemUpsertJob(env, job);
    return;
  }

  throw new Error(`Unsupported document ingestion job kind: ${(job as { kind?: string } | null)?.kind ?? "unknown"}`);
}

export async function handleDocumentIngestionQueue(batch: MessageBatch<DocumentIngestionJob>, env: DocumentIngestionEnv) {
  for (const message of batch.messages) {
    try {
      if (!isKnowledgeItemUpsertJob(message.body)) {
        console.warn("Dropping deprecated document ingestion job.", {
          kind: (message.body as { kind?: string } | null)?.kind ?? "unknown",
        });
        message.ack();
        continue;
      }
      await processDocumentIngestionJob(env, message.body);
      message.ack();
    } catch (error) {
      const job = message.body;
      if (job && isKnowledgeItemUpsertJob(job)) {
        await upsertKnowledgeItemStatus(env, job, "failed", {
          errorMessage: error instanceof Error ? error.message : "Unknown knowledge ingestion failure",
        });
      }
      message.retry();
    }
  }
}
