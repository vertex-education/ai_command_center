export const scheduledTaskAdminTypes = ["Weekly Briefing", "Background Research", "Artifact Validation"] as const;

export type ScheduledTaskAdminType = (typeof scheduledTaskAdminTypes)[number];

export const scheduledTaskAdminStatuses = ["pending", "running", "completed", "failed", "paused"] as const;

export type ScheduledTaskAdminStatus = (typeof scheduledTaskAdminStatuses)[number];

export type ScheduledTaskAdminJsonValue =
  | string
  | number
  | boolean
  | null
  | ScheduledTaskAdminJsonValue[]
  | { [key: string]: ScheduledTaskAdminJsonValue };

export type ScheduledTaskAdminJsonObject = { [key: string]: ScheduledTaskAdminJsonValue };

export type ScheduledTaskAdminDbRow = {
  id: string;
  organizationId: string | null;
  workspaceId: string | null;
  type: string;
  status: string;
  enabled: number | boolean;
  priority: number | null;
  payloadJson: string | null;
  scheduleJson: string | null;
  nextRunAt: number | string | null;
  intervalMinutes: number | string | null;
  retryDelayMinutes: number | string | null;
  attemptCount: number | string | null;
  maxAttempts: number | string | null;
  lockedAt: number | string | null;
  lastRunAt: number | string | null;
  lastCompletedAt: number | string | null;
  lastError: string | null;
  resultJson: string | null;
  createdAt: number | string | null;
  updatedAt: number | string | null;
};

export type ScheduledTaskAdminHealth = "ready" | "due" | "running" | "failed" | "paused" | "complete";

export type ScheduledTaskAdminRow = {
  id: string;
  organizationId: string | null;
  workspaceId: string | null;
  type: ScheduledTaskAdminType;
  status: ScheduledTaskAdminStatus;
  statusLabel: string;
  enabled: boolean;
  priority: number;
  payloadJson: string;
  scheduleJson: string;
  resultJson: string | null;
  payload: ScheduledTaskAdminJsonObject;
  schedule: ScheduledTaskAdminJsonObject;
  result: ScheduledTaskAdminJsonObject | null;
  nextRunAt: number;
  nextRunAtLabel: string;
  intervalMinutes: number | null;
  intervalLabel: string;
  retryDelayMinutes: number;
  attemptCount: number;
  maxAttempts: number;
  lockedAt: number | null;
  lockedAtLabel: string;
  lastRunAt: number | null;
  lastRunAtLabel: string;
  lastCompletedAt: number | null;
  lastCompletedAtLabel: string;
  lastError: string | null;
  createdAt: number | null;
  createdAtLabel: string;
  updatedAt: number | null;
  updatedAtLabel: string;
  isDue: boolean;
  health: ScheduledTaskAdminHealth;
};

export type ScheduledTaskAdminSummary = {
  total: number;
  enabled: number;
  due: number;
  pending: number;
  running: number;
  failed: number;
  paused: number;
  completed: number;
};

export type ScheduledTaskAdminView = {
  generatedAt: string;
  summary: ScheduledTaskAdminSummary;
  tasks: ScheduledTaskAdminRow[];
};

export type CreateScheduledTaskAdminInput = {
  type: ScheduledTaskAdminType;
  organizationId?: string | null;
  workspaceId?: string | null;
  enabled: boolean;
  priority: number;
  payloadJson: string;
  scheduleJson: string;
  nextRunAt: number;
  intervalMinutes: number | null;
  retryDelayMinutes: number;
  maxAttempts: number;
};

export type UpdateScheduledTaskAdminInput = {
  taskId: string;
  enabled: boolean;
  priority: number;
  payloadJson: string;
  scheduleJson: string;
  nextRunAt: number;
  intervalMinutes: number | null;
  retryDelayMinutes: number;
  maxAttempts: number;
};

const taskTypeSet = new Set<string>(scheduledTaskAdminTypes);
const taskStatusSet = new Set<string>(scheduledTaskAdminStatuses);

export function isScheduledTaskAdminType(value: string): value is ScheduledTaskAdminType {
  return taskTypeSet.has(value);
}

export function isScheduledTaskAdminStatus(value: string): value is ScheduledTaskAdminStatus {
  return taskStatusSet.has(value);
}

export function parseScheduledTaskJson(value: string | null | undefined) {
  if (!value) return {};

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as ScheduledTaskAdminJsonObject) : {};
  } catch {
    return {};
  }
}

export function normalizeScheduledTaskJsonText(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return "{}";

  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? JSON.stringify(parsed) : "{}";
  } catch {
    return trimmed;
  }
}

export function formatScheduledTaskTimestamp(value: number | string | null | undefined, emptyLabel = "Not recorded") {
  const timestamp = timestampFromDb(value);
  return timestamp === null ? emptyLabel : new Date(timestamp).toLocaleString();
}

