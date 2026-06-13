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
- `artifacts`: artifact metadata and R2 object keys.
- `workspace_actions`: decisions, approvals, and tasks.

Generated Drizzle migrations are stored in `drizzle/`.

## Cloudflare Bindings

Standalone Cloudflare deployment uses [wrangler.jsonc](wrangler.jsonc):

- `DB` -> D1 database `ai-command-center-db`
- `ARTIFACTS_BUCKET` -> R2 bucket `ai-command-center-artifacts`
- `VECTORIZE` -> Vectorize index `ai-command-center-rag`
- `DOCUMENT_INGESTION_QUEUE` -> Queue for scoped RAG document ingestion
- `AI` -> Workers AI binding for chat generation, intent routing, and embeddings
- `CHAT_SYNC` -> Durable Object namespace for chat presence and live chat events
- `TAVILY_API_KEY` and `FIRECRAWL_API_KEY` -> optional external web context providers

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

The route validates access, retrieves project context, queries Vectorize-backed artifact chunks, and calls Workers AI with `stream: true`. It returns Server-Sent Events:

- `citations`: matched artifact metadata
- `token`: incremental Markdown response text
- `done`: normal stream completion
- `stream-error`: validation, retrieval, or model failure inside the SSE protocol

The chat UI consumes this endpoint with the browser `EventSource` API and appends tokens to the optimistic assistant message as they arrive. See [docs/rag-infrastructure.md](docs/rag-infrastructure.md) for setup commands and the full event contract.

## Artifact Files

Public artifact download copies live in `public/artifacts/`.

R2 source seed copies live in:

- `r2-seed/personal/artifacts/`
- `r2-seed/team/artifacts/`
- `r2-seed/org/artifacts/`

The D1 `artifacts.r2_key` values match the R2 object paths.

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
