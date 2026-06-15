# VertexAI

VertexAI is a TanStack Start workspace app for AI-assisted chat, project, idea, task, decision, approval, and artifact workflows.

The app is organized around three explicit workspace scopes:

- `Personal`: personal projects, project chats, and personal chats.
- `Team`: team projects, project chats, and team chats.
- `Org`: org projects, project chats, and org chats.

Each scope has its own projects, chats, ideas, artifacts, decisions, approvals, tasks, activity, and seed data. The UI is designed so lower scopes do not surface higher-scope information, and switching a project dynamically changes the `Project Chats` section for the selected workspace.

Pinned ideas, approvals, decisions, tasks, and artifacts render in a `Pinned Items` rail above the workspace tabs. Pinning is explicit: newly created workflow items do not auto-load into the rail. The rail stays scoped to the active workspace or selected project, shows only items the user pins, and only displays left or right carousel buttons when the pinned cards overflow the available width. Each arrow click moves to the next card boundary so the next pinned item is fully visible.

## Feature Map

The full feature catalog lives in [docs/vertexai-feature-catalog.md](docs/vertexai-feature-catalog.md). In short, VertexAI currently includes:

- Scoped Personal, Team, and Org workspaces with isolated projects, chats, workflow items, artifacts, risks, prompts, and activity.
- Project Studio chat experiences with project chats, workspace chats, branchable conversations, reasoning modes, file attachments, web search, Asana context, and scoped RAG streaming.
- AI prompt guardrails for dynamic workspace context, role-based inference authorization, intent routing, context budgeting, and Cloudflare AI Gateway usage tracking.
- Dynamic artifact rendering for Markdown, tables, code, summaries, and workflow-action JSON.
- Workflow features for ideas, AI idea assessment, decisions, approvals, tasks, risks, pinned items, and Asana task sync.
- Immutable artifact versioning with D1 metadata, R2 files, Kimi-backed AI diff patch reviews, restore-by-new-version behavior, asynchronous artifact uploads, and Queue-backed RAG ingestion through Vectorize.
- Autonomous web research indexing for newly created projects and ideas, backed by Firecrawl, Cloudflare Queues, Workers AI embeddings, and Vectorize metadata tagged with `source = autonomous_research`.
- Invite-only authentication, Microsoft Entra sign-in, encrypted Microsoft Graph token storage, Microsoft Graph webhooks, and Teams subscription capacity tracking.
- Asana OAuth, encrypted Asana token storage, project mapping, task sync, project webhooks, verified webhook delivery, and Asana snapshot memory for RAG.
- Scheduled and cron-driven project briefings with custom Markdown instruction formatting.
- Realtime mutation event streams and chat presence/message sync through a Durable Object.
- Admin metrics and provider usage tracking for AI Gateway, Workers AI, Tavily, Firecrawl, and Vectorize-backed flows.

## Stack

- React 19
- TanStack Start, Router, Query, Form, and Table
- Vite
- Tailwind CSS
- Drizzle ORM
- Cloudflare Workers runtime
- Cloudflare D1 for structured workspace data
- Cloudflare KV for encrypted Microsoft Graph token storage and per-workspace Asana webhook secrets
- Cloudflare R2 for artifact files
- Cloudflare Workers AI for assistant responses, embeddings, and prompt intent routing
- Cloudflare Vectorize for scoped RAG artifact retrieval
- Cloudflare Queues for document ingestion jobs, autonomous research indexing, Microsoft Graph webhook fan-out, and Asana task creation sync
- Cloudflare Cron Triggers for scheduled project briefings
- Codex Sites metadata in `.openai/hosting.json`

## Prerequisites

- Node.js `>=22.13.0`
- npm
- Wrangler authentication for Cloudflare operations
- A Microsoft Entra ID app registration when Microsoft sign-in is enabled

Check Cloudflare auth:

```powershell
npx wrangler whoami
```

## Local Development

Install dependencies and start the dev server:

```powershell
npm install
npm run dev
```

Build and type-check:

```powershell
npm run build
```

Lint:

```powershell
npm run lint
```

Run deterministic Vitest coverage:

```powershell
npm test
```

## Authentication

Better Auth manages local sessions, invite-only email/password accounts, Microsoft Entra ID sign-in, admin user management, and organization-aware role checks.

VertexAI uses four app roles from [src/lib/auth-access-control.ts](src/lib/auth-access-control.ts):

- `Viewer`: read-only access to workspaces, projects, artifacts, and risks.
- `Contributor`: can read workspace/project configuration and create or update artifacts and risks.
- `Manager`: can update workspaces, create/update/delete projects, manage team/member invitations, and fully manage artifacts and risks.
- `Admin`: full user, session, organization, workspace, project, artifact, and risk administration.

Compatibility aliases are normalized before checks: Better Auth `owner` maps to `Admin`, `user` maps to `Contributor`, and `member` maps to `Viewer`. The Better Auth plugin array keeps `tanstackStartCookies()` as the final plugin in [src/lib/auth.ts](src/lib/auth.ts), and protected route loaders call the `getSession` server function in [src/lib/auth-workflow.ts](src/lib/auth-workflow.ts) so session cookies survive hard reloads before protected modules render.

Microsoft sign-in uses the OAuth 2.0 Authorization Code flow through Better Auth server routes:

- The browser calls `startMicrosoftSignIn` in [src/lib/auth-workflow.ts](src/lib/auth-workflow.ts).
- The server function calls Better Auth's OAuth endpoint and returns only the Microsoft authorization URL.
- Microsoft redirects back to `/api/auth/oauth2/callback/microsoft-entra-id`.
- Better Auth exchanges the authorization code server-side, validates the configured tenant issuer, sends returned Microsoft Graph tokens to the encrypted KV vault, stores the provider account without token material in D1, and sets the local session cookie.
- The React client never receives the authorization code, access token, refresh token, or ID token.

