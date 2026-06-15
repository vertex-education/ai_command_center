import { env } from "cloudflare:workers";

export const defaultAiGatewayId = "default";
export const defaultAiGatewayOrganizationId = "vertex-education";
export const defaultAiGatewayFallbackModelId = "@cf/meta/llama-3.2-1b-instruct";

const aiGatewayResponseMetadataSymbol = Symbol.for("vertex-ai.ai-gateway.response-metadata");

type AiGatewayMetadata = Record<string, string | number | boolean | null | bigint>;

type AiGatewayIdentityMetadata = {
  userId?: string | null;
  organizationId?: string | null;
  orgId?: string | null;
  workspaceId?: string | null;
  teamId?: string | null;
  projectId?: string | null;
  scopeType?: string | null;
};

type AiGatewayRuntimeEnv = Omit<Partial<Env>, "CLOUDFLARE_AI_GATEWAY_ID"> & {
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_AI_GATEWAY_ID?: string;
  CLOUDFLARE_AI_GATEWAY_FALLBACK_MODEL_ID?: string;
  CLOUDFLARE_AI_GATEWAY_ORGANIZATION_ID?: string;
  CLOUDFLARE_AI_GATEWAY_PROVIDER_TOKEN?: string;
  CLOUDFLARE_AI_GATEWAY_REQUEST_TIMEOUT_MS?: string;
  CLOUDFLARE_AI_GATEWAY_TOKEN?: string;
};

type AiGatewayRunOptions = {
  gatewayId?: string | null;
  env?: AiGatewayRuntimeEnv | null;
  fallbackModel?: string | null;
  identity?: AiGatewayIdentityMetadata;
  metadata?: AiGatewayMetadata;
  requestTimeoutMs?: number | null;
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

export type AiGatewayResponseMetadata = {
  fallbackUsed: boolean;
  gatewayId: string;
  logId: string | null;
  model: string | null;
  provider: string | null;
  step: number | null;
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

function runtimeValue(runtimeEnv: AiGatewayRuntimeEnv | null | undefined, key: string) {
  const bindingValue =
    (runtimeEnv as Record<string, unknown> | null | undefined)?.[key] ?? (env as unknown as Record<string, unknown>)[key];
  const processValue = typeof process !== "undefined" ? process.env[key] : undefined;
  return typeof bindingValue === "string" && bindingValue.trim()
    ? bindingValue.trim()
    : typeof processValue === "string" && processValue.trim()
      ? processValue.trim()
      : null;
}

function gatewayIdFromEnv(runtimeEnv?: AiGatewayRuntimeEnv | null) {
  const bindingValue =
    runtimeEnv?.CLOUDFLARE_AI_GATEWAY_ID ?? (env as Env & { CLOUDFLARE_AI_GATEWAY_ID?: string }).CLOUDFLARE_AI_GATEWAY_ID;
  const processValue = typeof process !== "undefined" ? process.env.CLOUDFLARE_AI_GATEWAY_ID : undefined;
  return bindingValue?.trim() || processValue?.trim() || defaultAiGatewayId;
}

function compactMetadata(metadata: AiGatewayMetadata | undefined) {
  if (!metadata) return undefined;
  const entries = Object.entries(metadata)
    .filter(([, value]) => value !== undefined)
    .slice(0, 5);
  return entries.length ? (Object.fromEntries(entries) as AiGatewayMetadata) : undefined;
}

function compactGatewayIdentityMetadata(options: AiGatewayRunOptions) {
  const metadata = options.metadata ?? {};
  const identity = options.identity ?? {};
  const runtimeEnv = options.env;
  const usageOptions = options as AiGatewayRunOptions & Pick<AiGatewayUsageTrackingOptions, "projectId" | "teamId">;
  const userId = firstStringValue(identity.userId, metadata.userId, metadata.user_id, "system") ?? "system";
  const organizationId =
    firstStringValue(
      identity.organizationId,
      identity.orgId,
      metadata.organizationId,
      metadata.orgId,
      metadata.org_id,
      runtimeValue(runtimeEnv, "CLOUDFLARE_AI_GATEWAY_ORGANIZATION_ID"),
      defaultAiGatewayOrganizationId,
    ) ?? defaultAiGatewayOrganizationId;
  const workspaceId = firstStringValue(identity.workspaceId, metadata.workspaceId, metadata.workspace_id, "none") ?? "none";
  const teamId = firstStringValue(identity.teamId, usageOptions.teamId, metadata.teamId, metadata.team_id, "none") ?? "none";
  const projectId = firstStringValue(identity.projectId, usageOptions.projectId, metadata.projectId, metadata.project_id, "none") ?? "none";

  // Cloudflare stores up to five custom metadata entries per request. Keep these
  // five stable keys aligned with spend-limit dashboard dimensions.
  return {
    user_id: userId,
    org_id: organizationId,
    workspace_id: workspaceId,
    team_id: teamId,
    project_id: projectId,
  } satisfies AiGatewayMetadata;
}

function firstStringValue(...values: unknown[]) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const normalized = typeof value === "bigint" ? value.toString() : String(value);
    const trimmed = normalized.trim();
    if (trimmed) return trimmed.slice(0, 160);
  }
  return null;
}

