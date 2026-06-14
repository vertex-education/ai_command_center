import { and, asc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../../db/schema";
import { runAiGateway } from "@/lib/ai-gateway";
import { vertexAiModelId } from "@/lib/prompts";

type AppDb = DrizzleD1Database<typeof schema>;

export type BriefingScheduleRow = typeof schema.briefingSchedules.$inferSelect;

type BriefingProjectRow = {
  id: string;
  workspaceId: string;
  workspaceName: string;
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

type BriefingGenerationInput = {
  projectId: string;
  workspaceId?: string | null;
  chatId?: string | null;
  title?: string | null;
  reportingWindowHours: number;
  promptInstructions?: string | null;
  scheduledAt?: Date;
  markerKey?: string | null;
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

const dailyBriefingsTitle = "Daily Briefings";
const briefingAuthor = "Vertex AI Command Center";
const defaultWindowHours = 24;

function isoDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function shortDateKey(date: Date) {
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const year = String(date.getUTCFullYear()).slice(-2);
  return `${month}/${day}/${year}`;
}

function utcTimeLabel(date: Date) {
  return date.toISOString().slice(11, 16) + " UTC";
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
      .map(([key, nestedValue]) => [key, Array.isArray(nestedValue) ? `array(${nestedValue.length})` : isRecord(nestedValue) ? Object.keys(nestedValue).slice(0, 8) : typeof nestedValue]),
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

function resolveInstructionPlaceholders(promptInstructions: string | null | undefined, project: BriefingProjectRow, windowEnd: Date) {
  const instructions = promptInstructions?.trim();
  if (!instructions) return "";

  const projectName = project.name?.trim();
  const workspaceName = project.workspaceName?.trim();
  const values: Record<string, string | undefined> = {
    "project name": projectName,
    project: projectName,
    "workspace name": workspaceName,
    workspace: workspaceName,
    "project status": project.status?.trim(),
    status: project.status?.trim(),
    date: isoDateKey(windowEnd),
    "yyyy-mm-dd": isoDateKey(windowEnd),
    "mm/dd/yy": shortDateKey(windowEnd),
    "mm/dd/yyyy": `${String(windowEnd.getUTCMonth() + 1).padStart(2, "0")}/${String(windowEnd.getUTCDate()).padStart(2, "0")}/${windowEnd.getUTCFullYear()}`,
    time: utcTimeLabel(windowEnd),
  };

  return instructions.replace(/\{([^{}]+)\}/g, (match, rawKey: string) => {
    const key = rawKey.trim().toLowerCase();
    return values[key] || match;
  });
}

function formatCustomInstructionTemplate(instructions: string) {
  const lines = instructions.replace(/\r/g, "\n").split("\n");
  const formatted: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      formatted.push("");
      continue;
    }

    const titleMatch = line.match(/^title\s*:\s*(.+)$/i);
    if (titleMatch?.[1]) {
      formatted.push(`# ${titleMatch[1].trim()}`);
      continue;
    }

    const parentheticalMatch = line.match(/^([A-Z][A-Za-z0-9 /&-]{1,70})\s*\((.+)\)$/);
    if (parentheticalMatch?.[1] && parentheticalMatch[2]) {
      formatted.push(`## ${parentheticalMatch[1].trim()}`);
      formatted.push(parentheticalMatch[2].trim());
      continue;
    }

    const sentenceLike = /[.!?]$/.test(line) || /\b(the|a|an|and|or|but|because|based|choose|give|summarize|list|include)\b/i.test(line);
    const alreadyFormatted = /^(#{1,6}\s+|- |\* |\d+\. )/.test(line);
    if (!alreadyFormatted && !sentenceLike && line.length <= 80) {
      formatted.push(`## ${line.replace(/:$/, "")}`);
      continue;
    }

    formatted.push(line);
  }

  return formatted
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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

function normalizeBriefingMarkdown(markdown: string) {
  const sectionLabels = new Set([
    "status",
    "status summary",
    "risks",
    "decisions requiring executive input",
    "decisions made within workstream scope",
    "completed asana tasks",
    "key strategic decisions",
    "elevated project risks",
    "recommended next moves",
  ]);

  return markdown
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/([^\n])\s+(#{1,6}\s+)/g, "$1\n\n$2")
    .replace(/([^\n])\s+(\*\*[^*\n]+:\*\*)/g, "$1\n\n$2")
    .replace(/(\S)\s+(Status:\s*)/g, "$1\n\n$2")
    .replace(/([^\n])\s+([-*]\s+\*\*)/g, "$1\n$2")
    .replace(/([^\n])\s+([-*]\s+[A-Z][^:\n]{2,80}:)/g, "$1\n$2")
    .replace(/(\S)\s+(Status Summary:)/g, "$1\n\n$2")
    .replace(/(\S)\s+(Decisions Requiring Executive Input)/g, "$1\n\n$2")
    .replace(/(\S)\s+(Decisions Made Within Workstream Scope)/g, "$1\n\n$2")
    .split("\n")
    .map((line, index) => {
      const trimmed = line.trim();
      if (!trimmed || /^#{1,6}\s+/.test(trimmed) || /^[-*]\s+/.test(trimmed)) return line;
      const normalized = trimmed.replace(/:$/, "").toLowerCase();
      if (index > 0 && sectionLabels.has(normalized)) return `## ${trimmed.replace(/:$/, "")}`;
      return line;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function fallbackBriefing(project: BriefingProjectRow, windowEnd: Date, hasActivity: boolean, promptInstructions?: string | null, failureReason = "Workers AI did not return usable text.") {
  const projectName = project.name?.trim() || "{Project Name}";
  const customInstructions = resolveInstructionPlaceholders(promptInstructions, project, windowEnd);
  return [
    `# Chief of Staff Briefing - ${projectName} - ${isoDateKey(windowEnd)}`,
    "",
    "> AI synthesis was unavailable for this run, so this fallback summary could not apply Custom Instructions beyond the static briefing sections.",
    `> Reason: ${failureReason}`,
    customInstructions ? `> Custom Instructions received: ${customInstructions}` : "",
    customInstructions ? "" : "",
    "## Strategic Decisions",
    hasActivity ? "- Review the source activity in this thread; model synthesis was unavailable." : "- No new strategic decisions were identified in the reporting window.",
    "",
    "## Completed Asana Tasks",
    "- No completed Asana tasks were identified in the available source data.",
    "",
    "## Elevated Project Risks",
    project.status === "Blocked" || project.status === "Watch"
      ? `- Project status is currently ${project.status}.`
      : "- No elevated risks were identified in the available source data.",
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
        name: schema.projects.name,
        description: schema.projects.description,
        status: schema.projects.status,
      })
      .from(schema.projects)
      .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.projects.workspaceId))
      .where(and(
        eq(schema.workspaces.scope, "org"),
        inArray(schema.projects.status, ["Active", "In Progress", "Watch", "Blocked"]),
      ))
      .orderBy(asc(schema.projects.sortOrder), asc(schema.projects.name)),
  ]);
  return projects as BriefingProjectRow[];
}

async function getOrCreateDailyBriefingsChat(db: AppDb, project: BriefingProjectRow, preferredChatId?: string | null) {
  if (preferredChatId) {
    const [rows] = await db.batch([
      db
        .select({ id: schema.chats.id })
        .from(schema.chats)
        .where(and(
          eq(schema.chats.id, preferredChatId),
          eq(schema.chats.workspaceId, project.workspaceId),
          eq(schema.chats.projectId, project.id),
        ))
        .limit(1),
    ]);
    if (rows[0]?.id) return rows[0].id;
  }

  const [existing, sortRows] = await db.batch([
    db
      .select({ id: schema.chats.id })
      .from(schema.chats)
      .where(and(
        eq(schema.chats.workspaceId, project.workspaceId),
        eq(schema.chats.projectId, project.id),
        eq(schema.chats.section, "project"),
        eq(schema.chats.title, dailyBriefingsTitle),
      ))
      .limit(1),
    db
      .select({ sortOrder: sql<number>`COALESCE(MAX(${schema.chats.sortOrder}), 0) + 1` })
      .from(schema.chats)
      .where(and(
        eq(schema.chats.workspaceId, project.workspaceId),
        eq(schema.chats.projectId, project.id),
      )),
  ]);

  if (existing[0]?.id) return existing[0].id;

  const chatId = `daily-briefings-${project.id}`;
  await db.batch([
    db.insert(schema.chats).values({
      id: chatId,
      workspaceId: project.workspaceId,
      projectId: project.id,
      section: "project",
      title: dailyBriefingsTitle,
      description: "Automated executive summaries generated by the scheduled Worker.",
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
      .where(and(
        eq(schema.chatMessages.chatId, chatId),
        sql`${schema.chatMessages.body} LIKE ${`%${marker}%`}`,
      ))
      .limit(1),
  ]);
  return Boolean(rows[0]?.id);
}

async function collectProjectIntelligence(db: AppDb, project: BriefingProjectRow, windowStart: Date) {
  const [messages, tasks, asanaTasks, riskSignals] = await db.batch([
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
      .where(and(
        eq(schema.chatMessages.workspaceId, project.workspaceId),
        eq(schema.chats.projectId, project.id),
        gte(schema.chatMessages.createdAt, windowStart.toISOString()),
        sql`${schema.chats.title} <> ${dailyBriefingsTitle}`,
      ))
      .orderBy(asc(schema.chatMessages.createdAt)),
    db
      .select({
        id: schema.workspaceActions.id,
        title: schema.workspaceActions.title,
        owner: schema.workspaceActions.owner,
        source: schema.workspaceActions.source,
        status: schema.workspaceActions.status,
        createdAt: schema.workspaceActions.createdAt,
      })
      .from(schema.workspaceActions)
      .where(and(
        eq(schema.workspaceActions.workspaceId, project.workspaceId),
        eq(schema.workspaceActions.projectId, project.id),
        eq(schema.workspaceActions.kind, "task"),
        gte(schema.workspaceActions.createdAt, windowStart),
      ))
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
      .where(and(
        eq(schema.asanaProjectMappings.vertexProjectId, project.id),
        gte(schema.asanaWebhookTaskStates.updatedAt, windowStart),
      ))
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
      .where(and(
        eq(schema.chatMessages.workspaceId, project.workspaceId),
        gte(schema.chatMessages.createdAt, windowStart.toISOString()),
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
      ))
      .orderBy(asc(schema.chatMessages.createdAt)),
  ]);

  return {
    asanaTasks: asanaTasks as AsanaTaskRow[],
    messages: messages as ChatMessageRow[],
    riskSignals: riskSignals as RiskSignalRow[],
    tasks: tasks as TaskRow[],
  };
}

function buildXmlContext({
  asanaTasks,
  messages,
  project,
  riskSignals,
  tasks,
  windowEnd,
  windowStart,
}: {
  asanaTasks: AsanaTaskRow[];
  messages: ChatMessageRow[];
  project: BriefingProjectRow;
  riskSignals: RiskSignalRow[];
  tasks: TaskRow[];
  windowEnd: Date;
  windowStart: Date;
}) {
  const completedAsanaTasks = asanaTasks.filter((task) => {
    const status = (task.status ?? "").toLowerCase();
    return status.includes("complete") || task.changeField === "completed" || task.changeAction === "changed";
  });

  return [
    `<briefing_context generated_at="${xmlEscape(windowEnd.toISOString())}">`,
    `  <reporting_window start="${xmlEscape(windowStart.toISOString())}" end="${xmlEscape(windowEnd.toISOString())}" />`,
    "  <project>",
    `    <id>${xmlEscape(project.id)}</id>`,
    `    <name>${xmlEscape(project.name)}</name>`,
    `    <workspace>${xmlEscape(project.workspaceName)}</workspace>`,
    `    <status>${xmlEscape(project.status)}</status>`,
    `    <description>${xmlEscape(project.description)}</description>`,
    "  </project>",
    "  <chat_messages>",
    ...messages.map((message) => [
      `    <message id="${xmlEscape(message.id)}" chat="${xmlEscape(message.chatTitle)}" role="${xmlEscape(message.role)}" author="${xmlEscape(message.author)}" created_at="${xmlEscape(message.createdAt)}">`,
      `      ${xmlEscape(truncate(message.body, 900))}`,
      "    </message>",
    ].join("\n")),
    "  </chat_messages>",
    "  <tasks source=\"workspace_actions\">",
    ...tasks.map((task) => [
      `    <task id="${xmlEscape(task.id)}" status="${xmlEscape(task.status)}" owner="${xmlEscape(task.owner)}" source="${xmlEscape(task.source)}" created_at="${xmlEscape(task.createdAt.toISOString())}">`,
      `      <title>${xmlEscape(task.title)}</title>`,
      "    </task>",
    ].join("\n")),
    "  </tasks>",
    "  <asana_tasks>",
    ...asanaTasks.map((task) => [
      `    <task gid="${xmlEscape(task.asanaTaskGid)}" project="${xmlEscape(task.asanaProjectName)}" status="${xmlEscape(task.status)}" action="${xmlEscape(task.action)}" change_action="${xmlEscape(task.changeAction)}" change_field="${xmlEscape(task.changeField)}" updated_at="${xmlEscape(task.updatedAt.toISOString())}" completed="${completedAsanaTasks.includes(task) ? "true" : "false"}">`,
      `      <name>${xmlEscape(task.taskName)}</name>`,
      "    </task>",
    ].join("\n")),
    "  </asana_tasks>",
    "  <risks source=\"risk_chats_and_status\">",
    `    <project_status>${xmlEscape(project.status)}</project_status>`,
    ...riskSignals.map((risk) => [
      `    <risk_signal id="${xmlEscape(risk.id)}" chat="${xmlEscape(risk.chatTitle)}" author="${xmlEscape(risk.author)}" created_at="${xmlEscape(risk.createdAt)}">`,
      `      ${xmlEscape(truncate(risk.body, 700))}`,
      "    </risk_signal>",
    ].join("\n")),
    "  </risks>",
    "</briefing_context>",
  ].join("\n");
}

function buildSystemPrompt(project: BriefingProjectRow, windowEnd: Date, promptInstructions?: string | null) {
  const sharedRules = [
    "You are a Chief of Staff preparing a concise executive briefing for senior Vertex Education stakeholders.",
    "Synthesize only the XML context provided. Do not invent owners, dates, risks, decisions, Asana completions, or project facts.",
    "Use a strategic lens: identify decisions that matter, completed Asana work, and risks that should be escalated.",
    "Return Markdown only.",
    "Use valid Markdown with real line breaks between the title, sections, paragraphs, and bullets. Do not return a single compressed paragraph.",
    "Prefer crisp bullets with concrete evidence. If a section has no evidence, state that directly in one bullet.",
  ];
  const defaultStructure = [
    "Use these headings in this order:",
    "# Scheduled Intelligence Briefing",
    "## Key Strategic Decisions",
    "## Completed Asana Tasks",
    "## Elevated Project Risks",
    "## Recommended Next Moves",
  ];
  const extra = formatCustomInstructionTemplate(resolveInstructionPlaceholders(promptInstructions, project, windowEnd));
  return extra ? [
    ...sharedRules,
    "Custom Instructions are the controlling output template. Use only the sections, labels, and order requested in Custom Instructions. Do not add default briefing sections unless the Custom Instructions ask for them.",
    "User-friendly template conversion has already been applied: plain label lines are section headers, Title: becomes the main title, and parenthetical guidance below a label is instruction text.",
    "Template placeholder handling:",
    "Placeholders in braces are requested fields to fill. Known placeholders such as {Project Name}, {Date}, {MM/DD/YY}, {Workspace}, and {Project Status} have been resolved below when the system has those values. For any remaining placeholder, fill it only from the XML context. If the XML does not support a value, leave that value blank rather than guessing.",
    "Custom Instructions:",
    "Treat the following Custom Instructions as schedule-specific direction for tone, emphasis, audience, and additional sections. Follow them unless they conflict with the XML-only evidence rule, the required Markdown-only output, or factual accuracy.",
    extra,
  ].join("\n") : [...sharedRules, ...defaultStructure].join("\n");
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

async function runBriefingAiAttempt(env: Env, project: BriefingProjectRow, windowEnd: Date, contextXml: string, promptInstructions: string | null | undefined, attempt: BriefingAiAttempt) {
  return runAiGateway(env.AI, vertexAiModelId, {
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
  }, {
    env,
    metadata: {
      feature: "scheduled-intelligence-briefing",
      projectId: project.id,
      workspaceId: project.workspaceId,
      attempt: attempt.label,
    },
    skipCache: true,
  });
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
  if (input.workspaceId && input.workspaceId !== project.workspaceId) throw new Error("Briefing project does not belong to the selected workspace.");

  const reportingWindowHours = clampReportingWindowHours(input.reportingWindowHours);
  const windowStart = new Date(scheduledAt.getTime() - reportingWindowHours * 60 * 60 * 1000);
  const intelligence = await collectProjectIntelligence(db, project, windowStart);
  const hasActivity = intelligence.messages.length > 0
    || intelligence.tasks.length > 0
    || intelligence.asanaTasks.length > 0
    || intelligence.riskSignals.length > 0;
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
    },
  };
}

async function insertBriefingMessage(db: AppDb, chatId: string, project: BriefingProjectRow, marker: string, body: string, scheduledAt: Date, source: "cloudflare-cron" | "manual-test") {
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
        generatedBy: source,
        model: vertexAiModelId,
        scheduledAt: scheduledAt.toISOString(),
      }),
      attachmentsJson: null,
      createdAt: scheduledAt.toISOString(),
    }),
  ]);
  return id;
}

