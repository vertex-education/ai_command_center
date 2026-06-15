import { and, asc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../../db/schema";
import { runAiGateway } from "@/lib/ai-gateway";
import { briefingsChatIdForProject, weeklyBriefingsChatDescription, weeklyBriefingsChatTitle } from "@/lib/briefing-thread";
import { recordRealtimeMutationEvent } from "@/lib/realtime-events";
import {
  formatCustomInstructionTemplate,
  normalizeBriefingMarkdown,
  resolveInstructionPlaceholders,
  utcTimeLabel,
} from "@/lib/briefing-formatting";
import { vertexAiModelId } from "@/lib/prompts";

type AppDb = DrizzleD1Database<typeof schema>;

export type BriefingScheduleRow = typeof schema.briefingSchedules.$inferSelect;

type BriefingProjectRow = {
  id: string;
  workspaceId: string;
  workspaceName: string;
  workspaceScope: "personal" | "team" | "org";
  name: string;
  description: string;
  status: string;
};

type ChatMessageRow = {
  id: string;
  chatTitle: string;
  author: string;
  role: string;
  body: string;
  createdAt: string;
};

type TaskRow = {
  id: string;
  title: string;
  owner: string;
  source: string | null;
  status: string;
  asanaTaskGid: string | null;
  createdAt: Date;
};

type AsanaTaskRow = {
  asanaTaskGid: string;
  taskName: string | null;
  asanaProjectName: string;
  status: string | null;
  action: string;
  changeAction: string | null;
  changeField: string | null;
  updatedAt: Date;
};

type RiskSignalRow = {
  id: string;
  chatTitle: string;
  author: string;
  body: string;
  createdAt: string;
};

type PersistedRiskRow = {
  id: string;
  title: string;
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  status: string;
  mitigationStrategy: string;
};

type ArtifactSourceRow = {
  id: string;
  title: string;
  fileType: string;
  owner: string;
  artifactDate: string;
  status: string;
  summary: string;
  r2Key: string;
  href: string;
  previewJson: string;
  projectId: string | null;
  version: number;
  parentArtifactId: string | null;
  commitMessage: string;
};

type ModifiedArtifactRow = {
  id: string;
  title: string;
  fileType: string;
  owner: string | null;
  status: string | null;
  summary: string;
  r2Key: string | null;
  version: number | null;
  parentArtifactId: string | null;
  commitMessage: string | null;
  modifiedAt: string;
  source: "artifacts" | "artifacts_registry";
};

type BriefingGenerationInput = {
  projectId: string;
  workspaceId?: string | null;
  chatId?: string | null;
  title?: string | null;
  reportingWindowHours: number;
  promptInstructions?: string | null;
  scheduledAt?: Date;
  markerKey?: string | null;
  sourceUserId?: string | null;
};

type WorkersAiTextResult = {
  response?: unknown;
  text?: unknown;
  output_text?: unknown;
  content?: unknown;
  output?: unknown;
  result?: {
    response?: unknown;
    text?: unknown;
    output_text?: unknown;
    content?: unknown;
    output?: unknown;
  };
  choices?: Array<{
    message?: { content?: unknown; text?: unknown };
    delta?: { content?: unknown };
  }>;
};

const legacyDailyBriefingsTitle = "Daily Briefings";
const briefingAuthor = "VertexAI";
const defaultWindowHours = 168;
const closedTaskStatuses = new Set(["closed", "complete", "completed", "done", "resolved"]);
const contextLimits = {
  asanaTasks: 120,
  artifacts: 80,
  messages: 240,
  persistedRisks: 80,
  riskSignals: 120,
  tasks: 80,
};

function isoDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function truncate(value: string | null | undefined, maxLength: number) {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return normalized.slice(0, maxLength - 3).trimEnd() + "...";
}

function xmlEscape(value: string | number | null | undefined) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function toIso(value: Date | string | number | null | undefined) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") return new Date(value).toISOString();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : value;
  }
  return "";
}

function compactChronologicalRows<T>(rows: T[], limit: number) {
  if (rows.length <= limit) return rows;
  const headCount = Math.max(1, Math.floor(limit * 0.2));
  const tailCount = Math.max(1, limit - headCount);
  return [...rows.slice(0, headCount), ...rows.slice(-tailCount)];
}

function parseJsonRecord(value: string | null | undefined): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value ?? "");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function parseArtifactDate(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed) : null;
}

function artifactDateFallsInWindow(value: string, windowStart: Date, windowEnd: Date) {
  const parsed = parseArtifactDate(value);
  if (!parsed) return false;
  const dayStart = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate(), 0, 0, 0, 0));
  const dayEnd = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate(), 23, 59, 59, 999));
  return dayEnd >= windowStart && dayStart <= windowEnd;
}

function isClosedTaskStatus(status: string | null | undefined) {
  return closedTaskStatuses.has((status ?? "").trim().toLowerCase());
}

function isCompletedAsanaTask(task: AsanaTaskRow) {
  const status = (task.status ?? "").toLowerCase();
  const action = task.action.toLowerCase();
  const changeAction = (task.changeAction ?? "").toLowerCase();
  const changeField = (task.changeField ?? "").toLowerCase();
  return (
    status.includes("complete") ||
    status.includes("closed") ||
    action.includes("complete") ||
    action.includes("closed") ||
    (changeField === "completed" && (changeAction === "changed" || changeAction === "added"))
  );
}

function workspaceModeFromScope(scope: BriefingProjectRow["workspaceScope"]) {
  if (scope === "team") return "Team";
  if (scope === "org") return "Org";
  return "Personal";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function extractTextFromContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => extractTextFromContent(item))
      .filter(Boolean)
      .join("");
  }
  if (!isRecord(value)) return "";

  for (const key of ["text", "content", "response", "output_text", "value"]) {
    const text = extractTextFromContent(value[key]);
    if (text) return text;
  }

  return "";
}

