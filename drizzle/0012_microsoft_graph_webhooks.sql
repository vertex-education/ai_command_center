CREATE TABLE IF NOT EXISTS microsoft_graph_subscriptions (
  subscription_id TEXT PRIMARY KEY,
  tenant_id TEXT,
  resource TEXT NOT NULL,
  resource_kind TEXT NOT NULL CHECK (resource_kind IN ('teams', 'outlook', 'other')),
  change_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'renewing', 'expired', 'deleted')),
  expiration_at TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  notification_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS microsoft_graph_subscriptions_kind_status_idx
  ON microsoft_graph_subscriptions (resource_kind, status);

CREATE INDEX IF NOT EXISTS microsoft_graph_subscriptions_expiration_idx
  ON microsoft_graph_subscriptions (expiration_at);

CREATE INDEX IF NOT EXISTS microsoft_graph_subscriptions_tenant_idx
  ON microsoft_graph_subscriptions (tenant_id);

CREATE TABLE IF NOT EXISTS microsoft_graph_webhook_deliveries (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  notification_count INTEGER NOT NULL,
  validation_token_count INTEGER NOT NULL,
  user_agent TEXT,
  cf_ray TEXT,
  connecting_ip TEXT,
  received_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS microsoft_graph_webhook_deliveries_request_idx
  ON microsoft_graph_webhook_deliveries (request_id);

CREATE INDEX IF NOT EXISTS microsoft_graph_webhook_deliveries_received_at_idx
  ON microsoft_graph_webhook_deliveries (received_at);
