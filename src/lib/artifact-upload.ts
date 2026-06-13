/// <reference path="../../worker-configuration.d.ts" />

import { createServerFn } from "@tanstack/react-start";
import { setResponseStatus } from "@tanstack/react-start/server";
import { getRequest } from "@tanstack/start-server-core";
import { env } from "cloudflare:workers";
import { getAuth } from "@/lib/auth";
import type { DocumentIngestionJob, ScopeLevel } from "@/lib/document-ingestion-queue";

export type { ScopeLevel } from "@/lib/document-ingestion-queue";

export type ArtifactUploadResult = {
  artifactId: string;
  r2Key: string;
  status: "queued";
};

type UploadEnv = Env & {
  DOCUMENT_INGESTION_QUEUE?: Queue<DocumentIngestionJob>;
};

type AuthSession = {
  user?: {
    id?: string;
    role?: string | null;
  };
};

const scopeLevels = new Set<ScopeLevel>(["org", "team", "personal"]);
const maxTagCount = 25;
const maxTagLength = 48;

function getRuntimeEnv() {
  return env as UploadEnv;
}

function getDb() {
  const db = getRuntimeEnv().DB;
  if (!db) throw new Error("D1 binding DB is required for artifact uploads.");
  return db;
}

function getBucket() {
  const bucket = getRuntimeEnv().ARTIFACTS_BUCKET;
  if (!bucket) throw new Error("R2 binding ARTIFACTS_BUCKET is required for artifact uploads.");
  return bucket;
}

function getQueue() {
  const queue = getRuntimeEnv().DOCUMENT_INGESTION_QUEUE;
  if (!queue) throw new Error("Queue binding DOCUMENT_INGESTION_QUEUE is required for artifact uploads.");
  return queue;
}

async function currentUserId() {
  const request = getRequest();
  const session = (await getAuth(request).api.getSession({ headers: request.headers })) as AuthSession | null;
  const userId = session?.user?.id;
  if (!userId) throw new Error("Sign in is required.");
  return userId;
}

function requiredString(formData: FormData, key: string, label: string) {
  const value = formData.get(key);
  if (typeof value !== "string") throw new Error(`${label} is required.`);
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required.`);
  return trimmed;
}

function optionalString(formData: FormData, key: string) {
  const value = formData.get(key);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function parseScopeLevel(value: string) {
  if (!scopeLevels.has(value as ScopeLevel)) {
    throw new Error("Scope level must be org, team, or personal.");
  }
  return value as ScopeLevel;
}

function parseTags(value: string | null) {
  if (!value) return [];
  const tags = Array.from(
    new Set(
      value
        .split(",")
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean),
    ),
  );

  if (tags.length > maxTagCount) throw new Error(`Use ${maxTagCount} tags or fewer.`);
  for (const tag of tags) {
    if (tag.length > maxTagLength) throw new Error(`Tags must be ${maxTagLength} characters or fewer.`);
  }

  return tags;
}

function safeFileName(fileName: string) {
  const normalized = fileName.trim().replace(/\\/g, "/").split("/").pop() ?? "artifact";
  return normalized.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-|-$/g, "") || "artifact";
}

function extensionFor(fileName: string) {
  const match = safeFileName(fileName).match(/\.([a-zA-Z0-9]{1,16})$/);
  return match ? `.${match[1].toLowerCase()}` : "";
}

function createR2Key(scopeLevel: ScopeLevel, scopeId: string, fileName: string) {
  const extension = extensionFor(fileName);
  return `uploads/${scopeLevel}/${encodeURIComponent(scopeId)}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}${extension}`;
}

function getUploadFile(formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("File is required.");
  if (file.size <= 0) throw new Error("File is empty.");
  return file;
}

export const uploadArtifact = createServerFn({ method: "POST" })
  .validator((data: FormData) => data)
  .handler(async ({ data }): Promise<ArtifactUploadResult> => {
    const userId = await currentUserId();
    const file = getUploadFile(data);
    const originalFilename = safeFileName(file.name || "artifact");
    const mimeType = file.type || "application/octet-stream";
    const scopeLevel = parseScopeLevel(requiredString(data, "scope_level", "Scope level"));
    const scopeId = requiredString(data, "scope_id", "Scope ID");
    const projectId = optionalString(data, "project_id");
    const documentType = requiredString(data, "document_type", "Document type");
    const customTags = parseTags(optionalString(data, "custom_tags"));
    const artifactId = `artifact-${crypto.randomUUID()}`;
    const r2Key = createR2Key(scopeLevel, scopeId, originalFilename);
    const now = new Date().toISOString();

    await getBucket().put(r2Key, file, {
      httpMetadata: {
        contentType: mimeType,
      },
      customMetadata: {
        artifact_id: artifactId,
        original_filename: originalFilename,
        scope_level: scopeLevel,
        scope_id: scopeId,
        project_id: projectId ?? "",
        document_type: documentType,
        custom_tags: customTags.join(","),
      },
    });

    await getDb()
      .prepare(
        `INSERT INTO artifacts_registry (
          id,
          original_filename,
          mime_type,
          file_size,
          r2_key,
          scope_level,
          scope_id,
          project_id,
          document_type,
          custom_tags_json,
          status,
          uploaded_by_user_id,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
      )
      .bind(
        artifactId,
        originalFilename,
        mimeType,
        file.size,
        r2Key,
        scopeLevel,
        scopeId,
        projectId,
        documentType,
        JSON.stringify(customTags),
        userId,
        now,
        now,
      )
      .run();

    await getQueue().send({
      artifactId,
      r2Key,
      originalFilename,
      mimeType,
      fileSize: file.size,
      scopeLevel,
      scopeId,
      projectId,
      documentType,
      customTags,
    });

    setResponseStatus(202);

    return {
      artifactId,
      r2Key,
      status: "queued",
    };
  });