function summarizeAiResponseShape(value: unknown): unknown {
  if (typeof value === "string") return "string";
  if (Array.isArray(value)) return value.slice(0, 3).map((item) => summarizeAiResponseShape(item));
  if (!isRecord(value)) return typeof value;

  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 12)
      .map(([key, nestedValue]) => [
        key,
        Array.isArray(nestedValue)
          ? `array(${nestedValue.length})`
          : isRecord(nestedValue)
            ? Object.keys(nestedValue).slice(0, 8)
            : typeof nestedValue,
      ]),
  );
}

function safeAiErrorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : "Workers AI request failed.";
  if (/<html[\s>]/i.test(raw) || /504 Gateway Time-out/i.test(raw)) {
    return "Workers AI gateway timed out before returning a response.";
  }
  return raw.replace(/\s+/g, " ").trim() || "Workers AI request failed.";
}

function clampReportingWindowHours(value: number | null | undefined) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0 && parsed <= 720) return Math.round(parsed);
  return defaultWindowHours;
}

function parseReportingWindowHours(env: Env) {
  const raw = (env as Env & { BRIEFING_REPORTING_WINDOW_HOURS?: string }).BRIEFING_REPORTING_WINDOW_HOURS;
  return clampReportingWindowHours(Number.parseInt(raw ?? "", 10));
}

function extractAiResponse(result: unknown) {
  if (typeof result === "string") return result.trim();
  if (isRecord(result)) {
    const response = result as WorkersAiTextResult;
    const choice = response.choices?.[0];
    const candidates = [
      extractTextFromContent(response.response),
      extractTextFromContent(response.text),
      extractTextFromContent(response.output_text),
      extractTextFromContent(response.content),
      extractTextFromContent(response.output),
      extractTextFromContent(response.result?.response),
      extractTextFromContent(response.result?.text),
      extractTextFromContent(response.result?.output_text),
      extractTextFromContent(response.result?.content),
      extractTextFromContent(response.result?.output),
      extractTextFromContent(choice?.message?.content),
      extractTextFromContent(choice?.message?.text),
      extractTextFromContent(choice?.delta?.content),
    ];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    }
  }
  return "";
}

function fallbackBriefing(
  project: BriefingProjectRow,
  windowEnd: Date,
  hasActivity: boolean,
  promptInstructions?: string | null,
  failureReason = "Workers AI did not return usable text.",
) {
  const projectName = project.name?.trim() || "{Project Name}";
  const customInstructions = resolveInstructionPlaceholders(promptInstructions, project, windowEnd);
  return [
    `# Weekly Briefing - ${projectName} - ${isoDateKey(windowEnd)}`,
    "",
    "> AI synthesis was unavailable for this run, so this fallback summary could not apply Custom Instructions beyond the static briefing sections.",
    `> Reason: ${failureReason}`,
    customInstructions ? `> Custom Instructions received: ${customInstructions}` : "",
    customInstructions ? "" : "",
    "## Executive Summary",
    hasActivity
      ? "- Review the source activity in this thread; model synthesis was unavailable."
      : "- No activity was identified in the reporting window.",
    "",
    "## Strategic Decisions and Direction",
    "- No strategic decisions could be synthesized while model generation was unavailable.",
    "",
    "## Completed Asana-Linked Work",
    "- No completed Asana tasks were identified in the available source data.",
    "",
    "## Newly Surfaced Risks",
    project.status === "Blocked" || project.status === "Watch"
      ? `- Project status is currently ${project.status}.`
      : "- No elevated risks were identified in the available source data.",
    "",
    "## Modified Artifacts",
    "- No modified artifacts were identified in the available source data.",
    "",
    "## Recommended Next Moves",
    "- Confirm whether follow-up is needed based on the source thread activity.",
  ].join("\n");
}

async function getProjectById(db: AppDb, projectId: string) {
  const [projects] = await db.batch([
    db
      .select({
        id: schema.projects.id,
        workspaceId: schema.projects.workspaceId,
        workspaceName: schema.workspaces.name,
        workspaceScope: schema.workspaces.scope,
        name: schema.projects.name,
        description: schema.projects.description,
        status: schema.projects.status,
      })
      .from(schema.projects)
      .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.projects.workspaceId))
      .where(eq(schema.projects.id, projectId))
      .limit(1),
  ]);
  return projects[0] as BriefingProjectRow | undefined;
}

async function listActiveOrgProjects(db: AppDb) {
  const [projects] = await db.batch([
    db
      .select({
        id: schema.projects.id,
        workspaceId: schema.projects.workspaceId,
        workspaceName: schema.workspaces.name,
        workspaceScope: schema.workspaces.scope,
        name: schema.projects.name,
        description: schema.projects.description,
        status: schema.projects.status,
      })
      .from(schema.projects)
      .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.projects.workspaceId))
      .where(and(eq(schema.workspaces.scope, "org"), inArray(schema.projects.status, ["Active", "In Progress", "Watch", "Blocked"])))
      .orderBy(asc(schema.projects.sortOrder), asc(schema.projects.name)),
  ]);
  return projects as BriefingProjectRow[];
}

async function getOrCreateBriefingsChat(db: AppDb, project: BriefingProjectRow) {
  const chatId = briefingsChatIdForProject(project.id);
  const [existingById, existingByTitle, sortRows] = await db.batch([
    db
      .select({ id: schema.chats.id, description: schema.chats.description })
      .from(schema.chats)
      .where(and(eq(schema.chats.id, chatId), eq(schema.chats.workspaceId, project.workspaceId), eq(schema.chats.projectId, project.id)))
      .limit(1),
    db
      .select({ id: schema.chats.id, description: schema.chats.description })
      .from(schema.chats)
      .where(
        and(
          eq(schema.chats.workspaceId, project.workspaceId),
          eq(schema.chats.projectId, project.id),
          eq(schema.chats.section, "project"),
          eq(schema.chats.title, weeklyBriefingsChatTitle),
        ),
      )
      .limit(1),
    db
      .select({ sortOrder: sql<number>`COALESCE(MAX(${schema.chats.sortOrder}), 0) + 1` })
      .from(schema.chats)
      .where(and(eq(schema.chats.workspaceId, project.workspaceId), eq(schema.chats.projectId, project.id))),
  ]);

  const existing = existingById[0] ?? existingByTitle[0];
  if (existing?.id) {
    if (existing.description !== weeklyBriefingsChatDescription) {
      await db.update(schema.chats).set({ description: weeklyBriefingsChatDescription }).where(eq(schema.chats.id, existing.id));
    }
    return existing.id;
  }

  await db.batch([
    db.insert(schema.chats).values({
      id: chatId,
      workspaceId: project.workspaceId,
      projectId: project.id,
      section: "project",
      title: weeklyBriefingsChatTitle,
      description: weeklyBriefingsChatDescription,
      sortOrder: sortRows[0]?.sortOrder ?? 99,
    }),
  ]);
  return chatId;
}

