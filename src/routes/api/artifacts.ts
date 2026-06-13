/// <reference path="../../../worker-configuration.d.ts" />

import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { getAuth } from "@/lib/auth";

const xlsxMimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

async function handleArtifactDownload({ request }: { request: Request }) {
  const session = await getAuth(request).api.getSession({ headers: request.headers });
  if (!session?.user) return new Response("Unauthorized", { status: 401 });

  const url = new URL(request.url);
  const r2Key = url.searchParams.get("key")?.trim();
  if (!r2Key) return new Response("Artifact key is required.", { status: 400 });

  const artifact = await env.DB.prepare(
    `SELECT title, file_type as fileType, r2_key as r2Key
     FROM artifacts
     WHERE r2_key = ?
     LIMIT 1`,
  )
    .bind(r2Key)
    .first<{ title: string; fileType: string; r2Key: string }>();
  if (!artifact) return new Response("Artifact was not found.", { status: 404 });

  const object = await env.ARTIFACTS_BUCKET.get(artifact.r2Key);
  if (!object?.body) return new Response("Artifact file was not found.", { status: 404 });

  const contentType = object.httpMetadata?.contentType ?? contentTypeForArtifact(artifact.fileType);
  return new Response(object.body, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${downloadFileName(artifact.title, artifact.fileType)}"`,
      "Cache-Control": "private, max-age=60",
    },
  });
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

export const Route = createFileRoute("/api/artifacts")({
  server: {
    handlers: {
      GET: handleArtifactDownload,
    },
  },
});
