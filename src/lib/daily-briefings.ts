import { runTrackedAiGateway } from "@/lib/ai-gateway";
import { vertexAiModelId } from "@/lib/prompts";

type BriefingProjectRow = {
  id: string;
  workspaceId: string;
  workspaceName: string;
  name: string;
  description: string;
  status: string;
};

type MutationRow = {
  id: number;
  entity: string;
  entityId: string;
  operation: string;
  chatId: string | null;
  createdAt: number;
};

type IdeaRow = {
  id: string;
  title: string;
  status: string;
  category: string;
  owner: string;
  summary: string;
  nextStep: string;
  eventCreatedAt: number;
};

type ChatMessageRow = {
  id: string;
  chatTitle: string;
  author: string;
  role: string;
  body: string;
  artifactTitle: string | null;
  artifactType: string | null;
  createdAt: string;
};

type ArtifactEventRow = {
  eventId: number;
  operation: string;
  title: string | null;
  fileType: string | null;
  status: string | null;
  summary: string | null;
  eventCreatedAt: number;
};

type WorkersAiTextResult = {
  response?: unknown;
  choices?: Array<{
    message?: { content?: unknown; text?: unknown };
    delta?: { content?: unknown };
  }>;
};

const dailyBriefingsTitle = "Daily Briefings";
const briefingAuthor = "Vertex AI Command Center";

function isoDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function utcTimeLabel(date: Date) {
  return date.toISOString().slice(11, 16) + " UTC";
}

function truncate(value: string | null | undefined, maxLength: number) {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return normalized.slice(0, maxLength - 3).trimEnd() + "...";
}

function extractAiResponse(result: unknown) {
  if (typeof result === "string") return result;
  if (result && typeof result === "object") {
    const response = result as WorkersAiTextResult;
    const choice = response.choices?.[0];
    const candidates = [
      response.response,
      choice?.message?.content,
      choice?.message?.text,
      choice?.delta?.content,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    }
  }
  return "";
}

function fallbackBriefing(project: BriefingProjectRow, dateKey: string, hasActivity: boolean) {
  return [
    `# ${project.name} Daily Briefing - ${dateKey}`,
    "",
    "## Key Decisions",
    hasActivity ? "- Review the activity details in this thread; the model response was unavailable." : "- No new decisions were recorded in the last 24 hours.",
    "",
    "## Artifact Updates",
    hasActivity ? "- Recent artifact or workspace updates may need review." : "- No artifact updates were recorded in the last 24 hours.",
    "",
    "## Active Blockers",
    project.status === "Blocked" ? "- Project status is currently Blocked." : "- No active blockers were identified from the available activity.",
  ].join("\n");
}

function buildActivityPayload({
  artifacts,
  ideas,
  messages,
  mutations,
  project,
  windowEnd,
  windowStart,
}: {
  artifacts: ArtifactEventRow[];
  ideas: IdeaRow[];
  messages: ChatMessageRow[];
  mutations: MutationRow[];
  project: BriefingProjectRow;
  windowEnd: Date;
  windowStart: Date;
}) {
  return JSON.stringify({
    project: {
      id: project.id,
      name: project.name,
      status: project.status,
      description: project.description,
      workspace: project.workspaceName,
    },
    window: {
      start: windowStart.toISOString(),
      end: windowEnd.toISOString(),
    },
    mutations: mutations.map((row) => ({
      id: row.id,
      entity: row.entity,
      entityId: row.entityId,
      operation: row.operation,
      chatId: row.chatId,
      createdAt: new Date(row.createdAt).toISOString(),
    })),
    newIdeas: ideas.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      category: row.category,
      owner: row.owner,
      summary: truncate(row.summary, 360),
      nextStep: truncate(row.nextStep, 240),
      createdAt: new Date(row.eventCreatedAt).toISOString(),
    })),
    artifactUpdates: artifacts.map((row) => ({
      eventId: row.eventId,
      operation: row.operation,
      title: row.title,
      fileType: row.fileType,
      status: row.status,
      summary: truncate(row.summary, 360),
      createdAt: new Date(row.eventCreatedAt).toISOString(),
    })),
    chatMessages: messages.map((row) => ({
      id: row.id,
      chatTitle: row.chatTitle,
      author: row.author,
      role: row.role,
      body: truncate(row.body, 700),
      artifactTitle: row.artifactTitle,
      artifactType: row.artifactType,
      createdAt: row.createdAt,
    })),
  });
}

