# Vertex AI Command Center

Vertex AI Command Center is a TanStack Start workspace app for AI-assisted chat, project, idea, task, decision, approval, and artifact workflows.

The app is organized around three explicit workspace scopes:

- `Personal`: personal projects, project chats, and personal chats.
- `Team`: team projects, project chats, and team chats.
- `Org`: org projects, project chats, and org chats.

Each scope has its own projects, chats, ideas, artifacts, decisions, approvals, tasks, activity, and seed data. The UI is designed so lower scopes do not surface higher-scope information, and switching a project dynamically changes the `Project Chats` section for the selected workspace.

## Stack

- React 19
- TanStack Start, Router, Query, Form, and Table
- Vite
- Tailwind CSS
- Drizzle ORM
- Cloudflare Workers runtime
- Cloudflare D1 for structured workspace data
- Cloudflare R2 for artifact files
- Cloudflare Workers AI for assistant responses, embeddings, and prompt intent routing
- Cloudflare Vectorize for scoped RAG artifact retrieval
- Cloudflare Queues for document ingestion jobs
- Cloudflare Cron Triggers for automated daily project status briefings
- Codex Sites metadata in `.openai/hosting.json`

## Prerequisites

- Node.js `>=22.13.0`
- npm
- Wrangler authentication for Cloudflare operations

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

## Data Model

The D1 schema lives in [db/schema.ts](db/schema.ts).

Core tables:

- `workspaces`: Personal, Team, and Org scope records.
- `projects`: scoped projects.
- `chats`: workspace chats and project chats.
- `chat_messages`: chat history.
- `ideas`: scoped improvement ideas.
- `artifacts`: immutable artifact metadata, version lineage, commit messages, and R2 object keys.
- `workspace_actions`: decisions, approvals, and tasks.

Generated Drizzle migrations are stored in `drizzle/`.

Artifact history is append-only. `artifacts.version` stores the integer version number, `artifacts.parent_artifact_id` points to the previous version row, and `artifacts.commit_message` describes the change that produced the row. Migration [drizzle/0008_artifact_versioning.sql](drizzle/0008_artifact_versioning.sql) adds these fields and supporting indexes. Updating or restoring an artifact must insert a new D1 row with a new R2 object key instead of overwriting or deleting the historical file.

## Cloudflare Bindings

Standalone Cloudflare deployment uses [wrangler.jsonc](wrangler.jsonc):

- `DB` -> D1 database `ai-command-center-db`
- `ARTIFACTS_BUCKET` -> R2 bucket `ai-command-center-artifacts`
- `VECTORIZE` -> Vectorize index `ai-command-center-rag`
- `DOCUMENT_INGESTION_QUEUE` -> Queue for scoped RAG document ingestion
- `AI` -> Workers AI binding for chat generation, intent routing, and embeddings
- `CHAT_SYNC` -> Durable Object namespace for chat presence and live chat events
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

## D1 Setup

Generate migrations after schema changes:

```powershell
npm run db:generate
```

Apply and seed local D1:

```powershell
npm run db:migrate
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
- Markdown task-list items that match current approvals or tasks, or include explicit markers such as `approval:team-approval-1` or `task:team-task-1`, render inline action buttons.
- JSON schemas containing `pendingApprovals`, `approvals`, `assignedTasks`, or `tasks` arrays render as workflow action rows instead of plain code when they describe approvals or tasks.
- Inline approval/task buttons call the existing TanStack Query mutations for `toggleApprovalStatus` and `toggleTaskStatus`, so chat actions use the same optimistic cache updates, rollback behavior, and server-side permission checks as the Approvals and Tasks tabs.

Recommended assistant patterns:

```markdown
## Pending Approvals
- [ ] approval:team-approval-1 Confirm launch readiness sign-off

## Assigned Tasks
- [ ] task:team-task-1 Package Vertex Hub roadmap evidence
```

```json
{
  "pendingApprovals": [
    { "id": "team-approval-1", "title": "Confirm launch readiness sign-off", "owner": "Maya Chen", "due": "Due Jun 14" }
  ],
  "assignedTasks": [
    { "id": "team-task-1", "title": "Package Vertex Hub roadmap evidence", "owner": "Maya Chen", "source": "Vertex Hub Roadmap Brief" }
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
