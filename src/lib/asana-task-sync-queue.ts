/// <reference path="../../worker-configuration.d.ts" />

import { getValidAsanaTokens, type AsanaTokenVaultEnv } from "@/lib/asana-token-vault";
import { recordRealtimeMutationEvent } from "@/lib/realtime-events";
import type { WorkspaceMode } from "@/lib/pmo-data";

export const asanaSyncQueueName = "asana-sync-queue";

const asanaApiTimeoutMs = 10_000;
const asanaSyncQueueSourceClientId = "asana-sync-queue";
const maxConsumerAttempts = 5;

export type AsanaTaskSyncJob = {
  kind: "asana-task-create";
  requestId: string;
  requestedAt: number;
  taskId: string;
  userId: string;
  workspaceId: string;
  mode: WorkspaceMode;
  teamId: string | null;
  projectId: string | null;
  title: string;
  notes: string;
  sourceClientId: string | null;
};

export type AsanaTaskSyncEnv = AsanaTokenVaultEnv & {
  ASANA_PAT?: string;
  ASANA_SYNC_QUEUE?: Queue<AsanaTaskSyncJob>;
  DB: D1Database;
};

type AsanaApiEnvelope<T> = {
  data?: T;
  errors?: Array<{ message?: string }>;
};

type AsanaUser = {
  gid: string;
  workspaces?: Array<{ gid?: string; name?: string }>;
};

type CreatedAsanaTask = {
  gid: string;
  name: string;
  permalink_url?: string | null;
};

type PersistedTaskForSync = {
  id: string;
  workspaceId: string;
  projectId: string | null;
  title: string;
  originalText: string;
  owner: string;
  source: string | null;
  asanaTaskGid: string | null;
};

class PermanentAsanaTaskSyncError extends Error {
  readonly permanent = true;
}

export class AsanaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function isAsanaTaskSyncJob(value: unknown): value is AsanaTaskSyncJob {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const job = value as Partial<AsanaTaskSyncJob>;
  return (
    job.kind === "asana-task-create" &&
    typeof job.requestId === "string" &&
    typeof job.requestedAt === "number" &&
    typeof job.taskId === "string" &&
    typeof job.userId === "string" &&
    typeof job.workspaceId === "string" &&
    (job.mode === "Personal" || job.mode === "Team" || job.mode === "Org") &&
    (typeof job.teamId === "string" || job.teamId === null) &&
    (typeof job.projectId === "string" || job.projectId === null) &&
    typeof job.title === "string" &&
    typeof job.notes === "string" &&
    (typeof job.sourceClientId === "string" || job.sourceClientId === null)
  );
}

export async function enqueueAsanaTaskSync(env: AsanaTaskSyncEnv, job: AsanaTaskSyncJob) {
  if (!isAsanaTaskSyncJob(job)) throw new Error("Invalid Asana task sync payload.");
  if (!env.ASANA_SYNC_QUEUE) throw new Error("ASANA_SYNC_QUEUE binding is required for Asana task synchronization.");
  await env.ASANA_SYNC_QUEUE.send(job, { contentType: "json" });
}

export async function handleAsanaTaskSyncQueue(batch: MessageBatch<AsanaTaskSyncJob>, env: AsanaTaskSyncEnv) {
  for (const message of batch.messages) {
    const job = message.body;
    if (!isAsanaTaskSyncJob(job)) {
      console.warn("Discarding invalid Asana task sync queue payload.", { messageId: message.id });
      message.ack();
      continue;
    }

    try {
      await processAsanaTaskSyncJob(env, job);
      message.ack();
    } catch (error) {
      const retriable = isRetriableAsanaTaskSyncError(error);
      const finalAttempt = !retriable || message.attempts >= maxConsumerAttempts;
      try {
        await markTaskSyncFailed(env, job, error, { finalAttempt });
      } catch (markError) {
        console.error("Failed to persist Asana task sync failure state.", {
          error: markError instanceof Error ? markError.message : "Unknown persistence failure",
          taskId: job.taskId,
        });
      }

      console.error("Asana task sync queue job failed.", {
        attempt: message.attempts,
        finalAttempt,
        error: error instanceof Error ? error.message : "Unknown Asana task sync failure",
        taskId: job.taskId,
      });

      if (retriable && !finalAttempt) {
        message.retry({ delaySeconds: retryDelaySeconds(message.attempts) });
      } else {
        message.ack();
      }
    }
  }
}