export async function postBriefing(env: Env, input: BriefingGenerationInput & { markdown?: string | null; source?: "cloudflare-cron" | "manual-test" }) {
  if (!env.DB || !env.AI) {
    throw new Error("DB or AI binding is unavailable.");
  }

  const db = drizzle(env.DB, { schema });
  const scheduledAt = input.scheduledAt ?? new Date();
  const project = await getProjectById(db, input.projectId);
  if (!project) throw new Error("Briefing project was not found.");

  const markdown = input.markdown?.trim() || (await generateBriefingPreview(env, input)).markdown;
  const chatId = await getOrCreateDailyBriefingsChat(db, project, input.chatId);
  const marker = input.markerKey
    ? `<!-- scheduled-briefing:${input.markerKey} -->`
    : `<!-- scheduled-briefing:${project.id}:${scheduledAt.toISOString()} -->`;
  if (await briefingExists(db, chatId, marker)) return { chatId, chatMessageId: null, skipped: true };

  const chatMessageId = await insertBriefingMessage(db, chatId, project, marker, markdown, scheduledAt, input.source ?? "manual-test");
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
  const allowedDays = schedule.recurrence === "daily"
    ? [0, 1, 2, 3, 4, 5, 6]
    : schedule.recurrence === "weekdays"
      ? [1, 2, 3, 4, 5]
      : weekdays.length ? weekdays : [weekdayForDate(afterLocal.year, afterLocal.month, afterLocal.day)];

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
    const preview = await generateBriefingPreview(env, {
      projectId: schedule.projectId,
      workspaceId: schedule.workspaceId,
      chatId: schedule.chatId,
      title: schedule.title,
      reportingWindowHours: schedule.reportingWindowHours,
      promptInstructions: schedule.promptInstructions,
      scheduledAt,
      markerKey: `${schedule.id}:${scheduledAt.toISOString()}`,
    });
    const postResult = await postBriefing(env, {
      projectId: schedule.projectId,
      workspaceId: schedule.workspaceId,
      chatId: schedule.chatId,
      title: schedule.title,
      reportingWindowHours: schedule.reportingWindowHours,
      promptInstructions: schedule.promptInstructions,
      scheduledAt,
      markerKey: `${schedule.id}:${scheduledAt.toISOString()}`,
      markdown: preview.markdown,
      source: "cloudflare-cron",
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
      db.update(schema.briefingSchedules)
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
      db.update(schema.briefingSchedules)
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
      .where(and(
        eq(schema.briefingSchedules.enabled, true),
        or(
          lte(schema.briefingSchedules.nextRunAt, scheduledAt),
          and(eq(schema.briefingSchedules.recurrence, "once"), lte(schema.briefingSchedules.runOnceAt, scheduledAt)),
        ),
      ))
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
      const chatId = await getOrCreateDailyBriefingsChat(db, project);
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
