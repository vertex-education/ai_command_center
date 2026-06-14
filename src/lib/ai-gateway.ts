import { env } from "cloudflare:workers";

export const defaultAiGatewayId = "default";

type AiGatewayMetadata = Record<string, string | number | boolean | null | bigint>;

type AiGatewayRunOptions = {
  gatewayId?: string | null;
  env?: Pick<Env, "CLOUDFLARE_AI_GATEWAY_ID"> | null;
  metadata?: AiGatewayMetadata;
  signal?: AbortSignal;
  skipCache?: boolean;
  cacheTtl?: number;
};

type AiGatewayUsageTrackingOptions = AiGatewayRunOptions & {
  feature: string;
  model?: string | null;
  usageDb?: D1Database | null;
  teamId?: string | null;
  projectId?: string | null;
  chatId?: string | null;
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

function gatewayIdFromEnv(runtimeEnv?: Pick<Env, "CLOUDFLARE_AI_GATEWAY_ID"> | null) {
  const bindingValue = runtimeEnv?.CLOUDFLARE_AI_GATEWAY_ID ?? (env as Env & { CLOUDFLARE_AI_GATEWAY_ID?: string }).CLOUDFLARE_AI_GATEWAY_ID;
  const processValue = typeof process !== "undefined" ? process.env.CLOUDFLARE_AI_GATEWAY_ID : undefined;
  return bindingValue?.trim() || processValue?.trim() || defaultAiGatewayId;
}

function compactMetadata(metadata: AiGatewayMetadata | undefined) {
  if (!metadata) return undefined;
  const entries = Object.entries(metadata)
    .filter(([, value]) => value !== undefined)
    .slice(0, 5);
  return entries.length ? Object.fromEntries(entries) as AiGatewayMetadata : undefined;
}

function jsonSafeMetadata(metadata: AiGatewayMetadata | undefined) {
  if (!metadata) return {};
  return Object.fromEntries(
    Object.entries(metadata)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, typeof value === "bigint" ? value.toString() : value]),
  );
}

export function getAiGatewayLogId(ai: Ai | null | undefined) {
  return ai?.aiGatewayLogId ?? null;
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function findFirstByKey(value: unknown, keys: string[], depth = 0): unknown {
  if (depth > 8 || !value) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = findFirstByKey(item, keys, depth + 1);
      if (nested !== null && nested !== undefined) return nested;
    }
    return null;
  }
  if (!isRecord(value)) return null;

  for (const key of keys) {
    if (value[key] !== undefined && value[key] !== null) return value[key];
  }

  for (const nestedValue of Object.values(value)) {
    const nested = findFirstByKey(nestedValue, keys, depth + 1);
    if (nested !== null && nested !== undefined) return nested;
  }
  return null;
}

function tokenUsageFromResult(result: unknown) {
  const usage = findFirstByKey(result, ["usage"]);
  const usageRecord = isRecord(usage) ? usage : {};
  const inputTokens = finiteNumber(usageRecord.prompt_tokens ?? usageRecord.input_tokens);
  const outputTokens = finiteNumber(usageRecord.completion_tokens ?? usageRecord.output_tokens);
  const totalTokens = finiteNumber(usageRecord.total_tokens) ?? (
    inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null
  );
  return { inputTokens, outputTokens, totalTokens };
}

function getUsageDb(db?: D1Database | null) {
  return db ?? (env as Env & { DB?: D1Database }).DB ?? null;
}

async function ensureUsageTable(db: D1Database) {
  await db.prepare(usageTableSql).run();
  for (const statement of usageIndexesSql) {
    await db.prepare(statement).run();
  }
}

async function recordWorkersAiGatewayUsageEvent({
  ai,
  durationMs,
  error,
  feature,
  metadata,
  model,
  result,
  usageDb,
  teamId,
  projectId,
  chatId,
}: {
  ai: Ai;
  durationMs: number;
  error?: unknown;
  feature: string;
  metadata?: AiGatewayMetadata;
  model?: string | null;
  result?: unknown;
  usageDb?: D1Database | null;
  teamId?: string | null;
  projectId?: string | null;
  chatId?: string | null;
}) {
  const db = getUsageDb(usageDb);
  if (!db) return;

  try {
    await ensureUsageTable(db);
    const tokenUsage = tokenUsageFromResult(result);
    await db
      .prepare(
        `INSERT INTO admin_usage_events (
          id, provider, feature, model, credits_used, input_tokens, output_tokens, total_tokens,
          duration_ms, team_id, project_id, chat_id, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        `usage-${crypto.randomUUID()}`,
        "ai-gateway",
        error ? `${feature}-error` : feature,
        model ?? null,
        null,
        tokenUsage.inputTokens,
        tokenUsage.outputTokens,
        tokenUsage.totalTokens,
        durationMs,
        teamId ?? null,
        projectId ?? null,
        chatId ?? null,
        JSON.stringify({
          ...jsonSafeMetadata(metadata),
          aiGatewayLogId: getAiGatewayLogId(ai),
          trackedBy: "ai-gateway-wrapper",
          success: !error,
          error: error instanceof Error ? error.message : error ? "Workers AI request failed." : undefined,
        }),
        Date.now(),
      )
      .run();
  } catch (trackingError) {
    console.warn("[AiGateway] Workers AI usage event was not recorded.", {
      feature,
      message: trackingError instanceof Error ? trackingError.message : "Unknown usage logging error.",
    });
  }
}

export function runAiGateway(
  ai: Ai,
  model: string,
  inputs: Record<string, unknown>,
  options: AiGatewayRunOptions = {},
) {
  return ai.run(model, inputs, {
    signal: options.signal,
    gateway: {
      id: options.gatewayId?.trim() || gatewayIdFromEnv(options.env),
      skipCache: options.skipCache ?? true,
      cacheTtl: options.cacheTtl,
      metadata: compactMetadata({
        app: "ai-command-center",
        feature: "ai-gateway",
        ...options.metadata,
      }),
    },
  });
}

export async function runTrackedAiGateway(
  ai: Ai,
  model: string,
  inputs: Record<string, unknown>,
  options: AiGatewayUsageTrackingOptions,
) {
  const startedAt = Date.now();
  try {
    const result = await runAiGateway(ai, model, inputs, options);
    await recordWorkersAiGatewayUsageEvent({
      ai,
      durationMs: Date.now() - startedAt,
      feature: options.feature,
      metadata: options.metadata,
      model: options.model ?? model,
      result,
      usageDb: options.usageDb,
      teamId: options.teamId,
      projectId: options.projectId,
      chatId: options.chatId,
    });
    return result;
  } catch (error) {
    await recordWorkersAiGatewayUsageEvent({
      ai,
      durationMs: Date.now() - startedAt,
      error,
      feature: options.feature,
      metadata: options.metadata,
      model: options.model ?? model,
      usageDb: options.usageDb,
      teamId: options.teamId,
      projectId: options.projectId,
      chatId: options.chatId,
    });
    throw error;
  }
}

export const runWorkersAiWithGateway = runAiGateway;
export const runTrackedWorkersAiWithGateway = runTrackedAiGateway;