async function briefingExists(db: AppDb, chatId: string, marker: string) {
  const [rows] = await db.batch([
    db
      .select({ id: schema.chatMessages.id })
      .from(schema.chatMessages)
      .where(and(eq(schema.chatMessages.chatId, chatId), sql`${schema.chatMessages.body} LIKE ${`%${marker}%`}`))
      .limit(1),
  ]);
  return Boolean(rows[0]?.id);
}

async function listModifiedRegistryArtifacts(d1: D1Database, project: BriefingProjectRow, windowStart: Date, windowEnd: Date) {
  try {
    const result = await d1
      .prepare(
        `SELECT id,
                original_filename as title,
                document_type as fileType,
                uploaded_by_user_id as owner,
                status,
                error_message as summary,
                r2_key as r2Key,
                updated_at as updatedAt
         FROM artifacts_registry
         WHERE project_id = ?
           AND updated_at >= ?
           AND updated_at <= ?
         ORDER BY updated_at ASC
         LIMIT ?`,
      )
      .bind(project.id, windowStart.toISOString(), windowEnd.toISOString(), contextLimits.artifacts)
      .all<{
        id: string;
        title: string;
        fileType: string;
        owner: string | null;
        status: string;
        summary: string | null;
        r2Key: string;
        updatedAt: string;
      }>();

    return (result.results ?? []).map(
      (row): ModifiedArtifactRow => ({
        id: row.id,
        title: row.title,
        fileType: row.fileType,
        owner: row.owner,
        status: row.status,
        summary: row.summary ?? "",
        r2Key: row.r2Key,
        version: null,
        parentArtifactId: null,
        commitMessage: "Uploaded artifact registry row updated",
        modifiedAt: row.updatedAt,
        source: "artifacts_registry",
      }),
    );
  } catch {
    return [];
  }
}

