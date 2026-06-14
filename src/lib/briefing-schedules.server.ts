/// <reference path="../../worker-configuration.d.ts" />

import { env } from "cloudflare:workers";
import { getRequest } from "@tanstack/start-server-core";
import { and, asc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../db/schema";
import { getAuth } from "@/lib/auth";
import { generateBriefingPreview } from "@/lib/daily-briefings";
import type {
  BriefingPreviewResult,
  BriefingProjectOption,
  BriefingRecurrence,
  BriefingScheduleInput,
  BriefingScheduleView,
  BriefingSettingsSummary,
} from "@/lib/briefing-schedules";

type AuthSession = {
  user: {
    id: string;
    email: string;
    name: string;
    role?: string | null;
  };
};

type ScheduleRow = typeof schema.briefingSchedules.$inferSelect & {
  projectName: string | null;
  chatTitle: string | null;
};

type ProjectOptionRow = {
  projectId: string;
  projectName: string;
  workspaceId: string;
  workspaceName: string;
  workspaceScope: "personal" | "team" | "org";
  teamName: string | null;
};

type ChatOptionRow = {
  id: string;
  title: string;
  projectId: string | null;
};

const recurrenceValues = new Set<BriefingRecurrence>(["daily", "weekdays", "weekly", "monthly", "once"]);

async function requireUser() {
  const request = getRequest();
  const session = await getAuth(request).api.getSession({ headers: request.headers }) as AuthSession | null;
  if (!session?.user?.id) throw new Error("Sign in before managing briefing schedules.");
  return session.user;
}

function getDb() {
  if (!env.DB) throw new Error("D1 binding DB is unavailable.");
  return drizzle(env.DB, { schema });
}

function parseWeekdays(value: string | number[] | null | undefined) {
  if (Array.isArray(value)) return value.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
  try {
    const parsed = JSON.parse(value ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6) : [];
  } catch {
    return [];
  }
}

function normalizeScheduleInput(input: BriefingScheduleInput) {
  const title = input.title.trim() || "Scheduled briefing";
  const recurrence = recurrenceValues.has(input.recurrence) ? input.recurrence : "weekdays";
  const timeZone = input.timeZone.trim() || "America/New_York";
  const localTime = /^\d{2}:\d{2}$/.test(input.localTime) ? input.localTime : "08:00";
  const weekdays = parseWeekdays(input.weekdays);
  const monthDay = input.monthDay && input.monthDay >= 1 && input.monthDay <= 31 ? Math.floor(input.monthDay) : null;
  const reportingWindowHours = Math.min(Math.max(Math.round(Number(input.reportingWindowHours) || 24), 1), 720);
  return {
    ...input,
    title,
    recurrence,
    timeZone,
    localTime,
    weekdays,
    monthDay,
    reportingWindowHours,
    promptInstructions: input.promptInstructions.trim(),
    chatId: input.chatId?.trim() || null,
    newChatTitle: input.newChatTitle?.trim() ?? null,
  };
}

function toIso(value: Date | null) {
  return value ? value.toISOString() : null;
}

function toView(row: ScheduleRow): BriefingScheduleView {
  return {
    id: row.id,
    title: row.title,
    enabled: Boolean(row.enabled),
    recurrence: row.recurrence,
    timeZone: row.timeZone,
    localTime: row.localTime,
    weekdays: parseWeekdays(row.weekdaysJson),
    monthDay: row.monthDay,
    runOnceAt: toIso(row.runOnceAt),
    reportingWindowHours: row.reportingWindowHours,
    promptInstructions: row.promptInstructions,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    projectName: row.projectName,
    chatId: row.chatId,
    chatTitle: row.chatTitle,
    nextRunAt: toIso(row.nextRunAt),
    lastRunAt: toIso(row.lastRunAt),
    lastStatus: row.lastStatus,
    lastError: row.lastError,
  };
}

function getTimeZoneParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  const hour = Number(parts.hour) === 24 ? 0 : Number(parts.hour);
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour,
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function localDateTimeToUtc(timeZone: string, year: number, month: number, day: number, hour: number, minute: number) {
  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  for (let index = 0; index < 3; index += 1) {
    const parts = getTimeZoneParts(guess, timeZone);
    const zonedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
    guess = new Date(guess.getTime() + targetAsUtc - zonedAsUtc);
  }
  return guess;
}

function addDays(year: number, month: number, day: number, days: number) {
  const date = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function addMonths(year: number, month: number, months: number) {
  const date = new Date(Date.UTC(year, month - 1 + months, 1, 12, 0, 0));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

function weekdayForDate(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).getUTCDay();
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0, 12, 0, 0)).getUTCDate();
}