function jsonSafeMetadata(metadata: AiGatewayMetadata | undefined) {
  if (!metadata) return {};
  return Object.fromEntries(
    Object.entries(metadata)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, typeof value === "bigint" ? value.toString() : value]),
  );
}

function jsonSafeHeaderValue(metadata: AiGatewayMetadata) {
  return JSON.stringify(jsonSafeMetadata(metadata));
}

export function getAiGatewayResponseMetadata(value: unknown): AiGatewayResponseMetadata | null {
  if (!value || (typeof value !== "object" && typeof value !== "function")) return null;
  return ((value as Record<PropertyKey, unknown>)[aiGatewayResponseMetadataSymbol] as AiGatewayResponseMetadata | undefined) ?? null;
}

export function getAiGatewayLogId(ai: Ai | null | undefined, result?: unknown) {
  return getAiGatewayResponseMetadata(result)?.logId ?? ai?.aiGatewayLogId ?? null;
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
  const totalTokens =
    finiteNumber(usageRecord.total_tokens) ?? (inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null);
  return { inputTokens, outputTokens, totalTokens };
}

function getUsageDb(db?: D1Database | null) {
  return db ?? (env as Env & { DB?: D1Database }).DB ?? null;
}

function requestTimeoutMsFromOptions(options: AiGatewayRunOptions, inputs: Record<string, unknown>) {
  const configured = finiteNumber(options.requestTimeoutMs) ?? finiteNumber(inputs.timeoutMs);
  const envConfigured = finiteNumber(Number(runtimeValue(options.env, "CLOUDFLARE_AI_GATEWAY_REQUEST_TIMEOUT_MS")));
  const timeoutMs = configured ?? envConfigured;
  return timeoutMs && timeoutMs > 0 ? Math.round(timeoutMs) : null;
}

function fallbackModelFromOptions(model: string, inputs: Record<string, unknown>, options: AiGatewayRunOptions) {
  if (!isLlmPayload(inputs) || isDynamicGatewayModel(model)) return null;
  if (Object.prototype.hasOwnProperty.call(options, "fallbackModel") && options.fallbackModel === null) return null;
  const configured =
    firstStringValue(options.fallbackModel, runtimeValue(options.env, "CLOUDFLARE_AI_GATEWAY_FALLBACK_MODEL_ID")) ??
    defaultAiGatewayFallbackModelId;
  if (["none", "off", "disabled"].includes(configured.toLowerCase())) return null;
  return configured && configured !== model ? configured : null;
}

function gatewayProviderAuthorization(options: AiGatewayRunOptions) {
  const token = firstStringValue(
    runtimeValue(options.env, "CLOUDFLARE_AI_GATEWAY_PROVIDER_TOKEN"),
    runtimeValue(options.env, "CLOUDFLARE_AI_GATEWAY_TOKEN"),
    runtimeValue(options.env, "CLOUDFLARE_API_TOKEN"),
  );
  if (!token) return null;
  return token.toLowerCase().startsWith("bearer ") ? token : `Bearer ${token}`;
}

function isLlmPayload(inputs: Record<string, unknown>) {
  return Array.isArray(inputs.messages) || typeof inputs.prompt === "string";
}