async function collectProjectIntelligence(db: AppDb, project: BriefingProjectRow, windowStart: Date, windowEnd: Date, d1: D1Database) {
  const [messages, tasks, asanaTasks, riskSignals, persistedRisks, artifacts] = await db.batch([
    db
      .select({
        id: schema.chatMessages.id,
        chatTitle: schema.chats.title,
        author: schema.chatMessages.author,
        role: schema.chatMessages.role,
        body: schema.chatMessages.body,
        createdAt: schema.chatMessages.createdAt,
      })
      .from(schema.chatMessages)
      .innerJoin(schema.chats, eq(schema.chats.id, schema.chatMessages.chatId))
      .where(
        and(
          eq(schema.chatMessages.workspaceId, project.workspaceId),
          eq(schema.chats.projectId, project.id),
          gte(schema.chatMessages.createdAt, windowStart.toISOString()),
          lte(schema.chatMessages.createdAt, windowEnd.toISOString()),
          sql`${schema.chatMessages.type} <> 'briefing'`,
          sql`LOWER(${schema.chats.title}) NOT IN (${weeklyBriefingsChatTitle.toLowerCase()}, ${legacyDailyBriefingsTitle.toLowerCase()})`,
        ),
      )
      .orderBy(asc(schema.chatMessages.createdAt)),
    db
      .select({
        id: schema.workspaceActions.id,
        title: schema.workspaceActions.title,
        owner: schema.workspaceActions.owner,
        source: schema.workspaceActions.source,
        status: schema.workspaceActions.status,
        asanaTaskGid: schema.workspaceActions.asanaTaskGid,
        createdAt: schema.workspaceActions.createdAt,
      })
      .from(schema.workspaceActions)
      .where(
        and(
          eq(schema.workspaceActions.workspaceId, project.workspaceId),
          eq(schema.workspaceActions.projectId, project.id),
          eq(schema.workspaceActions.kind, "task"),
          sql`${schema.workspaceActions.asanaTaskGid} IS NOT NULL`,
          gte(schema.workspaceActions.createdAt, windowStart),
          lte(schema.workspaceActions.createdAt, windowEnd),
        ),
      )
      .orderBy(asc(schema.workspaceActions.createdAt)),
    db
      .select({
        asanaTaskGid: schema.asanaWebhookTaskStates.asanaTaskGid,
        taskName: schema.asanaWebhookTaskStates.taskName,
        asanaProjectName: schema.asanaProjectMappings.asanaProjectName,
        status: schema.asanaWebhookTaskStates.status,
        action: schema.asanaWebhookTaskStates.action,
        changeAction: schema.asanaWebhookTaskStates.changeAction,
        changeField: schema.asanaWebhookTaskStates.changeField,
        updatedAt: schema.asanaWebhookTaskStates.updatedAt,
      })
      .from(schema.asanaWebhookTaskStates)
      .innerJoin(
        schema.asanaProjectMappings,
        eq(schema.asanaProjectMappings.asanaProjectGid, schema.asanaWebhookTaskStates.asanaProjectGid),
      )
      .where(
        and(
          eq(schema.asanaProjectMappings.vertexProjectId, project.id),
          gte(schema.asanaWebhookTaskStates.updatedAt, windowStart),
          lte(schema.asanaWebhookTaskStates.updatedAt, windowEnd),
        ),
      )
      .orderBy(asc(schema.asanaWebhookTaskStates.updatedAt)),
    db
      .select({
        id: schema.chatMessages.id,
        chatTitle: schema.chats.title,
        author: schema.chatMessages.author,
        body: schema.chatMessages.body,
        createdAt: schema.chatMessages.createdAt,
      })
      .from(schema.chatMessages)
      .innerJoin(schema.chats, eq(schema.chats.id, schema.chatMessages.chatId))
      .where(
        and(
          eq(schema.chatMessages.workspaceId, project.workspaceId),
          gte(schema.chatMessages.createdAt, windowStart.toISOString()),
          lte(schema.chatMessages.createdAt, windowEnd.toISOString()),
          sql`${schema.chatMessages.type} <> 'briefing'`,
          sql`LOWER(${schema.chats.title}) NOT IN (${weeklyBriefingsChatTitle.toLowerCase()}, ${legacyDailyBriefingsTitle.toLowerCase()})`,
          sql`(
          ${schema.chats.projectId} = ${project.id}
          OR ${schema.chats.projectId} IS NULL
        )`,
          sql`(
          LOWER(${schema.chats.title}) LIKE '%risk%'
          OR LOWER(${schema.chats.title}) LIKE '%escalation%'
          OR LOWER(${schema.chatMessages.body}) LIKE '%risk%'
          OR LOWER(${schema.chatMessages.body}) LIKE '%blocked%'
          OR LOWER(${schema.chatMessages.body}) LIKE '%escalat%'
        )`,
        ),
      )
      .orderBy(asc(schema.chatMessages.createdAt)),
    db
      .select({
        id: schema.risks.id,
        title: schema.risks.title,
        description: schema.risks.description,
        severity: schema.risks.severity,
        status: schema.risks.status,
        mitigationStrategy: schema.risks.mitigationStrategy,
      })
      .from(schema.risks)
      .where(and(eq(schema.risks.workspaceId, project.workspaceId), eq(schema.risks.projectId, project.id)))
      .orderBy(asc(schema.risks.severity), asc(schema.risks.title)),
    db
      .select({
        id: schema.artifacts.id,
        title: schema.artifacts.title,
        fileType: schema.artifacts.fileType,
        owner: schema.artifacts.owner,
        artifactDate: schema.artifacts.artifactDate,
        status: schema.artifacts.status,
        summary: schema.artifacts.summary,
        r2Key: schema.artifacts.r2Key,
        href: schema.artifacts.href,
        previewJson: schema.artifacts.previewJson,
        projectId: schema.artifacts.projectId,
        version: schema.artifacts.version,
        parentArtifactId: schema.artifacts.parentArtifactId,
        commitMessage: schema.artifacts.commitMessage,
      })
      .from(schema.artifacts)
      .where(and(eq(schema.artifacts.workspaceId, project.workspaceId), eq(schema.artifacts.projectId, project.id)))
      .orderBy(asc(schema.artifacts.title), asc(schema.artifacts.version)),
  ]);

  const localModifiedArtifacts = (artifacts as ArtifactSourceRow[])
    .filter((artifact) => artifactDateFallsInWindow(artifact.artifactDate, windowStart, windowEnd))
    .map(
      (artifact): ModifiedArtifactRow => ({
        id: artifact.id,
        title: artifact.title,
        fileType: artifact.fileType,
        owner: artifact.owner,
        status: artifact.status,
        summary: artifact.summary,
        r2Key: artifact.r2Key,
        version: artifact.version,
        parentArtifactId: artifact.parentArtifactId,
        commitMessage: artifact.commitMessage,
        modifiedAt: artifact.artifactDate,
        source: "artifacts",
      }),
    );
  const registryArtifacts = await listModifiedRegistryArtifacts(d1, project, windowStart, windowEnd);
  const modifiedArtifacts = [...localModifiedArtifacts, ...registryArtifacts].sort(
    (left, right) => Date.parse(left.modifiedAt) - Date.parse(right.modifiedAt),
  );

  return {
    asanaTasks: (asanaTasks as AsanaTaskRow[]).filter(isCompletedAsanaTask),
    messages: messages as ChatMessageRow[],
    modifiedArtifacts,
    persistedRisks: persistedRisks as PersistedRiskRow[],
    riskSignals: riskSignals as RiskSignalRow[],
    tasks: (tasks as TaskRow[]).filter((task) => task.asanaTaskGid && isClosedTaskStatus(task.status)),
  };
}

