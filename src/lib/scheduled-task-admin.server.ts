import { getRequest } from "@tanstack/start-server-core";
import { env } from "cloudflare:workers";
import { isAdminRole } from "@/lib/auth-access-control";
import { getAuth } from "@/lib/auth";
import {
  isScheduledTaskAdminType,
  summarizeScheduledTaskAdminRows,
  toScheduledTaskAdminRow,
  type CreateScheduledTaskAdminInput,
  type ScheduledTaskAdminDbRow,
  type ScheduledTaskAdminRow,
  type UpdateScheduledTaskAdminInput,
} from "@/lib/scheduled-task-admin-shared";

type AdminSession = {
  user?: {
    id?: string;
    role?: string | null;
  };
};

function getDb() {
  const db = (env as Env).DB;
  if (!db) throw new Error("D1 binding DB is required for scheduled task admin settings.");
  return db;
}

async function requireAdmin() {
  const request = getRequest();
  const session = (await getAuth(request).api.getSession({ headers: request.headers })) as AdminSession | null;
  if (!session?.user?.id) throw new Error("Sign in is required.");
  if (!isAdminRole(session.user.role)) throw new Error("Admin privileges are required.");
  return session;
}

async function selectScheduledTaskById(db: D1Database, taskId: string, now: number): Promise<ScheduledTaskAdminRow> {
  const row = await db
    .prepare(
      `SELECT
         id,
         organization_id AS organizationId,
         workspace_id AS workspaceId,
         type,
         status,
         enabled,
         priority,
         payload_json AS payloadJson,
         schedule_json AS scheduleJson,
         next_run_at AS nextRunAt,
         interval_minutes AS intervalMinutes,
         retry_delay_minutes AS retryDelayMinutes,
         attempt_count AS attemptCount,
         max_attempts AS maxAttempts,
         locked_at AS lockedAt,
         last_run_at AS lastRunAt,
         last_completed_at AS lastCompletedAt,
         last_error AS lastError,
         result_json AS resultJson,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM scheduled_tasks
       WHERE id = ?
       LIMIT 1`,
    )
    .bind(taskId)
    .first<ScheduledTaskAdminDbRow>();

  if (!row) throw new Error("Scheduled task was not found.");
  return toScheduledTaskAdminRow(row, now);
}

export async function listScheduledTasksForAdmin() {
  await requireAdmin();
  const now = Date.now();
  const result = await getDb()
    .prepare(
      `SELECT
         id,
         organization_id AS organizationId,
         workspace_id AS workspaceId,
         type,
         status,
         enabled,
         priority,
         payload_json AS payloadJson,
         schedule_json AS scheduleJson,
         next_run_at AS nextRunAt,
         interval_minutes AS intervalMinutes,
         retry_delay_minutes AS retryDelayMinutes,
         attempt_count AS attemptCount,
         max_attempts AS maxAttempts,
         locked_at AS lockedAt,
         last_run_at AS lastRunAt,
         last_completed_at AS lastCompletedAt,
         last_error AS lastError,
         result_json AS resultJson,
         created_at AS createdAt,
         updated_at AS updatedAt
       FROM scheduled_tasks
       ORDER BY
         CASE
           WHEN enabled = 1 AND status = 'pending' AND next_run_at <= ? THEN 0
           WHEN status = 'running' THEN 1
           WHEN status = 'failed' THEN 2
           WHEN enabled = 1 AND status = 'pending' THEN 3
           ELSE 4
         END,
         next_run_at ASC,
         priority DESC,
         type ASC`,
    )
    .bind(now)
    .all<ScheduledTaskAdminDbRow>();

  const tasks = (result.results ?? []).map((row) => toScheduledTaskAdminRow(row, now));
  return {
    generatedAt: new Date(now).toISOString(),
    summary: summarizeScheduledTaskAdminRows(tasks),
    tasks,
  };
}

export async function createScheduledTaskForAdmin(input: CreateScheduledTaskAdminInput) {
  await requireAdmin();
  const now = Date.now();
  const data = normalizeCreateInput(input);
  const db = getDb();
  const taskId = `scheduled-${crypto.randomUUID()}`;

  await db
    .prepare(
      `INSERT INTO scheduled_tasks (
         id,
         organization_id,
         workspace_id,
         type,
         status,
         enabled,
         priority,
         payload_json,
         schedule_json,
         next_run_at,
         interval_minutes,
         retry_delay_minutes,
         attempt_count,
         max_attempts,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    )
    .bind(
      taskId,
      data.organizationId,
      data.workspaceId,
      data.type,
      data.enabled ? "pending" : "paused",
      data.enabled ? 1 : 0,
      data.priority,
      data.payloadJson,
      data.scheduleJson,
      data.nextRunAt,
      data.intervalMinutes,
      data.retryDelayMinutes,
      data.maxAttempts,
      now,
      now,
    )
    .run();

  return selectScheduledTaskById(db, taskId, now);
}

export async function updateScheduledTaskSettingsForAdmin(input: UpdateScheduledTaskAdminInput) {
  await requireAdmin();
  const now = Date.now();
  const taskId = requireTaskId(input.taskId);
  const data = normalizeUpdateInput(input);
  const db = getDb();

  const result = await db
    .prepare(
      `UPDATE scheduled_tasks
       SET enabled = ?,
           status = CASE
             WHEN ? = 0 AND status = 'pending' THEN 'paused'
             WHEN ? = 1 AND status = 'paused' THEN 'pending'
             ELSE status
           END,
           priority = ?,
           payload_json = ?,
           schedule_json = ?,
           next_run_at = ?,
           interval_minutes = ?,
           retry_delay_minutes = ?,
           max_attempts = ?,
           locked_at = CASE WHEN ? = 0 AND status = 'pending' THEN NULL ELSE locked_at END,
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      data.enabled ? 1 : 0,
      data.enabled ? 1 : 0,
      data.enabled ? 1 : 0,
      data.priority,
      data.payloadJson,
      data.scheduleJson,
      data.nextRunAt,
      data.intervalMinutes,
      data.retryDelayMinutes,
      data.maxAttempts,
      data.enabled ? 1 : 0,
      now,
      taskId,
    )
    .run();

  if (!result.meta.changes) throw new Error("Scheduled task was not found.");
  return selectScheduledTaskById(db, taskId, now);
}

