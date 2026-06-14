# VertexAI Feature Catalog

This catalog documents the implemented VertexAI Command Center feature set and points each feature to its primary runtime files, data stores, and Vitest coverage. It is intended to complement the setup-focused [README](../README.md).

## Product Model

VertexAI is a scoped AI command center for personal, team, and organization work. The core interaction model is a Project Studio: users move between workspaces, projects, chats, workflow rails, artifact previews, and integrations without leaving the active scope.

| Feature area | User-facing behavior | Primary implementation | Test coverage |
| --- | --- | --- | --- |
| Workspace scopes | Personal, Team, and Org scopes isolate projects, chats, ideas, artifacts, decisions, approvals, tasks, risks, prompts, and activity. | `src/lib/pmo-data.ts`, `src/routes/index.tsx` | `src/lib/pmo-data.test.ts`, `src/lib/risk-feature.test.ts` |
| Project chats and workspace chats | Project selection changes the Project Chats list while workspace chats remain scope-level. | `src/lib/pmo-data.ts`, `src/lib/team-workflow.ts` | `src/lib/pmo-data.test.ts` |
| Pinned items rail | Explicitly pinned ideas, artifacts, decisions, approvals, tasks, and risks appear in the pinned carousel for the active scope or project. | `src/routes/index.tsx`, `src/lib/pmo-data.ts` | `src/lib/risk-feature.test.ts`, `src/lib/asana-task-sync-state.test.ts` |
| Team and project management | Users can create teams, projects, scoped chats, chat branches, project instructions, and scoped invites. | `src/lib/team-workflow.ts`, `src/routes/profile/invites.tsx` | Runtime behavior is covered through helper-level tests and route build checks. |

## AI Chat And Prompting

| Feature | Behavior | Primary implementation | Test coverage |
| --- | --- | --- | --- |
| VertexAI assistant prompt | The assistant can answer general questions and use scoped command-center records only when relevant. | `src/lib/prompts.ts` | `src/lib/prompts.test.ts` |
| Dynamic workspace context | Workspace name, active project, project status, description, and project instructions are prepended before all other generation context. | `src/lib/prompts.ts`, `src/lib/pmo-data.ts`, `src/lib/rag.ts` | `src/lib/prompts.test.ts` |
| Role-based inference guardrails | Generation receives an absolute authorization directive for admin, user, or viewer roles; viewer users are refused for state-changing or restricted-artifact requests. | `src/lib/prompts.ts`, `src/lib/rag.ts` | `src/lib/prompts.test.ts`, `src/lib/rag.test.ts` |
| Reasoning modes | Low, Medium, and High reasoning adjust token budgets, timeouts, thinking settings, and instruction depth. Legacy aliases such as quick, deep, and max normalize to supported levels. | `src/lib/pmo-data.ts`, `src/lib/rag.ts`, `src/routes/api/scoped-rag-stream.ts` | `src/lib/pmo-data.test.ts`, `src/lib/rag.test.ts`, `src/test/routes/scoped-rag-stream-route.test.ts` |
| Intent routing | A lightweight Workers AI classifier chooses RAG search, web search, direct chat, or artifact generation. A deterministic fallback handles invalid model labels or classifier failures. | `src/lib/intent-routing.ts` | `src/lib/intent-routing.test.ts` |
| AI Gateway usage tracking | Workers AI calls run through the Cloudflare AI Gateway wrapper with compact metadata and optional D1 usage events. | `src/lib/ai-gateway.ts`, `src/lib/admin-metrics.server.ts` | `src/lib/ai-gateway.test.ts` |

## Scoped RAG And Web Context

| Feature | Behavior | Primary implementation | Test coverage |
| --- | --- | --- | --- |
| Scoped RAG streaming | Project chat streams cited responses over Server-Sent Events with `citations`, `token`, `done`, and `stream-error` events. | `src/routes/api/scoped-rag-stream.ts`, `src/lib/rag.ts` | `src/lib/rag.test.ts`, `src/test/routes/scoped-rag-stream-route.test.ts` |
| Context budgeting | RAG, Asana, and web context are trimmed or blocked based on the selected reasoning mode. Low and Medium can ask the user to narrow the request or increase reasoning depth. | `src/lib/rag.ts` | `src/lib/rag.test.ts` |
| Vectorize retrieval filters | RAG queries filter by team, project, role, confidentiality, and restricted metadata before D1 chunk text enters the prompt. | `src/lib/rag.ts`, `src/lib/document-ingestion-queue.ts` | `src/lib/rag.test.ts`, `src/lib/document-ingestion-queue.test.ts` |
| Generated artifact ingestion | Generated artifacts can be saved to R2 and queued for chunking, embedding, D1 chunk storage, and Vectorize indexing. | `src/lib/rag.ts`, `src/lib/document-ingestion-queue.ts` | `src/lib/rag.test.ts`, `src/lib/document-ingestion-queue.test.ts` |
| Registry artifact ingestion | Uploaded registry artifacts are processed asynchronously from R2, chunked, embedded, and indexed with scope and custom tag metadata. | `src/lib/document-ingestion-queue.ts`, `src/document-ingestion-worker.ts` | `src/lib/document-ingestion-queue.test.ts` |
| Hybrid web search | Tavily and Firecrawl run concurrently when web context is enabled; successful provider output is still used if the other provider fails. | `src/lib/rag.ts`, `src/lib/pmo-data.ts` | `src/lib/rag.test.ts`, `src/lib/pmo-data.test.ts` |

