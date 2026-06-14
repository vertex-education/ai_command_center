# Vertex AI Command Center

Vertex AI Command Center is a TanStack Start workspace app for AI-assisted chat, project, idea, task, decision, approval, and artifact workflows.

The app is organized around three explicit workspace scopes:

- `Personal`: personal projects, project chats, and personal chats.
- `Team`: team projects, project chats, and team chats.
- `Org`: org projects, project chats, and org chats.

Each scope has its own projects, chats, ideas, artifacts, decisions, approvals, tasks, activity, and seed data. The UI is designed so lower scopes do not surface higher-scope information, and switching a project dynamically changes the `Project Chats` section for the selected workspace.

Pinned ideas, approvals, decisions, tasks, and artifacts render in a `Pinned Items` rail above the workspace tabs. Pinning is explicit: newly created workflow items do not auto-load into the rail. The rail stays scoped to the active workspace or selected project, shows only items the user pins, and only displays left or right carousel buttons when the pinned cards overflow the available width. Each arrow click moves to the next card boundary so the next pinned item is fully visible.

## Stack

- React 19
- TanStack Start, Router, Query, Form, and Table
- Vite
- Tailwind CSS
- Drizzle ORM
- Cloudflare Workers runtime
- Cloudflare D1 for structured workspace data
- Cloudflare KV for encrypted Microsoft Graph token storage
- Cloudflare R2 for artifact files
- Cloudflare Workers AI for assistant responses, embeddings, and prompt intent routing
- Cloudflare Vectorize for scoped RAG artifact retrieval
- Cloudflare Queues for document ingestion jobs and Microsoft Graph webhook fan-out
- Cloudflare Cron Triggers for automated daily project status briefings
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

## Authentication

Better Auth manages local sessions, invite-only email/password accounts, and Microsoft Entra ID sign-in.

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

The D1 schema lives in [db/schema.ts](db/schema.ts).

Core tables:

- `workspaces`: Personal, Team, and Org scope records.
- `projects`: scoped projects.
- `chats`: workspace chats and project chats.
- `chat_messages`: chat history.
- `ideas`: scoped improvement ideas, owner attribution, AI analysis scores, rationale text, status, explicit pin state, and shareable authenticated route targets.
- `artifacts`: immutable artifact metadata, version lineage, commit messages, and R2 object keys.
- `workspace_actions`: decisions, approvals, and tasks, including status, original assistant text, project scope, and explicit pin state.
- `microsoft_graph_subscriptions`: Teams and Outlook Graph webhook subscription tracking, including active Teams subscription counts for the 10,000 tenant limit.
- `microsoft_graph_webhook_deliveries`: audit rows for queued Graph webhook deliveries.

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
- `ARTIFACTS_BUCKET` -> R2 bucket `ai-command-center-artifacts`
- `VECTORIZE` -> Vectorize index `ai-command-center-rag`
- `DOCUMENT_INGESTION_QUEUE` -> Queue for scoped RAG document ingestion
- `GRAPH_WEBHOOK_QUEUE` -> Queue for Microsoft Graph Teams and Outlook change notifications
- `AI` -> Workers AI binding for chat generation, intent routing, and embeddings
- `CHAT_SYNC` -> Durable Object namespace for chat presence and live chat events
- `TOKEN_VAULT_KEY` -> 32-byte base64 Cloudflare Secret used as the AES-256-GCM key for Microsoft Graph token encryption
- `MICROSOFT_ENTRA_CLIENT_ID`, `MICROSOFT_ENTRA_CLIENT_SECRET`, and `MICROSOFT_ENTRA_TENANT_ID` -> Cloudflare Secrets used for Microsoft sign-in and automatic Microsoft Graph token refresh
- `ASANA_WEBHOOK_SECRET` -> Cloudflare Secret used to verify Asana webhook HMAC-SHA256 signatures before accepting task updates
- `ASANA_WEBHOOK_PROJECT_MAP` -> optional JSON environment value mapping Asana project or task gids to local project ids or `{ "projectId": "...", "chatId": "..." }` targets
- `ASANA_WEBHOOK_SOURCE_USER_ID` -> optional local user id used as the source for database mutation events created from verified Asana webhooks
- `ASANA_CLIENT_ID` and `ASANA_CLIENT_SECRET` -> Cloudflare Secrets used for Asana OAuth account connections and refresh-token rotation
- `TAVILY_API_KEY` and `FIRECRAWL_API_KEY` -> optional external web context providers

The standalone Cloudflare Worker also defines a daily cron trigger:

```jsonc
"triggers": {
  "crons": ["0 12 * * *"]
}
```

Cron schedules are UTC. The default schedule runs the proactive project status briefing job at `12:00 UTC` daily.

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
- The wizard lists only projects where the connected Asana user has a project membership. Each project is probed for Asana membership write access and combined with the granted OAuth scopes.
- Users can map an Asana project to an existing VertexAI project or scaffold a new VertexAI project and project chat from the selected Asana project.
- Each saved mapping stores `can_write_tasks`. Task submission back to Asana is blocked unless the connected user has both `tasks:write` OAuth scope and confirmed Asana project-level write access.