async function listActiveOrgProjects(db: D1Database) {
  const result = await db
    .prepare(
      `SELECT p.id,
              p.workspace_id as workspaceId,
              w.name as workspaceName,
              p.name,
              p.description,
              p.status
       FROM projects p
       INNER JOIN workspaces w ON w.id = p.workspace_id
       WHERE w.scope = 'org'
         AND p.status IN ('Active', 'In Progress', 'Watch')
       ORDER BY p.sort_order ASC, p.name ASC`,
    )
    .all<BriefingProjectRow>();
  return result.results ?? [];
}

async function getOrCreateDailyBriefingsChat(db: D1Database, project: BriefingProjectRow) {
  const existing = await db
    .prepare(
      `SELECT id
       FROM chats
       WHERE workspace_id = ?
         AND project_id = ?
         AND section = 'project'
         AND title = ?
       LIMIT 1`,
    )
    .bind(project.workspaceId, project.id, dailyBriefingsTitle)
    .first<{ id: string }>();
  if (existing?.id) return existing.id;

  const sortRow = await db
    .prepare("SELECT COALESCE(MAX(sort_order), 0) + 1 as sortOrder FROM chats WHERE workspace_id = ? AND project_id = ?")
    .bind(project.workspaceId, project.id)
    .first<{ sortOrder: number }>();
  const chatId = `daily-briefings-${project.id}`;
  await db
    .prepare(
      `INSERT INTO chats (id, workspace_id, project_id, section, title, description, sort_order)
       VALUES (?, ?, ?, 'project', ?, ?, ?)`,
    )
    .bind(
      chatId,
      project.workspaceId,
      project.id,
      dailyBriefingsTitle,
      "Automated executive summaries generated by the daily scheduled Worker.",
      sortRow?.sortOrder ?? 99,
    )
    .run();
  return chatId;
}

async function briefingExists(db: D1Database, chatId: string, marker: string) {
  const row = await db
    .prepare("SELECT id FROM chat_messages WHERE chat_id = ? AND body LIKE ? LIMIT 1")
    .bind(chatId, `%${marker}%`)
    .first<{ id: string }>();
  return Boolean(row?.id);
}

async function collectProjectActivity(db: D1Database, project: BriefingProjectRow, windowStartMs: number) {
  const [mutations, ideas, artifacts, messages] = await Promise.all([
    db
      .prepare(
        `SELECT id, entity, entity_id as entityId, operation, chat_id as chatId, created_at as createdAt
         FROM events
         WHERE workspace_id = ?
           AND project_id = ?
           AND created_at >= ?
         ORDER BY created_at ASC`,
      )
      .bind(project.workspaceId, project.id, windowStartMs)
      .all<MutationRow>(),
    db
      .prepare(
        `SELECT i.id,
                i.title,
                i.status,
                i.category,
                i.owner,
                i.summary,
                i.next_step as nextStep,
                e.created_at as eventCreatedAt
         FROM events e
         INNER JOIN ideas i ON i.id = e.entity_id
         WHERE e.workspace_id = ?
           AND e.project_id = ?
           AND e.entity = 'idea'
           AND e.operation = 'insert'
           AND e.created_at >= ?
         ORDER BY e.created_at ASC`,
      )
      .bind(project.workspaceId, project.id, windowStartMs)
      .all<IdeaRow>(),
    db
      .prepare(
        `SELECT e.id as eventId,
                e.operation,
                a.title,
                a.file_type as fileType,
                a.status,
                a.summary,
                e.created_at as eventCreatedAt
         FROM events e
         LEFT JOIN artifacts a ON a.id = e.entity_id OR a.r2_key = e.entity_id
         WHERE e.workspace_id = ?
           AND e.project_id = ?
           AND e.entity = 'artifact'
           AND e.created_at >= ?
         ORDER BY e.created_at ASC`,
      )
      .bind(project.workspaceId, project.id, windowStartMs)
      .all<ArtifactEventRow>(),
    db
      .prepare(
        `SELECT m.id,
                c.title as chatTitle,
                m.author,
                m.role,
                m.body,
                m.artifact_title as artifactTitle,
                m.artifact_type as artifactType,
                m.created_at as createdAt
         FROM chat_messages m
         INNER JOIN chats c ON c.id = m.chat_id
         WHERE m.workspace_id = ?
           AND c.project_id = ?
           AND m.created_at >= ?
           AND c.title <> ?
         ORDER BY m.created_at ASC`,
      )
      .bind(project.workspaceId, project.id, new Date(windowStartMs).toISOString(), dailyBriefingsTitle)
      .all<ChatMessageRow>(),
  ]);

  return {
    artifacts: artifacts.results ?? [],
    ideas: ideas.results ?? [],
    messages: messages.results ?? [],
    mutations: mutations.results ?? [],
  };
}