## Attachments, Exports, And Rendering

| Feature | Behavior | Primary implementation | Test coverage |
| --- | --- | --- | --- |
| Chat attachments | Users can attach PDF, XLSX, PPTX, DOCX, CSV, and TXT files. Extracted text is normalized, capped, and inserted into chat context when relevant. | `src/lib/attachment-extraction.ts`, `src/lib/pmo-data.ts` | `src/lib/attachment-extraction.test.ts`, `src/lib/pmo-data.test.ts` |
| Chat export requests | The assistant can detect requests to export responses as PDF, DOCX, XLSX, or CSV and generate downloadable artifacts. | `src/lib/chat-export.ts` | `src/lib/chat-export.test.ts` |
| Branded spreadsheets | XLSX exports use Vertex workbook branding, frozen headers, auto filters, and safe sheet names. | `src/lib/chat-export.ts` | `src/lib/chat-export.test.ts` |
| Dynamic artifact previews | Markdown, tables, code blocks, summaries, and workflow-action JSON render through one artifact preview component. | `src/components/ArtifactRenderer.tsx` | `src/components/ArtifactRenderer.test.ts` |
| Inline workflow actions | Markdown or JSON suggestions for approvals, decisions, ideas, and tasks can render as actionable inline controls. | `src/components/ArtifactRenderer.tsx`, `src/lib/pmo-data.ts` | `src/components/ArtifactRenderer.test.ts`, `src/lib/chat-entities.test.ts` |

## Workflow Features

| Feature | Behavior | Primary implementation | Test coverage |
| --- | --- | --- | --- |
| Ideas | Ideas are scoped to the active workspace or project, can be created manually or from assistant suggestions, and have status, owner, category, votes, scores, notes, and pin state. | `src/lib/pmo-data.ts`, `src/routes/index.tsx` | `src/lib/pmo-data.test.ts`, `src/lib/chat-entities.test.ts` |
| AI idea assessment | Gemma scores ideas for Impact, Effort, and Confidence and stores concise score rationale and consideration text. Fallback scoring is conservative when AI is unavailable. | `src/lib/pmo-data.ts` | `src/lib/pmo-data.test.ts` |
| Decisions | Decisions can be created from suggestions, toggled complete or incomplete, pinned, and scoped to workspaces or projects. | `src/lib/pmo-data.ts`, `src/components/ArtifactRenderer.tsx` | `src/lib/pmo-data.test.ts`, `src/components/ArtifactRenderer.test.ts` |
| Approvals | Approvals cycle through Not Reviewed, Reviewing, Approved, and Not Approved; they can be created from suggestions and pinned. | `src/lib/pmo-data.ts`, `src/components/ArtifactRenderer.tsx` | `src/lib/pmo-data.test.ts`, `src/components/ArtifactRenderer.test.ts` |
| Tasks | Tasks can be created from suggestions, marked Open or Completed, pinned, and manually or automatically synced to Asana when allowed. | `src/lib/pmo-data.ts`, `src/lib/asana-task-sync-state.ts`, `src/lib/asana-integration.server.ts` | `src/lib/pmo-data.test.ts`, `src/lib/asana-task-sync-state.test.ts` |
| Risks | Risks are scoped to projects or workspace-level views, ranked by severity, summarized with lightweight stats, and can generate mitigation strategies for editable users. | `src/lib/risk-feature.ts`, `src/lib/risks.ts`, `src/routes/workspace/$workspaceId/project/$projectId/risks.tsx` | `src/lib/risk-feature.test.ts` |

## Artifacts