Configure the Asana OAuth app with this redirect URI:

```text
https://<app-origin>/api/asana/oauth/callback
```

Create and manage required secrets with Wrangler:

```powershell
"<asana-client-id>" | node ./scripts/run-wrangler.mjs secret put ASANA_CLIENT_ID --config=./wrangler.jsonc
"<asana-client-secret>" | node ./scripts/run-wrangler.mjs secret put ASANA_CLIENT_SECRET --config=./wrangler.jsonc
```

The D1 schema for this flow lives in [drizzle/0013_asana_oauth_integration.sql](drizzle/0013_asana_oauth_integration.sql) and [db/schema.ts](db/schema.ts):

- `asana_oauth_states`: short-lived state and PKCE verifier records.
- `asana_connections`: connected Asana account metadata and granted scopes.
- `asana_project_mappings`: Asana-to-VertexAI project links, project chat routing, and captured task-write permission.

## Asana Webhook Receiver

The Cloudflare Worker exposes `POST /api/asana-webhook` for Asana task update webhooks.

- During Asana's webhook handshake, the route echoes `X-Hook-Secret` and returns `204`.
- For event deliveries, the route reads the raw request body, extracts `X-Asana-Request-Signature` or Asana's standard `X-Hook-Signature`, computes an HMAC-SHA256 digest with `ASANA_WEBHOOK_SECRET`, and compares the signatures before parsing JSON.
- Verified task updates are resolved through `asana_project_mappings` first, then the legacy optional env map. Matching updates are inserted as system chat messages, published through `CHAT_SYNC`, and recorded in the D1 `events` table so `/api/chat-events` and `/api/events` subscribers refresh through the existing SSE sync path.
- If the signature is valid but the payload cannot be mapped to a local project chat, the route returns `202` with `delivered: false` instead of guessing the destination.

Set the required secret with Wrangler:

```powershell
"<asana-webhook-secret>" | node ./scripts/run-wrangler.mjs secret put ASANA_WEBHOOK_SECRET --config=./wrangler.jsonc
```

For deterministic routing, configure a JSON project map. Keys can be Asana project gids or task gids:

```json
{
  "1200000000000001": { "projectId": "team-vertex-hub", "chatId": "team-vertex-hub-chat-1" },
  "1200000000000002": "org-enterprise-ai"
}
```

Without `ASANA_WEBHOOK_PROJECT_MAP`, the receiver attempts to match Asana project gids or project names to local `projects.id` or `projects.name`. Set `ASANA_WEBHOOK_SOURCE_USER_ID` when you want mutation rows attributed to a specific integration user; otherwise the receiver uses the first active admin or user account.

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

## Scoped RAG Streaming

Team project chat can use scoped RAG when the Cloudflare bindings are configured. The browser connects to:

```text
GET /api/scoped-rag-stream?prompt=...&teamId=...&workspaceId=...&projectId=...
```

The route validates access, retrieves project context, classifies the prompt intent, and then runs only the required backend path. It returns Server-Sent Events:

- `citations`: matched artifact metadata
- `token`: incremental Markdown response text
- `done`: normal stream completion
- `stream-error`: validation, retrieval, or model failure inside the SSE protocol

The chat UI consumes this endpoint with the browser `EventSource` API and appends tokens to the optimistic assistant message as they arrive. See [docs/rag-infrastructure.md](docs/rag-infrastructure.md) for setup commands and the full event contract.

### Role-Based LLM Guardrails

Scoped RAG enforces RBAC at the inference layer. Before generation, the backend validates team/project membership, re-queries the active user's role from the D1 `"user"` table, and injects an absolute authorization directive into the system prompt before workspace context, web context, historical chunks, or the user's message.

The directive tells the model the user role and requires viewer users to be refused for state-changing requests or summaries of restricted artifacts. `admin` and `user` roles are treated as having confidential artifact retrieval clearance; `viewer` is not.

Vectorize retrieval also applies the role before chunks are returned. New indexed chunks carry `confidentiality` and `restricted` metadata, and viewer queries exclude chunks marked `Confidential` or `restricted = true` in the Vectorize metadata filter before D1 chunk text is loaded into the prompt context. Generated scoped RAG artifacts can pass `sensitivityLabel: "Confidential"` or `restricted: true` to `ingestGeneratedArtifact`. Create Vectorize metadata indexes for `team_id`, `project_id`, `confidentiality`, and `restricted`; reingest older vectors when confidentiality metadata must be applied to existing artifacts.

### Dynamic Multi-Modal Rendering

Assistant responses and artifact previews share [src/components/ArtifactRenderer.tsx](src/components/ArtifactRenderer.tsx). The renderer accepts streaming Markdown or structured preview JSON and converts known shapes into interactive workspace UI:

- Markdown tables render through the shared Table primitives, while preserving normal HTML table output for CSV/XLSX export and artifact save flows.
- Markdown list items that match current approvals, decisions, ideas, or tasks, or include explicit markers such as `approval:team-approval-1`, `decision:team-decision-1`, `idea:team-idea-1`, or `task:team-task-1`, render inline workflow actions.
- When the user asks the assistant for ideas, suggestion-sized list items can surface an `Actions -> Add Idea` affordance even when each line does not literally contain the word "idea".
- JSON schemas containing `pendingApprovals`, `approvals`, `decisions`, `ideas`, `suggestedIdeas`, `assignedTasks`, or `tasks` arrays render as workflow action rows instead of plain code when they describe workflow items.
- Inline workflow actions create persisted ideas, approvals, decisions, or tasks through the same server-side permission checks and D1-backed workspace refresh path as the corresponding tabs.

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
  "suggestedIdeas": [
    { "title": "Add a lightweight launch-readiness checklist to project chats", "owner": "Maya Chen" }
  ]
}
```

### Dynamic Workspace Context Injection

Before any main generation call, the backend queries D1 for the active `workspaces` and `projects` records using the current `workspaceId` and `projectId` scope identifiers. It prepends a priority context block to the system prompt with:

- workspace name
- active project name
- active project status, including operational labels such as `Blocked` or `In Progress`
- detailed project description

This block is placed at the absolute top of the system prompt before RAG chunks, web context, attachments, chat history, or the user's message. The shared prompt helper lives in [src/lib/prompts.ts](src/lib/prompts.ts); scoped streaming and regular persisted chat generation wire it in through [src/lib/rag.ts](src/lib/rag.ts) and [src/lib/pmo-data.ts](src/lib/pmo-data.ts).

### Context-Aware Agentic Routing

Before retrieval work, scoped project chat calls the lightweight intent router in [src/lib/intent-routing.ts](src/lib/intent-routing.ts). The router uses `@cf/meta/llama-3-8b-instruct` to return one strict label:

- `RAG_SEARCH`: embed the prompt, query Vectorize with team/project and role-sensitive confidentiality metadata filters, load cited chunks, and stream a grounded answer.
- `WEB_SEARCH`: call the configured external search providers, load scoped historical chunks with role-sensitive confidentiality filters, and stream an answer grounded in both live web context and project history.
- `DIRECT_CHAT`: bypass Vectorize and web search, then send the prompt directly to the primary generation model with workspace/project context.
- `ARTIFACT_GENERATION`: bypass Vectorize and web search, then use the primary generation model to draft the requested artifact.

If intent classification fails, the route falls back to `RAG_SEARCH` so project-history questions remain evidence-first.

## Proactive Project Status Briefs

The Worker scheduled handler in [src/worker.ts](src/worker.ts) calls [src/lib/daily-briefings.ts](src/lib/daily-briefings.ts) once per configured cron run.

Daily briefings:

- Run for Org-scope projects with status `Active`, `In Progress`, or `Watch`.
- Use the preceding 24 hours from the scheduled execution time.
- Query D1 for project-scoped mutation rows, newly inserted ideas, artifact mutation events, and project chat messages.
- Send the aggregated activity to the Workers AI binding with instructions to produce a concise Markdown executive summary with `Key Decisions`, `Artifact Updates`, and `Active Blockers`.
- Create or reuse a project chat titled `Daily Briefings`.
- Insert the generated Markdown as an assistant `chat_messages` row in that project's `Daily Briefings` thread.

Each generated message includes an internal date marker so a retried cron execution does not insert a duplicate briefing for the same project and UTC date. If Workers AI is unavailable, the job inserts a conservative fallback briefing rather than inventing status details.

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
- The UI shows a version history timeline in the artifact detail panel. Historical versions can be previewed read-only.
- Restore does not overwrite the current file. It copies the selected historical R2 object into a new versioned R2 key and inserts a new latest D1 row with a restore commit message.
- Destructive artifact deletion is blocked so existing database rows and R2 objects preserve project decision history.

## Deployment

For Codex Sites:

1. Run `npm run build`.
2. Save and deploy through the Sites connector.

For a Cloudflare-account Worker deployment:

1. Run `npm run build`.
2. Confirm `wrangler.jsonc` points to the desired D1 database and R2 bucket.
3. Run:

```powershell
npx wrangler deploy --config=./wrangler.jsonc
```

## Useful Commands

```powershell
npm run dev
npm run build
npm run lint
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
- Keep `.openai/hosting.json` and `wrangler.jsonc` aligned on binding names used by the deployed surface. The Cloudflare Worker path currently expects `DB`, `ARTIFACTS_BUCKET`, `VECTORIZE`, `DOCUMENT_INGESTION_QUEUE`, `AI`, and `CHAT_SYNC`.
- The proactive daily briefing cron is only configured in the Cloudflare-account Worker deployment path. Codex Sites hosting may not execute `wrangler.jsonc` cron triggers.