function buildXmlContext({
  asanaTasks,
  messages,
  modifiedArtifacts,
  persistedRisks,
  project,
  riskSignals,
  tasks,
  windowEnd,
  windowStart,
}: {
  asanaTasks: AsanaTaskRow[];
  messages: ChatMessageRow[];
  modifiedArtifacts: ModifiedArtifactRow[];
  persistedRisks: PersistedRiskRow[];
  project: BriefingProjectRow;
  riskSignals: RiskSignalRow[];
  tasks: TaskRow[];
  windowEnd: Date;
  windowStart: Date;
}) {
  const compactedMessages = compactChronologicalRows(messages, contextLimits.messages);
  const compactedTasks = compactChronologicalRows(tasks, contextLimits.tasks);
  const compactedAsanaTasks = compactChronologicalRows(asanaTasks, contextLimits.asanaTasks);
  const compactedRiskSignals = compactChronologicalRows(riskSignals, contextLimits.riskSignals);
  const compactedPersistedRisks = compactChronologicalRows(persistedRisks, contextLimits.persistedRisks);
  const compactedArtifacts = compactChronologicalRows(modifiedArtifacts, contextLimits.artifacts);

  return [
    `<briefing_context generated_at="${xmlEscape(windowEnd.toISOString())}">`,
    `  <reporting_window start="${xmlEscape(windowStart.toISOString())}" end="${xmlEscape(windowEnd.toISOString())}" />`,
    "  <source_counts>",
    `    <chat_messages total="${messages.length}" included="${compactedMessages.length}" omitted="${Math.max(0, messages.length - compactedMessages.length)}" />`,
    `    <closed_asana_linked_tasks total="${tasks.length + asanaTasks.length}" workspace_tasks="${tasks.length}" webhook_tasks="${asanaTasks.length}" included="${compactedTasks.length + compactedAsanaTasks.length}" />`,
    `    <risk_signals total="${riskSignals.length}" included="${compactedRiskSignals.length}" omitted="${Math.max(0, riskSignals.length - compactedRiskSignals.length)}" />`,
    `    <risk_register_items total="${persistedRisks.length}" included="${compactedPersistedRisks.length}" />`,
    `    <modified_artifacts total="${modifiedArtifacts.length}" included="${compactedArtifacts.length}" omitted="${Math.max(0, modifiedArtifacts.length - compactedArtifacts.length)}" />`,
    "  </source_counts>",
    "  <project>",
    `    <id>${xmlEscape(project.id)}</id>`,
    `    <name>${xmlEscape(project.name)}</name>`,
    `    <workspace>${xmlEscape(project.workspaceName)}</workspace>`,
    `    <status>${xmlEscape(project.status)}</status>`,
    `    <description>${xmlEscape(project.description)}</description>`,
    "  </project>",
    "  <chat_messages>",
    ...compactedMessages.map((message) =>
      [
        `    <message id="${xmlEscape(message.id)}" chat="${xmlEscape(message.chatTitle)}" role="${xmlEscape(message.role)}" author="${xmlEscape(message.author)}" created_at="${xmlEscape(message.createdAt)}">`,
        `      ${xmlEscape(truncate(message.body, 1200))}`,
        "    </message>",
      ].join("\n"),
    ),
    "  </chat_messages>",
    '  <closed_asana_linked_tasks source="workspace_actions">',
    ...compactedTasks.map((task) =>
      [
        `    <task id="${xmlEscape(task.id)}" asana_gid="${xmlEscape(task.asanaTaskGid)}" status="${xmlEscape(task.status)}" owner="${xmlEscape(task.owner)}" source="${xmlEscape(task.source)}" created_at="${xmlEscape(toIso(task.createdAt))}">`,
        `      <title>${xmlEscape(task.title)}</title>`,
        "    </task>",
      ].join("\n"),
    ),
    "  </closed_asana_linked_tasks>",
    '  <completed_asana_webhook_tasks source="asana_webhook_task_states">',
    ...compactedAsanaTasks.map((task) =>
      [
        `    <task gid="${xmlEscape(task.asanaTaskGid)}" project="${xmlEscape(task.asanaProjectName)}" status="${xmlEscape(task.status)}" action="${xmlEscape(task.action)}" change_action="${xmlEscape(task.changeAction)}" change_field="${xmlEscape(task.changeField)}" updated_at="${xmlEscape(toIso(task.updatedAt))}" completed="true">`,
        `      <name>${xmlEscape(task.taskName)}</name>`,
        "    </task>",
      ].join("\n"),
    ),
    "  </completed_asana_webhook_tasks>",
    '  <new_operational_risk_signals source="chat_messages_and_project_status">',
    `    <project_status>${xmlEscape(project.status)}</project_status>`,
    ...compactedRiskSignals.map((risk) =>
      [
        `    <risk_signal id="${xmlEscape(risk.id)}" chat="${xmlEscape(risk.chatTitle)}" author="${xmlEscape(risk.author)}" created_at="${xmlEscape(risk.createdAt)}">`,
        `      ${xmlEscape(truncate(risk.body, 900))}`,
        "    </risk_signal>",
      ].join("\n"),
    ),
    "  </new_operational_risk_signals>",
    '  <current_project_risk_register source="risks">',
    ...compactedPersistedRisks.map((risk) =>
      [
        `    <risk id="${xmlEscape(risk.id)}" severity="${xmlEscape(risk.severity)}" status="${xmlEscape(risk.status)}">`,
        `      <title>${xmlEscape(risk.title)}</title>`,
        `      <description>${xmlEscape(truncate(risk.description, 700))}</description>`,
        `      <mitigation>${xmlEscape(truncate(risk.mitigationStrategy, 700))}</mitigation>`,
        "    </risk>",
      ].join("\n"),
    ),
    "  </current_project_risk_register>",
    "  <modified_artifacts>",
    ...compactedArtifacts.map((artifact) =>
      [
        `    <artifact id="${xmlEscape(artifact.id)}" source="${xmlEscape(artifact.source)}" type="${xmlEscape(artifact.fileType)}" status="${xmlEscape(artifact.status)}" owner="${xmlEscape(artifact.owner)}" version="${xmlEscape(artifact.version)}" parent_id="${xmlEscape(artifact.parentArtifactId)}" modified_at="${xmlEscape(artifact.modifiedAt)}">`,
        `      <title>${xmlEscape(artifact.title)}</title>`,
        `      <summary>${xmlEscape(truncate(artifact.summary, 700))}</summary>`,
        `      <commit_message>${xmlEscape(truncate(artifact.commitMessage, 240))}</commit_message>`,
        `      <r2_key>${xmlEscape(artifact.r2Key)}</r2_key>`,
        "    </artifact>",
      ].join("\n"),
    ),
    "  </modified_artifacts>",
    "</briefing_context>",
  ].join("\n");
}