Configure the Entra app registration:

1. Add a platform redirect URI of type `web`.
2. Set the redirect URI to:

```text
https://<app-origin>/api/auth/oauth2/callback/microsoft-entra-id
```

3. Use a single-tenant app or set `MICROSOFT_ENTRA_TENANT_ID` to the authorized tenant GUID. Do not use `common`, `organizations`, or `consumers`.
4. Grant delegated Microsoft Graph scopes `openid`, `profile`, `email`, `offline_access`, and `User.Read`.
5. Create a client secret and store it only as the Cloudflare Secret `MICROSOFT_ENTRA_CLIENT_SECRET`.

Server-side environment values:

```text
MICROSOFT_ENTRA_CLIENT_ID=<application-client-id>
MICROSOFT_ENTRA_CLIENT_SECRET=<application-client-secret>
MICROSOFT_ENTRA_TENANT_ID=<authorized-tenant-guid>
BETTER_AUTH_SECRET=<strong-random-secret>
```

For Cloudflare deployment, set these as Worker environment variables or secrets before deploy. For local development, add them to `.dev.vars`; keep `.dev.vars` out of source control.

## Data Model

The primary D1 schema lives in [db/schema.ts](db/schema.ts). Supplemental SQL for artifact registry upload tables lives in [schema_updates.sql](schema_updates.sql).

Core tables:

- `workspaces`: Personal, Team, and Org scope records.
- `projects`: scoped projects.
- `chats`: workspace chats and project chats.
- `chat_messages`: chat history.
- `ideas`: scoped improvement ideas, owner attribution, AI analysis scores, rationale text, status, explicit pin state, and shareable authenticated route targets.
- `artifacts`: immutable artifact metadata, version lineage, commit messages, and R2 object keys.
- `artifacts_registry`: upload registry rows for asynchronous artifact ingestion, including R2 key, scope, tags, status, error, and chunk count.
- `document_chunks` and `document_chunks_v2`: D1 chunk text stores paired with Vectorize metadata for scoped RAG retrieval.
- `workspace_actions`: decisions, approvals, and tasks, including status, original assistant text, project scope, explicit pin state, and queued bidirectional Asana task sync metadata.
- `risks`: project-scoped risks with title, description, severity, status, and mitigation strategy.
- `organization`, `member`, and `invitation`: Better Auth organization plugin tables used for organization-aware roles.
- `microsoft_graph_subscriptions`: Teams and Outlook Graph webhook subscription tracking, including active Teams subscription counts for the 10,000 tenant limit.
- `microsoft_graph_webhook_deliveries`: audit rows for queued Graph webhook deliveries.
- `asana_project_webhooks`: project-level Asana webhook registry used to prevent duplicate subscriptions and repair failed setup.
- `asana_webhook_task_states`: latest verified Asana task webhook state by Asana task gid.

Generated Drizzle migrations are stored in `drizzle/`.

Artifact history is append-only. `artifacts.version` stores the integer version number, `artifacts.parent_artifact_id` points to the previous version row, and `artifacts.commit_message` describes the change that produced the row. Migration [drizzle/0008_artifact_versioning.sql](drizzle/0008_artifact_versioning.sql) adds these fields and supporting indexes. Updating or restoring an artifact must insert a new D1 row with a new R2 object key instead of overwriting or deleting the historical file.

## Ideas and AI Analysis

Ideas are persisted in D1 and scoped to the active Personal, Team, or Org workspace. New manually created ideas use the signed-in user's display name as owner; ideas captured from assistant suggestions use the owner extracted from the suggestion when available.

The Ideas rail uses the same workflow-row controls as Decisions, Approvals, and Tasks:

- pin or unpin the idea
- change status
- preview workflow context
- delete the idea

The details panel shows `AI analysis` for Impact, Effort, and Confidence. On create, the server asks Workers AI with Gemma 4 to score the idea against Vertex Education context and provide concise score explanations. The scores, hover explanations, consideration type, and consideration text are stored on the idea row through the existing `impact`, `effort`, `confidence`, `metrics_json`, `next_step`, and `thread_json` fields. The Refresh button reruns the analysis ad hoc, disables while the request is pending, and writes the refreshed values back to D1.

Ideas created manually or from assistant suggestions are not pinned automatically. Use the row or detail-panel pin control when an idea should appear in `Pinned Items`.

Share creates a normal authenticated app URL such as `/?mode=Team&tab=Ideas&idea=<id>&teamId=<id>`. It does not create magic links; unauthenticated users still go through the sign-in route.

## Cloudflare Bindings

Standalone Cloudflare deployment uses [wrangler.jsonc](wrangler.jsonc):

