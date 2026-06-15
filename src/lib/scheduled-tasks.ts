/// <reference path="../../worker-configuration.d.ts" />

import { runDailyProjectBriefings } from "@/lib/daily-briefings";
import {
  publishAutonomousResearchTrigger,
  type AutonomousResearchEntityType,
  type AutonomousResearchProducerEnv,
  type AutonomousResearchWorkspaceMode,
} from "@/lib/autonomous-research-queue";

export const scheduledTaskTypes = ["Weekly Briefing", "Background Research", "Artifact Validation"] as const;

export type ScheduledTaskType = (typeof scheduledTaskTypes)[number];

type ScheduledTaskStatus = "pending" | "running" | "completed" | "failed" | "paused";

type ScheduledTaskRow = {
  id: string;
  organizationId: string | null;
  workspaceId: string | null;
  type: ScheduledTaskType;
  status: ScheduledTaskStatus;
  payloadJson: string;
  scheduleJson: string;
  nextRunAt: number;
  intervalMinutes: number | null;
  retryDelayMinutes: number;
  attemptCount: number;
  maxAttempts: number;
};

type ScheduledTaskResult = {
  handledAt: string;
  taskId: string;
  taskType: ScheduledTaskType;
  summary: string;
  metadata?: Record<string, unknown>;
};

const maxTasksPerTick = 25;
const defaultWeeklyIntervalMinutes = 7 * 24 * 60;
const defaultRetryDelayMinutes = 15;
const maxStoredResultChars = 20_000;

const scheduledTaskTypeSet = new Set<string>(scheduledTaskTypes);

export function isScheduledTaskType(value: string): value is ScheduledTaskType {
  return scheduledTaskTypeSet.has(value);
}

function parseJsonRecord(value: string | null | undefined) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function truncateForStorage(value: string, maxLength = maxStoredResultChars) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3)}...`;
}

function safeErrorMessage(error: unknown) {
  return (error instanceof Error ? error.message : "Unknown scheduled task error.").replace(/\s+/g, " ").trim();
}

function numberFromPayload(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringFromPayload(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function nullableStringFromPayload(value: unknown) {
  const text = stringFromPayload(value);
  return text || null;
}

function tagsFromPayload(value: unknown) {
  return Array.isArray(value)
    ? value
        .filter((tag): tag is string => typeof tag === "string")
        .map((tag) => tag.trim())
        .filter(Boolean)
    : [];
}

function researchEntityType(value: unknown): AutonomousResearchEntityType | null {
  return value === "project" || value === "idea" ? value : null;
}

function researchWorkspaceMode(value: unknown): AutonomousResearchWorkspaceMode | null {
  return value === "Personal" || value === "Team" || value === "Org" ? value : null;
}

export function getNextScheduledTaskRunAt(task: Pick<ScheduledTaskRow, "intervalMinutes" | "nextRunAt" | "type">, scheduledAt: Date) {
  const intervalMinutes =
    task.intervalMinutes && task.intervalMinutes > 0
      ? task.intervalMinutes
      : task.type === "Weekly Briefing"
        ? defaultWeeklyIntervalMinutes
        : null;
  if (!intervalMinutes) return null;

  const intervalMs = intervalMinutes * 60 * 1000;
  let nextRunAt = task.nextRunAt + intervalMs;
  while (nextRunAt <= scheduledAt.getTime()) {
    nextRunAt += intervalMs;
  }
  return nextRunAt;
}

async function listDueScheduledTasks(db: D1Database, scheduledAt: Date) {
  const { results } = await db
    .prepare(
      `SELECT
         id,
         organization_id AS organizationId,
         workspace_id AS workspaceId,
         type,
         status,
         payload_json AS payloadJson,
         schedule_json AS scheduleJson,
         next_run_at AS nextRunAt,
         interval_minutes AS intervalMinutes,
         retry_delay_minutes AS retryDelayMinutes,
         attempt_count AS attemptCount,
         max_attempts AS maxAttempts
       FROM scheduled_tasks
       WHERE enabled = 1
         AND status = 'pending'
         AND next_run_at <= ?
       ORDER BY next_run_at ASC, priority DESC
       LIMIT ?`,
    )
    .bind(scheduledAt.getTime(), maxTasksPerTick)
    .all<ScheduledTaskRow>();

  return results.filter((task) => isScheduledTaskType(task.type));
}

async function claimScheduledTask(db: D1Database, task: ScheduledTaskRow, scheduledAt: Date) {
  const now = scheduledAt.getTime();
  const result = await db
    .prepare(
      `UPDATE scheduled_tasks
       SET status = 'running',
           locked_at = ?,
           last_run_at = ?,
           updated_at = ?,
           attempt_count = attempt_count + 1
       WHERE id = ?
         AND enabled = 1
         AND status = 'pending'
         AND next_run_at <= ?`,
    )
    .bind(now, now, now, task.id, now)
    .run();

  return (result.meta.changes ?? 0) > 0;
}

async function completeScheduledTask(db: D1Database, task: ScheduledTaskRow, scheduledAt: Date, result: ScheduledTaskResult) {
  const completedAt = scheduledAt.getTime();
  const nextRunAt = getNextScheduledTaskRunAt(task, scheduledAt);
  const status: ScheduledTaskStatus = nextRunAt ? "pending" : "completed";
  const storedNextRunAt = nextRunAt ?? task.nextRunAt;
  await db
    .prepare(
      `UPDATE scheduled_tasks
       SET status = ?,
           next_run_at = ?,
           locked_at = NULL,
           last_completed_at = ?,
           last_error = NULL,
           result_json = ?,
           attempt_count = 0,
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(status, storedNextRunAt, completedAt, truncateForStorage(JSON.stringify(result)), completedAt, task.id)
    .run();
}

