# RAG Infrastructure Commands

Run these from the repository root.

```powershell
npx wrangler d1 create ai-command-center-db
npx wrangler d1 execute ai-command-center-db --remote --file=./schema.sql

npx wrangler r2 bucket create ai-command-center-artifacts

npx wrangler vectorize create ai-command-center-rag --dimensions=1024 --metric=cosine --config=./wrangler.jsonc
npx wrangler vectorize create-metadata-index ai-command-center-rag --propertyName=team_id --type=string --config=./wrangler.jsonc
npx wrangler vectorize create-metadata-index ai-command-center-rag --propertyName=project_id --type=string --config=./wrangler.jsonc
npx wrangler vectorize create-metadata-index ai-command-center-rag --propertyName=confidentiality --type=string --config=./wrangler.jsonc
npx wrangler vectorize create-metadata-index ai-command-center-rag --propertyName=restricted --type=boolean --config=./wrangler.jsonc
npx wrangler vectorize list-metadata-index ai-command-center-rag --config=./wrangler.jsonc

npx wrangler queues create document-ingestion-queue
npx wrangler queues create graph-webhook-notifications
npm run cf-typegen
```

The Vectorize index dimensions match `@cf/baai/bge-large-en-v1.5`.

Required bindings for the scoped RAG path:

- `DB`: stores workspace, project, chat, artifact, and document chunk rows.
- `ARTIFACTS_BUCKET`: stores raw generated or uploaded artifact text and files.
- `VECTORIZE`: indexes embedded document chunks with `team_id`, `project_id`, `confidentiality`, and `restricted` metadata filters.
- `DOCUMENT_INGESTION_QUEUE`: receives `scoped-rag-generated-artifact` jobs for chunking and indexing.
- `GRAPH_WEBHOOK_QUEUE`: receives Microsoft Graph Teams and Outlook change notifications from `/api/graph/webhooks`.
- `AI`: runs embeddings, intent routing, and streamed chat generation.
- `TAVILY_API_KEY` and `FIRECRAWL_API_KEY`: optional external web context providers.

Refresh `worker-configuration.d.ts` with `npm run cf-typegen` after changing bindings in `wrangler.jsonc`.

## Immutable Artifact Versioning

Artifacts are append-only once written. The `artifacts` D1 table includes:

| Field | Purpose |
| --- | --- |
| `version` | Integer version number for the artifact lineage. |
| `parent_artifact_id` | Self-reference to the prior version row. |
| `commit_message` | Short description of why the version was created. |

`drizzle/0008_artifact_versioning.sql` adds these fields and supporting indexes. Generated artifact updates write a distinct R2 object key and insert a new D1 row parented to the latest version in the lineage. Restore follows the same rule: the selected historical R2 object is copied to a new versioned R2 key and inserted as the new latest row. Historical rows and R2 objects are not overwritten or deleted, so the UI can render older states read-only in the artifact version timeline.

## Scoped RAG Streaming

Team project chat uses a native Server-Sent Events endpoint for scoped RAG:

```text
GET /api/scoped-rag-stream?prompt=...&teamId=...&workspaceId=...&projectId=...
```

The route calls `createScopedRagStreamResponse` in `src/lib/rag.ts`. That shared helper:

- validates team and project access and re-queries the active user's D1 role
- fetches workspace and project context from D1
- classifies the prompt intent with `classifyPromptIntent` from `src/lib/intent-routing.ts`
- routes `DIRECT_CHAT` and `ARTIFACT_GENERATION` directly to the primary generation model without embeddings or Vectorize
- routes `WEB_SEARCH` to the hybrid external search pipeline and scoped historical chunk retrieval
- routes `RAG_SEARCH` through embeddings, Vectorize, and matching chunks from D1
- calls Workers AI with `stream: true`
- returns `Content-Type: text/event-stream; charset=utf-8`

The route lives in `src/routes/api/scoped-rag-stream.ts`. Startup validation failures are also returned as SSE with a `stream-error` event, so the browser consumer can use one parsing path for both pre-generation and mid-stream failures.

The stream emits named SSE events:

| Event | Payload | Purpose |
| --- | --- | --- |
| `citations` | `{ "citations": [...] }` | Sends matched artifact metadata before answer tokens. |
| `token` | `{ "token": "..." }` | Sends incremental Markdown text for the assistant response. |
| `done` | `{ "response": "...", "citations": [...] }` | Ends the stream after Workers AI completes. |
| `stream-error` | `{ "message": "..." }` | Reports validation, retrieval, or model failures inside the SSE protocol. |

The frontend consumes this endpoint with the browser `EventSource` API in `src/routes/index.tsx`. Tokens are appended to the optimistic assistant message as they arrive, so existing Markdown rendering updates incrementally. The client closes the `EventSource` on `done` or `stream-error`; network failures use the native `onerror` path.