- `DB` -> D1 database `ai-command-center-db`
- `MICROSOFT_TOKEN_VAULT` -> KV namespace for AES-256-GCM encrypted Microsoft Graph access and refresh tokens
- `ASANA_WEBHOOK_SECRETS` -> KV namespace for Asana `X-Hook-Secret` values captured during webhook handshakes
- `ARTIFACTS_BUCKET` -> R2 bucket `ai-command-center-artifacts`
- `VECTORIZE` -> Vectorize index `ai-command-center-rag`
- `DOCUMENT_INGESTION_QUEUE` -> Queue for scoped RAG document ingestion
- `AUTONOMOUS_RESEARCH_QUEUE` -> Queue for background Firecrawl research indexing when projects or ideas are created
- `GRAPH_WEBHOOK_QUEUE` -> Queue for Microsoft Graph Teams and Outlook change notifications
- `ASANA_SYNC_QUEUE` -> Queue for creating approved VertexAI workflow tasks in Asana after the local D1 insert succeeds
- `AI` -> Workers AI binding for chat generation, intent routing, and embeddings
- `CLOUDFLARE_AI_GATEWAY_ID` -> AI Gateway name used by every inference request; defaults to `default`
- `CLOUDFLARE_AI_GATEWAY_ORGANIZATION_ID` -> optional organization dimension for Gateway spend-limit metadata; defaults to `vertex-education`
- `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_AI_GATEWAY_TOKEN`, or `CLOUDFLARE_AI_GATEWAY_PROVIDER_TOKEN` -> optional provider authorization token for universal AI Gateway requests; required when using code-level fallback arrays and `cf-aig-step` response headers
- `CLOUDFLARE_AI_GATEWAY_FALLBACK_MODEL_ID` -> optional fallback model used in authenticated AI Gateway fallback arrays for LLM requests; defaults to `@cf/meta/llama-3.2-1b-instruct`, or set to `none` to disable code-level fallback
- `CLOUDFLARE_AI_GATEWAY_REQUEST_TIMEOUT_MS` -> optional Gateway request timeout header in milliseconds for provider failover behavior
- `CHAT_SYNC` -> Durable Object namespace for chat presence and live chat events
- `TOKEN_VAULT_KEY` -> 32-byte base64 Cloudflare Secret used as the AES-256-GCM key for Microsoft Graph token encryption
- `MICROSOFT_ENTRA_CLIENT_ID`, `MICROSOFT_ENTRA_CLIENT_SECRET`, and `MICROSOFT_ENTRA_TENANT_ID` -> Cloudflare Secrets used for Microsoft sign-in and automatic Microsoft Graph token refresh
- `ASANA_WEBHOOK_SECRET` -> optional legacy fallback Cloudflare Secret used only when a per-workspace webhook secret has not been stored in `ASANA_WEBHOOK_SECRETS`
- `ASANA_WEBHOOK_ORIGIN` -> public Worker origin used when creating Asana webhook target URLs outside the browser request origin
- `ASANA_WEBHOOK_PROJECT_MAP` -> optional JSON environment value mapping Asana project or task gids to local project ids or `{ "projectId": "...", "chatId": "..." }` targets
- `ASANA_WEBHOOK_SOURCE_USER_ID` -> optional local user id used as the source for database mutation events created from verified Asana webhooks
- `ASANA_CLIENT_ID` and `ASANA_CLIENT_SECRET` -> Cloudflare Secrets used for Asana OAuth account connections and refresh-token rotation
- `TAVILY_API_KEY` and `FIRECRAWL_API_KEY` -> optional external web context providers; `FIRECRAWL_API_KEY` is required for the autonomous research consumer
- `FIRECRAWL_API_BASE_URL` -> optional autonomous research consumer override; defaults to `https://api.firecrawl.dev/v2/search`

All Workers AI inference is routed through [src/lib/ai-gateway.ts](src/lib/ai-gateway.ts). When provider authorization is configured, the wrapper calls the universal Cloudflare AI Gateway endpoint with `cf-aig-metadata` headers containing `user_id`, `org_id`, `workspace_id`, `team_id`, and `project_id`, then records `cf-aig-step`, `cf-aig-model`, `cf-aig-provider`, and `cf-aig-log-id` for admin usage review. A `cf-aig-step` greater than `0` is treated as a successful Gateway fallback, not an application error. When no provider token is configured, the wrapper uses the Workers AI binding Gateway path so inference still routes through AI Gateway without triggering universal-endpoint authentication errors.

The standalone Cloudflare Worker also defines a scheduler trigger:

```jsonc
"triggers": {
  "crons": ["0 * * * *"]
}
```

Cron schedules are UTC. The default schedule wakes the Worker hourly, then `src/lib/scheduled-tasks.ts` queries `scheduled_tasks` for due temporal jobs across the organization.

Codex Sites uses [.openai/hosting.json](.openai/hosting.json) for logical binding declarations:

```json
{
  "d1": "DB",
  "r2": "ARTIFACTS_BUCKET"
}
```

Note: Codex Sites is OpenAI-managed hosting. The root `wrangler.jsonc` is for Cloudflare-account controlled Workers/D1/R2 operations.

## Microsoft Graph Token Vault

Microsoft Graph token storage is implemented in [src/lib/microsoft-token-vault.ts](src/lib/microsoft-token-vault.ts). The helper encrypts access and refresh tokens with AES-256-GCM before writing them to the `MICROSOFT_TOKEN_VAULT` KV namespace, using `TOKEN_VAULT_KEY` from Cloudflare Secrets as the 256-bit encryption key.

Call `storeMicrosoftGraphTokens` after a Microsoft OAuth authorization-code exchange. Call `getValidMicrosoftGraphTokens` before Graph API requests; it decrypts the stored token set and automatically refreshes the access token when it is within five minutes of expiry, then re-encrypts and writes the refreshed token set back to KV.

Create and manage required secrets with Wrangler:

```powershell
$tokenVaultKey = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$tokenVaultKey | node ./scripts/run-wrangler.mjs secret put TOKEN_VAULT_KEY --config=./wrangler.jsonc

"<microsoft-client-id>" | node ./scripts/run-wrangler.mjs secret put MICROSOFT_ENTRA_CLIENT_ID --config=./wrangler.jsonc
"<microsoft-client-secret>" | node ./scripts/run-wrangler.mjs secret put MICROSOFT_ENTRA_CLIENT_SECRET --config=./wrangler.jsonc
"<tenant-id>" | node ./scripts/run-wrangler.mjs secret put MICROSOFT_ENTRA_TENANT_ID --config=./wrangler.jsonc
```