export function computeNextRunAtFromInput(input: BriefingScheduleInput, after = new Date()) {
  const normalized = normalizeScheduleInput(input);
  if (!normalized.enabled) return null;

  if (normalized.recurrence === "once") {
    const runOnceAt = normalized.runOnceAt ? new Date(normalized.runOnceAt) : null;
    return runOnceAt && Number.isFinite(runOnceAt.getTime()) && runOnceAt > after ? runOnceAt : null;
  }

  const [hourText, minuteText] = normalized.localTime.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const afterLocal = getTimeZoneParts(new Date(after.getTime() + 60 * 1000), normalized.timeZone);

  if (normalized.recurrence === "monthly") {
    const preferredDay = normalized.monthDay ?? 1;
    for (let offset = 0; offset < 24; offset += 1) {
      const { year, month } = addMonths(afterLocal.year, afterLocal.month, offset);
      const day = Math.min(preferredDay, daysInMonth(year, month));
      const candidate = localDateTimeToUtc(normalized.timeZone, year, month, day, hour, minute);
      if (candidate > after) return candidate;
    }
    return null;
  }

  const allowedDays = normalized.recurrence === "daily"
    ? [0, 1, 2, 3, 4, 5, 6]
    : normalized.recurrence === "weekdays"
      ? [1, 2, 3, 4, 5]
      : normalized.weekdays.length ? normalized.weekdays : [weekdayForDate(afterLocal.year, afterLocal.month, afterLocal.day)];

  for (let offset = 0; offset < 370; offset += 1) {
    const { year, month, day } = addDays(afterLocal.year, afterLocal.month, afterLocal.day, offset);
    if (!allowedDays.includes(weekdayForDate(year, month, day))) continue;
    const candidate = localDateTimeToUtc(normalized.timeZone, year, month, day, hour, minute);
    if (candidate > after) return candidate;
  }
  return null;
}

