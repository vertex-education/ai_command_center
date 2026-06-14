# Asana Webhooks

The Asana webhook receiver is implemented in `src/lib/asana-webhook.ts` and exposed through Hono at:

```text
POST /api/webhooks/asana
```

## Webhook URL

Create project-level Asana webhooks with a workspace lookup key and project lookup key on the target URL:

```text
https://<app-origin>/api/webhooks/asana?asanaWorkspaceGid=<asana-workspace-gid>&asanaProjectGid=<asana-project-gid>
```

`workspaceId=<vertex-workspace-id>` is also accepted for the workspace key. `webhookKey=<stable-key>` is accepted as a generic resource key. Use a unique resource key for each webhook because Asana gives each webhook its own signing secret.

## Automatic Setup

When a user maps or scaffolds an Asana project in Profile > Asana, the app saves the `asana_project_mappings` row and then runs an idempotent webhook ensure step.

The ensure step:

1. Checks `asana_project_webhooks` for an active webhook matching the expected target URL.
2. Checks Asana's webhook list for an existing active project webhook when the token can read webhooks.
3. Creates a project-level webhook only when no matching active webhook exists.
4. Stores the returned webhook gid, target URL, status, and last error in `asana_project_webhooks`.

Mapping saves are not rolled back if webhook setup fails. Instead, the failure is recorded in `asana_project_webhooks`, and the Repair webhooks action in Profile > Asana can rerun setup for all mapped projects.

## Handshake

When Asana creates a webhook, it sends `X-Hook-Secret`. The Worker:

1. Reads the exact header value.
2. Stores it in the `ASANA_WEBHOOK_SECRETS` KV namespace under the workspace plus resource lookup key.
3. Returns `200 OK` with the exact same `X-Hook-Secret` response header.

No request body parsing is needed for the handshake.

## Event Verification

For standard event deliveries, the Worker verifies the request before parsing JSON:

1. Reads the raw request body with `request.arrayBuffer()`.
2. Reads `X-Hook-Signature`, with `X-Asana-Request-Signature` accepted for compatibility.
3. Retrieves the workspace secret from `ASANA_WEBHOOK_SECRETS`.
4. Imports the secret with Web Crypto HMAC SHA-256 verify permissions.
5. Calls `crypto.subtle.verify` against the raw request body.

Node.js crypto APIs are not used. Missing or invalid signatures return `401 Unauthorized`.

## Persistence

After signature verification succeeds, task events are parsed and upserted through Drizzle into `asana_webhook_task_states`.

Webhook setup state is stored in `asana_project_webhooks`. Verified event payload state is stored in `asana_webhook_task_states`.

The receiver then resolves project-chat delivery through `asana_project_mappings`, followed by the optional `ASANA_WEBHOOK_PROJECT_MAP` fallback. Matching updates are inserted as system chat messages, published through `CHAT_SYNC`, and recorded in the D1 `events` table for SSE invalidation.

## Bindings

- `ASANA_WEBHOOK_SECRETS`: KV namespace for per-workspace Asana webhook secrets.
- `ASANA_WEBHOOK_ORIGIN`: public Worker origin used for generated target URLs.
- `DB`: D1 database used for task state, mappings, chat messages, and mutation events.
- `CHAT_SYNC`: Durable Object namespace for live chat append delivery.
- `ASANA_WEBHOOK_SOURCE_USER_ID`: optional local user id used as the source for mutation events.
- `ASANA_WEBHOOK_PROJECT_MAP`: optional JSON mapping from Asana project or task gids to local project/chat targets.
- `ASANA_WEBHOOK_SECRET`: optional legacy fallback only; prefer the KV-backed handshake path.