export async function processAsanaTaskSyncJob(env: AsanaTaskSyncEnv, job: AsanaTaskSyncJob) {
  const task = await loadPersistedTaskForSync(env, job);
  if (!task) throw new PermanentAsanaTaskSyncError("The local task no longer exists.");
  if (task.asanaTaskGid) {
    await publishTaskSyncMutation(env, job);
    return;
  }

  await assertAsanaTaskWriteAccess(env, job);
  const accessToken = await getAsanaAccessToken(env, job.userId);
  const target = await resolveAsanaTaskTarget(env, accessToken, job);
  const created = await createRemoteAsanaTask(accessToken, buildAsanaCreateTaskPayload({ ...target, notes: job.notes, title: task.title }));

  await markTaskSyncSucceeded(env, job, created);
  await publishTaskSyncMutation(env, job);
}

export function buildAsanaCreateTaskPayload({
  assigneeGid,
  asanaProjectGid,
  notes,
  title,
  workspaceGid,
}: {
  assigneeGid?: string | null;
  asanaProjectGid?: string | null;
  notes?: string | null;
  title: string;
  workspaceGid?: string | null;
}) {
  const payload: Record<string, unknown> = {
    name: title.trim(),
  };
  const trimmedNotes = notes?.trim();
  if (trimmedNotes) payload.notes = trimmedNotes;
  if (asanaProjectGid) {
    payload.projects = [asanaProjectGid];
  } else {
    if (workspaceGid) payload.workspace = workspaceGid;
    if (assigneeGid) payload.assignee = assigneeGid;
  }
  return payload;
}

export function isRetriableAsanaTaskSyncError(error: unknown) {
  if (error instanceof PermanentAsanaTaskSyncError) return false;
  if (error instanceof AsanaApiError) return error.status === 429 || error.status >= 500;
  if (error instanceof DOMException && error.name === "AbortError") return true;
  return false;
}

async function loadPersistedTaskForSync(env: AsanaTaskSyncEnv, job: AsanaTaskSyncJob) {
  return env.DB.prepare(
    `SELECT id,
            workspace_id as workspaceId,
            project_id as projectId,
            title,
            original_text as originalText,
            owner,
            source,
            asana_task_gid as asanaTaskGid
     FROM workspace_actions
     WHERE id = ?
       AND workspace_id = ?
       AND kind = 'task'
     LIMIT 1`,
  )
    .bind(job.taskId, job.workspaceId)
    .first<PersistedTaskForSync>();
}

async function assertAsanaTaskWriteAccess(env: AsanaTaskSyncEnv, job: AsanaTaskSyncJob) {
  const connection = await env.DB.prepare(
    `SELECT scopes
     FROM asana_connections
     WHERE user_id = ?
     LIMIT 1`,
  )
    .bind(job.userId)
    .first<{ scopes: string }>();

  if (!connection) {
    if (env.ASANA_PAT?.trim()) return;
    throw new PermanentAsanaTaskSyncError("Connect Asana before submitting tasks.");
  }

  if (!hasAsanaScope(parseScopes(connection.scopes), "tasks:write")) {
    throw new PermanentAsanaTaskSyncError("Reconnect Asana with tasks:write before submitting tasks.");
  }
}

async function getAsanaAccessToken(env: AsanaTaskSyncEnv, userId: string) {
  const tokenSet = await getValidAsanaTokens({ env, userId });
  if (tokenSet?.accessToken) return tokenSet.accessToken;

  const pat = env.ASANA_PAT?.trim();
  if (pat) return pat;

  throw new PermanentAsanaTaskSyncError("Reconnect Asana before submitting tasks.");
}

async function resolveAsanaTaskTarget(env: AsanaTaskSyncEnv, accessToken: string, job: AsanaTaskSyncJob) {
  if (job.projectId) {
    const mapping = await env.DB.prepare(
      `SELECT asana_project_gid as asanaProjectGid,
              can_write_tasks as canWriteTasks
       FROM asana_project_mappings
       WHERE user_id = ?
         AND vertex_project_id = ?
       LIMIT 1`,
    )
      .bind(job.userId, job.projectId)
      .first<{ asanaProjectGid: string; canWriteTasks: number | boolean }>();
    if (!mapping) throw new PermanentAsanaTaskSyncError("This VertexAI project is not mapped to Asana.");
    if (!Boolean(mapping.canWriteTasks)) {
      throw new PermanentAsanaTaskSyncError("Your Asana permission for this project is read-only. Task submission is disabled.");
    }
    return { asanaProjectGid: mapping.asanaProjectGid };
  }

  const asanaUser = await fetchAsanaMe(accessToken);
  return {
    assigneeGid: asanaUser.gid,
    workspaceGid: await resolveDefaultAsanaWorkspaceForUser(env, job.userId, asanaUser),
  };
}

