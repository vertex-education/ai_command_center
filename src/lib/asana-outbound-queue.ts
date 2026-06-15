/// <reference path="../../worker-configuration.d.ts" />

export const asanaOutboundQueueName = "asana-outbound-queue";

const asanaOutboundTimeoutMs = 10_000;
const maxConsumerAttempts = 5;

export type AsanaOutboundJob = {
  kind: "asana-outbound-request";
  requestId: string;
  requestedAt: number;
  url: string;
  method: "POST" | "PUT" | "PATCH";
  headers?: Record<string, string>;
  body?: string;
  workspaceActionId?: string | null;
  workspaceId?: string | null;
};

export type AsanaOutboundEnv = Env & {
  ASANA_OUTBOUND_QUEUE?: Queue<AsanaOutboundJob>;
  DB: D1Database;
};

export function isAsanaOutboundJob(value: unknown): value is AsanaOutboundJob {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const job = value as Partial<AsanaOutboundJob>;
  return (
    job.kind === "asana-outbound-request" &&
    typeof job.requestId === "string" &&
    typeof job.requestedAt === "number" &&
    typeof job.url === "string" &&
    (job.method === "POST" || job.method === "PUT" || job.method === "PATCH") &&
    (job.headers === undefined || isStringRecord(job.headers)) &&
    (job.body === undefined || typeof job.body === "string") &&
    (job.workspaceActionId === undefined || typeof job.workspaceActionId === "string" || job.workspaceActionId === null) &&
    (job.workspaceId === undefined || typeof job.workspaceId === "string" || job.workspaceId === null)
  );
}

export async function enqueueAsanaOutboundRequest(env: AsanaOutboundEnv, job: AsanaOutboundJob) {
  if (!isAsanaOutboundJob(job)) throw new Error("Invalid Asana outbound payload.");
  if (!env.ASANA_OUTBOUND_QUEUE) throw new Error("ASANA_OUTBOUND_QUEUE binding is required for Asana outbound requests.");
  await env.ASANA_OUTBOUND_QUEUE.send(job, { contentType: "json" });
}

export async function handleAsanaOutboundQueue(batch: MessageBatch<AsanaOutboundJob>, env: AsanaOutboundEnv) {
  for (const message of batch.messages) {
    const job = message.body;
    if (!isAsanaOutboundJob(job)) {
      console.warn("Discarding invalid Asana outbound queue payload.", { messageId: message.id });
      message.ack();
      continue;
    }

    try {
      await processAsanaOutboundJob(env, job);
      message.ack();
    } catch (error) {
      const finalAttempt = message.attempts >= maxConsumerAttempts;
      await markOutboundStatus(env, job, finalAttempt ? "Failed" : "Pending", error);
      console.error("Asana outbound queue job failed.", {
        attempt: message.attempts,
        finalAttempt,
        error: error instanceof Error ? error.message : "Unknown Asana outbound failure",
        requestId: job.requestId,
      });
      if (finalAttempt) {
        message.ack();
      } else {
        message.retry({ delaySeconds: Math.min(120, message.attempts * message.attempts * 10) });
      }
    }
  }
}

export async function processAsanaOutboundJob(env: AsanaOutboundEnv, job: AsanaOutboundJob) {
  await markOutboundStatus(env, job, "Pending");
  const response = await fetchWithTimeout(job.url, {
    method: job.method,
    headers: {
      "Content-Type": "application/json",
      ...(job.headers ?? {}),
    },
    body: job.body,
  });

  if (!response.ok) {
    throw new Error(`Asana outbound request failed with HTTP ${response.status}.`);
  }

  await markOutboundStatus(env, job, "Sent");
}

async function fetchWithTimeout(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), asanaOutboundTimeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`Asana outbound request timed out after ${asanaOutboundTimeoutMs} ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function markOutboundStatus(env: AsanaOutboundEnv, job: AsanaOutboundJob, status: "Pending" | "Sent" | "Failed", error?: unknown) {
  if (!job.workspaceActionId || !job.workspaceId) return;
  await env.DB.prepare(
    `UPDATE workspace_actions
     SET outbound_status = ?,
         sync_status = CASE
           WHEN ? = 'Sent' THEN 'Sent'
           WHEN ? = 'Failed' THEN 'Failed'
           ELSE sync_status
         END,
         asana_sync_error = CASE
           WHEN ? = 'Failed' THEN ?
           WHEN ? = 'Sent' THEN NULL
           ELSE asana_sync_error
         END
     WHERE id = ?
       AND workspace_id = ?
       AND kind = 'task'`,
  )
    .bind(
      status,
      status,
      status,
      status,
      error instanceof Error ? error.message : error ? "Unknown Asana outbound failure" : null,
      status,
      job.workspaceActionId,
      job.workspaceId,
    )
    .run();
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every((item) => typeof item === "string");
}