async function failScheduledTask(db: D1Database, task: ScheduledTaskRow, scheduledAt: Date, error: unknown) {
  const now = scheduledAt.getTime();
  const nextAttemptCount = task.attemptCount + 1;
  const shouldRetry = nextAttemptCount < task.maxAttempts;
  const retryDelayMinutes = task.retryDelayMinutes > 0 ? task.retryDelayMinutes : defaultRetryDelayMinutes;
  const nextRunAt = shouldRetry ? now + retryDelayMinutes * 60 * 1000 : null;
  const status: ScheduledTaskStatus = shouldRetry ? "pending" : "failed";
  await db
    .prepare(
      `UPDATE scheduled_tasks
       SET status = ?,
           next_run_at = ?,
           locked_at = NULL,
           last_error = ?,
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(status, nextRunAt, truncateForStorage(safeErrorMessage(error), 4000), now, task.id)
    .run();
}

async function countRows(db: D1Database, statement: string, ...bindings: unknown[]) {
  const row = await db
    .prepare(statement)
    .bind(...bindings)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

async function optionalCountRows(db: D1Database, statement: string, ...bindings: unknown[]) {
  try {
    return await countRows(db, statement, ...bindings);
  } catch (error) {
    const message = safeErrorMessage(error);
    if (/no such table/i.test(message)) return null;
    throw error;
  }
}

async function runWeeklyBriefingTask(env: Env, task: ScheduledTaskRow, scheduledAt: Date): Promise<ScheduledTaskResult> {
  await runDailyProjectBriefings(env, scheduledAt.getTime());
  return {
    handledAt: scheduledAt.toISOString(),
    taskId: task.id,
    taskType: task.type,
    summary: "Due briefing schedules were processed.",
  };
}

async function runBackgroundResearchTask(env: Env, task: ScheduledTaskRow, scheduledAt: Date): Promise<ScheduledTaskResult> {
  const payload = parseJsonRecord(task.payloadJson);
  const entityType = researchEntityType(payload.entityType);
  const workspaceMode = researchWorkspaceMode(payload.workspaceMode);
  const entityId = stringFromPayload(payload.entityId);
  const workspaceId = stringFromPayload(payload.workspaceId) || task.workspaceId || "";
  const title = stringFromPayload(payload.title) || stringFromPayload(payload.query);
  const description = stringFromPayload(payload.description) || title;
  const requiredPayloadMissing = !entityType || !workspaceMode || !entityId || !workspaceId || !title;
  const queued = requiredPayloadMissing
    ? false
    : await publishAutonomousResearchTrigger(env as AutonomousResearchProducerEnv, {
        entityType,
        entityId,
        workspaceId,
        workspaceMode,
        teamId: nullableStringFromPayload(payload.teamId),
        projectId: nullableStringFromPayload(payload.projectId) ?? (entityType === "project" ? entityId : null),
        title,
        description,
        tags: tagsFromPayload(payload.tags),
        sourceUserId: nullableStringFromPayload(payload.sourceUserId),
        requestId: `scheduled-${task.id}-${scheduledAt.getTime()}`,
        requestedAt: scheduledAt.getTime(),
      });

  return {
    handledAt: scheduledAt.toISOString(),
    taskId: task.id,
    taskType: task.type,
    summary: queued
      ? "Background research task was queued for autonomous research indexing."
      : "Background research task did not have enough payload to queue autonomous research.",
    metadata: {
      entityId,
      entityType,
      organizationId: task.organizationId,
      workspaceId,
      workspaceMode,
    },
  };
}

async function runArtifactValidationTask(env: Env, task: ScheduledTaskRow, scheduledAt: Date): Promise<ScheduledTaskResult> {
  const payload = parseJsonRecord(task.payloadJson);
  const staleAfterHours = numberFromPayload(payload.staleAfterHours) ?? 24;
  const staleBeforeIso = new Date(scheduledAt.getTime() - staleAfterHours * 60 * 60 * 1000).toISOString();
  const [artifactMetadataIssues, knowledgeProcessing, knowledgeFailures] = await Promise.all([
    countRows(
      env.DB,
      `SELECT COUNT(*) AS count
       FROM artifacts
       WHERE COALESCE(r2_key, '') = ''
          OR COALESCE(href, '') = ''
          OR COALESCE(preview_json, '') = ''`,
    ),
    optionalCountRows(
      env.DB,
      `SELECT COUNT(*) AS count
       FROM knowledge_items
       WHERE status = 'processing'
         AND updated_at < ?`,
      staleBeforeIso,
    ),
    optionalCountRows(env.DB, "SELECT COUNT(*) AS count FROM knowledge_items WHERE status = 'failed'"),
  ]);

  return {
    handledAt: scheduledAt.toISOString(),
    taskId: task.id,
    taskType: task.type,
    summary: "Artifact metadata and knowledge archive health were checked.",
    metadata: {
      artifactMetadataIssues,
      knowledgeFailures,
      knowledgeProcessing,
      staleAfterHours,
    },
  };
}

async function runScheduledTask(env: Env, task: ScheduledTaskRow, scheduledAt: Date) {
  switch (task.type) {
    case "Weekly Briefing":
      return runWeeklyBriefingTask(env, task, scheduledAt);
    case "Background Research":
      return runBackgroundResearchTask(env, task, scheduledAt);
    case "Artifact Validation":
      return runArtifactValidationTask(env, task, scheduledAt);
  }
}

export async function runScheduledTaskEngine(env: Env, scheduledTime: number = Date.now()) {
  if (!env.DB) {
    console.warn("[ScheduledTasks] DB binding is unavailable; skipping scheduled task engine.");
    return;
  }

  const scheduledAt = new Date(scheduledTime);
  const dueTasks = await listDueScheduledTasks(env.DB, scheduledAt);

  for (const task of dueTasks) {
    const claimed = await claimScheduledTask(env.DB, task, scheduledAt);
    if (!claimed) continue;

    try {
      const result = await runScheduledTask(env, task, scheduledAt);
      await completeScheduledTask(env.DB, task, scheduledAt, result);
    } catch (error) {
      console.error("[ScheduledTasks] Task failed.", {
        taskId: task.id,
        taskType: task.type,
        message: safeErrorMessage(error),
      });
      await failScheduledTask(env.DB, task, scheduledAt, error);
    }
  }
}