See [docs/microsoft-token-vault.md](docs/microsoft-token-vault.md) for the storage format and operational notes.

## Microsoft Graph Webhooks

Microsoft Graph Teams message and Outlook email change notifications are received at:

```text
POST /api/graph/webhooks
```

The route returns Microsoft validation tokens as `text/plain` and otherwise immediately sends notification JSON to `GRAPH_WEBHOOK_QUEUE` before returning `202 Accepted`. If enqueue fails, it returns `503` so Microsoft Graph retries instead of dropping the notification.

Queued jobs write delivery audit rows and keep `microsoft_graph_subscriptions` current. Teams resources are counted separately so subscription creation and renewal code can stay under the Microsoft Graph 10,000 Teams subscription limit with `assertMicrosoftGraphTeamsSubscriptionCapacity`.

See [docs/microsoft-graph-webhooks.md](docs/microsoft-graph-webhooks.md) for setup and operating notes.

## Asana OAuth And Webhook Integration

Asana account setup starts in Profile settings at `/profile/asana`.

- `Connect Asana` starts the OAuth 2.0 authorization-code flow with PKCE and a server-side state check.
- Access and refresh tokens are encrypted with AES-256-GCM and stored in the existing `MICROSOFT_TOKEN_VAULT` KV namespace under Asana-specific keys. Token material is not stored in D1 or exposed to the browser.
- The wizard lists projects discovered through the connected user's Asana team project memberships and portfolio memberships. Project write access is verified for selected mappings at save time and combined with the granted OAuth scopes.
- Users can map an Asana project to an existing VertexAI project or scaffold a new VertexAI project and project chat from the selected Asana project.
- Each saved mapping stores `can_write_tasks`. Task submission back to Asana is blocked unless the connected user has both `tasks:write` OAuth scope and confirmed Asana project-level write access.
- Tasks created from VertexAI workflow suggestions stay local until the user clicks Sync to Asana, unless the user enables auto-sync in Profile > Asana. The local D1 task is inserted first, then `ASANA_SYNC_QUEUE` creates the remote task out of band and writes the Asana task gid back to `workspace_actions`.
- Project-scoped tasks are added to the mapped Asana project without selecting a section, so Asana places them in the project's default task location. Non-project tasks are created in the connected user's Asana task list by setting `assignee` to that Asana user and using a single resolvable Asana workspace. Once a task has an Asana task gid, the Sync to Asana button is disabled and displayed as synced.
- Verified Asana webhook deliveries update `asana_webhook_task_states`, post system messages to mapped project chats, publish SSE invalidation events, and update matching local task title/status/sync-error fields when the Asana gid matches `workspace_actions.asana_task_gid`. Webhooks do not create unrelated local tasks or delete local task records.
- Asana's project membership and portfolio discovery endpoints currently require the OAuth app's Full permissions mode for this integration. Set `ASANA_USE_FULL_PERMISSIONS=true` and reconnect after enabling Full permissions in the Asana developer console when the mapping wizard must enforce membership/write-access guardrails.

Configure the Asana OAuth app with this redirect URI:

```text
https://<app-origin>/api/asana/oauth/callback
```

Create and manage required secrets with Wrangler:

```powershell
"<asana-client-id>" | node ./scripts/run-wrangler.mjs secret put ASANA_CLIENT_ID --config=./wrangler.jsonc
"<asana-client-secret>" | node ./scripts/run-wrangler.mjs secret put ASANA_CLIENT_SECRET --config=./wrangler.jsonc
"true" | node ./scripts/run-wrangler.mjs secret put ASANA_USE_FULL_PERMISSIONS --config=./wrangler.jsonc
```

The D1 schema for this flow lives in [drizzle/0013_asana_oauth_integration.sql](drizzle/0013_asana_oauth_integration.sql) and [db/schema.ts](db/schema.ts):

- `asana_oauth_states`: short-lived state and PKCE verifier records.
- `asana_connections`: connected Asana account metadata, granted scopes, and the user's auto-sync preference for newly created tasks.
- `asana_project_mappings`: Asana-to-VertexAI project links, project chat routing, and captured task-write permission.
- `asana_project_webhooks`: Asana project webhook gid, target URL, status, and last setup error.

## Asana Webhook Receiver

The Cloudflare Worker exposes `POST /api/webhooks/asana` for Asana task update webhooks.

- Configure each project-level Asana webhook target URL with `asanaWorkspaceGid` and `asanaProjectGid`, for example `https://<app-origin>/api/webhooks/asana?asanaWorkspaceGid=<asana-workspace-gid>&asanaProjectGid=<asana-project-gid>`. The workspace value is stored with task state, and the workspace plus project pair is the lookup key for that webhook's signing secret.
- New Asana project mappings automatically call Asana's webhook API after the mapping is saved. The receiver first checks `asana_project_webhooks`, then checks existing Asana webhooks for the same project/target when the connected token can read webhooks, and only creates a new webhook when no active matching webhook exists.
- The Profile > Asana page shows webhook status for each mapped project and includes a Repair webhooks action that re-runs this idempotent ensure flow for all mapped projects available to the connected user.
- During Asana's webhook handshake, the route stores the exact `X-Hook-Secret` value in the `ASANA_WEBHOOK_SECRETS` KV namespace and returns `200 OK` with the same `X-Hook-Secret` response header.
- For event deliveries, the route reads the raw request body, extracts `X-Hook-Signature` or `X-Asana-Request-Signature`, retrieves the stored workspace secret from KV, imports it with `crypto.subtle.importKey("raw", secretKeyData, { name: "HMAC", hash: "SHA-256" }, false, ["verify"])`, and validates the signature with `crypto.subtle.verify` before parsing JSON.
- Verified task updates are upserted into `asana_webhook_task_states` through Drizzle, then resolved through `asana_project_mappings` first and the optional env map second. Matching updates are inserted as system chat messages, published through `CHAT_SYNC`, and recorded in the D1 `events` table so `/api/chat-events` and `/sse/workspace-events` subscribers refresh through the existing SSE sync path.
- If the signature is valid but the payload cannot be mapped to a local project chat, the route returns `202` with `delivered: false` instead of guessing the destination.
- If the signature is missing or invalid, the route returns `401 Unauthorized` before parsing the event JSON.