export function formatScheduledTaskInterval(minutes: number | null | undefined) {
  if (!minutes || minutes <= 0) return "One-time";
  if (minutes % 10_080 === 0) return `Every ${minutes / 10_080} week${minutes === 10_080 ? "" : "s"}`;
  if (minutes % 1_440 === 0) return `Every ${minutes / 1_440} day${minutes === 1_440 ? "" : "s"}`;
  if (minutes % 60 === 0) return `Every ${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
  return `Every ${minutes} minutes`;
}

export function toScheduledTaskAdminRow(row: ScheduledTaskAdminDbRow, now = Date.now()): ScheduledTaskAdminRow {
  const type = isScheduledTaskAdminType(row.type) ? row.type : "Background Research";
  const status = isScheduledTaskAdminStatus(row.status) ? row.status : "failed";
  const enabled = Boolean(row.enabled);
  const nextRunAt = timestampFromDb(row.nextRunAt) ?? 0;
  const intervalMinutes = positiveIntegerOrNull(row.intervalMinutes);
  const retryDelayMinutes = positiveIntegerOrDefault(row.retryDelayMinutes, 15);
  const attemptCount = nonNegativeIntegerOrDefault(row.attemptCount, 0);
  const maxAttempts = positiveIntegerOrDefault(row.maxAttempts, 3);
  const lockedAt = timestampFromDb(row.lockedAt);
  const lastRunAt = timestampFromDb(row.lastRunAt);
  const lastCompletedAt = timestampFromDb(row.lastCompletedAt);
  const createdAt = timestampFromDb(row.createdAt);
  const updatedAt = timestampFromDb(row.updatedAt);
  const isDue = enabled && status === "pending" && nextRunAt <= now;

  return {
    id: row.id,
    organizationId: row.organizationId,
    workspaceId: row.workspaceId,
    type,
    status,
    statusLabel: statusLabel(status),
    enabled,
    priority: integerOrDefault(row.priority, 0),
    payloadJson: row.payloadJson ?? "{}",
    scheduleJson: row.scheduleJson ?? "{}",
    resultJson: row.resultJson,
    payload: parseScheduledTaskJson(row.payloadJson),
    schedule: parseScheduledTaskJson(row.scheduleJson),
    result: row.resultJson ? parseScheduledTaskJson(row.resultJson) : null,
    nextRunAt,
    nextRunAtLabel: formatScheduledTaskTimestamp(nextRunAt, "Not scheduled"),
    intervalMinutes,
    intervalLabel: formatScheduledTaskInterval(intervalMinutes),
    retryDelayMinutes,
    attemptCount,
    maxAttempts,
    lockedAt,
    lockedAtLabel: formatScheduledTaskTimestamp(lockedAt, "Not locked"),
    lastRunAt,
    lastRunAtLabel: formatScheduledTaskTimestamp(lastRunAt, "Never"),
    lastCompletedAt,
    lastCompletedAtLabel: formatScheduledTaskTimestamp(lastCompletedAt, "Never"),
    lastError: row.lastError,
    createdAt,
    createdAtLabel: formatScheduledTaskTimestamp(createdAt, "Unknown"),
    updatedAt,
    updatedAtLabel: formatScheduledTaskTimestamp(updatedAt, "Unknown"),
    isDue,
    health: taskHealth({ enabled, status, isDue }),
  };
}

export function summarizeScheduledTaskAdminRows(tasks: ScheduledTaskAdminRow[]): ScheduledTaskAdminSummary {
  return {
    total: tasks.length,
    enabled: tasks.filter((task) => task.enabled).length,
    due: tasks.filter((task) => task.isDue).length,
    pending: tasks.filter((task) => task.status === "pending").length,
    running: tasks.filter((task) => task.status === "running").length,
    failed: tasks.filter((task) => task.status === "failed").length,
    paused: tasks.filter((task) => task.status === "paused" || !task.enabled).length,
    completed: tasks.filter((task) => task.status === "completed").length,
  };
}

function timestampFromDb(value: number | string | null | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed) return null;
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function integerOrDefault(value: number | string | null | undefined, fallback: number) {
  const numeric = typeof value === "string" ? Number(value) : value;
  return typeof numeric === "number" && Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function nonNegativeIntegerOrDefault(value: number | string | null | undefined, fallback: number) {
  return Math.max(0, integerOrDefault(value, fallback));
}

function positiveIntegerOrDefault(value: number | string | null | undefined, fallback: number) {
  const integer = integerOrDefault(value, fallback);
  return integer > 0 ? integer : fallback;
}

function positiveIntegerOrNull(value: number | string | null | undefined) {
  const integer = integerOrDefault(value, 0);
  return integer > 0 ? integer : null;
}

function statusLabel(status: ScheduledTaskAdminStatus) {
  return status.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function taskHealth({
  enabled,
  status,
  isDue,
}: {
  enabled: boolean;
  status: ScheduledTaskAdminStatus;
  isDue: boolean;
}): ScheduledTaskAdminHealth {
  if (!enabled || status === "paused") return "paused";
  if (status === "running") return "running";
  if (status === "failed") return "failed";
  if (status === "completed") return "complete";
  return isDue ? "due" : "ready";
}