export async function getBriefingSettingsSummaryForCurrentUser(): Promise<BriefingSettingsSummary> {
  const user = await requireUser();
  const db = getDb();
  if (!env.DB) throw new Error("D1 binding DB is unavailable.");
  const [projectResult, chatResult] = await env.DB.batch([
    env.DB.prepare(
      `SELECT p.id as projectId,
              p.name as projectName,
              p.workspace_id as workspaceId,
              w.name as workspaceName,
              w.scope as workspaceScope,
              COALESCE(
                (
                  SELECT t_user.name
                  FROM project_members pm_user
                  INNER JOIN teams t_user ON t_user.id = pm_user.team_id
                  WHERE pm_user.project_id = p.id
                    AND pm_user.user_id = ?
                  LIMIT 1
                ),
                (
                  SELECT t_any.name
                  FROM project_members pm_any
                  INNER JOIN teams t_any ON t_any.id = pm_any.team_id
                  WHERE pm_any.project_id = p.id
                  LIMIT 1
                )
              ) as teamName
       FROM projects p
       INNER JOIN workspaces w ON w.id = p.workspace_id
       ORDER BY w.scope ASC, p.sort_order ASC, p.name ASC`,
    ).bind(user.id),
    env.DB.prepare(
      `SELECT id,
              title,
              project_id as projectId
       FROM chats
       WHERE section = 'project'
       ORDER BY sort_order ASC, title ASC`,
    ),
  ]);
  const projectRows = (projectResult.results ?? []) as ProjectOptionRow[];
  const chatRows = (chatResult.results ?? []) as ChatOptionRow[];

  let scheduleRows: ScheduleRow[] = [];
  try {
    const [rows] = await db.batch([
      db
        .select({
          id: schema.briefingSchedules.id,
          userId: schema.briefingSchedules.userId,
          workspaceId: schema.briefingSchedules.workspaceId,
          projectId: schema.briefingSchedules.projectId,
          chatId: schema.briefingSchedules.chatId,
          title: schema.briefingSchedules.title,
          enabled: schema.briefingSchedules.enabled,
          recurrence: schema.briefingSchedules.recurrence,
          timeZone: schema.briefingSchedules.timeZone,
          localTime: schema.briefingSchedules.localTime,
          weekdaysJson: schema.briefingSchedules.weekdaysJson,
          monthDay: schema.briefingSchedules.monthDay,
          runOnceAt: schema.briefingSchedules.runOnceAt,
          reportingWindowHours: schema.briefingSchedules.reportingWindowHours,
          promptInstructions: schema.briefingSchedules.promptInstructions,
          nextRunAt: schema.briefingSchedules.nextRunAt,
          lastRunAt: schema.briefingSchedules.lastRunAt,
          lastStatus: schema.briefingSchedules.lastStatus,
          lastError: schema.briefingSchedules.lastError,
          createdAt: schema.briefingSchedules.createdAt,
          updatedAt: schema.briefingSchedules.updatedAt,
          projectName: schema.projects.name,
          chatTitle: schema.chats.title,
        })
        .from(schema.briefingSchedules)
        .leftJoin(schema.projects, eq(schema.projects.id, schema.briefingSchedules.projectId))
        .leftJoin(schema.chats, eq(schema.chats.id, schema.briefingSchedules.chatId))
        .where(eq(schema.briefingSchedules.userId, user.id))
        .orderBy(asc(schema.briefingSchedules.title)),
    ]);
    scheduleRows = rows as ScheduleRow[];
  } catch (error) {
    console.warn("[BriefingSchedules] Schedule table is not available yet; returning project options only.", {
      message: error instanceof Error ? error.message : "Unknown schedule lookup error.",
    });
  }

  const chatsByProject = new Map<string, Array<{ id: string; title: string }>>();
  for (const chat of chatRows) {
    if (!chat.projectId) continue;
    const options = chatsByProject.get(chat.projectId) ?? [];
    options.push({ id: chat.id, title: chat.title });
    chatsByProject.set(chat.projectId, options);
  }

  const projects: BriefingProjectOption[] = projectRows.map((project) => ({
    id: project.projectId,
    name: project.projectName,
    projectName: project.projectName,
    workspaceId: project.workspaceId,
    workspaceName: project.workspaceName,
    workspaceScope: project.workspaceScope,
    teamName: project.teamName,
    chatOptions: chatsByProject.get(project.projectId) ?? [],
  }));

  return {
    projects,
    schedules: scheduleRows.map(toView),
  };
}

async function getProjectScope(projectId: string) {
  const db = getDb();
  const [rows] = await db.batch([
    db
      .select({
        id: schema.projects.id,
        workspaceId: schema.projects.workspaceId,
      })
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId))
      .limit(1),
  ]);
  const project = rows[0];
  if (!project) throw new Error("Choose a valid project for the briefing.");
  return project;
}

async function resolveScheduleChatId(db: ReturnType<typeof getDb>, projectId: string, workspaceId: string, chatId: string | null, newChatTitle: string | null) {
  if (chatId) {
    const [chatRows] = await db.batch([
      db
        .select({ id: schema.chats.id })
        .from(schema.chats)
        .where(and(
          eq(schema.chats.id, chatId),
          eq(schema.chats.projectId, projectId),
        ))
        .limit(1),
    ]);
    if (!chatRows[0]) throw new Error("Choose a chat that belongs to the selected project.");
    return chatId;
  }

  const title = newChatTitle?.trim();
  if (!title) throw new Error("Choose an existing thread or enter a new thread name.");

  const [existingRows, sortRows] = await db.batch([
    db
      .select({ id: schema.chats.id })
      .from(schema.chats)
      .where(and(
        eq(schema.chats.workspaceId, workspaceId),
        eq(schema.chats.projectId, projectId),
        eq(schema.chats.section, "project"),
        eq(schema.chats.title, title),
      ))
      .limit(1),
    db
      .select({ nextSortOrder: sql<number>`coalesce(max(${schema.chats.sortOrder}), 0) + 1` })
      .from(schema.chats)
      .where(and(
        eq(schema.chats.workspaceId, workspaceId),
        eq(schema.chats.projectId, projectId),
      )),
  ]);

  if (existingRows[0]?.id) return existingRows[0].id;

  const newChatId = `briefing-thread-${projectId}-${crypto.randomUUID()}`;
  const nextSortOrder = Number(sortRows[0]?.nextSortOrder ?? 1);
  await db.batch([
    db.insert(schema.chats).values({
      id: newChatId,
      workspaceId,
      projectId,
      section: "project",
      title,
      description: "Automated briefing thread.",
      sortOrder: nextSortOrder,
    }),
  ]);

  return newChatId;
}