async function generateBriefing({
  activity,
  env,
  project,
  windowEnd,
  windowStart,
}: {
  activity: Awaited<ReturnType<typeof collectProjectActivity>>;
  env: Env;
  project: BriefingProjectRow;
  windowEnd: Date;
  windowStart: Date;
}) {
  const hasActivity = activity.artifacts.length > 0 || activity.ideas.length > 0 || activity.messages.length > 0 || activity.mutations.length > 0;
  const prompt = buildActivityPayload({
    ...activity,
    project,
    windowEnd,
    windowStart,
  });

  const systemPrompt = [
    "You generate concise executive project status briefings for senior stakeholders.",
    "Use only the provided JSON activity payload. Do not invent dates, owners, decisions, blockers, artifact names, or project facts.",
    "Return Markdown only, with exactly these headings in this order:",
    "# Daily Briefing",
    "## Key Decisions",
    "## Artifact Updates",
    "## Active Blockers",
    "Keep the briefing under 220 words. Prefer bullets. If a section has no evidence, write a single bullet that says no new item was identified in the last 24 hours.",
  ].join("\n");

  try {
    const result = await runTrackedAiGateway(env.AI, vertexAiModelId, {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      max_completion_tokens: 800,
      temperature: 0.2,
    }, {
      feature: "daily-project-briefing",
      model: vertexAiModelId,
      usageDb: env.DB,
      projectId: project.id,
      metadata: {
        feature: "daily-project-briefing",
        workspaceId: project.workspaceId,
        projectStatus: project.status,
        mutationCount: activity.mutations.length,
        ideaCount: activity.ideas.length,
        artifactUpdateCount: activity.artifacts.length,
        chatMessageCount: activity.messages.length,
      },
    });
    const text = extractAiResponse(result);
    return text || fallbackBriefing(project, isoDateKey(windowEnd), hasActivity);
  } catch (error) {
    console.warn("[DailyBriefings] Workers AI briefing generation failed.", {
      projectId: project.id,
      message: error instanceof Error ? error.message : "Unknown Workers AI error.",
    });
    return fallbackBriefing(project, isoDateKey(windowEnd), hasActivity);
  }
}

async function insertBriefingMessage(db: D1Database, chatId: string, project: BriefingProjectRow, marker: string, body: string, scheduledAt: Date) {
  await db
    .prepare(
      `INSERT INTO chat_messages (
        id,
        chat_id,
        parent_id,
        workspace_id,
        author,
        role,
        avatar,
        message_time,
        body,
        artifact_title,
        artifact_type,
        artifact_meta,
        attachments_json,
        created_at
      ) VALUES (?, ?, NULL, ?, ?, 'assistant', NULL, ?, ?, NULL, NULL, NULL, NULL, ?)`,
    )
    .bind(
      `daily-briefing-msg-${project.id}-${isoDateKey(scheduledAt)}-${crypto.randomUUID()}`,
      chatId,
      project.workspaceId,
      briefingAuthor,
      utcTimeLabel(scheduledAt),
      `${marker}\n${body}`.trim(),
      scheduledAt.toISOString(),
    )
    .run();
}

export async function runDailyProjectBriefings(env: Env, scheduledTime: number = Date.now()) {
  if (!env.DB || !env.AI) {
    console.warn("[DailyBriefings] DB or AI binding is unavailable; skipping scheduled briefings.");
    return;
  }

  const windowEnd = new Date(scheduledTime);
  const windowStart = new Date(windowEnd.getTime() - 24 * 60 * 60 * 1000);
  const projects = await listActiveOrgProjects(env.DB);

  for (const project of projects) {
    try {
      const chatId = await getOrCreateDailyBriefingsChat(env.DB, project);
      const marker = `<!-- daily-briefing:${project.id}:${isoDateKey(windowEnd)} -->`;
      if (await briefingExists(env.DB, chatId, marker)) continue;

      const activity = await collectProjectActivity(env.DB, project, windowStart.getTime());
      const briefing = await generateBriefing({ activity, env, project, windowEnd, windowStart });
      await insertBriefingMessage(env.DB, chatId, project, marker, briefing, windowEnd);
    } catch (error) {
      console.error("[DailyBriefings] Project briefing failed.", {
        projectId: project.id,
        message: error instanceof Error ? error.message : "Unknown daily briefing error.",
      });
    }
  }
}