Asana-enabled project chats also create durable Asana snapshots. The first retrieval stores a baseline in `asana_project_snapshots`; later retrievals compare the current tasks/status updates/stories to the latest snapshot. Changed snapshots are saved to R2 and queued through `DOCUMENT_INGESTION_QUEUE`, which embeds them into Vectorize through the existing scoped RAG document ingestion path.

The normal production path does not require pre-seeding an Asana webhook secret: Asana provides the secret during the creation handshake, and the Worker stores it in KV. `ASANA_WEBHOOK_SECRET` remains available only as a legacy fallback for older single-secret deployments.

For deterministic routing, configure a JSON project map. Keys can be Asana project gids or task gids:

```json
{
  "1200000000000001": { "projectId": "team-vertex-hub", "chatId": "team-vertex-hub-chat-1" },
  "1200000000000002": "org-enterprise-ai"
}
```

Without `ASANA_WEBHOOK_PROJECT_MAP`, the receiver attempts to match Asana project gids or project names to local `projects.id` or `projects.name`. Set `ASANA_WEBHOOK_SOURCE_USER_ID` when you want mutation rows attributed to a specific integration user; otherwise the receiver uses the first active admin or user account.

See [docs/asana-webhooks.md](docs/asana-webhooks.md) for setup and operating notes.

## D1 Setup

Generate migrations after schema changes:

```powershell
npm run db:generate
```

Apply incremental migrations to the configured remote D1:

```powershell
npm run db:migrate
```

Apply and seed local D1:

```powershell
npm run db:setup
node ./scripts/apply-incremental-migrations.mjs
npm run db:seed
```

`npm run db:setup` applies the base schema through `0009`; `scripts/apply-incremental-migrations.mjs` performs idempotent completion checks for later migrations, including risks, Better Auth organization tables, and the Asana sync queue timestamp.

Apply the artifact registry upload tables when an environment does not already have them:

```powershell
node ./scripts/run-wrangler.mjs d1 execute ai-command-center-db --config=./wrangler.jsonc --local --file=./schema_updates.sql
```

Apply and seed remote D1:

```powershell
npm run db:migrate:remote
npm run db:seed:remote
```

Seed SQL is in [db/seed/ai-command-center.sql](db/seed/ai-command-center.sql).

## R2 Setup

R2 seed files are stored under `r2-seed/` and mirror the object keys used in D1 artifact metadata.

Seed local R2:

```powershell
npm run r2:seed
```

Seed remote R2:

```powershell
npm run r2:seed:remote
```

The seed set includes separate DOCX, XLSX, and PPTX files for Personal, Team, and Org.

## Artifact Upload And Ingestion

Artifact registry uploads use [src/lib/artifact-upload.ts](src/lib/artifact-upload.ts). The upload server function requires `DB`, `ARTIFACTS_BUCKET`, and `DOCUMENT_INGESTION_QUEUE`, writes the raw file buffer directly to R2, inserts an `artifacts_registry` row with `status = pending`, publishes an `artifact-registry-upload` queue job, and returns HTTP `202 Accepted` with `{ status: "queued" }`.

The document ingestion consumer in [src/document-ingestion-worker.ts](src/document-ingestion-worker.ts) is deployed separately with [wrangler.document-ingestion.jsonc](wrangler.document-ingestion.jsonc). It retrieves the R2 object, extracts text, chunks Markdown by headings and paragraph breaks, embeds chunks with Workers AI through the AI Gateway wrapper, clamps Vectorize metadata to the 2048-byte limit, upserts vectors, writes D1 chunk rows, and updates the registry row to `processing`, `completed`, or `failed`.

## Autonomous Research Indexing

Autonomous research indexing does not require a user-facing setting. When a manager or admin creates a project, imports a project from Asana, adds an idea manually, or creates an idea from an assistant suggestion, the backend publishes a small payload to `AUTONOMOUS_RESEARCH_QUEUE`. If the queue binding is missing or enqueue fails, the create action still succeeds and the failure is logged.

Admin setup requirements:

- Create the `autonomous-research-queue` Cloudflare Queue.
- Set `FIRECRAWL_API_KEY` as a secret for the autonomous research Worker.
- Deploy [wrangler.autonomous-research.jsonc](wrangler.autonomous-research.jsonc) with `npm run deploy:autonomous-research`.
- Keep `AUTONOMOUS_RESEARCH_QUEUE` configured as a producer binding in [wrangler.jsonc](wrangler.jsonc).

The consumer in [src/autonomous-research-worker.ts](src/autonomous-research-worker.ts) routes queue batches into [src/lib/autonomous-research-queue.ts](src/lib/autonomous-research-queue.ts). The processor extracts the core project or idea text, builds up to three optimized Firecrawl search queries, accepts Markdown results from Firecrawl, chunks the Markdown through the shared document ingestion helper, embeds with `@cf/baai/bge-large-en-v1.5`, writes D1 `document_chunks`, and upserts Vectorize vectors with metadata including `source: "autonomous_research"`, `entity_type`, `entity_id`, `workspace_id`, `project_id`, `source_url`, `source_domain`, and `search_query`.