export async function saveBriefingScheduleForCurrentUser(input: BriefingScheduleInput): Promise<BriefingScheduleView> {
  const user = await requireUser();
  const db = getDb();
  const normalized = normalizeScheduleInput(input);
  const project = await getProjectScope(normalized.projectId);
  const now = new Date();
  const nextRunAt = computeNextRunAtFromInput(normalized, now);
  const id = normalized.id?.trim() || `briefing-schedule-${crypto.randomUUID()}`;
  const runOnceAt = normalized.runOnceAt ? new Date(normalized.runOnceAt) : null;
  const chatId = await resolveScheduleChatId(db, project.id, project.workspaceId, normalized.chatId, normalized.newChatTitle);

  const values = {
    id,
    userId: user.id,
    workspaceId: project.workspaceId,
    projectId: project.id,
    chatId,
    title: normalized.title,
    enabled: normalized.enabled,
    recurrence: normalized.recurrence,
    timeZone: normalized.timeZone,
    localTime: normalized.localTime,
    weekdaysJson: JSON.stringify(normalized.weekdays),
    monthDay: normalized.monthDay,
    runOnceAt,
    reportingWindowHours: normalized.reportingWindowHours,
    promptInstructions: normalized.promptInstructions,
    nextRunAt,
    updatedAt: now,
  };

  const [existing] = await db.batch([
    db
      .select({ id: schema.briefingSchedules.id })
      .from(schema.briefingSchedules)
      .where(and(eq(schema.briefingSchedules.id, id), eq(schema.briefingSchedules.userId, user.id)))
      .limit(1),
  ]);

  if (existing[0]) {
    await db.batch([
      db.update(schema.briefingSchedules)
        .set(values)
        .where(and(eq(schema.briefingSchedules.id, id), eq(schema.briefingSchedules.userId, user.id))),
    ]);
  } else {
    await db.batch([
      db.insert(schema.briefingSchedules).values({
        ...values,
        createdAt: now,
      }),
    ]);
  }

  const summary = await getBriefingSettingsSummaryForCurrentUser();
  const saved = summary.schedules.find((schedule) => schedule.id === id);
  if (!saved) throw new Error("Schedule was saved, but could not be reloaded.");
  return saved;
}

export async function deleteBriefingScheduleForCurrentUser(id: string) {
  const user = await requireUser();
  const db = getDb();
  await db.batch([
    db.delete(schema.briefingSchedules)
      .where(and(eq(schema.briefingSchedules.id, id), eq(schema.briefingSchedules.userId, user.id))),
  ]);
  return { ok: true };
}

export async function testBriefingScheduleForCurrentUser(input: BriefingScheduleInput): Promise<BriefingPreviewResult> {
  await requireUser();
  const normalized = normalizeScheduleInput(input);
  const project = await getProjectScope(normalized.projectId);
  const preview = await generateBriefingPreview(env, {
    projectId: project.id,
    workspaceId: project.workspaceId,
    chatId: normalized.chatId,
    title: normalized.title,
    reportingWindowHours: normalized.reportingWindowHours,
    promptInstructions: normalized.promptInstructions,
    scheduledAt: new Date(),
    markerKey: `test:${crypto.randomUUID()}`,
  });

  return {
    markdown: preview.markdown,
    contextXml: preview.contextXml,
    windowStart: preview.windowStart,
    windowEnd: preview.windowEnd,
    counts: preview.counts,
    project: {
      id: preview.project.id,
      name: preview.project.name,
      workspaceId: preview.project.workspaceId,
      workspaceName: preview.project.workspaceName,
      status: preview.project.status,
    },
  };
}