function buildSystemPrompt(project: BriefingProjectRow, windowEnd: Date, promptInstructions?: string | null) {
  const sharedRules = [
    "You are a Chief of Staff preparing the Weekly Briefing for senior Vertex Education stakeholders.",
    "Synthesize only the XML context provided. Do not invent owners, dates, risks, decisions, Asana completions, or project facts.",
    "Use a strategic lens across the preceding seven-day reporting window: identify decisions that matter, completed Asana-linked work, newly surfaced operational risks, and modified artifacts.",
    "Treat source_counts as coverage metadata. If rows were omitted by compaction, summarize that limitation in Source Coverage without speculating about omitted details.",
    "Return Markdown only.",
    "Use valid Markdown with real line breaks between the title, sections, paragraphs, and bullets. Do not return a single compressed paragraph.",
    "Prefer crisp executive bullets with concrete evidence, source names, and dates when available. If a section has no evidence, state that directly in one bullet.",
  ];
  const defaultStructure = [
    "Use these headings in this order:",
    `# Weekly Briefing - ${project.name?.trim() || "Project"} - ${isoDateKey(windowEnd)}`,
    "## Executive Summary",
    "## Strategic Decisions and Direction",
    "## Completed Asana-Linked Work",
    "## Newly Surfaced Risks",
    "## Modified Artifacts",
    "## Recommended Next Moves",
    "## Source Coverage",
  ];
  const extra = formatCustomInstructionTemplate(resolveInstructionPlaceholders(promptInstructions, project, windowEnd));
  return extra
    ? [
        ...sharedRules,
        "Custom Instructions are the controlling output template. Use only the sections, labels, and order requested in Custom Instructions. Do not add default briefing sections unless the Custom Instructions ask for them.",
        "User-friendly template conversion has already been applied: plain label lines are section headers, Title: becomes the main title, and parenthetical guidance below a label is instruction text.",
        "Template placeholder handling:",
        "Placeholders in braces are requested fields to fill. Known placeholders such as {Project Name}, {Date}, {MM/DD/YY}, {Workspace}, and {Project Status} have been resolved below when the system has those values. For any remaining placeholder, fill it only from the XML context. If the XML does not support a value, leave that value blank rather than guessing.",
        "Custom Instructions:",
        "Treat the following Custom Instructions as schedule-specific direction for tone, emphasis, audience, and additional sections. Follow them unless they conflict with the XML-only evidence rule, the required Markdown-only output, or factual accuracy.",
        extra,
      ].join("\n")
    : [...sharedRules, ...defaultStructure].join("\n");
}

type BriefingAiAttempt = {
  label: string;
  maxCompletionTokens: number;
  reasoningEffort?: "high" | "medium" | "low";
  thinking: boolean;
  temperature: number;
};

const briefingAiAttempts: BriefingAiAttempt[] = [
  {
    label: "high-reasoning",
    maxCompletionTokens: 8192,
    reasoningEffort: "high",
    thinking: true,
    temperature: 0.2,
  },
  {
    label: "concise-high-reasoning-retry",
    maxCompletionTokens: 4096,
    reasoningEffort: "high",
    thinking: true,
    temperature: 0.1,
  },
];

async function runBriefingAiAttempt(
  env: Env,
  project: BriefingProjectRow,
  windowEnd: Date,
  contextXml: string,
  promptInstructions: string | null | undefined,
  attempt: BriefingAiAttempt,
) {
  return runAiGateway(
    env.AI,
    vertexAiModelId,
    {
      messages: [
        { role: "system", content: buildSystemPrompt(project, windowEnd, promptInstructions) },
        { role: "user", content: contextXml },
      ],
      max_completion_tokens: attempt.maxCompletionTokens,
      reasoningLevel: attempt.reasoningEffort ?? "low",
      reasoning_effort: attempt.reasoningEffort,
      timeoutMs: attempt.label === "high-reasoning" ? 120_000 : 75_000,
      chat_template_kwargs: {
        enable_thinking: attempt.thinking,
        thinking: attempt.thinking,
      },
      temperature: attempt.temperature,
    },
    {
      env,
      identity: {
        userId: "system",
        workspaceId: project.workspaceId,
        projectId: project.id,
        scopeType: "weekly-briefing",
      },
      metadata: {
        feature: "weekly-briefing-synthesis",
        userId: "system",
        projectId: project.id,
        workspaceId: project.workspaceId,
        attempt: attempt.label,
      },
      skipCache: true,
    },
  );
}

async function generateBriefingMarkdown({
  contextXml,
  env,
  project,
  windowEnd,
  hasActivity,
  promptInstructions,
}: {
  contextXml: string;
  env: Env;
  project: BriefingProjectRow;
  windowEnd: Date;
  hasActivity: boolean;
  promptInstructions?: string | null;
}) {
  const failures: string[] = [];
  for (const attempt of briefingAiAttempts) {
    try {
      const result = await runBriefingAiAttempt(env, project, windowEnd, contextXml, promptInstructions, attempt);
      const markdown = extractAiResponse(result);
      if (markdown) return normalizeBriefingMarkdown(markdown);
      const responseShape = JSON.stringify(summarizeAiResponseShape(result));
      failures.push(`${attempt.label}: no final text; response shape ${responseShape}`);
      console.warn("[DailyBriefings] Workers AI returned an empty briefing response.", {
        projectId: project.id,
        model: vertexAiModelId,
        attempt: attempt.label,
        responseShape,
      });
    } catch (error) {
      const message = safeAiErrorMessage(error);
      failures.push(`${attempt.label}: ${message}`);
      console.warn("[DailyBriefings] Workers AI briefing generation attempt failed.", {
        projectId: project.id,
        model: vertexAiModelId,
        attempt: attempt.label,
        message,
      });
    }
  }
  return fallbackBriefing(project, windowEnd, hasActivity, promptInstructions, failures.join(" | "));
}

export async function generateBriefingPreview(env: Env, input: BriefingGenerationInput) {
  if (!env.DB || !env.AI) {
    throw new Error("DB or AI binding is unavailable.");
  }

  const db = drizzle(env.DB, { schema });
  const scheduledAt = input.scheduledAt ?? new Date();
  const project = await getProjectById(db, input.projectId);
  if (!project) throw new Error("Briefing project was not found.");
  if (input.workspaceId && input.workspaceId !== project.workspaceId)
    throw new Error("Briefing project does not belong to the selected workspace.");

  const reportingWindowHours = clampReportingWindowHours(input.reportingWindowHours);
  const windowStart = new Date(scheduledAt.getTime() - reportingWindowHours * 60 * 60 * 1000);
  const intelligence = await collectProjectIntelligence(db, project, windowStart, scheduledAt, env.DB);
  const hasActivity =
    intelligence.messages.length > 0 ||
    intelligence.tasks.length > 0 ||
    intelligence.asanaTasks.length > 0 ||
    intelligence.riskSignals.length > 0 ||
    intelligence.persistedRisks.length > 0 ||
    intelligence.modifiedArtifacts.length > 0;
  const contextXml = buildXmlContext({ ...intelligence, project, windowEnd: scheduledAt, windowStart });
  const markdown = await generateBriefingMarkdown({
    contextXml,
    env,
    project,
    windowEnd: scheduledAt,
    hasActivity,
    promptInstructions: input.promptInstructions,
  });

  return {
    contextXml,
    markdown,
    project,
    windowEnd: scheduledAt.toISOString(),
    windowStart: windowStart.toISOString(),
    counts: {
      messages: intelligence.messages.length,
      tasks: intelligence.tasks.length,
      asanaTasks: intelligence.asanaTasks.length,
      riskSignals: intelligence.riskSignals.length,
      risks: intelligence.persistedRisks.length,
      modifiedArtifacts: intelligence.modifiedArtifacts.length,
    },
  };
}

