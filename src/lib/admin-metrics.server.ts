import { getRequest } from "@tanstack/start-server-core";
import { env } from "cloudflare:workers";
import { isAdminRole } from "@/lib/auth-access-control";
import { getAuth } from "@/lib/auth";
import { vertexAiModelId } from "@/lib/prompts";

type AdminSession = {
  user?: {
    id?: string;
    role?: string | null;
  };
};

export type AdminUsageProvider = "ai-gateway" | "cloudflare-workers-ai" | "tavily" | "firecrawl" | "vectorize";

export type AdminUsageEventInput = {
  provider: AdminUsageProvider;
  feature: string;
  model?: string | null;
  creditsUsed?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  durationMs?: number | null;
  teamId?: string | null;
  projectId?: string | null;
  chatId?: string | null;
  metadata?: Record<string, unknown>;
};

type MetricCard = {
  id: string;
  label: string;
  value: string;
  detail: string;
  status?: "ok" | "watch" | "muted";
};

type UsageRow = {
  provider: string;
  requests: number;
  creditsUsed: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  durationMs: number | null;
  latestAt: number | null;
};

const aiGatewayUsageProviders = ["ai-gateway", "cloudflare-workers-ai"] as const;

type ActivityRow = {
  name: string;
  count: number;
};

type RecentUsageRow = {
  id: string;
  provider: string;
  feature: string;
  model: string | null;
  creditsUsed: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  durationMs: number | null;
  teamId: string | null;
  projectId: string | null;
  chatId: string | null;
  metadataJson: string;
  createdAt: number;
};

type UsageMetadata = Record<string, string | number | boolean | null>;

type GatewayUsageSummary = {
  requests: number;
  tokensIn: number | null;
  tokensOut: number | null;
  totalTokens: number | null;
  cost: number | null;
  cached: number;
  success: number;
  latestAt: number | null;
};

type GatewayLogCacheEntry = {
  expiresAt: number;
  promise: Promise<AiGatewayLog | null>;
};

const usageTableSql = `
CREATE TABLE IF NOT EXISTS admin_usage_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  feature TEXT NOT NULL,
  model TEXT,
  credits_used REAL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  duration_ms INTEGER,
  team_id TEXT,
  project_id TEXT,
  chat_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
)`;

const usageIndexesSql = [
  "CREATE INDEX IF NOT EXISTS admin_usage_events_provider_idx ON admin_usage_events (provider, created_at)",
  "CREATE INDEX IF NOT EXISTS admin_usage_events_scope_idx ON admin_usage_events (team_id, project_id, created_at)",
  "CREATE INDEX IF NOT EXISTS admin_usage_events_chat_idx ON admin_usage_events (chat_id, created_at)",
];

const defaultAiGatewayId = "default";
const gatewayLogCache = new Map<string, GatewayLogCacheEntry>();
const gatewayLogSuccessCacheTtlMs = 5 * 60 * 1000;
const gatewayLogFailureCacheTtlMs = 60 * 1000;
const gatewayLogLookupConcurrency = 3;
const gatewayLogSampleLimit = 20;

function getRuntimeEnv() {
  return env as Env & {
    CLOUDFLARE_AI_GATEWAY_ID?: string;
    FIRECRAWL_API_KEY?: string;
    TAVILY_API_KEY?: string;
    VECTORIZE?: Vectorize;
    AI?: Ai;
    ARTIFACTS_BUCKET?: R2Bucket;
  };
}

function configuredAiGatewayId() {
  return getRuntimeEnv().CLOUDFLARE_AI_GATEWAY_ID?.trim() || defaultAiGatewayId;
}

async function getDb() {
  const env = getRuntimeEnv();
  const db = (env as Env).DB;
  if (!db) throw new Error("D1 binding DB is required for admin metrics.");
  return db;
}

async function requireAdmin() {
  const request = getRequest();
  const session = (await getAuth(request).api.getSession({ headers: request.headers })) as AdminSession | null;
  if (!session?.user?.id) throw new Error("Sign in is required.");
  if (!isAdminRole(session.user.role)) throw new Error("Admin privileges are required.");
  return session;
}

async function ensureUsageTable() {
  const db = await getDb();
  await db.prepare(usageTableSql).run();
  for (const statement of usageIndexesSql) {
    await db.prepare(statement).run();
  }
}

function finiteNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatNumber(value: number | null | undefined) {
  return finiteNumber(value)?.toLocaleString() ?? "Not tracked";
}