## Scoped RAG Streaming

Team project chat can use scoped RAG when the Cloudflare bindings are configured. The current browser path connects to:

```text
GET /sse/workspace-events?stream=scoped-rag&prompt=...&teamId=...&workspaceId=...&projectId=...&chatId=...
```

The legacy route `GET /api/scoped-rag-stream?...` remains as a compatibility wrapper around the same stream helper. The shared route validates access, retrieves project context, classifies the prompt intent, and then runs only the required backend path. It returns Server-Sent Events:

- `trace`: resolved prompt, model, reasoning, and context diagnostics for the LLM dev tools
- `citations`: matched artifact metadata
- `thinking`: streamed reasoning text when the selected model returns it
- `token`: incremental Markdown response text
- `entities`: extracted tasks, approvals, ideas, and risks from the completed turn
- `done`: normal stream completion
- `stream-error`: validation, retrieval, or model failure inside the SSE protocol

The chat UI consumes this endpoint with the browser `EventSource` API and appends tokens to the optimistic assistant message as they arrive. See [docs/rag-infrastructure.md](docs/rag-infrastructure.md) for setup commands and the full event contract.

## Workspace Realtime And Optimistic UI

Broader workspace mutations stream through:

```text
GET /sse/workspace-events?mode=Team&teamId=...&clientId=...
```

[src/features/command-center/use-workspace-events.ts](src/features/command-center/use-workspace-events.ts) opens this EventSource, resumes from `Last-Event-ID` or the stored `lastEventId`, ignores events produced by the same browser `clientId`, and invalidates TanStack Query caches for workspace, team, project, and chat data based on each event's `invalidates` list. The server route polls D1 `events` every 2.5 seconds for `chat_message`, `idea`, `task`, and `asana_task` mutations scoped to the current Personal, Team, or Org view.

Interactive command-center actions use TanStack Query optimistic cache updates where latency would otherwise be visible. Chat send inserts an optimistic user message with `clientStatus = sending`, scoped RAG inserts optimistic user and assistant messages before SSE tokens arrive, task creation inserts a temporary `optimistic-task-*` row with `clientStatus = pending`, and task removal/artifact pin/save flows snapshot the previous cache and roll back on mutation failure. Failures surface through the shared toast area with the failing operation included in the message.

### Role-Based LLM Guardrails

Scoped RAG enforces RBAC at the inference layer. Before generation, the backend validates team/project membership, re-queries the active user's role from the D1 `"user"` table, and injects an absolute authorization directive into the system prompt before workspace context, web context, historical chunks, or the user's message.

The directive tells the model the user role and requires viewer users to be refused for state-changing requests or summaries of restricted artifacts. `Admin`, `Manager`, and `Contributor` users are treated as having confidential artifact retrieval clearance; `Viewer` users are not.

Vectorize retrieval also applies the role before chunks are returned. New indexed chunks carry `confidentiality` and `restricted` metadata, and viewer queries exclude chunks marked `Confidential` or `restricted = true` in the Vectorize metadata filter before D1 chunk text is loaded into the prompt context. Generated scoped RAG artifacts can pass `sensitivityLabel: "Confidential"` or `restricted: true` to `ingestGeneratedArtifact`. Create Vectorize metadata indexes for `team_id`, `project_id`, `confidentiality`, and `restricted`; reingest older vectors when confidentiality metadata must be applied to existing artifacts.

### Dynamic Multi-Modal Rendering

Assistant responses and artifact previews share [src/components/ArtifactRenderer.tsx](src/components/ArtifactRenderer.tsx). The renderer accepts streaming Markdown or structured preview JSON and converts known shapes into interactive workspace UI:

- Markdown tables render through the shared Table primitives, while preserving normal HTML table output for CSV/XLSX export and artifact save flows.
- Markdown uses `react-markdown`, `remark-gfm`, `remark-math`, and `rehype-katex` so standard GFM and inline or block LaTeX math render without a user or admin setting. Loose visible LaTeX arrow commands such as `\rightarrow` are normalized in ordinary chat text while fenced code, inline code, and real math spans stay protected.
- Code previews use PrismJS-backed syntax highlighting for supported executable/source formats without introducing a separate component library.
- Structured preview JSON from document or vision extraction, including extracted tables, cell grids, field maps, and row arrays, renders through the shared Radix Table primitives.
- Markdown list items that match current approvals, decisions, ideas, or tasks, or include explicit markers such as `approval:team-approval-1`, `decision:team-decision-1`, `idea:team-idea-1`, or `task:team-task-1`, render inline workflow actions.
- When the user asks the assistant for ideas, suggestion-sized list items can surface an `Actions -> Add Idea` affordance even when each line does not literally contain the word "idea".
- JSON schemas containing `pendingApprovals`, `approvals`, `decisions`, `ideas`, `suggestedIdeas`, `assignedTasks`, or `tasks` arrays render as workflow action rows instead of plain code when they describe workflow items.
- JSON blocks with `schema: "vertex.risk.v1"` render as inline `Risk Flag` chips and deep-link into the command-center Risks page when workspace and project identifiers are present.
- Inline workflow actions create persisted ideas, approvals, decisions, or tasks through the same server-side permission checks and D1-backed workspace refresh path as the corresponding tabs.
- Chat rendering also runs a scoped post-render text cleanup for legacy or over-escaped streamed arrow commands; it only walks the current chat container after message changes and skips `code`, `pre`, `kbd`, `samp`, and KaTeX nodes.

Recommended assistant patterns:

```markdown
## Pending Approvals

- [ ] approval:team-approval-1 Confirm launch readiness sign-off

## Assigned Tasks

- [ ] task:team-task-1 Package Vertex Hub roadmap evidence

## Suggested Ideas

- idea:team-idea-1 Add a lightweight launch-readiness checklist to project chats
```

```json
{
  "pendingApprovals": [
    { "id": "team-approval-1", "title": "Confirm launch readiness sign-off", "owner": "Maya Chen", "due": "Due Jun 14" }
  ],
  "assignedTasks": [
    { "id": "team-task-1", "title": "Package Vertex Hub roadmap evidence", "owner": "Maya Chen", "source": "Vertex Hub Roadmap Brief" }
  ],
  "suggestedIdeas": [{ "title": "Add a lightweight launch-readiness checklist to project chats", "owner": "Maya Chen" }]
}
```

Risk flag schema:

```json
{
  "schema": "vertex.risk.v1",
  "kind": "risk",
  "risk": {
    "id": "risk-launch-dependency",
    "workspace_id": "ws-team",
    "project_id": "team-vertex-hub",
    "title": "Launch dependency",
    "description": "Launch readiness depends on unresolved acceptance criteria.",
    "severity": "critical",
    "status": "open",
    "mitigation_strategy": ""
  }
}
```

### Risk Management

The command-center Risks page uses the `risks` table and [src/features/command-center/workflow.tsx](src/features/command-center/workflow.tsx). Risks are scoped by the active Personal, Team, or Org workspace tab and shown exhaustively across all projects in that selected scope. The grid supports search, project filtering, severity filtering, status filtering, critical-risk summary counts, preview, and AI-generated mitigation strategies.

Project RAG responses use one risk detection contract in [src/lib/risk-contract.ts](src/lib/risk-contract.ts). When a risk is detected, the assistant can append a `vertex.risk.v1` JSON block so [src/components/ArtifactRenderer.tsx](src/components/ArtifactRenderer.tsx) can render an inline `Risk Flag` chip in the chat feed without exposing raw JSON. When that chat turn is persisted, [src/lib/team-workflow.ts](src/lib/team-workflow.ts) saves the same normalized risk entity into the `risks` table so the same operational risk appears in the command-center Risks page. The chip is the immediate chat surface; the Risks page is the durable workspace/project record. Viewer users can read risks; mitigation generation requires risk update permission.

### Dynamic Workspace Context Injection

Before any main generation call, the backend queries D1 for the active `workspaces` and `projects` records using the current `workspaceId` and `projectId` scope identifiers. It prepends a priority context block to the system prompt with:

- workspace name
- active project name
- active project status, including operational labels such as `Blocked` or `In Progress`
- detailed project description

This block is placed at the absolute top of the system prompt before RAG chunks, web context, attachments, chat history, or the user's message. The shared prompt helper lives in [src/lib/prompts.ts](src/lib/prompts.ts); scoped streaming and regular persisted chat generation wire it in through [src/lib/rag.ts](src/lib/rag.ts) and [src/lib/pmo-data.ts](src/lib/pmo-data.ts).

### Context-Aware Agentic Routing

Before retrieval work, scoped project chat calls the lightweight intent router in [src/lib/intent-routing.ts](src/lib/intent-routing.ts). The router uses `@cf/zai-org/glm-4.7-flash` with turn-level thinking disabled to return one strict label:

- `RAG_SEARCH`: embed the prompt, query Vectorize with team/project and role-sensitive confidentiality metadata filters, load cited chunks, and stream a grounded answer.
- `WEB_SEARCH`: call the configured external search providers, load scoped historical chunks with role-sensitive confidentiality filters, and stream an answer grounded in both live web context and project history.
- `DIRECT_CHAT`: bypass Vectorize and web search, then send the prompt directly to the primary generation model with workspace/project context.
- `ENTITY_EXTRACTION`: bypass Vectorize and web search, then extract prompt-local operational entities such as tasks, approvals, risks, ideas, owners, and deadlines.
- `ARTIFACT_GENERATION`: bypass Vectorize and web search, then use the primary generation model to draft the requested artifact.

If intent classification fails, the route falls back to `RAG_SEARCH` so project-history questions remain evidence-first.

## Scheduled Project Briefings

The Worker scheduled handler in [src/worker.ts](src/worker.ts) calls `runScheduledTaskEngine` in [src/lib/scheduled-tasks.ts](src/lib/scheduled-tasks.ts) once per configured cron run. The engine claims due rows from `scheduled_tasks`, dispatches by type, and routes `Weekly Briefing` tasks into `runDailyProjectBriefings` in [src/lib/daily-briefings.ts](src/lib/daily-briefings.ts).

User-defined schedules:

- Can be daily, weekdays, weekly, monthly, or one-time.
- Store project scope, local time, time zone, reporting window, and custom prompt instructions in D1.
- Automatically target a dedicated `Briefings` project chat. The app creates that thread when needed and treats it as read-only for normal user chat, rename, and delete actions.
- Query project-scoped chat transcripts, closed Asana-linked tasks, completed Asana webhook task states, newly surfaced risk signals, current risks, and modified artifacts for the configured reporting window. Weekly schedules default to the preceding seven days.
- Compact the source payload into XML-bounded context, send it to the Gemma 4 reasoning model through the AI Gateway wrapper, and require a structured executive Markdown briefing grounded in the supplied material.
- Insert the generated Markdown as an automated assistant message in the `Briefings` thread and record a realtime mutation event so SSE subscribers refresh project/chat state.
- Record `briefing_runs`, `last_run_at`, `last_status`, `last_error`, and `next_run_at` so retries and future runs are auditable.

