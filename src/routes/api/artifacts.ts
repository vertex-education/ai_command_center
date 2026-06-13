/// <reference path="../../../worker-configuration.d.ts" />

import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { getAuth } from "@/lib/auth";

const xlsxMimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const finalizedArtifactCacheControl = "public, max-age=31536000, immutable";
const privateArtifactCacheControl = "private, max-age=60";

type ArtifactDownloadRow = {
  title: string;
  fileType: string;
  r2Key: string;
  status: "Final" | "Draft" | "Pinned";
};

async function handleArtifactDownload({ request }: { request: Request }) {
  const session = await getAuth(request).api.getSession({ headers: request.headers });
  if (!session?.user) return new Response("Unauthorized", { status: 401 });

  const url = new URL(request.url);
  const r2Key = url.searchParams.get("key")?.trim();
  if (!r2Key) return new Response("Artifact key is required.", { status: 400 });

  const artifact = await env.DB.prepare(
    `SELECT title, file_type as fileType, r2_key as r2Key, status
     FROM artifacts
     WHERE r2_key = ?
     LIMIT 1`,
  )
    .bind(r2Key)
    .first<ArtifactDownloadRow>();
  if (!artifact) return new Response("Artifact was not found.", { status: 404 });

  const isFinalized = artifact.status === "Final";
  const cacheKey = artifactCacheKey(request, artifact.r2Key);
  if (isFinalized) {
    const cachedResponse = await getDefaultCache().match(cacheKey);
    if (cachedResponse) return cachedResponse;
  }

  const object = await env.ARTIFACTS_BUCKET.get(artifact.r2Key);
  if (!object?.body) return new Response("Artifact file was not found.", { status: 404 });

  const contentType = object.httpMetadata?.contentType ?? contentTypeForArtifact(artifact.fileType);
  const response = new Response(object.body, {
    headers: artifactResponseHeaders({
      artifact,
      contentType,
      contentLength: object.size,
      etag: object.httpEtag,
      cacheControl: isFinalized ? finalizedArtifactCacheControl : privateArtifactCacheControl,
    }),
  });

  if (isFinalized) {
    try {
      await getDefaultCache().put(cacheKey, response.clone());
    } catch (error) {
      console.warn("Unable to cache finalized artifact response.", {
        r2Key: artifact.r2Key,
        error: error instanceof Error ? error.message : "Unknown cache error",
      });
    }
  }

  return response;
}

function contentTypeForArtifact(fileType: string) {
  if (fileType.toUpperCase() === "XLSX") return xlsxMimeType;
  if (fileType.toUpperCase() === "DOCX") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (fileType.toUpperCase() === "PPTX") return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  return "application/octet-stream";
}

function downloadFileName(title: string, fileType: string) {
  const extension = fileType.toLowerCase() || "bin";
  const safeName = title
    .trim()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/\d+/g, " ")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 72) || "vertex-artifact";
  return `${safeName}.${extension}`;
}

function getDefaultCache() {
  return (caches as CacheStorage & { default: Cache }).default;
}

function artifactCacheKey(request: Request, r2Key: string) {
  const url = new URL(request.url);
  url.search = "";
  url.searchParams.set("key", r2Key);
  return new Request(url.toString(), { method: "GET" });
}

function artifactResponseHeaders({
  artifact,
  contentType,
  contentLength,
  etag,
  cacheControl,
}: {
  artifact: ArtifactDownloadRow;
  contentType: string;
  contentLength: number;
  etag?: string;
  cacheControl: string;
}) {
  const headers = new Headers({
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="${downloadFileName(artifact.title, artifact.fileType)}"`,
    "Cache-Control": cacheControl,
  });

  headers.set("Content-Length", String(contentLength));
  if (etag) headers.set("ETag", etag);

  return headers;
}

export const Route = createFileRoute("/api/artifacts")({
  server: {
    handlers: {
      GET: handleArtifactDownload,
    },
  },
});
