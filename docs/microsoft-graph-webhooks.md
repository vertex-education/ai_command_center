# Microsoft Graph Webhooks

The public Microsoft Graph notification endpoint is:

```text
POST /api/graph/webhooks
```

Use this route as the `notificationUrl` for Microsoft Graph subscriptions that watch Teams messages and Outlook email messages.

## Delivery SLA

Microsoft Graph considers a notification delivered when the endpoint returns a `2xx` response within 3 seconds. This route keeps the request path intentionally small:

1. If Microsoft sends `validationToken` in the query string, return it immediately as `text/plain`.
2. Parse the JSON notification body.
3. Send the body to the `GRAPH_WEBHOOK_QUEUE` Cloudflare Queue.
4. Return `202 Accepted`.

If the Queue binding is unavailable or enqueue fails, the route returns `503` so Microsoft Graph retries delivery instead of treating the notification as accepted.

## Queue Processing

`GRAPH_WEBHOOK_QUEUE` publishes to the `graph-webhook-notifications` queue. The Worker `queue()` handler dispatches those jobs to `processMicrosoftGraphWebhookJob` in [src/lib/microsoft-graph-webhooks.ts](../src/lib/microsoft-graph-webhooks.ts).

The consumer records:

- `microsoft_graph_webhook_deliveries`: one audit row per queued webhook request.
- `microsoft_graph_subscriptions`: one row per observed subscription id, with resource type, status, expiration, first/last seen timestamps, and notification count.

Payload validation, token validation, resource fetches, and business-specific message processing should be added to the Queue consumer path, not the HTTP route.

## Teams Subscription Limit

Microsoft Graph has a tenant-wide 10,000 subscription limit for Teams change notification resources. The subscription tracker classifies Graph resources as:

- `teams`: resources such as `/teams/...`, `/chats/...`, channel messages, and chat messages.
- `outlook`: resources such as `/me/messages` or `/users/{id}/messages`.
- `other`: anything not recognized by the current classifier.

Use `getMicrosoftGraphTeamsSubscriptionUsage(env)` to read current usage and `assertMicrosoftGraphTeamsSubscriptionCapacity(env)` before creating more Teams subscriptions. Use `registerMicrosoftGraphSubscription(env, subscription)` after creating or renewing subscriptions so the count stays accurate before notifications arrive.

## Setup

Create the queue:

```powershell
npx wrangler queues create graph-webhook-notifications
```

Apply the D1 migration:

```powershell
npm run db:migrate
```

Refresh generated Worker types after binding changes:

```powershell
npm run cf-typegen
```

Required binding:

- `GRAPH_WEBHOOK_QUEUE`: Cloudflare Queue producer for Microsoft Graph webhook payloads.