| Feature | Behavior | Primary implementation | Test coverage |
| --- | --- | --- | --- |
| Artifact library | Artifacts store title, type, owner, date, status, summary, R2 key, preview text or JSON, pin state, and project scope. | `src/lib/pmo-data.ts`, `src/routes/api/artifacts.ts` | `src/components/ArtifactRenderer.test.ts` |
| Immutable versioning | Artifact updates and restores insert a new D1 row and new R2 key. Historical rows and files are not overwritten. | `src/lib/pmo-data.ts`, `drizzle/0008_artifact_versioning.sql` | Build/type checks plus artifact renderer tests. |
| Artifact deletion guardrail | Destructive deletion is blocked so prior artifact history remains available. | `src/lib/pmo-data.ts` | Build/type checks. |
| Seed artifacts | Personal, Team, and Org seed artifacts live in public copies and R2 seed folders. | `public/artifacts/`, `r2-seed/`, `db/seed/ai-command-center.sql` | Build/type checks. |

## Authentication And Access

| Feature | Behavior | Primary implementation | Test coverage |
| --- | --- | --- | --- |
| Invite-only local accounts | Admins invite users by email and role; only Vertex Education accounts and the configured test account are allowed. | `src/lib/auth-workflow.ts`, `src/lib/auth.ts` | `src/lib/auth-workflow.test.ts` |
| Managed users | Admin routes list, update, and delete managed users, with self-delete blocked. | `src/lib/auth-workflow.ts`, `src/routes/admin/users.tsx` | Build/type checks. |
| Better Auth sessions | Better Auth stores sessions, requires email verification for local accounts, and supports role-aware session snapshots. | `src/lib/auth.ts`, `src/lib/auth-client.ts` | Build/type checks. |
| Microsoft Entra sign-in | Microsoft OAuth runs server-side through Better Auth and never exposes token material to the browser. | `src/lib/auth.ts`, `src/lib/auth-workflow.ts`, `src/routes/api/auth/$.ts` | `src/lib/token-vaults.test.ts`, build/type checks. |

## Microsoft Graph Features

| Feature | Behavior | Primary implementation | Test coverage |
| --- | --- | --- | --- |
| Encrypted Graph token vault | Access and refresh tokens are AES-256-GCM encrypted before KV storage and refreshed within a five-minute expiry skew. | `src/lib/microsoft-token-vault.ts` | `src/lib/token-vaults.test.ts` |
| Graph webhook receiver | `/api/graph/webhooks` handles validation tokens, validates JSON payloads, queues notifications, and returns 503 if the queue is unavailable. | `src/routes/api/graph/webhooks.ts` | `src/test/routes/graph-webhooks-route.test.ts` |
| Graph queue processor | Queued notifications write delivery audit rows and update subscription status/count metadata. | `src/lib/microsoft-graph-webhooks.ts`, `src/worker.ts` | `src/lib/microsoft-graph-webhooks.test.ts` |
| Teams subscription capacity | Teams resources are counted separately against the 10,000 tenant subscription limit with warning and exceeded states. | `src/lib/microsoft-graph-webhooks.ts` | `src/lib/microsoft-graph-webhooks.test.ts` |

## Asana Features

| Feature | Behavior | Primary implementation | Test coverage |
| --- | --- | --- | --- |
| Asana OAuth | Users connect Asana from Profile, using PKCE, server-side state, encrypted token storage, and granted-scope tracking. | `src/lib/asana-integration.ts`, `src/lib/asana-integration.server.ts`, `src/routes/api/asana/oauth/callback.ts` | `src/lib/token-vaults.test.ts`, build/type checks. |
| Encrypted Asana token vault | Asana access and refresh tokens use the same AES-256-GCM KV vault pattern as Microsoft Graph. | `src/lib/asana-token-vault.ts` | `src/lib/token-vaults.test.ts` |
| Project mapping wizard | Users map Asana projects to existing VertexAI projects or scaffold new VertexAI projects and chats. Write access is validated before task sync. | `src/lib/asana-integration.server.ts`, `src/routes/profile/asana.tsx` | Build/type checks. |
| Manual and auto task sync | VertexAI workflow tasks stay local until manual sync or auto-sync settings push new tasks to Asana. Synced tasks keep their Asana gid and disable duplicate sync. | `src/lib/pmo-data.ts`, `src/lib/asana-task-sync-state.ts`, `src/lib/asana-integration.server.ts` | `src/lib/asana-task-sync-state.test.ts`, `src/lib/pmo-data.test.ts` |
| Project webhooks | Asana webhook setup is idempotent, stores per-project secrets in KV, and supports repair from Profile > Asana. | `src/lib/asana-integration.server.ts`, `src/lib/asana-webhook.ts` | `src/lib/asana-webhook.test.ts` |
| Webhook verification | Deliveries validate HMAC signatures over the raw request body before JSON parsing. Missing or invalid signatures return 401. | `src/lib/asana-webhook.ts` | `src/lib/asana-webhook.test.ts` |
| Webhook delivery routing | Verified task events upsert latest task state, resolve a project chat through mappings or fallback maps, publish chat updates, and record realtime invalidation events. | `src/lib/asana-webhook.ts`, `src/lib/realtime-events.ts`, `src/lib/chat-sync.ts` | `src/lib/asana-webhook.test.ts`, `src/lib/realtime-events.test.ts` |
| Asana snapshot memory | Asana-enabled project chats capture task/status/story snapshots, store changed snapshots to R2, and queue them into the scoped RAG ingestion path. | `src/lib/asana-integration.server.ts`, `src/lib/rag.ts`, `src/lib/document-ingestion-queue.ts` | `src/lib/document-ingestion-queue.test.ts`, build/type checks. |