export async function setScheduledTaskEnabledForAdmin(taskIdInput: string, enabled: boolean) {
  await requireAdmin();
  const now = Date.now();
  const taskId = requireTaskId(taskIdInput);
  const db = getDb();
  const enabledValue = enabled ? 1 : 0;

  const result = await db
    .prepare(
      `UPDATE scheduled_tasks
       SET enabled = ?,
           status = CASE
             WHEN ? = 0 AND status = 'pending' THEN 'paused'
             WHEN ? = 1 AND status = 'paused' THEN 'pending'
             ELSE status
           END,
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(enabledValue, enabledValue, enabledValue, now, taskId)
    .run();

  if (!result.meta.changes) throw new Error("Scheduled task was not found.");
  return selectScheduledTaskById(db, taskId, now);
}

export async function queueScheduledTaskForAdmin(taskIdInput: string) {
  await requireAdmin();
  const now = Date.now();
  const taskId = requireTaskId(taskIdInput);
  const db = getDb();

  const result = await db
    .prepare(
      `UPDATE scheduled_tasks
       SET enabled = 1,
           status = 'pending',
           next_run_at = ?,
           locked_at = NULL,
           last_error = NULL,
           attempt_count = 0,
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(now, now, taskId)
    .run();

  if (!result.meta.changes) throw new Error("Scheduled task was not found.");
  return selectScheduledTaskById(db, taskId, now);
}

function normalizeCreateInput(input: CreateScheduledTaskAdminInput): CreateScheduledTaskAdminInput {
  const type = input.type;
  if (!isScheduledTaskAdminType(type)) throw new Error("Scheduled task type is not supported.");

  return {
    type,
    organizationId: optionalText(input.organizationId),
    workspaceId: optionalText(input.workspaceId),
    enabled: Boolean(input.enabled),
    priority: integer(input.priority, "Priority"),
    payloadJson: jsonObjectText(input.payloadJson, "Payload JSON"),
    scheduleJson: jsonObjectText(input.scheduleJson, "Schedule JSON"),
    nextRunAt: timestamp(input.nextRunAt, "Next run"),
    intervalMinutes: nullablePositiveInteger(input.intervalMinutes, "Interval minutes"),
    retryDelayMinutes: positiveInteger(input.retryDelayMinutes, "Retry delay minutes"),
    maxAttempts: positiveInteger(input.maxAttempts, "Max attempts"),
  };
}

function normalizeUpdateInput(input: UpdateScheduledTaskAdminInput): UpdateScheduledTaskAdminInput {
  return {
    taskId: requireTaskId(input.taskId),
    enabled: Boolean(input.enabled),
    priority: integer(input.priority, "Priority"),
    payloadJson: jsonObjectText(input.payloadJson, "Payload JSON"),
    scheduleJson: jsonObjectText(input.scheduleJson, "Schedule JSON"),
    nextRunAt: timestamp(input.nextRunAt, "Next run"),
    intervalMinutes: nullablePositiveInteger(input.intervalMinutes, "Interval minutes"),
    retryDelayMinutes: positiveInteger(input.retryDelayMinutes, "Retry delay minutes"),
    maxAttempts: positiveInteger(input.maxAttempts, "Max attempts"),
  };
}

function requireTaskId(value: string) {
  const taskId = value.trim();
  if (!taskId) throw new Error("Scheduled task id is required.");
  return taskId;
}

function optionalText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function integer(value: number, label: string) {
  if (!Number.isFinite(value)) throw new Error(`${label} must be a number.`);
  return Math.trunc(value);
}

function positiveInteger(value: number, label: string) {
  const normalized = integer(value, label);
  if (normalized < 1) throw new Error(`${label} must be at least 1.`);
  return normalized;
}

function nullablePositiveInteger(value: number | null, label: string) {
  if (value === null) return null;
  return positiveInteger(value, label);
}

function timestamp(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be a valid timestamp.`);
  return Math.trunc(value);
}

function jsonObjectText(value: string, label: string) {
  const trimmed = value.trim() || "{}";
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return JSON.stringify(parsed);
  } catch {
    throw new Error(`${label} must be a JSON object.`);
  }
}
