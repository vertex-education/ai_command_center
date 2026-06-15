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
npx wrangler vectorize create-metadata-index ai-command-center-rag --propertyName=source --type=string --config=./wrangler.jsonc
npx wrangler vectorize list-metadata-index ai-command-center-rag --config=./wrangler.jsonc

npx wrangler queues create document-ingestion-queue
npx wrangler queues create autonomous-research-queue
npx wrangler queues create graph-webhook-notifications
npx wrangler queues create asana-sync-queue
npx wrangler queues create asana-sync-queue-dlq
npm run cf-typegen
```

The Vectorize index dimensions match `@cf/baai/bge-large-en-v1.5`.

Required bindings for the scoped RAG path:

- `DB`: stores workspace, project, chat, artifact, and document chunk rows.
- `ARTIFACTS_BUCKET`: stores raw generated or uploaded artifact text and files.
- `VECTORIZE`: indexes embedded document chunks with `team_id`, `project_id`, `confidentiality`, and `restricted` metadata filters.
- `DOCUMENT_INGESTION_QUEUE`: receives `scoped-rag-generated-artifact` jobs for chunking and indexing.
- `AUTONOMOUS_RESEARCH_QUEUE`: receives project and idea research jobs for Firecrawl-backed background indexing.
- `GRAPH_WEBHOOK_QUEUE`: receives Microsoft Graph Teams and Outlook change notifications from `/api/graph/webhooks`.
- `AI`: runs embeddings, intent routing, and streamed chat generation through the configured Cloudflare AI Gateway. Gateway requests include identity/scope metadata headers for spend-limit dimensions and accept `cf-aig-step` fallback responses as successful model output.
- `TAVILY_API_KEY` and `FIRECRAWL_API_KEY`: optional external web context providers for chat web search. `FIRECRAWL_API_KEY` is required on the autonomous research consumer.
- `FIRECRAWL_API_BASE_URL`: optional autonomous research consumer override for the Firecrawl search endpoint.

Refresh `worker-configuration.d.ts` with `npm run cf-typegen` after changing bindings in `wrangler.jsonc`.

Deploy the document ingestion consumer separately from the main app Worker:

```powershell
npm run deploy:document-ingestion
```

[wrangler.document-ingestion.jsonc](../wrangler.document-ingestion.jsonc) attaches that Worker as the `document-ingestion-queue` consumer with a batch size of 5, a 30 second batch timeout, and 3 retries. The main app Worker remains the producer for registry uploads and generated scoped RAG artifacts.

Deploy the autonomous research consumer separately from the main app Worker:

```powershell
npm run deploy:autonomous-research
```

[wrangler.autonomous-research.jsonc](../wrangler.autonomous-research.jsonc) attaches that Worker as the `autonomous-research-queue` consumer with a batch size of 2, a 30 second batch timeout, and 3 retries. Set the Firecrawl secret before deployment:

```powershell
"<firecrawl-api-key>" | node ./scripts/run-wrangler.mjs secret put FIRECRAWL_API_KEY --config=./wrangler.autonomous-research.jsonc
```

## Asynchronous Artifact Registry Ingestion

Artifact uploads are intentionally non-blocking. `uploadArtifact` in `src/lib/artifact-upload.ts`:

1. Validates the signed-in user and form fields.
2. Writes the raw file buffer to `ARTIFACTS_BUCKET` with scope and document metadata.
3. Inserts an `artifacts_registry` row with `status = pending`.
4. Publishes an `artifact-registry-upload` job to `DOCUMENT_INGESTION_QUEUE`.
5. Sets HTTP `202 Accepted` and returns `{ status: "queued", artifactId, r2Key }`.

The queue consumer in `src/lib/document-ingestion-queue.ts` owns the expensive work. It retrieves the R2 object, extracts text, chunks Markdown structurally by headings and paragraph breaks, embeds chunks in batches of 50 using `@cf/baai/bge-large-en-v1.5`, clamps each Vectorize metadata object to the 2048-byte limit, writes vectors, writes D1 `document_chunks_v2` rows for registry uploads, and moves the registry row through `processing`, `completed`, or `failed`.

## Autonomous Web Research Indexing

Autonomous research indexing is intentionally silent. There is no user-facing toggle or per-user setting. The main app Worker publishes a queue payload after these conceptual entities are established:

- direct project creation in `createScopedProject`
- Asana project scaffolding in `scaffoldVertexProjectForAsana`
- manual idea creation in `addIdea`
- assistant-suggestion idea creation in `createIdeaFromSuggestion`

Each payload contains only structured scope and description fields: `entityType`, `entityId`, `workspaceId`, `workspaceMode`, `teamId`, `projectId`, `title`, `description`, `tags`, and `sourceUserId`. The request path does not call Firecrawl or embed content; it only publishes to `AUTONOMOUS_RESEARCH_QUEUE`.

The consumer in `src/lib/autonomous-research-queue.ts`:

1. Validates the structured-clone-safe job body.
2. Extracts a core text description from title, description, and tags.
3. Builds up to three bounded search queries optimized for frameworks, case studies, risks, requirements, metrics, and benchmarks.
4. Calls Firecrawl Search with Markdown scrape options.
5. Deduplicates external HTTP URLs and caps Markdown per document.
6. Passes each Markdown document into the shared scoped RAG ingestion helper.
7. Embeds chunks with `@cf/baai/bge-large-en-v1.5`, stores D1 `document_chunks`, and upserts Vectorize records.

Autonomous research vectors include these metadata fields in addition to the normal scoped RAG filter fields:

- `source`: always `autonomous_research`
- `entity_type`: `project` or `idea`
- `entity_id`: source project or idea id
- `workspace_id` and `workspace_mode`
- `source_url` and `source_domain`
- `search_query`
- `research_request_id`
- `research_requested_at`
- `tags`

These chunks are available to normal scoped RAG retrieval because they share the same `team_id` and `project_id` metadata conventions as generated artifacts. The `source` metadata index is optional for normal retrieval, but it enables future source-specific filters and operational audits.

## Immutable Artifact Versioning

Artifacts are append-only once written. The `artifacts` D1 table includes:

| Field                | Purpose                                           |
| -------------------- | ------------------------------------------------- |
| `version`            | Integer version number for the artifact lineage.  |
| `parent_artifact_id` | Self-reference to the prior version row.          |
| `commit_message`     | Short description of why the version was created. |

`drizzle/0008_artifact_versioning.sql` adds these fields and supporting indexes. Generated artifact updates write a distinct R2 object key and insert a new D1 row parented to the latest version in the lineage. Restore follows the same rule: the selected historical R2 object is copied to a new versioned R2 key and inserted as the new latest row. Historical rows and R2 objects are not overwritten or deleted, so the UI can render older states read-only in the artifact version timeline.

## AI Diff Artifact Patching

The artifact detail panel exposes `AI diff` for roles that can modify artifacts. The flow is deliberately review-first:

1. `draftArtifactPatch` in `src/lib/pmo-data.ts` verifies the user's edit permission, resolves the latest artifact lineage row, and reads the current UTF-8 text artifact from a short-lived R2 edge cache backed by `ARTIFACTS_BUCKET`.
2. The server prompts Kimi K2.7 Code (`@cf/moonshotai/kimi-k2.7-code`) to return only a strict JSON object shaped as `{ "patches": [...] }`. Supported actions are `replace`, `delete`, `insert_before`, and `insert_after`; each action must include an exact `target_string` copied from the current artifact text.
3. `src/lib/artifact-diff.ts` parses wrapped JSON, JSON arrays, or newline-delimited streamed patch objects, applies the deltas to the active text state, and reports any unmatched targets.
4. `ArtifactPatchDialog` renders each discrete change with deleted text highlighted red and inserted text highlighted green. The user must explicitly approve before anything is written.
5. `commitArtifactPatch` re-reads the latest artifact state, verifies the reviewed `baseR2Key` is still current, reapplies the approved patches server-side, writes the unified text to a versioned R2 key, and inserts a new `artifacts` row parented to the prior latest version.

No new admin or user preference is required. The feature uses the existing `DB`, `ARTIFACTS_BUCKET`, `AI`, AI Gateway, and RBAC configuration. Viewer users do not see the action. Current patch commits intentionally support text-like artifacts only (`md`, `markdown`, `txt`, `json`, `yaml`, `yml`, `xml`, and `csv` or compatible text content types); binary Office containers are rejected rather than mutated in place.

## Scoped RAG Streaming

Team project chat uses a native Server-Sent Events endpoint for scoped RAG:

```text
GET /sse/workspace-events?stream=scoped-rag&prompt=...&teamId=...&workspaceId=...&projectId=...&chatId=...
```

`GET /api/scoped-rag-stream?...` remains available as a compatibility wrapper. Both routes call `createScopedRagStreamResponse` in `src/lib/rag.ts`. That shared helper:

- validates team and project access and re-queries the active user's D1 role
- fetches workspace and project context from D1
- classifies the prompt intent with `classifyPromptIntent` from `src/lib/intent-routing.ts`
- routes `DIRECT_CHAT` and `ARTIFACT_GENERATION` directly to the primary generation model without embeddings or Vectorize
- routes `WEB_SEARCH` to the hybrid external search pipeline and scoped historical chunk retrieval
- routes `RAG_SEARCH` through embeddings, Vectorize, and matching chunks from D1
- calls Workers AI with `stream: true`
- returns `Content-Type: text/event-stream; charset=utf-8`

The preferred browser route lives in `src/routes/sse/workspace-events.ts`; `src/routes/api/scoped-rag-stream.ts` is the compatibility route. Startup validation failures are also returned as SSE with a `stream-error` event, so the browser consumer can use one parsing path for both pre-generation and mid-stream failures.

The stream emits named SSE events:

| Event          | Payload                                     | Purpose                                                                     |
| -------------- | ------------------------------------------- | --------------------------------------------------------------------------- |
| `trace`        | `{ "messages": [...], "context": {...} }`   | Sends prompt, model, reasoning, and context diagnostics for LLM dev tools.  |
| `citations`    | `{ "citations": [...] }`                    | Sends matched artifact metadata before answer tokens.                       |
| `thinking`     | `{ "thinking": "..." }`                     | Sends incremental model reasoning text when the model returns it.           |
| `token`        | `{ "token": "..." }`                        | Sends incremental Markdown text for the assistant response.                 |
| `entities`     | `{ "entities": [...] }`                     | Sends extracted tasks, approvals, ideas, and risks from the completed turn. |
| `done`         | `{ "response": "...", "citations": [...] }` | Ends the stream after Workers AI and entity extraction complete.            |
| `stream-error` | `{ "message": "..." }`                      | Reports validation, retrieval, or model failures inside the SSE protocol.   |

The frontend consumes the preferred `/sse/workspace-events?stream=scoped-rag` endpoint with the browser `EventSource` API in `src/features/command-center/chat.tsx` and `src/features/command-center/command-center.tsx`. Tokens are appended to the optimistic assistant message as they arrive, so existing Markdown rendering updates incrementally. The client closes the `EventSource` on `done` or `stream-error`; network failures use the native `onerror` path and roll back the optimistic chat cache when streaming cannot complete.

`chatWithScopedRag` remains available as a TanStack Start server function, but it delegates to `createScopedRagStreamResponse`. New browser chat streaming should use `/sse/workspace-events?stream=scoped-rag` so token streaming and broader workspace mutation streaming share one SSE route.

## Workspace Mutation SSE

The same TanStack Start route also streams database mutation invalidations:

```text
GET /sse/workspace-events?mode=Team&teamId=...&clientId=...
```

`handleWorkspaceEvents` validates the signed-in user, verifies Team membership when `mode=Team`, resolves the workspace, resumes from the `Last-Event-ID` header or `lastEventId` query parameter, and polls the D1 `events` table every 2500 ms. It emits `mutation` events for `chat_message`, `idea`, `task`, and `asana_task` rows and heartbeat comments every 20 seconds.

`useWorkspaceEventSource` in `src/features/command-center/use-workspace-events.ts` stores the latest event id in `sessionStorage`, ignores events that came from the same `clientId`, and invalidates only the TanStack Query caches named in the event payload: `workspace`, `teams`, `projects`, and `chats`.

## Dynamic Workspace Context Injection

Main chat generation prepends a D1-backed priority context block to the system prompt before any retrieval, web, attachment, chat-history, or user-prompt content. The backend resolves the active scope from the current request:

- scoped RAG streaming uses `workspaceId` and `projectId` from `/sse/workspace-events?stream=scoped-rag`
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

This header is included for `RAG_SEARCH`, `WEB_SEARCH`, `DIRECT_CHAT`, `ENTITY_EXTRACTION`, and `ARTIFACT_GENERATION` paths. Project status values are treated as operational labels and can include `Active`, `Watch`, `Planning`, `Blocked`, or `In Progress`.

## Role-Based LLM Guardrails

Scoped generation now enforces RBAC at the inference layer in addition to normal server-side access checks. `createScopedRagStreamResponse` calls `requireScopedProjectAccess`, which validates team/project membership and then queries the active row from the D1 `"user"` table. The resolved role is normalized to `viewer`, `contributor`, `manager`, or `admin` and passed through every scoped generation path.

Before the model receives workspace context, web context, historical chunks, or the user's latest message, the system prompt receives an absolute authorization directive from `buildInferenceAuthorizationDirective` in `src/lib/prompts.ts`. The directive states the user's role, whether state modification is allowed, whether confidential artifact access is allowed, and that viewer users must be refused for state changes or restricted-artifact summaries.

Confidential retrieval is also blocked before chunks enter the model context window. New ingestion jobs write the following metadata into Vectorize:

- `confidentiality`: `Standard` or `Confidential`
- `restricted`: boolean

For viewer users, Vectorize queries add a metadata pre-filter that excludes `confidentiality = Confidential` and `restricted = true` chunks before similarity matches are returned. `Admin`, `Manager`, and `Contributor` roles are treated as having explicit confidential retrieval clearance; `Viewer` is not.

The ingestion worker marks a chunk as confidential when the uploaded artifact's custom tags, R2 custom metadata, or document name explicitly include `Confidential` or `restricted`. Generated scoped RAG artifacts can also pass `sensitivityLabel: "Confidential"` or `restricted: true` to `ingestGeneratedArtifact`, which stores matching R2 metadata for the queue consumer. Existing vectors that predate this metadata should be reingested when confidential filtering must apply to them.

## Context-Aware Agentic Routing

Scoped project chat runs intent routing before retrieval work. The router uses `@cf/zai-org/glm-4.7-flash` as a fast Workers AI classifier with turn-level thinking disabled and accepts five labels:

| Intent                | Runtime path                                                                                                                                                                             | Vectorize usage                |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `RAG_SEARCH`          | Embed the prompt, query Vectorize with `team_id`, `project_id`, and role-sensitive confidentiality filters, load D1 chunks, and stream a cited answer.                                   | Required                       |
| `WEB_SEARCH`          | Concurrently fetch consolidated Tavily and Firecrawl context, query scoped D1-backed chunks with role-sensitive confidentiality filters, and stream an answer grounded in both sections. | Required for historical chunks |
| `DIRECT_CHAT`         | Send the prompt plus scoped workspace/project context directly to the primary generation model.                                                                                          | Bypassed                       |
| `ENTITY_EXTRACTION`   | Extract prompt-local operational entities such as tasks, approvals, risks, ideas, owners, and deadlines with scoped workspace/project context.                                           | Bypassed                       |
| `ARTIFACT_GENERATION` | Send the artifact request plus scoped workspace/project context directly to the primary generation model.                                                                                | Bypassed                       |

If the classifier returns an invalid label, the router applies a lightweight deterministic fallback. If the classifier call fails, it falls back to `RAG_SEARCH` so scoped historical questions remain grounded in project artifacts.

## Entity Extraction And Risk Flags

After the generation stream completes, `createAiSseResponse` runs `extractOperationalEntities` against the user prompt and assistant response. It returns strict JSON entities with `type` values of `Task`, `Approval`, `Idea`, or `Risk`. The final SSE payload emits those entities through the `entities` event and includes them in `done`.

When a project-scoped Risk entity is detected, `src/lib/risk-contract.ts` normalizes the entity once and the stream appends a fenced JSON block using the `vertex.risk.v1` schema:

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

`ArtifactRenderer` removes these JSON blocks from the Markdown body and renders them as `Risk Flag` chips. Persisted chat turns also pass extracted entities through the same risk contract before `persistScopedChatTurn` inserts Risk rows into the D1 `risks` table through `src/lib/team-workflow.ts`. In the command-center flow, the assistant message ID is sent to the stream so the inline chip and persisted row share the same risk ID.

## Hybrid External Search

`fetchConsolidatedWebSearch` in `src/lib/rag.ts` calls Tavily and Firecrawl concurrently with `Promise.allSettled()`. Tavily is requested with `include_answer: true` for an AI-generated summary, while Firecrawl is requested with Markdown scrape options for full-page extraction. Each provider call has a 10 second timeout; failures or timeouts are recorded as provider issues and the successful provider output is still returned.

When intent routing selects `WEB_SEARCH`, the generation system prompt includes both:

- `Real-Time Web Context`: the consolidated Tavily summary and Firecrawl Markdown content.
- `Scoped historical chunks`: D1 chunk text loaded from Vectorize matches for the active team and project.

## Asana Snapshot Memory

When Asana search is enabled for a mapped project chat, the app fetches current Asana tasks, recent status updates, and the same recent task stories used in prompt context. The normalized snapshot is hashed and compared to the latest row in `asana_project_snapshots`.

- The first Asana-enabled chat stores a baseline snapshot.
- Later Asana-enabled chats store a new snapshot only when task, status update, or tracked story content changes.
- Changed snapshots are written to R2 as Markdown and queued through `DOCUMENT_INGESTION_QUEUE` with `kind: "scoped-rag-generated-artifact"`, so the existing document ingestion worker embeds them into Vectorize and writes D1 `document_chunks`.
- The current chat prompt also receives a concise snapshot comparison, so the model can distinguish live Asana context from changes since the previous captured snapshot.