Generated messages include an internal marker so a retried schedule execution does not insert the same briefing twice. Legacy Org daily briefing helpers remain in [src/lib/daily-briefings.ts](src/lib/daily-briefings.ts), but the active Worker scheduler path runs user-defined schedules.

Settings and deployment notes:

- Admins can review, create, enable, disable, edit retry/schedule settings, and queue central scheduler rows from Admin Settings > Scheduled Tasks.
- Users configure briefing cadence, project scope, local run time, time zone, reporting window, and prompt instructions from Profile > Briefings. The destination is fixed to the project's `Briefings` thread.
- The Cloudflare-account Worker deployment path must have the existing `DB`, `AI`, and `CHAT_SYNC` bindings plus the cron-backed scheduled task engine enabled. Uploaded-artifact registry inputs use `artifacts_registry` when that table exists; missing registry rows are skipped rather than blocking the briefing.
- Admin queue actions update `scheduled_tasks.next_run_at`; the hourly cron-backed Worker still performs the long-running orchestration under its configured scheduled-worker CPU allowance.

### Hybrid External Search

The hybrid web search path is implemented in [src/lib/rag.ts](src/lib/rag.ts). `fetchConsolidatedWebSearch` runs Tavily and Firecrawl requests concurrently with `Promise.allSettled()`, requests a Tavily AI summary, requests Firecrawl Markdown extraction, records provider usage, and returns successful output even when one provider fails or times out.

For `WEB_SEARCH` intent, the generation prompt includes a `Real-Time Web Context` section alongside scoped D1-backed historical chunks for the active team project.

## Artifact Files

Public artifact download copies live in `public/artifacts/`.

R2 source seed copies live in:

- `r2-seed/personal/artifacts/`
- `r2-seed/team/artifacts/`
- `r2-seed/org/artifacts/`

The D1 `artifacts.r2_key` values match the R2 object paths.

Generated artifact updates use immutable versioning:

- New artifacts start at `version = 1` with no parent artifact.
- Updating an artifact stores a fresh R2 object under a versioned key and inserts a new `artifacts` row whose `parent_artifact_id` references the previous latest version.
- AI diff updates are available from an artifact detail panel's `AI diff` action for users with artifact edit permission. The user describes the requested alteration, Kimi K2.7 Code drafts a strict JSON patch delta, the browser applies that delta locally for red/green review, and approval commits the unified text as the next immutable R2/D1 version.
- The UI shows a version history timeline in the artifact detail panel. Historical versions can be previewed read-only.
- Restore does not overwrite the current file. It copies the selected historical R2 object into a new versioned R2 key and inserts a new latest D1 row with a restore commit message.
- Destructive artifact deletion is blocked so existing database rows and R2 objects preserve project decision history.

AI diff settings and limits:

- No new admin-facing toggle is required. Access follows the existing RBAC matrix: Viewer users do not see the action; Contributor, Manager, and Admin users can use it where artifact updates are allowed.
- No user preference is required. The feature uses the existing `DB`, `ARTIFACTS_BUCKET`, `AI`, and Cloudflare AI Gateway configuration.
- The patch model is `@cf/moonshotai/kimi-k2.7-code`, configured as `artifactDiffModelId` in [src/lib/prompts.ts](src/lib/prompts.ts).
- Patch review currently supports UTF-8 text-like R2 artifacts: Markdown, TXT, JSON, YAML, XML, and CSV. Binary Office containers are rejected rather than rewritten unsafely.
- Approval is stale-state guarded. If the artifact's latest R2 key changed after the draft was generated, the user must regenerate the patch before committing.

## Deployment

For Codex Sites:

1. Run `npm run build`.
2. Save and deploy through the Sites connector.

For a Cloudflare-account Worker deployment:

1. Run `npm run build`.
2. Confirm `wrangler.jsonc` points to the desired D1 database, R2 bucket, KV namespaces, Vectorize index, queues, and Durable Object namespace.
3. Deploy the main Worker:

```powershell
npx wrangler deploy --config=./wrangler.jsonc
```

Deploy the document ingestion queue consumer separately:

```powershell
npm run deploy:document-ingestion
```

Deploy the autonomous research queue consumer separately:

```powershell
npm run deploy:autonomous-research
```

## Useful Commands

```powershell
npm run dev
npm run build
npm run lint
npm run deploy
npm run deploy:document-ingestion
npm run deploy:autonomous-research
npm run cf-typegen
npm run db:generate
npm run db:migrate
npm run db:seed
npm run db:migrate:remote
npm run db:seed:remote
npm run r2:seed
npm run r2:seed:remote
```

## Operational Notes

- Remote D1 has been created as `ai-command-center-db`.
- Remote R2 has been created as `ai-command-center-artifacts`.
- Both remote D1 and R2 have been seeded with scoped dummy data.
- `worker-configuration.d.ts` is generated by Wrangler and should be refreshed after binding changes.
- Keep `.openai/hosting.json` and `wrangler.jsonc` aligned on binding names used by the deployed surface. The Cloudflare Worker path currently expects `DB`, `ARTIFACTS_BUCKET`, `VECTORIZE`, `DOCUMENT_INGESTION_QUEUE`, `AUTONOMOUS_RESEARCH_QUEUE`, `GRAPH_WEBHOOK_QUEUE`, `ASANA_SYNC_QUEUE`, `AI`, `CHAT_SYNC`, `MICROSOFT_TOKEN_VAULT`, and `ASANA_WEBHOOK_SECRETS`.
- The briefing scheduler cron and Queue consumers are only configured in the Cloudflare-account Worker deployment path. Codex Sites hosting may not execute `wrangler.jsonc` cron triggers or queue consumers.
