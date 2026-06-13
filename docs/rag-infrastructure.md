# RAG Infrastructure Commands

Run these from the repository root.

```powershell
npx wrangler d1 create ai-command-center-db
npx wrangler d1 execute ai-command-center-db --remote --file=./schema.sql

npx wrangler r2 bucket create ai-command-center-artifacts

npx wrangler vectorize create ai-command-center-rag --dimensions=1024 --metric=cosine --config=./wrangler.jsonc
npx wrangler vectorize create-metadata-index ai-command-center-rag --propertyName=team_id --type=string --config=./wrangler.jsonc
npx wrangler vectorize create-metadata-index ai-command-center-rag --propertyName=project_id --type=string --config=./wrangler.jsonc
npx wrangler vectorize list-metadata-index ai-command-center-rag --config=./wrangler.jsonc

npx wrangler queues create document-ingestion-queue
npm run cf-typegen
```

The Vectorize index dimensions match `@cf/baai/bge-large-en-v1.5`.

Required bindings for the scoped RAG path:

- `DB`: stores workspace, project, chat, artifact, and document chunk rows.
- `ARTIFACTS_BUCKET`: stores raw generated or uploaded artifact text and files.
- `VECTORIZE`: indexes embedded document chunks with `team_id` and `project_id` metadata filters.
- `DOCUMENT_INGESTION_QUEUE`: receives `scoped-rag-generated-artifact` jobs for chunking and indexing.
- `AI`: runs embeddings, intent routing, and streamed chat generation.
- `TAVILY_API_KEY` and `FIRECRAWL_API_KEY`: optional external web context providers.

Refresh `worker-configuration.d.ts` with `npm run cf-typegen` after changing bindings in `wrangler.jsonc`.

## Scoped RAG Streaming

Team project chat uses a native Server-Sent Events endpoint for scoped RAG:

```text
GET /api/scoped-rag-stream?prompt=...&teamId=...&workspaceId=...&projectId=...
```

The route calls `createScopedRagStreamResponse` in `src/lib/rag.ts`. That shared helper:

- validates team and project access
- fetches workspace and project context from D1
- classifies the prompt intent with Workers AI
- optionally gathers external web context
- embeds the prompt, queries Vectorize, and loads matching chunks from D1
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