function formatMs(value: number | null | undefined) {
  const number = finiteNumber(value);
  if (number === null) return "Not tracked";
  if (number >= 1_000) return `${(number / 1_000).toFixed(1)}s`;
  return `${Math.round(number).toLocaleString()}ms`;
}

function formatCurrency(value: number | null | undefined) {
  const number = finiteNumber(value);
  return number === null ? "Not tracked" : `$${number.toFixed(2)}`;
}

function formatDateTime(value: number | null | undefined) {
  const number = finiteNumber(value);
  return number === null ? "No activity" : new Date(number).toLocaleString();
}

function parseMetadata(value: string | null | undefined): UsageMetadata {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        ([, metadataValue]) =>
          metadataValue === null ||
          typeof metadataValue === "string" ||
          typeof metadataValue === "number" ||
          typeof metadataValue === "boolean",
      ),
    ) as UsageMetadata;
  } catch {
    return {};
  }
}

function getAiGatewayLogIdFromMetadata(value: string | null | undefined) {
  const metadata = parseMetadata(value);
  return typeof metadata.aiGatewayLogId === "string" && metadata.aiGatewayLogId.trim() ? metadata.aiGatewayLogId.trim() : null;
}

async function getAiGatewayLog(logId: string) {
  const cached = gatewayLogCache.get(logId);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.promise;

  const ai = getRuntimeEnv().AI;
  if (!ai) return null;

  const promise = ai
    .gateway(configuredAiGatewayId())
    .getLog(logId)
    .then((log) => {
      gatewayLogCache.set(logId, {
        expiresAt: Date.now() + gatewayLogSuccessCacheTtlMs,
        promise: Promise.resolve(log),
      });
      return log;
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : "Unknown Gateway log lookup error.";
      console.warn("[AdminMetrics] AI Gateway log was not available.", { logId, message });
      gatewayLogCache.set(logId, {
        expiresAt: Date.now() + gatewayLogFailureCacheTtlMs,
        promise: Promise.resolve(null),
      });
      return null;
    });

  gatewayLogCache.set(logId, {
    expiresAt: now + gatewayLogFailureCacheTtlMs,
    promise,
  });

  return promise;
}

async function getAiGatewayLogs(logIds: string[], limit = gatewayLogSampleLimit) {
  const uniqueLogIds = Array.from(new Set(logIds.filter((logId) => logId.trim()))).slice(0, limit);
  const entries: Array<[string, AiGatewayLog]> = [];

  for (let index = 0; index < uniqueLogIds.length; index += gatewayLogLookupConcurrency) {
    const chunk = uniqueLogIds.slice(index, index + gatewayLogLookupConcurrency);
    const logs = await Promise.all(
      chunk.map(async (logId) => {
        const log = await getAiGatewayLog(logId);
        return log ? ([logId, log] as [string, AiGatewayLog]) : null;
      }),
    );

    for (const log of logs) {
      if (log) entries.push(log);
    }
  }

  return new Map(entries);
}

function summarizeGatewayLogs(logs: AiGatewayLog[]): GatewayUsageSummary {
  const tokensIn = logs.reduce((sum, log) => sum + (log.tokens_in ?? 0), 0);
  const tokensOut = logs.reduce((sum, log) => sum + (log.tokens_out ?? 0), 0);
  const cost = logs.reduce((sum, log) => sum + (log.cost ?? 0), 0);
  return {
    requests: logs.length,
    tokensIn: logs.length ? tokensIn : null,
    tokensOut: logs.length ? tokensOut : null,
    totalTokens: logs.length ? tokensIn + tokensOut : null,
    cost: logs.some((log) => typeof log.cost === "number") ? cost : null,
    cached: logs.filter((log) => log.cached).length,
    success: logs.filter((log) => log.success).length,
    latestAt: logs.reduce<number | null>((latest, log) => {
      const createdAt = log.created_at instanceof Date ? log.created_at.getTime() : new Date(log.created_at).getTime();
      return latest === null || createdAt > latest ? createdAt : latest;
    }, null),
  };
}