async function insertBriefingMessage(
  db: AppDb,
  chatId: string,
  project: BriefingProjectRow,
  marker: string,
  body: string,
  scheduledAt: Date,
  source: "cloudflare-cron" | "manual-test",
) {
  const id = `scheduled-briefing-msg-${project.id}-${isoDateKey(scheduledAt)}-${crypto.randomUUID()}`;
  await db.batch([
    db.insert(schema.chatMessages).values({
      id,
      chatId,
      parentId: null,
      workspaceId: project.workspaceId,
      author: briefingAuthor,
      role: "assistant",
      type: "briefing",
      avatar: null,
      messageTime: utcTimeLabel(scheduledAt),
      body: `${marker}\n${body}`.trim(),
      artifactTitle: null,
      artifactType: null,
      artifactMeta: JSON.stringify({
        type: "briefing",
        briefingKind: "weekly",
        generatedBy: source,
        model: vertexAiModelId,
        readOnlyThread: true,
        scheduledAt: scheduledAt.toISOString(),
      }),
      attachmentsJson: null,
      createdAt: scheduledAt.toISOString(),
    }),
  ]);
  return id;
}

async function resolveBriefingEventTeamId(db: AppDb, project: BriefingProjectRow, sourceUserId: string) {
  if (project.workspaceScope !== "team") return null;
  const [rows] = await db.batch([
    db
      .select({ teamId: schema.projectMembers.teamId })
      .from(schema.projectMembers)
      .where(and(eq(schema.projectMembers.projectId, project.id), eq(schema.projectMembers.userId, sourceUserId)))
      .limit(1),
  ]);
  return rows[0]?.teamId ?? null;
}

async function recordBriefingAvailableEvent(
  d1: D1Database,
  db: AppDb,
  project: BriefingProjectRow,
  chatId: string,
  chatMessageId: string,
  sourceUserId: string | null | undefined,
) {
  if (!sourceUserId) return;
  try {
    await recordRealtimeMutationEvent(d1, {
      chatId,
      entity: "chat_message",
      entityId: chatMessageId,
      invalidates: ["chats", "projects"],
      mode: workspaceModeFromScope(project.workspaceScope),
      operation: "insert",
      projectId: project.id,
      sourceClientId: null,
      sourceUserId,
      teamId: await resolveBriefingEventTeamId(db, project, sourceUserId),
      workspaceId: project.workspaceId,
    });
  } catch (error) {
    console.warn("[DailyBriefings] Briefing SSE mutation event was not recorded.", {
      chatMessageId,
      projectId: project.id,
      message: error instanceof Error ? error.message : "Unknown realtime event error.",
    });
  }
}

export async function postBriefing(
  env: Env,
  input: BriefingGenerationInput & { markdown?: string | null; source?: "cloudflare-cron" | "manual-test" },
) {
  if (!env.DB || !env.AI) {
    throw new Error("DB or AI binding is unavailable.");
  }

  const db = drizzle(env.DB, { schema });
  const scheduledAt = input.scheduledAt ?? new Date();
  const project = await getProjectById(db, input.projectId);
  if (!project) throw new Error("Briefing project was not found.");

  const markdown = input.markdown?.trim() || (await generateBriefingPreview(env, input)).markdown;
  const chatId = await getOrCreateBriefingsChat(db, project);
  const marker = input.markerKey
    ? `<!-- scheduled-briefing:${input.markerKey} -->`
    : `<!-- scheduled-briefing:${project.id}:${scheduledAt.toISOString()} -->`;
  if (await briefingExists(db, chatId, marker)) return { chatId, chatMessageId: null, skipped: true };

  const chatMessageId = await insertBriefingMessage(db, chatId, project, marker, markdown, scheduledAt, input.source ?? "manual-test");
  await recordBriefingAvailableEvent(env.DB, db, project, chatId, chatMessageId, input.sourceUserId);
  return { chatId, chatMessageId, skipped: false };
}

export function computeNextRunAfter(schedule: Pick<BriefingScheduleRow, "recurrence" | "runOnceAt" | "enabled">, after: Date) {
  return computeNextRunAtForSchedule(schedule as BriefingScheduleRow, after);
}