## Briefings And Scheduling

| Feature | Behavior | Primary implementation | Test coverage |
| --- | --- | --- | --- |
| Legacy daily org briefings | The Worker cron job can generate daily Org project status briefings from recent activity and insert them into a Daily Briefings chat. | `src/worker.ts`, `src/lib/daily-briefings.ts` | `src/lib/briefing-formatting.test.ts` |
| User-defined schedules | Users can create daily, weekday, weekly, monthly, or one-time briefing schedules with time zones, run windows, project scope, and prompt instructions. | `src/lib/briefing-schedules.ts`, `src/lib/briefing-schedules.server.ts`, `src/routes/profile/briefings.tsx` | `src/lib/briefing-schedules.server.test.ts`, `src/lib/briefing-formatting.test.ts` |
| Custom briefing formatting | User-friendly instruction templates are converted to Markdown and placeholders such as project name, workspace, status, date, and time are resolved. | `src/lib/briefing-formatting.ts` | `src/lib/briefing-formatting.test.ts` |
| Duplicate prevention | Generated briefings carry internal markers so retried cron or schedule executions do not insert duplicate messages. | `src/lib/daily-briefings.ts` | Build/type checks. |

## Realtime Collaboration

| Feature | Behavior | Primary implementation | Test coverage |
| --- | --- | --- | --- |
| Mutation events | State changes record invalidation events so clients can refresh workspace, team, project, or chat data. | `src/lib/realtime-events.ts`, `src/routes/api/events.ts` | `src/lib/realtime-events.test.ts`, `src/test/routes/events-route.test.ts` |
| Event stream | `/api/events` streams mutation events by workspace mode and user or team scope with heartbeat comments. | `src/routes/api/events.ts` | `src/test/routes/events-route.test.ts` |
| Chat sync Durable Object | `CHAT_SYNC` streams live chat inserts and presence for personal, team, and org scopes. | `src/lib/chat-sync.ts`, `src/routes/api/chat-events.ts` | `src/test/routes/chat-events-route.test.ts` |

## Admin And Operations

| Feature | Behavior | Primary implementation | Test coverage |
| --- | --- | --- | --- |
| Admin metrics | Admin pages summarize usage, provider activity, app health, and recent events. | `src/lib/admin-metrics.ts`, `src/lib/admin-metrics.server.ts`, `src/routes/admin.tsx` | Build/type checks. |
| Usage events | AI Gateway, Tavily, Firecrawl, and Vectorize usage can be recorded in D1 for admin reporting. | `src/lib/admin-metrics.server.ts`, `src/lib/ai-gateway.ts`, `src/lib/rag.ts` | `src/lib/ai-gateway.test.ts`, `src/lib/rag.test.ts` |
| Cloudflare bindings | D1, R2, KV, Vectorize, Queues, Workers AI, Durable Objects, and Cron are declared in `wrangler.jsonc`. | `wrangler.jsonc`, `worker-configuration.d.ts` | Build/type checks. |
| Codex Sites hosting | `.openai/hosting.json` declares logical D1 and R2 bindings for the Sites-hosted surface. | `.openai/hosting.json` | Build/type checks. |

## Current Vitest Suite

Run all deterministic tests:

```powershell
npm test
```

The current suite covers:

- Prompt construction, authorization directives, reasoning profiles, and intent fallback routing.
- Scoped RAG stream helpers, context budgeting, web provider payload parsing, and generated-artifact normalization.
- Attachment extraction, chat export detection, branded XLSX generation, and artifact preview normalization.
- Workflow helpers for ideas, approvals, decisions, tasks, risks, and Asana sync controls.
- Asana webhook verification and task-state extraction.
- Microsoft Graph subscription classification, capacity checks, and queue tracking helpers.
- Encrypted Microsoft Graph and Asana token vault storage, retrieval, deletion, and refresh behavior.
- Briefing schedule next-run calculations and custom briefing formatting.
- Realtime mutation event parsing, SSE encoding, and chat presence scope keys.