function isDynamicGatewayModel(model: string) {
  return model.startsWith("dynamic/");
}

function buildGatewayHeaders(options: AiGatewayRunOptions, inputs: Record<string, unknown>, gatewayMetadata: AiGatewayMetadata) {
  const headers: Partial<AIGatewayHeaders> = {
    "Content-Type": "application/json",
    "cf-aig-metadata": jsonSafeHeaderValue(gatewayMetadata),
  };
  const authorization = gatewayProviderAuthorization(options);
  if (authorization) headers.Authorization = authorization;
  const skipCache = options.skipCache ?? true;
  if (skipCache) headers["cf-aig-skip-cache"] = "true";
  if (typeof options.cacheTtl === "number" && Number.isFinite(options.cacheTtl))
    headers["cf-aig-cache-ttl"] = Math.round(options.cacheTtl).toString();
  const requestTimeoutMs = requestTimeoutMsFromOptions(options, inputs);
  if (requestTimeoutMs) headers["cf-aig-request-timeout"] = requestTimeoutMs.toString();
  return headers;
}

function shouldUseUniversalGateway(model: string, headers: Partial<AIGatewayHeaders>) {
  return Boolean(headers.Authorization) || isDynamicGatewayModel(model);
}

function buildUniversalRequest(
  model: string,
  inputs: Record<string, unknown>,
  headers: Partial<AIGatewayHeaders>,
): AIGatewayUniversalRequest {
  if (isDynamicGatewayModel(model)) {
    return {
      provider: "compat",
      endpoint: "chat/completions",
      headers,
      query: {
        ...inputs,
        model,
      },
    };
  }

  return {
    provider: "workers-ai",
    endpoint: model,
    headers,
    query: inputs,
  };
}

function parseGatewayStep(value: string | null) {
  if (!value) return null;
  const step = Number(value);
  return Number.isInteger(step) && step >= 0 ? step : null;
}

function metadataFromResponse(response: Response, gatewayId: string): AiGatewayResponseMetadata {
  const step = parseGatewayStep(response.headers.get("cf-aig-step"));
  return {
    fallbackUsed: step !== null && step > 0,
    gatewayId,
    logId: response.headers.get("cf-aig-log-id"),
    model: response.headers.get("cf-aig-model"),
    provider: response.headers.get("cf-aig-provider"),
    step,
  };
}

function attachGatewayResponseMetadata<T>(value: T, metadata: AiGatewayResponseMetadata): T {
  if (value && (typeof value === "object" || typeof value === "function")) {
    Object.defineProperty(value, aiGatewayResponseMetadataSymbol, {
      configurable: true,
      enumerable: false,
      value: metadata,
    });
  }
  return value;
}

async function gatewayErrorFromResponse(response: Response) {
  const body = await response.text().catch(() => "");
  let detail = body.trim();
  try {
    const parsed = JSON.parse(body) as unknown;
    if (isRecord(parsed)) {
      const error = parsed.error;
      if (typeof error === "string") detail = error;
      if (isRecord(error) && typeof error.message === "string") detail = error.message;
      if (typeof parsed.message === "string") detail = parsed.message;
    }
  } catch {
    // Keep the trimmed text body.
  }
  if (/<html[\s>]/i.test(detail)) detail = "Gateway returned an HTML error page.";
  return new Error(`AI Gateway request failed with HTTP ${response.status}${detail ? `: ${detail.replace(/\s+/g, " ")}` : ""}`);
}