async function countRows(sql: string, ...params: unknown[]) {
  const row = await (
    await getDb()
  )
    .prepare(sql)
    .bind(...params)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

async function optionalCountRows(sql: string, ...params: unknown[]) {
  try {
    return await countRows(sql, ...params);
  } catch {
    return 0;
  }
}

async function getMostActiveProject(since: number) {
  const eventRow = await (
    await getDb()
  )
    .prepare(
      `SELECT p.name as name, COUNT(*) as count
       FROM events e
       INNER JOIN projects p ON p.id = e.project_id
       WHERE e.project_id IS NOT NULL
         AND e.created_at >= ?
       GROUP BY p.id, p.name
       ORDER BY count DESC, p.name ASC
       LIMIT 1`,
    )
    .bind(since)
    .first<ActivityRow>();

  if (eventRow) return eventRow;

  const messageRow = await (
    await getDb()
  )
    .prepare(
      `SELECT p.name as name, COUNT(*) as count
       FROM chat_messages m
       INNER JOIN chats c ON c.id = m.chat_id
       INNER JOIN projects p ON p.id = c.project_id
       GROUP BY p.id, p.name
       ORDER BY count DESC, p.name ASC
       LIMIT 1`,
    )
    .first<ActivityRow>();

  return messageRow ?? { name: "No project activity", count: 0 };
}

async function getMostActiveTeam(since: number) {
  const eventRow = await (
    await getDb()
  )
    .prepare(
      `SELECT t.name as name, COUNT(*) as count
       FROM events e
       INNER JOIN teams t ON t.id = e.team_id
       WHERE e.team_id IS NOT NULL
         AND e.created_at >= ?
       GROUP BY t.id, t.name
       ORDER BY count DESC, t.name ASC
       LIMIT 1`,
    )
    .bind(since)
    .first<ActivityRow>();

  if (eventRow) return eventRow;

  const membershipRow = await (
    await getDb()
  )
    .prepare(
      `SELECT t.name as name, COUNT(tm.user_id) as count
       FROM teams t
       LEFT JOIN team_members tm ON tm.team_id = t.id
       GROUP BY t.id, t.name
       ORDER BY count DESC, t.name ASC
       LIMIT 1`,
    )
    .first<ActivityRow>();

  return membershipRow ?? { name: "No team activity", count: 0 };
}

async function getUsageRows(since: number) {
  await ensureUsageTable();
  const result = await (
    await getDb()
  )
    .prepare(
      `SELECT CASE WHEN provider = 'cloudflare-workers-ai' THEN 'ai-gateway' ELSE provider END as provider,
              COUNT(*) as requests,
              SUM(credits_used) as creditsUsed,
              SUM(input_tokens) as inputTokens,
              SUM(output_tokens) as outputTokens,
              SUM(total_tokens) as totalTokens,
              AVG(duration_ms) as durationMs,
              MAX(created_at) as latestAt
       FROM admin_usage_events
       WHERE created_at >= ?
       GROUP BY CASE WHEN provider = 'cloudflare-workers-ai' THEN 'ai-gateway' ELSE provider END
       ORDER BY provider ASC`,
    )
    .bind(since)
    .all<UsageRow>();

  return result.results ?? [];
}

async function getProviderUsageRow(provider: AdminUsageProvider, since: number) {
  await ensureUsageTable();
  if (provider === "ai-gateway") {
    return await (
      await getDb()
    )
      .prepare(
        `SELECT 'ai-gateway' as provider,
                COUNT(*) as requests,
                SUM(credits_used) as creditsUsed,
                SUM(input_tokens) as inputTokens,
                SUM(output_tokens) as outputTokens,
                SUM(total_tokens) as totalTokens,
                AVG(duration_ms) as durationMs,
                MAX(created_at) as latestAt
         FROM admin_usage_events
         WHERE created_at >= ?
           AND provider IN ('ai-gateway', 'cloudflare-workers-ai')
         GROUP BY CASE WHEN provider IN ('ai-gateway', 'cloudflare-workers-ai') THEN 'ai-gateway' END
         LIMIT 1`,
      )
      .bind(since)
      .first<UsageRow>();
  }

  return await (
    await getDb()
  )
    .prepare(
      `SELECT provider,
              COUNT(*) as requests,
              SUM(credits_used) as creditsUsed,
              SUM(input_tokens) as inputTokens,
              SUM(output_tokens) as outputTokens,
              SUM(total_tokens) as totalTokens,
              AVG(duration_ms) as durationMs,
              MAX(created_at) as latestAt
       FROM admin_usage_events
       WHERE created_at >= ?
         AND provider = ?
       GROUP BY provider
       LIMIT 1`,
    )
    .bind(since, provider)
    .first<UsageRow>();
}

async function getAiGatewayModelUsageRow(model: string, since: number) {
  await ensureUsageTable();
  return await (
    await getDb()
  )
    .prepare(
      `SELECT 'ai-gateway' as provider,
              COUNT(*) as requests,
              SUM(credits_used) as creditsUsed,
              SUM(input_tokens) as inputTokens,
              SUM(output_tokens) as outputTokens,
              SUM(total_tokens) as totalTokens,
              AVG(duration_ms) as durationMs,
              MAX(created_at) as latestAt
       FROM admin_usage_events
       WHERE created_at >= ?
         AND provider IN ('ai-gateway', 'cloudflare-workers-ai')
         AND model = ?
       GROUP BY model
       LIMIT 1`,
    )
    .bind(since, model)
    .first<UsageRow>();
}

async function getRecentUsageRows() {
  await ensureUsageTable();
  const result = await (
    await getDb()
  )
    .prepare(
      `SELECT id,
              CASE WHEN provider = 'cloudflare-workers-ai' THEN 'ai-gateway' ELSE provider END as provider,
              feature,
              model,
              credits_used as creditsUsed,
              input_tokens as inputTokens,
              output_tokens as outputTokens,
              total_tokens as totalTokens,
              duration_ms as durationMs,
              team_id as teamId,
              project_id as projectId,
              chat_id as chatId,
              metadata_json as metadataJson,
              created_at as createdAt
       FROM admin_usage_events
       ORDER BY created_at DESC
       LIMIT 50`,
    )
    .all<RecentUsageRow>();

  return result.results ?? [];
}

async function getGatewayUsageSummary() {
  await ensureUsageTable();
  const result = await (
    await getDb()
  )
    .prepare(
      `SELECT metadata_json as metadataJson, created_at as createdAt
       FROM admin_usage_events
       WHERE provider IN (${aiGatewayUsageProviders.map(() => "?").join(", ")})
       ORDER BY created_at DESC
       LIMIT 50`,
    )
    .bind(...aiGatewayUsageProviders)
    .all<{ metadataJson: string; createdAt: number }>();

  const logIds = Array.from(
    new Set(
      (result.results ?? [])
        .map((row) => getAiGatewayLogIdFromMetadata(row.metadataJson))
        .filter((value): value is string => Boolean(value)),
    ),
  );

  if (!logIds.length) {
    return {
      requests: 0,
      tokensIn: null,
      tokensOut: null,
      totalTokens: null,
      cost: null,
      cached: 0,
      success: 0,
      latestAt: null,
    } satisfies GatewayUsageSummary;
  }

  return summarizeGatewayLogs(Array.from((await getAiGatewayLogs(logIds)).values()));
}

async function buildSingleMetricCard(metricId: string): Promise<MetricCard> {
  const now = Date.now();
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const oneDayAgo = now - 24 * 60 * 60 * 1000;

  switch (metricId) {
    case "current-concurrent-users": {
      const [activeUsers, activeSessions] = await Promise.all([
        countRows("SELECT COUNT(DISTINCT userId) as count FROM session WHERE expiresAt > ?", now),
        countRows("SELECT COUNT(*) as count FROM session WHERE expiresAt > ?", now),
      ]);
      return {
        id: metricId,
        label: "Current concurrent users",
        value: activeUsers.toLocaleString(),
        detail: `${activeSessions.toLocaleString()} active sessions`,
        status: "ok",
      };
    }
    case "average-concurrent-users": {
      const [activeUsers, sessionsUpdatedToday] = await Promise.all([
        countRows("SELECT COUNT(DISTINCT userId) as count FROM session WHERE expiresAt > ?", now),
        countRows("SELECT COUNT(DISTINCT userId) as count FROM session WHERE updatedAt >= ?", oneDayAgo),
      ]);
      const estimatedAverageConcurrentUsers = Math.round((activeUsers + sessionsUpdatedToday / 24) * 10) / 10;
      return {
        id: metricId,
        label: "Avg concurrent users",
        value: estimatedAverageConcurrentUsers.toLocaleString(),
        detail: "Estimated from active sessions and 24h session updates",
        status: "muted",
      };
    }
    case "max-concurrent-users": {
      const activeSessions = await countRows("SELECT COUNT(*) as count FROM session WHERE expiresAt > ?", now);
      return {
        id: metricId,
        label: "Max concurrent users",
        value: activeSessions.toLocaleString(),
        detail: "Highest observable from current active sessions until sampling is added",
        status: "muted",
      };
    }
    case "total-chats-initiated": {
      const [totalChats, totalMessages] = await Promise.all([
        countRows("SELECT COUNT(*) as count FROM chats"),
        countRows("SELECT COUNT(*) as count FROM chat_messages"),
      ]);
      return {
        id: metricId,
        label: "Total chats initiated",
        value: totalChats.toLocaleString(),
        detail: `${totalMessages.toLocaleString()} messages stored`,
        status: "ok",
      };
    }
    case "gemma-token-usage": {
      const usage = await getAiGatewayModelUsageRow(vertexAiModelId, thirtyDaysAgo);
      return {
        id: metricId,
        label: "Gemma 4 token usage",
        value: formatNumber(usage?.totalTokens),
        detail: `${usage?.requests ?? 0} Gemma 4 requests in 30 days`,
        status: usage ? "ok" : "watch",
      };
    }
    case "ai-gateway-token-usage": {
      const [usage, gatewayUsage] = await Promise.all([getProviderUsageRow("ai-gateway", thirtyDaysAgo), getGatewayUsageSummary()]);
      return {
        id: metricId,
        label: "AI Gateway tokens",
        value: formatNumber(usage?.totalTokens),
        detail: `${usage?.requests ?? 0} AI Gateway requests in 30 days; ${gatewayUsage.requests.toLocaleString()} logs sampled`,
        status: usage ? "ok" : "watch",
      };
    }
    case "ai-gateway-cost": {
      const gatewayUsage = await getGatewayUsageSummary();
      return {
        id: metricId,
        label: "AI Gateway cost",
        value: formatCurrency(gatewayUsage.cost),
        detail: `${gatewayUsage.success.toLocaleString()} successful Gateway requests sampled`,
        status: gatewayUsage.requests ? "ok" : "watch",
      };
    }
    case "tavily-credits-used": {
      const usage = await getProviderUsageRow("tavily", thirtyDaysAgo);
      return {
        id: metricId,
        label: "Tavily credits used",
        value: formatNumber(usage?.creditsUsed),
        detail: `${usage?.requests ?? 0} searches tracked in 30 days`,
        status: usage ? "ok" : "watch",
      };
    }
    case "firecrawl-credits-used": {
      const usage = await getProviderUsageRow("firecrawl", thirtyDaysAgo);
      return {
        id: metricId,
        label: "Firecrawl credits used",
        value: formatNumber(usage?.creditsUsed),
        detail: `${usage?.requests ?? 0} searches tracked in 30 days`,
        status: usage ? "ok" : "watch",
      };
    }
    case "files-stored": {
      const [totalArtifacts, legacyDocumentFiles, v2ArtifactFiles, totalChunks] = await Promise.all([
        countRows("SELECT COUNT(*) as count FROM artifacts"),
        countRows("SELECT COUNT(DISTINCT r2_key) as count FROM document_chunks"),
        optionalCountRows("SELECT COUNT(*) as count FROM artifacts_registry"),
        countRows("SELECT COUNT(*) as count FROM document_chunks"),
      ]);
      return {
        id: metricId,
        label: "Files stored",
        value: (totalArtifacts + legacyDocumentFiles + v2ArtifactFiles).toLocaleString(),
        detail: `${totalChunks.toLocaleString()} searchable chunks`,
        status: "ok",
      };
    }
    case "teams": {
      const [totalTeams, pendingInvites] = await Promise.all([
        countRows("SELECT COUNT(*) as count FROM teams"),
        countRows("SELECT COUNT(*) as count FROM auth_invites WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?", now),
      ]);
      return {
        id: metricId,
        label: "Teams",
        value: totalTeams.toLocaleString(),
        detail: `${pendingInvites.toLocaleString()} pending invites`,
        status: "ok",
      };
    }
    case "projects": {
      const [totalProjects, recentEvents] = await Promise.all([
        countRows("SELECT COUNT(*) as count FROM projects"),
        countRows("SELECT COUNT(*) as count FROM events WHERE created_at >= ?", sevenDaysAgo),
      ]);
      return {
        id: metricId,
        label: "Projects",
        value: totalProjects.toLocaleString(),
        detail: `${recentEvents.toLocaleString()} admin-visible events in 7 days`,
        status: "ok",
      };
    }
    case "most-active-project": {
      const mostActiveProject = await getMostActiveProject(thirtyDaysAgo);
      return {
        id: metricId,
        label: "Most active project",
        value: mostActiveProject.name,
        detail: `${mostActiveProject.count.toLocaleString()} activity records`,
        status: mostActiveProject.count ? "ok" : "muted",
      };
    }
    case "most-active-team": {
      const mostActiveTeam = await getMostActiveTeam(thirtyDaysAgo);
      return {
        id: metricId,
        label: "Most active team",
        value: mostActiveTeam.name,
        detail: `${mostActiveTeam.count.toLocaleString()} activity records or members`,
        status: mostActiveTeam.count ? "ok" : "muted",
      };
    }
    default:
      throw new Error("Metric was not found.");
  }
}

async function getHealthMetrics() {
  const now = Date.now();
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const oneDayAgo = now - 24 * 60 * 60 * 1000;

  const [
    totalUsers,
    activeSessions,
    activeUsers,
    sessionsUpdatedToday,
    totalTeams,
    totalProjects,
    totalChats,
    totalMessages,
    assistantMessages,
    totalArtifacts,
    legacyDocumentFiles,
    v2ArtifactFiles,
    totalChunks,
    pendingInvites,
    recentEvents,
    mostActiveProject,
    mostActiveTeam,
    usageRows,
    gemmaUsage,
    gatewayUsage,
    recentUsage,
  ] = await Promise.all([
    countRows('SELECT COUNT(*) as count FROM "user"'),
    countRows("SELECT COUNT(*) as count FROM session WHERE expiresAt > ?", now),
    countRows("SELECT COUNT(DISTINCT userId) as count FROM session WHERE expiresAt > ?", now),
    countRows("SELECT COUNT(DISTINCT userId) as count FROM session WHERE updatedAt >= ?", oneDayAgo),
    countRows("SELECT COUNT(*) as count FROM teams"),
    countRows("SELECT COUNT(*) as count FROM projects"),
    countRows("SELECT COUNT(*) as count FROM chats"),
    countRows("SELECT COUNT(*) as count FROM chat_messages"),
    countRows("SELECT COUNT(*) as count FROM chat_messages WHERE role = 'assistant'"),
    countRows("SELECT COUNT(*) as count FROM artifacts"),
    countRows("SELECT COUNT(DISTINCT r2_key) as count FROM document_chunks"),
    optionalCountRows("SELECT COUNT(*) as count FROM artifacts_registry"),
    countRows("SELECT COUNT(*) as count FROM document_chunks"),
    countRows("SELECT COUNT(*) as count FROM auth_invites WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?", now),
    countRows("SELECT COUNT(*) as count FROM events WHERE created_at >= ?", sevenDaysAgo),
    getMostActiveProject(thirtyDaysAgo),
    getMostActiveTeam(thirtyDaysAgo),
    getUsageRows(thirtyDaysAgo),
    getAiGatewayModelUsageRow(vertexAiModelId, thirtyDaysAgo),
    getGatewayUsageSummary(),
    getRecentUsageRows(),
  ]);

  const totalStoredFiles = totalArtifacts + legacyDocumentFiles + v2ArtifactFiles;
  const estimatedAverageConcurrentUsers = Math.round((activeUsers + sessionsUpdatedToday / 24) * 10) / 10;
  const providerRowsByName = new Map(usageRows.map((row) => [row.provider, row]));
  const aiGatewayEventUsage = providerRowsByName.get("ai-gateway");
  const tavilyUsage = providerRowsByName.get("tavily");
  const firecrawlUsage = providerRowsByName.get("firecrawl");
  const recentGatewayLogs = await getAiGatewayLogs(
    recentUsage.map((row) => getAiGatewayLogIdFromMetadata(row.metadataJson)).filter((value): value is string => Boolean(value)),
  );

  const runtime = getRuntimeEnv();

  const cards: MetricCard[] = [
    {
      id: "current-concurrent-users",
      label: "Current concurrent users",
      value: activeUsers.toLocaleString(),
      detail: `${activeSessions.toLocaleString()} active sessions`,
      status: "ok",
    },
    {
      id: "average-concurrent-users",
      label: "Avg concurrent users",
      value: estimatedAverageConcurrentUsers.toLocaleString(),
      detail: "Estimated from active sessions and 24h session updates",
      status: "muted",
    },
    {
      id: "max-concurrent-users",
      label: "Max concurrent users",
      value: activeSessions.toLocaleString(),
      detail: "Highest observable from current active sessions until sampling is added",
      status: "muted",
    },
    {
      id: "total-chats-initiated",
      label: "Total chats initiated",
      value: totalChats.toLocaleString(),
      detail: `${totalMessages.toLocaleString()} messages stored`,
      status: "ok",
    },
    {
      id: "gemma-token-usage",
      label: "Gemma 4 token usage",
      value: formatNumber(gemmaUsage?.totalTokens),
      detail: `${gemmaUsage?.requests ?? 0} Gemma 4 requests in 30 days`,
      status: gemmaUsage ? "ok" : "watch",
    },
    {
      id: "ai-gateway-token-usage",
      label: "AI Gateway tokens",
      value: formatNumber(aiGatewayEventUsage?.totalTokens),
      detail: `${aiGatewayEventUsage?.requests ?? 0} AI Gateway requests in 30 days; ${gatewayUsage.requests.toLocaleString()} logs sampled`,
      status: aiGatewayEventUsage ? "ok" : "watch",
    },
    {
      id: "ai-gateway-cost",
      label: "AI Gateway cost",
      value: formatCurrency(gatewayUsage.cost),
      detail: `${gatewayUsage.success.toLocaleString()} successful Gateway requests sampled`,
      status: gatewayUsage.requests ? "ok" : "watch",
    },
    {
      id: "tavily-credits-used",
      label: "Tavily credits used",
      value: formatNumber(tavilyUsage?.creditsUsed),
      detail: `${tavilyUsage?.requests ?? 0} searches tracked in 30 days`,
      status: tavilyUsage ? "ok" : "watch",
    },
    {
      id: "firecrawl-credits-used",
      label: "Firecrawl credits used",
      value: formatNumber(firecrawlUsage?.creditsUsed),
      detail: `${firecrawlUsage?.requests ?? 0} searches tracked in 30 days`,
      status: firecrawlUsage ? "ok" : "watch",
    },
    {
      id: "files-stored",
      label: "Files stored",
      value: totalStoredFiles.toLocaleString(),
      detail: `${totalChunks.toLocaleString()} searchable chunks`,
      status: "ok",
    },
    {
      id: "teams",
      label: "Teams",
      value: totalTeams.toLocaleString(),
      detail: `${pendingInvites.toLocaleString()} pending invites`,
      status: "ok",
    },
    {
      id: "projects",
      label: "Projects",
      value: totalProjects.toLocaleString(),
      detail: `${recentEvents.toLocaleString()} admin-visible events in 7 days`,
      status: "ok",
    },
    {
      id: "most-active-project",
      label: "Most active project",
      value: mostActiveProject.name,
      detail: `${mostActiveProject.count.toLocaleString()} activity records`,
      status: mostActiveProject.count ? "ok" : "muted",
    },
    {
      id: "most-active-team",
      label: "Most active team",
      value: mostActiveTeam.name,
      detail: `${mostActiveTeam.count.toLocaleString()} activity records or members`,
      status: mostActiveTeam.count ? "ok" : "muted",
    },
  ];

  return {
    generatedAt: new Date(now).toISOString(),
    cards,
    providerUsage: ["ai-gateway", "tavily", "firecrawl", "vectorize"].map((provider) => {
      if (provider === "ai-gateway") {
        const row = aiGatewayEventUsage;
        return {
          provider,
          requests: row?.requests ?? 0,
          creditsUsed: gatewayUsage.cost,
          inputTokens: row?.inputTokens ?? gatewayUsage.tokensIn ?? null,
          outputTokens: row?.outputTokens ?? gatewayUsage.tokensOut ?? null,
          totalTokens: row?.totalTokens ?? gatewayUsage.totalTokens ?? null,
          averageDuration: row?.durationMs ?? null,
          latestAt: gatewayUsage.latestAt ?? row?.latestAt ?? null,
          creditsLabel: formatCurrency(gatewayUsage.cost),
          inputTokensLabel: formatNumber(row?.inputTokens ?? gatewayUsage.tokensIn),
          outputTokensLabel: formatNumber(row?.outputTokens ?? gatewayUsage.tokensOut),
          totalTokensLabel: formatNumber(row?.totalTokens ?? gatewayUsage.totalTokens),
          averageDurationLabel: formatMs(row?.durationMs),
          latestLabel: formatDateTime(gatewayUsage.latestAt ?? row?.latestAt),
          cacheLabel: `${gatewayUsage.cached.toLocaleString()} cached`,
          successLabel: `${gatewayUsage.success.toLocaleString()} successful`,
        };
      }
      const row = providerRowsByName.get(provider);
      return {
        provider,
        requests: row?.requests ?? 0,
        creditsUsed: row?.creditsUsed ?? null,
        inputTokens: row?.inputTokens ?? null,
        outputTokens: row?.outputTokens ?? null,
        totalTokens: row?.totalTokens ?? null,
        averageDuration: row?.durationMs ?? null,
        latestAt: row?.latestAt ?? null,
        creditsLabel: formatNumber(row?.creditsUsed),
        inputTokensLabel: formatNumber(row?.inputTokens),
        outputTokensLabel: formatNumber(row?.outputTokens),
        totalTokensLabel: formatNumber(row?.totalTokens),
        averageDurationLabel: formatMs(row?.durationMs),
        latestLabel: formatDateTime(row?.latestAt),
        cacheLabel: "N/A",
        successLabel: "N/A",
      };
    }),
    appHealth: {
      totalUsers,
      assistantMessages,
      totalMessages,
      totalStoredFiles,
      totalDocumentChunks: totalChunks,
      pendingInvites,
      recentEvents,
      configuredServices: [
        { label: "AI Gateway", configured: Boolean(runtime.AI && runtime.CLOUDFLARE_AI_GATEWAY_ID) },
        { label: "Vectorize", configured: Boolean(runtime.VECTORIZE) },
        { label: "R2 artifacts", configured: Boolean(runtime.ARTIFACTS_BUCKET) },
        { label: "Tavily", configured: Boolean(runtime.TAVILY_API_KEY) },
        { label: "Firecrawl", configured: Boolean(runtime.FIRECRAWL_API_KEY) },
      ],
    },
    recentUsage: recentUsage.map((row) => {
      const aiGatewayLogId = getAiGatewayLogIdFromMetadata(row.metadataJson);
      const metadata = parseMetadata(row.metadataJson);
      const gatewayLog = aiGatewayLogId ? (recentGatewayLogs.get(aiGatewayLogId) ?? null) : null;
      const gatewayTokensIn = gatewayLog?.tokens_in ?? null;
      const gatewayTokensOut = gatewayLog?.tokens_out ?? null;
      const gatewayTotalTokens =
        gatewayTokensIn !== null || gatewayTokensOut !== null ? (gatewayTokensIn ?? 0) + (gatewayTokensOut ?? 0) : null;
      return {
        ...row,
        metadata,
        aiGatewayLogId,
        gatewayStatus: gatewayLog ? `${gatewayLog.status_code} ${gatewayLog.success ? "OK" : "Failed"}` : "Not available",
        gatewayCached: gatewayLog?.cached ?? null,
        gatewayCost: gatewayLog?.cost ?? null,
        gatewayCostLabel: formatCurrency(gatewayLog?.cost),
        creditsLabel: formatNumber(row.creditsUsed),
        inputTokensLabel: formatNumber(gatewayTokensIn ?? row.inputTokens),
        outputTokensLabel: formatNumber(gatewayTokensOut ?? row.outputTokens),
        totalTokensLabel: formatNumber(gatewayTotalTokens ?? row.totalTokens),
        durationLabel: formatMs(gatewayLog?.duration ?? row.durationMs),
        createdLabel: formatDateTime(row.createdAt),
      };
    }),
  };
}

export async function recordAdminUsageEvent(input: AdminUsageEventInput) {
  try {
    await ensureUsageTable();
    const totalTokens =
      finiteNumber(input.totalTokens) ??
      (finiteNumber(input.inputTokens) !== null && finiteNumber(input.outputTokens) !== null
        ? Number(input.inputTokens) + Number(input.outputTokens)
        : null);

    await (
      await getDb()
    )
      .prepare(
        `INSERT INTO admin_usage_events (
          id, provider, feature, model, credits_used, input_tokens, output_tokens, total_tokens,
          duration_ms, team_id, project_id, chat_id, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        `usage-${crypto.randomUUID()}`,
        input.provider,
        input.feature,
        input.model ?? null,
        finiteNumber(input.creditsUsed),
        finiteNumber(input.inputTokens),
        finiteNumber(input.outputTokens),
        totalTokens,
        finiteNumber(input.durationMs),
        input.teamId ?? null,
        input.projectId ?? null,
        input.chatId ?? null,
        JSON.stringify(input.metadata ?? {}),
        Date.now(),
      )
      .run();
  } catch (error) {
    console.warn("[AdminMetrics] Usage event was not recorded.", {
      provider: input.provider,
      feature: input.feature,
      message: error instanceof Error ? error.message : "Unknown usage logging error.",
    });
  }
}

export async function getAdminMetricsForAdmin() {
  await requireAdmin();
  return getHealthMetrics();
}

export async function getAdminMetricCardsForAdmin() {
  await requireAdmin();
  return (await getHealthMetrics()).cards;
}

export async function getAdminMetricCardForAdmin(metricId: string) {
  await requireAdmin();
  return buildSingleMetricCard(metricId);
}

export async function getAdminProviderUsageForAdmin() {
  await requireAdmin();
  const metrics = await getHealthMetrics();
  return {
    generatedAt: metrics.generatedAt,
    providerUsage: metrics.providerUsage,
  };
}

export async function getAdminAppHealthForAdmin() {
  await requireAdmin();
  const metrics = await getHealthMetrics();
  return {
    generatedAt: metrics.generatedAt,
    appHealth: metrics.appHealth,
  };
}

export async function getAdminRecentUsageForAdmin() {
  await requireAdmin();
  const metrics = await getHealthMetrics();
  return {
    generatedAt: metrics.generatedAt,
    recentUsage: metrics.recentUsage,
  };
}
