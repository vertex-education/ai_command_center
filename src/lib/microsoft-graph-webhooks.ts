/// <reference path="../../worker-configuration.d.ts" />

export type MicrosoftGraphResourceKind = "teams" | "outlook" | "other";

export type MicrosoftGraphChangeNotification = {
  subscriptionId?: string;
  changeType?: string;
  resource?: string;
  tenantId?: string;
  subscriptionExpirationDateTime?: string;
  clientState?: string;
  resourceData?: {
    id?: string;
    odataType?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type MicrosoftGraphChangeNotificationCollection = {
  value?: MicrosoftGraphChangeNotification[];
  validationTokens?: string[];
  [key: string]: unknown;
};

export type MicrosoftGraphWebhookJob = {
  kind: "microsoft-graph-change-notification";
  requestId: string;
  receivedAt: string;
  source: {
    userAgent: string | null;
    cfRay: string | null;
    connectingIp: string | null;
  };
  payload: MicrosoftGraphChangeNotificationCollection;
};

export type MicrosoftGraphWebhookEnv = Env & {
  DB: D1Database;
};

export type MicrosoftGraphSubscriptionRecord = {
  subscriptionId: string;
  resource: string;
  changeType: string;
  tenantId?: string | null;
  expirationAt?: string | null;
  status?: "active" | "renewing" | "expired" | "deleted";
};

const teamsSubscriptionLimit = 10_000;
const teamsSubscriptionWarningThreshold = 9_000;

export function inferMicrosoftGraphResourceKind(resource: string | undefined): MicrosoftGraphResourceKind {
  const normalized = resource?.trim().toLowerCase() ?? "";

  if (
    normalized.startsWith("/me/messages") ||
    normalized.startsWith("me/messages") ||
    normalized.startsWith("/users/") && normalized.includes("/messages") ||
    normalized.startsWith("users/") && normalized.includes("/messages")
  ) {
    return "outlook";
  }

  if (
    normalized.startsWith("/teams") ||
    normalized.startsWith("teams/") ||
    normalized.startsWith("/chats") ||
    normalized.startsWith("chats/") ||
    normalized.includes("/channels/") ||
    normalized.includes("/messages")
  ) {
    return "teams";
  }

  return "other";
}

export async function getMicrosoftGraphTeamsSubscriptionUsage(env: MicrosoftGraphWebhookEnv) {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS count
     FROM microsoft_graph_subscriptions
     WHERE resource_kind = 'teams'
       AND status IN ('active', 'renewing')`,
  ).first<{ count: number }>();
  const activeTeamsSubscriptions = Number(row?.count ?? 0);

  return {
    activeTeamsSubscriptions,
    limit: teamsSubscriptionLimit,
    remaining: Math.max(teamsSubscriptionLimit - activeTeamsSubscriptions, 0),
    warning: activeTeamsSubscriptions >= teamsSubscriptionWarningThreshold,
    exceeded: activeTeamsSubscriptions >= teamsSubscriptionLimit,
  };
}

export async function assertMicrosoftGraphTeamsSubscriptionCapacity(env: MicrosoftGraphWebhookEnv, additionalSubscriptions = 1) {
  const usage = await getMicrosoftGraphTeamsSubscriptionUsage(env);
  if (usage.activeTeamsSubscriptions + additionalSubscriptions > usage.limit) {
    throw new Error(
      `Microsoft Graph Teams subscription limit would be exceeded: ${usage.activeTeamsSubscriptions}/${usage.limit} active subscriptions.`,
    );
  }

  return usage;
}

export async function registerMicrosoftGraphSubscription(
  env: MicrosoftGraphWebhookEnv,
  subscription: MicrosoftGraphSubscriptionRecord,
) {
  const resourceKind = inferMicrosoftGraphResourceKind(subscription.resource);
  if (resourceKind === "teams" && !(await microsoftGraphSubscriptionExists(env, subscription.subscriptionId))) {
    await assertMicrosoftGraphTeamsSubscriptionCapacity(env);
  }

  await upsertMicrosoftGraphSubscription(env, {
    subscriptionId: subscription.subscriptionId,
    tenantId: subscription.tenantId ?? null,
    resource: subscription.resource,
    resourceKind,
    changeType: subscription.changeType,
    status: subscription.status ?? "active",
    expirationAt: subscription.expirationAt ?? null,
    observedAt: new Date().toISOString(),
    notificationIncrement: 0,
  });
}

export async function processMicrosoftGraphWebhookJob(env: MicrosoftGraphWebhookEnv, job: MicrosoftGraphWebhookJob) {
  const notifications = Array.isArray(job.payload.value) ? job.payload.value : [];
  const receivedAt = job.receivedAt || new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO microsoft_graph_webhook_deliveries (
      id,
      request_id,
      notification_count,
      validation_token_count,
      user_agent,
      cf_ray,
      connecting_ip,
      received_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    `graph-delivery-${crypto.randomUUID()}`,
    job.requestId,
    notifications.length,
    Array.isArray(job.payload.validationTokens) ? job.payload.validationTokens.length : 0,
    job.source.userAgent,
    job.source.cfRay,
    job.source.connectingIp,
    receivedAt,
  ).run();

  for (const notification of notifications) {
    if (!notification.subscriptionId) continue;

    await upsertMicrosoftGraphSubscription(env, {
      subscriptionId: notification.subscriptionId,
      tenantId: notification.tenantId ?? null,
      resource: notification.resource ?? "",
      resourceKind: inferMicrosoftGraphResourceKind(notification.resource),
      changeType: notification.changeType ?? "",
      status: "active",
      expirationAt: notification.subscriptionExpirationDateTime ?? null,
      observedAt: receivedAt,
      notificationIncrement: 1,
    });
  }

  const usage = await getMicrosoftGraphTeamsSubscriptionUsage(env);
  if (usage.warning) {
    console.warn("Microsoft Graph Teams subscription usage is approaching the tenant limit.", usage);
  }
}

async function upsertMicrosoftGraphSubscription(
  env: MicrosoftGraphWebhookEnv,
  subscription: {
    subscriptionId: string;
    tenantId: string | null;
    resource: string;
    resourceKind: MicrosoftGraphResourceKind;
    changeType: string;
    status: "active" | "renewing" | "expired" | "deleted";
    expirationAt: string | null;
    observedAt: string;
    notificationIncrement: number;
  },
) {
  await env.DB.prepare(
    `INSERT INTO microsoft_graph_subscriptions (
      subscription_id,
      tenant_id,
      resource,
      resource_kind,
      change_type,
      status,
      expiration_at,
      first_seen_at,
      last_seen_at,
      notification_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(subscription_id) DO UPDATE SET
      tenant_id = COALESCE(excluded.tenant_id, microsoft_graph_subscriptions.tenant_id),
      resource = CASE WHEN excluded.resource <> '' THEN excluded.resource ELSE microsoft_graph_subscriptions.resource END,
      resource_kind = excluded.resource_kind,
      change_type = CASE WHEN excluded.change_type <> '' THEN excluded.change_type ELSE microsoft_graph_subscriptions.change_type END,
      status = excluded.status,
      expiration_at = COALESCE(excluded.expiration_at, microsoft_graph_subscriptions.expiration_at),
      last_seen_at = excluded.last_seen_at,
      notification_count = microsoft_graph_subscriptions.notification_count + excluded.notification_count`,
  ).bind(
    subscription.subscriptionId,
    subscription.tenantId,
    subscription.resource,
    subscription.resourceKind,
    subscription.changeType,
    subscription.status,
    subscription.expirationAt,
    subscription.observedAt,
    subscription.observedAt,
    subscription.notificationIncrement,
  ).run();
}

async function microsoftGraphSubscriptionExists(env: MicrosoftGraphWebhookEnv, subscriptionId: string) {
  const row = await env.DB.prepare(
    `SELECT subscription_id
     FROM microsoft_graph_subscriptions
     WHERE subscription_id = ?
     LIMIT 1`,
  ).bind(subscriptionId).first<{ subscription_id: string }>();

  return Boolean(row);
}