async function parseGatewayResponse(response: Response, responseMetadata: AiGatewayResponseMetadata, stream: boolean) {
  if (!response.ok) throw await gatewayErrorFromResponse(response);

  if (responseMetadata.fallbackUsed) {
    console.info("[AiGateway] Gateway fallback route accepted.", {
      gatewayId: responseMetadata.gatewayId,
      model: responseMetadata.model,
      provider: responseMetadata.provider,
      step: responseMetadata.step,
    });
  }

  if (stream) {
    if (!response.body) throw new Error("AI Gateway streaming response did not include a body.");
    return attachGatewayResponseMetadata(response.body, responseMetadata);
  }

  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();
  if (!text.trim()) return attachGatewayResponseMetadata({}, responseMetadata);
  if (contentType.includes("application/json") || /^[\s\r\n]*[{[]/.test(text)) {
    return attachGatewayResponseMetadata(JSON.parse(text) as unknown, responseMetadata);
  }
  return attachGatewayResponseMetadata(text, responseMetadata);
}

function runWorkersAiBindingGateway(
  ai: Ai,
  model: string,
  inputs: Record<string, unknown>,
  options: AiGatewayRunOptions,
  gatewayId: string,
  gatewayMetadata: AiGatewayMetadata,
) {
  const result = ai.run(model, inputs, {
    signal: options.signal,
    gateway: {
      id: gatewayId,
      skipCache: options.skipCache ?? true,
      cacheTtl: options.cacheTtl,
      metadata: compactMetadata({
        app: "vertex-ai",
        feature: "ai-gateway",
        ...gatewayMetadata,
      }),
      requestTimeoutMs: requestTimeoutMsFromOptions(options, inputs) ?? undefined,
    },
  });

  return result.then((value) =>
    attachGatewayResponseMetadata(value, {
      fallbackUsed: false,
      gatewayId,
      logId: getAiGatewayLogId(ai),
      model,
      provider: "workers-ai",
      step: null,
    }),
  );
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
  gatewayMetadata,
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
  gatewayMetadata?: AiGatewayMetadata;
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
          gatewayMetadata: gatewayMetadata ? jsonSafeMetadata(gatewayMetadata) : undefined,
          aiGatewayLogId: getAiGatewayLogId(ai, result),
          aiGatewayStep: getAiGatewayResponseMetadata(result)?.step ?? null,
          aiGatewayModel: getAiGatewayResponseMetadata(result)?.model ?? null,
          aiGatewayProvider: getAiGatewayResponseMetadata(result)?.provider ?? null,
          aiGatewayFallback: getAiGatewayResponseMetadata(result)?.fallbackUsed ?? false,
          gatewayUserId: gatewayMetadata?.user_id,
          gatewayOrgId: gatewayMetadata?.org_id,
          gatewayWorkspaceId: gatewayMetadata?.workspace_id,
          gatewayTeamId: gatewayMetadata?.team_id,
          gatewayProjectId: gatewayMetadata?.project_id,
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

export async function runAiGateway(ai: Ai, model: string, inputs: Record<string, unknown>, options: AiGatewayRunOptions = {}) {
  const gatewayId = options.gatewayId?.trim() || gatewayIdFromEnv(options.env);
  const gatewayMetadata = compactGatewayIdentityMetadata(options);
  const headers = buildGatewayHeaders(options, inputs, gatewayMetadata);
  if (!shouldUseUniversalGateway(model, headers)) {
    return runWorkersAiBindingGateway(ai, model, inputs, options, gatewayId, gatewayMetadata);
  }
  const fallbackModel = fallbackModelFromOptions(model, inputs, options);
  const request = buildUniversalRequest(model, inputs, headers);
  const payload = fallbackModel ? [request, buildUniversalRequest(fallbackModel, inputs, headers)] : request;
  const response = await ai.gateway(gatewayId).run(payload, {
    signal: options.signal,
    gateway: {
      id: gatewayId,
      cacheTtl: options.cacheTtl,
      metadata: compactMetadata({
        app: "vertex-ai",
        feature: "ai-gateway",
        ...gatewayMetadata,
      }),
      requestTimeoutMs: requestTimeoutMsFromOptions(options, inputs) ?? undefined,
      skipCache: options.skipCache ?? true,
    },
  });
  return parseGatewayResponse(response, metadataFromResponse(response, gatewayId), inputs.stream === true);
}

export async function runTrackedAiGateway(ai: Ai, model: string, inputs: Record<string, unknown>, options: AiGatewayUsageTrackingOptions) {
  const startedAt = Date.now();
  const gatewayMetadata = compactGatewayIdentityMetadata(options);
  try {
    const result = await runAiGateway(ai, model, inputs, options);
    await recordWorkersAiGatewayUsageEvent({
      ai,
      durationMs: Date.now() - startedAt,
      feature: options.feature,
      gatewayMetadata,
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
      gatewayMetadata,
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