async function resolveDefaultAsanaWorkspaceForUser(env: AsanaTaskSyncEnv, userId: string, asanaUser: AsanaUser) {
  const mappedWorkspaces = await env.DB.prepare(
    `SELECT DISTINCT asana_workspace_gid as gid
     FROM asana_project_mappings
     WHERE user_id = ?
     ORDER BY asana_workspace_gid ASC`,
  )
    .bind(userId)
    .all<{ gid: string }>();

  const mappedWorkspaceGids = (mappedWorkspaces.results ?? []).map((row) => row.gid).filter(Boolean);
  if (mappedWorkspaceGids.length === 1) return mappedWorkspaceGids[0];
  if (mappedWorkspaceGids.length > 1) {
    throw new PermanentAsanaTaskSyncError(
      "Non-project Asana tasks need one default workspace, but this account has mapped projects in multiple Asana workspaces.",
    );
  }

  const accountWorkspaceGids = (asanaUser.workspaces ?? []).map((workspace) => workspace.gid).filter(Boolean);
  if (accountWorkspaceGids.length === 1) return accountWorkspaceGids[0];
  if (accountWorkspaceGids.length > 1) {
    throw new PermanentAsanaTaskSyncError(
      "Non-project Asana tasks need one default workspace, but this Asana account belongs to multiple workspaces.",
    );
  }
  throw new PermanentAsanaTaskSyncError("No Asana workspace is available for non-project task creation.");
}

async function fetchAsanaMe(accessToken: string) {
  return asanaFetch<AsanaUser>(accessToken, "/users/me", {
    query: {
      opt_fields: "gid,workspaces.gid,workspaces.name",
    },
  });
}

async function createRemoteAsanaTask(accessToken: string, payload: Record<string, unknown>) {
  return asanaFetch<CreatedAsanaTask>(accessToken, "/tasks", {
    method: "POST",
    query: {
      opt_fields: "gid,name,permalink_url",
    },
    body: JSON.stringify({ data: payload }),
  });
}

async function markTaskSyncSucceeded(env: AsanaTaskSyncEnv, job: AsanaTaskSyncJob, created: CreatedAsanaTask) {
  await env.DB.prepare(
    `UPDATE workspace_actions
     SET asana_task_gid = ?,
         asana_synced_at = ?,
         asana_sync_queued_at = NULL,
         asana_sync_error = NULL,
         outbound_status = 'Sent',
         sync_status = 'Sent'
     WHERE id = ?
       AND workspace_id = ?
       AND kind = 'task'`,
  )
    .bind(created.gid, Date.now(), job.taskId, job.workspaceId)
    .run();
}

async function markTaskSyncFailed(
  env: AsanaTaskSyncEnv,
  job: AsanaTaskSyncJob,
  error: unknown,
  { finalAttempt }: { finalAttempt: boolean },
) {
  await env.DB.prepare(
    `UPDATE workspace_actions
     SET asana_sync_queued_at = ?,
         asana_sync_error = ?,
         outbound_status = ?,
         sync_status = ?
     WHERE id = ?
       AND workspace_id = ?
       AND kind = 'task'`,
  )
    .bind(
      finalAttempt ? null : job.requestedAt,
      error instanceof Error ? error.message : "Unknown Asana sync failure",
      finalAttempt ? "Failed" : "Pending",
      finalAttempt ? "Failed" : "Pending",
      job.taskId,
      job.workspaceId,
    )
    .run();
  await publishTaskSyncMutation(env, job);
}

async function publishTaskSyncMutation(env: AsanaTaskSyncEnv, job: AsanaTaskSyncJob) {
  await recordRealtimeMutationEvent(env.DB, {
    chatId: null,
    entity: "task",
    entityId: job.taskId,
    invalidates: ["workspace"],
    mode: job.mode,
    operation: "update",
    projectId: job.projectId,
    sourceClientId: asanaSyncQueueSourceClientId,
    sourceUserId: job.userId,
    teamId: job.mode === "Team" ? job.teamId : null,
    workspaceId: job.workspaceId,
  });
}

async function asanaFetch<T>(
  accessToken: string,
  path: string,
  options: {
    method?: string;
    query?: Record<string, string>;
    body?: BodyInit;
  } = {},
) {
  const url = new URL(`https://app.asana.com/api/1.0${path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, value);
  const response = await fetchAsanaWithTimeout(url, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: options.body,
  });
  const envelope = await response.json<AsanaApiEnvelope<T>>();
  if (!response.ok || !envelope.data) {
    const message = envelope.errors
      ?.map((item) => item.message)
      .filter(Boolean)
      .join("; ");
    throw new AsanaApiError(message || `Asana API request failed with ${response.status}.`, response.status);
  }
  return envelope.data;
}

async function fetchAsanaWithTimeout(url: URL, init: RequestInit) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), asanaApiTimeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function retryDelaySeconds(attempt: number) {
  return Math.min(60, Math.max(5, attempt * attempt * 5));
}

function parseScopes(scope: string) {
  return [
    ...new Set(
      scope
        .split(/\s+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ].sort();
}

function hasAsanaScope(scopes: string[], scope: string) {
  return scopes.includes("full") || scopes.includes("default") || scopes.includes(scope);
}
