/// <reference path="../../../../worker-configuration.d.ts" />

import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import type { MicrosoftGraphChangeNotificationCollection, MicrosoftGraphWebhookJob } from "@/lib/microsoft-graph-webhooks";

type MicrosoftGraphWebhookRuntimeEnv = Env & {
  GRAPH_WEBHOOK_QUEUE?: Queue<MicrosoftGraphWebhookJob>;
};

const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

async function handleMicrosoftGraphWebhook({ request }: { request: Request }) {
  const url = new URL(request.url);
  const validationToken = url.searchParams.get("validationToken");
  if (validationToken) {
    return new Response(validationToken, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  const queue = (env as MicrosoftGraphWebhookRuntimeEnv).GRAPH_WEBHOOK_QUEUE;
  if (!queue) {
    return new Response(JSON.stringify({ error: "GRAPH_WEBHOOK_QUEUE binding is not configured." }), {
      status: 503,
      headers: jsonHeaders,
    });
  }

  let payload: MicrosoftGraphChangeNotificationCollection;
  try {
    const parsed = await request.json();
    if (!isObjectRecord(parsed)) throw new Error("Webhook payload must be a JSON object.");
    payload = parsed as MicrosoftGraphChangeNotificationCollection;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid Microsoft Graph webhook payload." }), {
      status: 400,
      headers: jsonHeaders,
    });
  }

  const job: MicrosoftGraphWebhookJob = {
    kind: "microsoft-graph-change-notification",
    requestId: crypto.randomUUID(),
    receivedAt: new Date().toISOString(),
    source: {
      userAgent: request.headers.get("user-agent"),
      cfRay: request.headers.get("cf-ray"),
      connectingIp: request.headers.get("cf-connecting-ip"),
    },
    payload,
  };

  try {
    await queue.send(job);
  } catch (error) {
    console.error("Failed to enqueue Microsoft Graph webhook notification.", {
      requestId: job.requestId,
      error: error instanceof Error ? error.message : "Unknown queue failure",
    });
    return new Response(JSON.stringify({ error: "Unable to queue Microsoft Graph notification." }), {
      status: 503,
      headers: jsonHeaders,
    });
  }

  return new Response(null, {
    status: 202,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const Route = createFileRoute("/api/graph/webhooks")({
  server: {
    handlers: {
      POST: handleMicrosoftGraphWebhook,
    },
  },
});