`chatWithScopedRag` remains available as a TanStack Start server function, but it delegates to `createScopedRagStreamResponse`. New browser chat streaming should use `/api/scoped-rag-stream` so connection lifecycle and termination are handled by standard SSE behavior.

## Dynamic Workspace Context Injection

Main chat generation prepends a D1-backed priority context block to the system prompt before any retrieval, web, attachment, chat-history, or user-prompt content. The backend resolves the active scope from the current request:

- scoped RAG streaming uses `workspaceId` and `projectId` from `/api/scoped-rag-stream`
- regular persisted chat uses the active chat scope and `projectId`

The context query joins `projects` to `workspaces` and injects the workspace name, active project name, active project status, and detailed project description. The prompt header is generated by `buildDynamicWorkspaceContextHeader` in `src/lib/prompts.ts` and is intentionally formatted as the first system-prompt section:

```text
=== PRIORITY WORKSPACE CONTEXT - READ BEFORE ALL OTHER CONTEXT ===
Workspace name: ...
Active project: ...
Active project status: ...
Detailed project description: ...
...
=== END PRIORITY WORKSPACE CONTEXT ===
```

This header is included for `RAG_SEARCH`, `WEB_SEARCH`, `DIRECT_CHAT`, and `ARTIFACT_GENERATION` paths. Project status values are treated as operational labels and can include `Active`, `Watch`, `Planning`, `Blocked`, or `In Progress`.

## Role-Based LLM Guardrails

Scoped generation now enforces RBAC at the inference layer in addition to normal server-side access checks. `createScopedRagStreamResponse` calls `requireScopedProjectAccess`, which validates team/project membership and then queries the active row from the D1 `"user"` table. The resolved role is normalized to `admin`, `user`, or `viewer` and passed through every scoped generation path.

Before the model receives workspace context, web context, historical chunks, or the user's latest message, the system prompt receives an absolute authorization directive from `buildInferenceAuthorizationDirective` in `src/lib/prompts.ts`. The directive states the user's role, whether state modification is allowed, whether confidential artifact access is allowed, and that viewer users must be refused for state changes or restricted-artifact summaries.

Confidential retrieval is also blocked before chunks enter the model context window. New ingestion jobs write the following metadata into Vectorize:

- `confidentiality`: `Standard` or `Confidential`
- `restricted`: boolean

For viewer users, Vectorize queries add a metadata pre-filter that excludes `confidentiality = Confidential` and `restricted = true` chunks before similarity matches are returned. `admin` and `user` roles are treated as having explicit confidential retrieval clearance; `viewer` is not.

The ingestion worker marks a chunk as confidential when the uploaded artifact's custom tags, R2 custom metadata, or document name explicitly include `Confidential` or `restricted`. Generated scoped RAG artifacts can also pass `sensitivityLabel: "Confidential"` or `restricted: true` to `ingestGeneratedArtifact`, which stores matching R2 metadata for the queue consumer. Existing vectors that predate this metadata should be reingested when confidential filtering must apply to them.

## Context-Aware Agentic Routing

Scoped project chat runs intent routing before retrieval work. The router uses `@cf/meta/llama-3-8b-instruct` as a fast Workers AI classifier and accepts only four labels:

| Intent | Runtime path | Vectorize usage |
| --- | --- | --- |
| `RAG_SEARCH` | Embed the prompt, query Vectorize with `team_id`, `project_id`, and role-sensitive confidentiality filters, load D1 chunks, and stream a cited answer. | Required |
| `WEB_SEARCH` | Concurrently fetch consolidated Tavily and Firecrawl context, query scoped D1-backed chunks with role-sensitive confidentiality filters, and stream an answer grounded in both sections. | Required for historical chunks |
| `DIRECT_CHAT` | Send the prompt plus scoped workspace/project context directly to the primary generation model. | Bypassed |
| `ARTIFACT_GENERATION` | Send the artifact request plus scoped workspace/project context directly to the primary generation model. | Bypassed |

If the classifier returns an invalid label, the router applies a lightweight deterministic fallback. If the classifier call fails, it falls back to `RAG_SEARCH` so scoped historical questions remain grounded in project artifacts.

## Hybrid External Search

`fetchConsolidatedWebSearch` in `src/lib/rag.ts` calls Tavily and Firecrawl concurrently with `Promise.allSettled()`. Tavily is requested with `include_answer: true` for an AI-generated summary, while Firecrawl is requested with Markdown scrape options for full-page extraction. Each provider call has a 10 second timeout; failures or timeouts are recorded as provider issues and the successful provider output is still returned.

When intent routing selects `WEB_SEARCH`, the generation system prompt includes both:

- `Real-Time Web Context`: the consolidated Tavily summary and Firecrawl Markdown content.
- `Scoped historical chunks`: D1 chunk text loaded from Vectorize matches for the active team and project.