function parseWeekdays(value: string | null | undefined) {
  try {
    const parsed = JSON.parse(value ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6) : [];
  } catch {
    return [];
  }
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

function computeNextRunAtForSchedule(schedule: BriefingScheduleRow, after: Date) {
  if (!schedule.enabled) return null;
  if (schedule.recurrence === "once") return schedule.runOnceAt && schedule.runOnceAt > after ? schedule.runOnceAt : null;

  const [hourText, minuteText] = schedule.localTime.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const timeZone = schedule.timeZone || "America/New_York";
  const afterLocal = getTimeZoneParts(new Date(after.getTime() + 60 * 1000), timeZone);

  if (schedule.recurrence === "monthly") {
    const preferredDay = schedule.monthDay ?? 1;
    for (let offset = 0; offset < 24; offset += 1) {
      const { year, month } = addMonths(afterLocal.year, afterLocal.month, offset);
      const day = Math.min(preferredDay, daysInMonth(year, month));
      const candidate = localDateTimeToUtc(timeZone, year, month, day, hour, minute);
      if (candidate > after) return candidate;
    }
    return null;
  }

  const weekdays = parseWeekdays(schedule.weekdaysJson);
  const allowedDays =
    schedule.recurrence === "daily"
      ? [0, 1, 2, 3, 4, 5, 6]
      : schedule.recurrence === "weekdays"
        ? [1, 2, 3, 4, 5]
        : weekdays.length
          ? weekdays
          : [weekdayForDate(afterLocal.year, afterLocal.month, afterLocal.day)];

  for (let offset = 0; offset < 370; offset += 1) {
    const { year, month, day } = addDays(afterLocal.year, afterLocal.month, afterLocal.day, offset);
    if (!allowedDays.includes(weekdayForDate(year, month, day))) continue;
    const candidate = localDateTimeToUtc(timeZone, year, month, day, hour, minute);
    if (candidate > after) return candidate;
  }
  return null;
}

async function runSchedule(db: AppDb, env: Env, schedule: BriefingScheduleRow, scheduledAt: Date) {
  const runId = `briefing-run-${crypto.randomUUID()}`;
  try {
    if (!schedule.projectId) throw new Error("Schedule does not have a project selected.");
    const reportingWindowHours = schedule.recurrence === "weekly" ? defaultWindowHours : schedule.reportingWindowHours;
    const preview = await generateBriefingPreview(env, {
      projectId: schedule.projectId,
      workspaceId: schedule.workspaceId,
      chatId: schedule.chatId,
      title: schedule.title,
      reportingWindowHours,
      promptInstructions: schedule.promptInstructions,
      scheduledAt,
      markerKey: `${schedule.id}:${scheduledAt.toISOString()}`,
    });
    const postResult = await postBriefing(env, {
      projectId: schedule.projectId,
      workspaceId: schedule.workspaceId,
      chatId: null,
      title: schedule.title,
      reportingWindowHours,
      promptInstructions: schedule.promptInstructions,
      scheduledAt,
      markerKey: `${schedule.id}:${scheduledAt.toISOString()}`,
      markdown: preview.markdown,
      source: "cloudflare-cron",
      sourceUserId: schedule.userId,
    });
    const nextRunAt = computeNextRunAfter(schedule, scheduledAt);
    await db.batch([
      db.insert(schema.briefingRuns).values({
        id: runId,
        scheduleId: schedule.id,
        chatMessageId: postResult.chatMessageId,
        trigger: "scheduled",
        status: "success",
        outputMarkdown: preview.markdown,
        error: null,
        createdAt: scheduledAt,
      }),
      db
        .update(schema.briefingSchedules)
        .set({
          enabled: schedule.recurrence === "once" ? false : schedule.enabled,
          nextRunAt,
          lastRunAt: scheduledAt,
          lastStatus: postResult.skipped ? "skipped" : "success",
          lastError: null,
          updatedAt: scheduledAt,
        })
        .where(eq(schema.briefingSchedules.id, schedule.id)),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown scheduled briefing error.";
    const nextRunAt = schedule.recurrence === "once" ? null : computeNextRunAfter(schedule, scheduledAt);
    await db.batch([
      db.insert(schema.briefingRuns).values({
        id: runId,
        scheduleId: schedule.id,
        chatMessageId: null,
        trigger: "scheduled",
        status: "error",
        outputMarkdown: null,
        error: message,
        createdAt: scheduledAt,
      }),
      db
        .update(schema.briefingSchedules)
        .set({
          enabled: schedule.recurrence === "once" ? false : schedule.enabled,
          nextRunAt,
          lastRunAt: scheduledAt,
          lastStatus: "error",
          lastError: message,
          updatedAt: scheduledAt,
        })
        .where(eq(schema.briefingSchedules.id, schedule.id)),
    ]);
    console.error("[DailyBriefings] Schedule failed.", { scheduleId: schedule.id, message });
  }
}

export async function runDueBriefingSchedules(env: Env, scheduledTime: number = Date.now()) {
  if (!env.DB || !env.AI) {
    console.warn("[DailyBriefings] DB or AI binding is unavailable; skipping scheduled briefings.");
    return;
  }

  const db = drizzle(env.DB, { schema });
  const scheduledAt = new Date(scheduledTime);
  const [dueSchedules] = await db.batch([
    db
      .select()
      .from(schema.briefingSchedules)
      .where(
        and(
          eq(schema.briefingSchedules.enabled, true),
          or(
            lte(schema.briefingSchedules.nextRunAt, scheduledAt),
            and(eq(schema.briefingSchedules.recurrence, "once"), lte(schema.briefingSchedules.runOnceAt, scheduledAt)),
          ),
        ),
      )
      .orderBy(asc(schema.briefingSchedules.nextRunAt))
      .limit(25),
  ]);

  for (const schedule of dueSchedules) {
    await runSchedule(db, env, schedule, scheduledAt);
  }
}

export async function runDailyProjectBriefings(env: Env, scheduledTime: number = Date.now()) {
  await runDueBriefingSchedules(env, scheduledTime);
}

export async function runLegacyOrgBriefings(env: Env, scheduledTime: number = Date.now()) {
  if (!env.DB || !env.AI) return;
  const db = drizzle(env.DB, { schema });
  const scheduledAt = new Date(scheduledTime);
  const reportingWindowHours = parseReportingWindowHours(env);
  const projects = await listActiveOrgProjects(db);
  for (const project of projects) {
    try {
      const chatId = await getOrCreateBriefingsChat(db, project);
      const markerKey = `legacy:${project.id}:${isoDateKey(scheduledAt)}:${reportingWindowHours}h`;
      if (await briefingExists(db, chatId, `<!-- scheduled-briefing:${markerKey} -->`)) continue;
      const preview = await generateBriefingPreview(env, {
        projectId: project.id,
        workspaceId: project.workspaceId,
        chatId,
        reportingWindowHours,
        scheduledAt,
        markerKey,
      });
      await postBriefing(env, {
        projectId: project.id,
        workspaceId: project.workspaceId,
        chatId,
        reportingWindowHours,
        scheduledAt,
        markerKey,
        markdown: preview.markdown,
        source: "cloudflare-cron",
      });
    } catch (error) {
      console.error("[DailyBriefings] Legacy project briefing failed.", {
        projectId: project.id,
        message: error instanceof Error ? error.message : "Unknown daily briefing error.",
      });
    }
  }
}
