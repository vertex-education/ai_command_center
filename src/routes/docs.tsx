import { useEffect, useMemo, useState, type ComponentType } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import {
  Archive,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Database,
  FileText,
  FolderOpen,
  GitBranch,
  KeyRound,
  Lightbulb,
  Lock,
  MessageCircle,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Users,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { AppRail } from "@/components/AppRail";
import { isAdminRole } from "@/lib/auth-access-control";
import { cn } from "@/lib/utils";
import { authClient } from "@/lib/auth-client";
import { getSession } from "@/lib/auth-workflow";

export const Route = createFileRoute("/docs")({
  loader: async () => {
    const session = await getSession();
    if (!session) throw redirect({ to: "/sign-in" });
    return { session };
  },
  head: () => ({
    meta: [{ title: "Docs | VertexAI" }],
  }),
  component: DocsPage,
});

type DocStatus = "Available" | "Admin" | "Partial" | "Coming Soon";

type DocSection = {
  id: string;
  title: string;
  category: string;
  icon: ComponentType<{ className?: string }>;
  summary: string;
  status: DocStatus;
  howTo: string[];
  details: string[];
  technicalDetails: string[];
};

type DocArticle = {
  id: string;
  title: string;
  category: string;
  icon: ComponentType<{ className?: string }>;
  summary: string;
  status: DocStatus;
  blocks: {
    title: string;
    items: string[];
    variant?: "steps" | "notes" | "technical";
  }[];
};

const docSections: DocSection[] = [
  {
    id: "workspaces",
    title: "Workspace Scopes",
    category: "Navigation",
    icon: FolderOpen,
    status: "Available",
    summary: "Personal, Team, and Org scopes separate projects, chats, artifacts, actions, and activity.",
    howTo: [
      "Use the persistent blue rail to move between Workspaces, Chats, Ideas, Artifacts, and Docs.",
      "Use the Personal, Team, and Org controls in the context bar to switch scope.",
      "In Team scope, select the active team before opening team projects or chats.",
      "Use the breadcrumb to confirm whether you are in a general workspace or a project-specific view.",
    ],
    details: [
      "Use Personal for private planning and individual follow-up that should not be mixed with team or organization work.",
      "Use Team when the work belongs to a named team and should be visible only to team members.",
      "Use Org for organization-level governance, portfolio, policy, and cross-team operating views.",
      "Project selection changes the entire workspace context, so chat, ideas, artifacts, decisions, approvals, tasks, prompts, and detail metrics all follow the selected project.",
      "Clearing the project context returns the workspace to General, which is useful for broad notes and work that is not tied to a specific project.",
      "The rail intentionally does not include a separate Settings button; account settings live in the profile menu at the bottom of the rail.",
    ],
    technicalDetails: [
      "The shared AppRail component renders the Workspaces, Chats, Ideas, Artifacts, and Docs shortcuts across signed-in app surfaces.",
      "Docs passes the AppRail persist flag so the rail remains visible as the left column on the documentation page.",
      "Workspace modes are represented as Personal, Team, and Org in the React state layer and map to personal, team, and org scopes in the D1-backed data model.",
      "The main workspace state is loaded through pmoWorkspaceQueryOptions and then merged with persisted artifacts before rendering.",
      "Team scope depends on listMyTeams, listMyScopedProjects, and listMyScopedChats server functions, and hides team data until a valid team membership exists.",
      "The active project id is used as the filter key for scoped ideas, artifacts, decisions, approvals, tasks, prompts, and conversation lookup.",
      "The UI stores workspace mode in component state; it does not currently persist the last selected scope across sessions.",
    ],
  },
  {
    id: "project-chat-nav",
    title: "Projects and Chat Navigation",
    category: "Navigation",
    icon: GitBranch,
    status: "Available",
    summary: "The left workspace panel manages project selection plus general and project chat lists.",
    howTo: [
      "Select a project to load its project chats and project-scoped tabs.",
      "Open a general chat to work outside a project.",
      "Use create, rename, delete, and invite controls where your role allows editing.",
    ],
    details: [
      "Use project chats when the conversation should stay attached to a specific project, artifact set, or workstream.",
      "Use general workspace chats for planning, notes, and questions that are not tied to a project.",
      "Create separate chats for distinct decisions or workstreams so message history stays focused and easy to branch later.",
      "Rename chats when the first generated title is not clear enough for future navigation.",
      "Invite project collaborators from the project context when they need access to that project without broadening their workspace visibility.",
    ],
    technicalDetails: [
      "Workspace chats and project chats are stored as separate chats rows using the section field and nullable project_id.",
      "Project membership is checked before project chat creation, deletion, rename, branch, listing, and message send operations.",
      "Workspace chat membership uses chat_members; team workspace chats are team-membered while personal and org chats are user-membered.",
      "Deleting a project deletes project chat members, chat messages, chats, scoped invites, project members, and the project row.",
      "The ProjectNav component receives visibleWorkspace data that is already filtered to the current user's allowed projects and chats.",
    ],
  },
  {
    id: "chat",
    title: "VertexAI Chat",
    category: "AI Workflows",
    icon: MessageCircle,
    status: "Available",
    summary: "Chat supports scoped assistant responses, generated chat titles, branch chats, web context, and live sync.",
    howTo: [
      "Choose a workspace or project chat, then type in the composer at the bottom of the workspace.",
      "Pick Low, Med, or High reasoning before sending to change response budget and timeout.",
      "Turn Web on when the prompt needs current external facts.",
      "Use branch on a message to start a new chat from that selected context.",
    ],
    details: [
      "Submitted messages appear immediately with a pending indicator while the server writes and assistant response run in the background.",
      "Use Low reasoning for quick drafting, summaries, and straightforward questions.",
      "Use Medium reasoning when the request needs fuller context, tradeoffs, synthesis, practical implications, or a recommendation.",
      "Use High reasoning for exhaustive planning, analysis, risk review, or multi-step work where completeness matters more than speed.",
      "Turn Web on only when the question needs current external information; leave it off for workspace-only or historical context.",
      "Branch a chat when a specific message should become the starting point for a separate thread without losing the original conversation.",
      "Token usage can be shown or hidden from User Settings depending on whether the audience needs model diagnostics.",
    ],
    technicalDetails: [
      "Chat send uses a TanStack Query v5 useMutation onMutate handler to cancel scoped chat queries, snapshot the previous cache, and append an optimistic user message with clientStatus sending.",
      "If sendChatMessage fails, onError restores the previous scoped chat cache snapshot and displays a toast notification.",
      "sendChatMessage persists both the user message and assistant response to chat_messages after permission checks pass.",
      "Initial chat titles use the lightweightChatTitleModelId Workers AI model with a local title fallback if AI is unavailable or times out.",
      "Reasoning profiles map to scoped context budgets, max completion tokens, optional reasoning_effort, and thinking visibility settings.",
      "When web search is enabled, the chat path can request consolidated Tavily and Firecrawl context through fetchConsolidatedWebSearch and combine it with scoped project chunks.",
      "Chat updates are published through CHAT_SYNC and consumed by /api/chat-events as server-sent events.",
      "Broader workspace mutations are also written to the D1 events table and streamed through /sse/workspace-events so other open clients can invalidate their TanStack Query caches without continuous browser polling.",
      "Project-scoped chat uses context-aware routing before RAG so direct chat, web search, artifact generation, and Vectorize retrieval use separate backend paths.",
      "Project-scoped RAG chat uses /sse/workspace-events with stream=scoped-rag and the browser EventSource API when Team project context, AI, Vectorize, queue, DB, and R2 bindings are configured.",
      "Scoped RAG tokens are appended to the optimistic assistant message as SSE token events arrive, so Markdown renders incrementally during generation.",
      "Assistant responses render through ArtifactRenderer, which interprets streaming Markdown, tables, Risk Flag chips, action task-list syntax, and supported action JSON schemas.",
      "ArtifactRenderer enables GFM through remark-gfm, LaTeX math through remark-math and rehype-katex, syntax-highlighted code through PrismJS, and structured tabular previews through shared Radix Table primitives without requiring a user or admin setting.",
      "Ordinary chat text normalizes loose visible LaTeX arrow commands such as \\rightarrow while preserving fenced code, inline code, and real math spans; ChatView also runs a scoped post-render cleanup for legacy or over-escaped streamed text nodes.",
      "Markdown list items matching current approvals, decisions, ideas, or tasks, or explicit markers such as approval:team-approval-1, decision:team-decision-1, idea:team-idea-1, and task:team-task-1, mount inline workflow actions in the chat response.",
      "When a user asks for ideas, suggestion-sized assistant list items can surface Add Idea actions even when each line does not literally include the word idea.",
    ],
  },
  {
    id: "realtime-sync",
    title: "Real-Time State Sync",
    category: "Collaboration",
    icon: Zap,
    status: "Available",
    summary: "Database-backed mutation events keep open Personal, Team, and Org workspaces current without browser polling.",
    howTo: [
      "Keep the workspace open in multiple signed-in sessions to see project, chat, artifact, idea, and action updates refresh automatically.",
      "Use Team scope with an active team selected so the event stream subscribes to the right team mutation feed.",
      "If the network reconnects, the browser resumes from the last delivered event id automatically.",
    ],
    details: [
      "When one user changes scoped data, other connected users receive an SSE mutation event and the affected React Query caches refresh in place.",
      "The stream sends heartbeat comments during quiet periods so edge connections stay warm without running a full data refresh.",
      "Client-side idempotency tracks delivered event ids and stores the most recent id per scope, preventing duplicate invalidation work after reconnects.",
      "Receiving a mutation event only invalidates or refreshes cached queries; it does not call write mutations back to the server.",
    ],
    technicalDetails: [
      "D1 stores mutation rows in events with workspace_id, optional team_id, project_id, chat_id, entity metadata, invalidates_json, source_user_id, optional source_client_id, and a monotonically increasing id.",
      "/sse/workspace-events is a TanStack Start server route that validates the signed-in user, verifies Team membership when needed, reads Last-Event-ID or lastEventId, polls D1 every 2500 ms, and emits named mutation events for chat_message, idea, task, and Asana task chat inserts.",
      "The SSE response uses text/event-stream, no-cache/no-transform, X-Accel-Buffering no, and keepalive comments every 20000 ms.",
      "The useWorkspaceEventSource hook consumes mutation events with EventSource, persists the last event id in sessionStorage, deduplicates event ids with an in-memory set, and invalidates pmoWorkspaceQueryKey, my-teams, scoped-projects, or scoped-chats based on invalidates_json.",
      "Chat message append-level updates still use /api/chat-events and CHAT_SYNC, while /sse/workspace-events provides the broader database mutation invalidation layer.",
    ],
  },
  {
    id: "asana-webhooks",
    title: "Asana Integration",
    category: "Automation",
    icon: Zap,
    status: "Available",
    summary:
      "OAuth connects a user's Asana account, maps member projects to VertexAI projects, and gates task writes by captured Asana permissions.",
    howTo: [
      "Open User Settings, then Asana Integration.",
      "Connect Asana and approve the requested scopes.",
      "Map visible Asana projects to existing VertexAI projects, or scaffold new VertexAI projects from selected Asana projects, including projects discovered from Asana portfolio memberships.",
      "Review the permission badge before relying on task submission back to Asana.",
    ],
    details: [
      "OAuth is the connection layer: it lets the app read only the Asana projects visible to the connected user.",
      "The mapping wizard discovers Asana projects through team project memberships and portfolio memberships. Asana requires Full permissions mode for membership and portfolio permission checks.",
      "Scaffolding creates a local VertexAI project and a project chat that can receive Asana updates.",
      "Task submission is disabled for mapped projects unless Asana confirms project write access at save time and the connection has tasks:write scope.",
      "Tasks stay local until the user clicks Sync to Asana unless auto-sync is enabled in Profile > Asana.",
      "The webhook remains the live update layer after mappings exist.",
    ],
    technicalDetails: [
      "/profile/asana uses startAsanaConnection, getAsanaConnectionSummary, saveAsanaProjectMappings, and disconnectAsanaConnection server functions.",
      "/api/asana/oauth/callback exchanges the authorization code server-side with PKCE verifier and state validation.",
      "Asana tokens are encrypted in KV through src/lib/asana-token-vault.ts using TOKEN_VAULT_KEY; D1 stores only connected account metadata and scopes.",
      "asana_oauth_states stores short-lived OAuth state, asana_connections stores the connected Asana identity plus auto-sync preference, and asana_project_mappings stores routing plus can_write_tasks.",
      "The project picker uses Asana team membership and portfolio membership discovery before surfacing projects in the wizard. Set ASANA_USE_FULL_PERMISSIONS=true and reconnect when the Asana app uses Full permissions.",
      "/api/webhooks/asana is routed through Hono in src/worker.ts and delegates to handleAsanaWebhookRequest in src/lib/asana-webhook.ts.",
      "Asana project webhook URLs must include workspaceId or asanaWorkspaceGid plus asanaProjectGid or webhookKey so the Worker can store and retrieve each webhook's X-Hook-Secret in ASANA_WEBHOOK_SECRETS.",
      "When users map or scaffold Asana projects, the app saves the mapping and then idempotently ensures a project-level Asana webhook exists; failures are recorded in asana_project_webhooks instead of rolling back the mapping.",
      "Profile > Asana includes a Repair webhooks action that reruns webhook setup for all mapped projects available to the connected user.",
      "During webhook creation, the receiver stores X-Hook-Secret in KV and returns 200 OK with the exact same X-Hook-Secret response header.",
      "For event deliveries, the receiver verifies X-Hook-Signature or X-Asana-Request-Signature against the raw request body with Web Crypto importKey and crypto.subtle.verify before parsing JSON.",
      "Verified task events are upserted into asana_webhook_task_states through Drizzle before project chats are resolved through asana_project_mappings and the optional legacy env map; linked local tasks are updated when the Asana gid matches workspace_actions.asana_task_gid.",
      "VertexAI task sync writes the local D1 task first, queues an ASANA_SYNC_QUEUE job, creates the remote Asana task in the consumer, then stores asana_task_gid and asana_synced_at back on workspace_actions.",
      "The existing /api/chat-events stream delivers the chat append while /sse/workspace-events invalidates project, chat, and workspace caches.",
    ],
  },
  {
    id: "daily-briefings",
    title: "Scheduled Status Briefs",
    category: "Automation",
    icon: CalendarClock,
    status: "Available",
    summary:
      "Cloudflare cron runs due project briefing schedules and writes executive Markdown summaries into dedicated read-only Briefings chats.",
    howTo: [
      "Open Profile > Briefings to create a daily, weekday, weekly, monthly, or one-time schedule.",
      "Choose the project, local time, time zone, reporting window, and custom instructions. Weekly schedules default to the preceding seven days.",
      "Admins can open Admin Settings > Scheduled Tasks to review central task health, edit retry settings, disable a task, or queue it for the next scheduler tick.",
      "Review generated Markdown summaries in the project's Briefings chat and use briefing_runs for audit history.",
    ],
    details: [
      "The standalone Cloudflare Worker schedule wakes hourly and dispatches due rows from scheduled_tasks.",
      "Each saved schedule stores the local run time, recurrence, time zone, reporting window, selected project, and prompt instructions.",
      "The app automatically resolves or creates the project's Briefings chat and blocks normal user messages, rename, and delete actions on that thread.",
      "The briefing window uses each schedule's configured reportingWindowHours from the scheduled execution time; weekly runs use a 168-hour window.",
      "Schedule retries are idempotent per schedule and timestamp marker, so the same briefing is not inserted twice.",
    ],
    technicalDetails: [
      "wrangler.jsonc defines the hourly cron trigger as 0 * * * * under triggers.crons.",
      "src/worker.ts implements the scheduled handler and passes controller.scheduledTime into runScheduledTaskEngine.",
      "scheduled_tasks stores global temporal jobs for Weekly Briefing, Background Research, and Artifact Validation dispatch.",
      "The Weekly Briefing task delegates to runDailyProjectBriefings, which currently runs due user-defined briefing schedules from Profile > Briefings.",
      "Due schedules query D1 for project-scoped chat transcripts, closed Asana-linked tasks, completed Asana webhook task states, risk signals, current risks, and modified artifacts within the configured reporting window.",
      "The source payload is aggressively compacted into XML-bounded context and sent to the Gemma 4 reasoning model through the AI Gateway wrapper.",
      "The generated summary is inserted as an automated assistant chat_messages row in the project's Briefings chat.",
      "Successful inserts record a realtime chat_message mutation so /sse/workspace-events subscribers can refresh project and chat state.",
      "briefing_runs records each scheduled run status, while briefing_schedules stores last_run_at, last_status, last_error, and next_run_at.",
      "Admin Settings > Scheduled Tasks is backed by scheduled-task admin server functions that read and update scheduled_tasks through the Worker D1 binding.",
      "Queue actions set next_run_at to the current timestamp; the hourly cron-backed Worker still performs the execution work.",
      "The Cloudflare-account Worker deployment must have the existing DB, AI, CHAT_SYNC, and cron-backed scheduled task engine available.",
      "The feature depends on the Cloudflare-account Worker deployment path; Codex Sites hosting may not execute wrangler cron triggers.",
    ],
  },
  {
    id: "artifacts",
    title: "Artifacts Library",
    category: "Content",
    icon: Archive,
    status: "Available",
    summary:
      "Artifacts track document, workbook, presentation, and text outputs with previews, downloads, pins, AI diff reviews, and R2-backed files.",
    howTo: [
      "Open the Artifacts tab to review files for the current workspace or project.",
      "Select an artifact to view metadata and preview details in the right panel.",
      "Preview files from the artifact list or details panel, then download from the preview dialog.",
      "Pin important artifacts to keep them visible in the workspace strip.",
      "Use the Pinned Items rail arrows when pinned ideas, approvals, decisions, tasks, and artifacts exceed the available width.",
      "Use the version history timeline to preview older versions read-only or restore one as a new latest version.",
      "For editable text artifacts, select AI diff, describe the requested change, review the red/green patch preview, then approve the patch to save a new version.",
    ],
    details: [
      "Review the artifact summary before downloading so you know whether the file is final, draft, or pinned.",
      "Use preview for quick inspection when you only need to confirm contents or sheet structure.",
      "Download the original file when you need an offline copy of the source document, presentation, or workbook.",
      "Pin high-value artifacts that should remain visible from the workspace overview.",
      "Pinned items stay in the current workspace scope; carousel arrows appear only when more pinned cards exist off-screen and move one full card into view per click.",
      "Artifact history is immutable; restoring an older version creates a new current version instead of replacing or deleting prior files.",
      "AI diff does not require a separate user preference or admin toggle. It follows the existing artifact edit permission matrix, so Viewer users do not see the action.",
      "AI diff currently supports UTF-8 text-like artifacts such as Markdown, TXT, JSON, YAML, XML, and CSV. Binary Office containers are blocked rather than patched unsafely.",
      "Pin changes update immediately and show a Pending badge while the background artifact write completes.",
      "Generated table exports show a Saving badge in the artifact list until the XLSX file and metadata are committed.",
    ],
    technicalDetails: [
      "Artifact metadata is stored in D1 artifacts rows with title, type, owner, status, r2_key, href, preview_json, pinned, version, parent_artifact_id, and commit_message fields.",
      "File bytes are resolved from R2 through /api/artifacts for generated or seeded R2-backed artifacts, with public seed copies also available under public/artifacts.",
      "Each artifact version maps to a distinct R2 object key. saveTableArtifact and restoreArtifactVersion insert new rows and never overwrite the previous object.",
      "draftArtifactPatch resolves the latest artifact lineage row, reads the current artifact text from a short-lived R2 edge cache backed by ARTIFACTS_BUCKET, and sends Kimi K2.7 Code a strict JSON-delta prompt.",
      "The artifact diff model is @cf/moonshotai/kimi-k2.7-code through artifactDiffModelId and uses the existing AI Gateway, DB, ARTIFACTS_BUCKET, AI, and RBAC configuration.",
      "src/lib/artifact-diff.ts parses JSON patch envelopes, arrays, and newline-delimited streamed JSON actions, then applies replace, delete, insert_before, and insert_after deltas to active UI state.",
      "ArtifactPatchDialog renders each applicable patch with red deletion and green insertion highlighting so the user must approve discrete changes before persistence.",
      "commitArtifactPatch verifies the reviewed baseR2Key is still current, reapplies approved patches server-side, writes the unified text to a versioned R2 key, and inserts a new parented artifacts row.",
      "toggleArtifactPin updates the D1 pinned flag and refreshes merged artifact state.",
      "deleteArtifact rejects destructive deletion so historical D1 rows and R2 objects remain available for time-travel and audit history.",
      "XLSX preview uses a client-side ExcelJS dynamic import, reads visible sheets, and caps preview rendering at 100 rows by 30 columns.",
      "Rendered table export uses an optimistic artifact row with clientStatus saving before saveTableArtifact returns the persisted R2-backed artifact.",
      "saveTableArtifact converts rendered table rows into an XLSX blob, stores it in R2, and inserts matching D1 metadata with project, source chat, version, parent, and commit-message context.",
    ],
  },
  {
    id: "ideas",
    title: "Ideas",
    category: "Workflow Tracking",
    icon: Lightbulb,
    status: "Available",
    summary: "Ideas capture improvement opportunities with category, status, owner, AI analysis, impact, effort, and confidence.",
    howTo: [
      "Open Ideas from the workspace tabs or the blue rail.",
      "Search and filter by status to narrow the list.",
      "Create an idea with title, category, status, impact, and summary.",
      "Use row actions or the details panel to pin, preview, delete, or change idea status.",
      "Use Refresh in the details panel to rerun AI analysis and persist new scores.",
      "Use Share to copy an authenticated app link; users must still sign in.",
    ],
    details: [
      "Manually created ideas use the signed-in user's name as the owner.",
      "Ideas captured from assistant suggestions keep the actual owner extracted from the suggestion when available.",
      "Newly created ideas are not pinned automatically; pin an idea only when it should appear in Pinned Items.",
      "AI analysis compares the idea to Vertex Education context and scores Impact, Effort, and Confidence.",
      "Hover each score to see the concise explanation returned by the model, or a refresh prompt when the idea predates AI rationale storage.",
      "The consideration callout is classified as a pro, gap, or con and uses green, orange, or red styling.",
      "Pins help surface ideas that should stay visible during planning conversations in the scoped Pinned Items rail.",
    ],
    technicalDetails: [
      "Idea status is modeled as a fixed union: Not Started, Reviewing, Convert to Project, and Dismiss.",
      "addIdea creates a persisted D1 idea using the active user display name, project scope, tags, AI analysis fields, and activity entries.",
      "createIdeaFromSuggestion persists assistant-surfaced ideas to D1 without auto-pinning them.",
      "New ideas are assigned to the active project id when a project chat is selected; otherwise projectId is null.",
      "Gemma 4 analysis is stored in impact, effort, confidence, next_step, metrics_json, and thread_json; refreshIdeaAssessment updates those fields on demand.",
      "updateIdeaStatus, refreshIdeaAssessment, toggleIdeaPin, and removeSuggestedIdea are server functions gated by requireWorkspaceEditor.",
      "Idea share links are normal authenticated route URLs with mode, tab, idea id, and team id when relevant; no magic-link access is granted.",
      "Filtering is performed client-side across title, category, owner, summary, and tags.",
    ],
  },
  {
    id: "actions",
    title: "Decisions, Approvals, and Tasks",
    category: "Workflow Tracking",
    icon: CheckCircle2,
    status: "Available",
    summary: "Action tabs provide focused views for commitments, governance approvals, and follow-up work.",
    howTo: [
      "Open Decisions, Approvals, or Tasks from the workspace tabs.",
      "Use row controls or the details panel to preview, pin, delete, or update item status.",
      "Switch project context to see only actions tied to the selected project.",
    ],
    details: [
      "Use Decisions for commitments that need an explicit outcome, owner, and status.",
      "Use Approvals for governance or stakeholder sign-offs that need to be requested and confirmed.",
      "Use Tasks for operational follow-up, execution work, or reminders from a source conversation or artifact.",
      "Use the line-level status control for fast updates, or use the detail panel when you need context before changing status.",
      "Keep actions project-scoped when they only apply to a selected project; keep them general when they apply to the whole workspace.",
      "Pin actions that should remain visible in Pinned Items; unpinning removes them from the strip without deleting the underlying item.",
    ],
    technicalDetails: [
      "Decisions, approvals, and tasks are persisted in D1 workspace_actions rows and hydrated into typed ScopedWorkspaceState action arrays.",
      "Decision status is Not Completed or Completed; completed decisions render with green strikethrough styling.",
      "Approval status is Not Reviewed, Reviewing, Approved, or Not Approved; Approved renders green strikethrough and Not Approved renders red strikethrough.",
      "Tasks can be marked Open or Completed in the app; each task can also be manually synced to Asana once, or auto-synced on creation when the user's Asana setting is enabled.",
      "toggleWorkflowActionPin updates workspace_actions.pinned and refreshes merged workspace state.",
      "ArtifactRenderer recognizes approvals, decisions, ideas, suggestedIdeas, assignedTasks, and tasks JSON arrays when assistant output should become interactive action rows.",
      "Inline workflow actions rendered inside chat create persisted ideas, approvals, decisions, or tasks through the same server-side permission checks as the tabs.",
      "Each action item can carry a nullable projectId, and the UI filters action arrays by the active scopedProjectId.",
      "Status, pin, create, and delete mutations are protected by requireWorkspaceEditor and publish workspace mutation events for cache refresh.",
    ],
  },
  {
    id: "risks",
    title: "Risk Management",
    category: "Workflow Tracking",
    icon: ShieldAlert,
    status: "Available",
    summary: "Risks are detected from project chat, shown as inline Risk Flag chips, and managed in an all-project Risks page.",
    howTo: [
      "Open Risks from the blue rail to see every risk across projects in the selected Personal, Team, or Org scope.",
      "Use the Personal, Team, and Org scope tabs at the top to change the risk register scope.",
      "Search or filter by project, severity, and status to narrow the table.",
      "Click a Risk Flag chip in chat to open the scoped Risks page with that risk selected.",
      "Use Generate on a project-scoped risk to create a mitigation strategy when your role allows risk updates.",
    ],
    details: [
      "The Risks page is intentionally not limited to the currently selected project; it is an operating register across all projects in the selected scope.",
      "Risk detection creates the risk title, description, severity, status, workspace id, and project id. Mitigation strategy starts blank until generated or persisted later.",
      "Mitigation generation uses the selected risk's title, description, severity, status, workspace, and project. It does not invent external project facts.",
      "Viewer users can read risks. Contributor, Manager, and Admin users can update risks and generate mitigation strategies.",
      "Project-scoped risks can generate mitigation. Workspace-level risk rows can be read in the grid, but generation requires a project id.",
    ],
    technicalDetails: [
      "Risk detection uses the shared risk contract in src/lib/risk-contract.ts so streamed Risk Flag JSON and persisted D1 risk rows share normalized ids, severity, title, description, status, and mitigation fields.",
      "Scoped RAG appends fenced JSON blocks with schema vertex.risk.v1 after entity extraction; ArtifactRenderer removes those blocks from Markdown and renders inline Risk Flag chips.",
      "persistScopedRagChatTurn passes extracted entities through normalizeRiskEntities before INSERT OR IGNORE into the D1 risks table.",
      "The command-center Risks rail page renders RiskView through CategoryTablePage and passes the complete workspace.risks array plus workspace.projects for project labels.",
      "generateRiskMitigation is a TanStack Start server function that checks risks.update permission, loads the risk by workspace/project/risk id, calls Workers AI through runTrackedAiGateway, and stores the returned markdown in risks.mitigation_strategy.",
      "No extra user preference or admin feature toggle is required; the feature depends on D1 migrations, the AI binding, scoped project access, and the existing Viewer/Contributor/Manager/Admin role matrix.",
    ],
  },
  {
    id: "prompts",
    title: "Prompt Library",
    category: "AI Workflows",
    icon: Sparkles,
    status: "Available",
    summary: "Reusable prompt templates help start structured assistant requests from the current scope.",
    howTo: [
      "Open Prompts from the tab row or category rail.",
      "Choose a prompt to insert it into the chat composer.",
      "Edit the inserted prompt before sending so it matches the current project or workspace need.",
    ],
    details: [
      "Use prompts when you want a consistent starting structure for recurring questions or work products.",
      "Treat prompt templates as editable drafts; adjust scope, audience, time period, and output format before sending.",
      "Use project context prompts when the answer should stay focused on one project.",
      "Use general workspace prompts for broad planning, governance, or portfolio summaries.",
      "Prompt selection is non-destructive: it fills the composer but does not automatically send the message.",
    ],
    technicalDetails: [
      "Prompt templates are exported from the prompts module and re-exported through pmo-data.",
      "The docs and workspace UI treat prompts as static templates, not database records.",
      "Scoped prompts are created by prefixing each template with the current scopeContextLabel.",
      "onUsePrompt sets chatInput, returns the active tab to Chat, and leaves sending under user control.",
      "Prompt search and display are handled client-side within the current workspace data.",
    ],
  },
  {
    id: "tables-exports",
    title: "Tables and Exports",
    category: "Content",
    icon: ClipboardList,
    status: "Available",
    summary: "Metric cards, charts, rendered tables, and assistant tables support CSV or XLSX export paths.",
    howTo: [
      "Use download controls beside metrics to export small metric rows.",
      "Ask the assistant for a table, then save a rendered HTML table to Artifacts as XLSX.",
      "Download previewed files from the artifact dialog.",
    ],
    details: [
      "Use quick metric exports when you need a small CSV or XLSX snapshot from a visible metric card.",
      "Use table export when the assistant renders a structured table that should become a durable artifact.",
      "Save generated tables to Artifacts when the output should be reused by a project or downloaded later.",
      "Confirm the active workspace, project, and source chat before saving so the artifact lands in the right place.",
      "Download existing workbook artifacts when you need the original spreadsheet rather than a preview.",
    ],
    technicalDetails: [
      "chat-export contains helpers for CSV, XLSX, HTML table parsing, export request parsing, and browser downloads.",
      "ArtifactRenderer maps Markdown table nodes onto the shared Table primitives so streamed assistant tables match the rest of the workspace UI.",
      "ArtifactRenderer maps structured previewJson shapes from vision and document extraction, including row arrays, explicit columns, OCR cell grids, and extracted field maps, onto the shared Radix Table primitives.",
      "RenderedTableExportControls detects rendered table export opportunities and posts FormData to saveTableArtifact.",
      "saveTableArtifact validates mode, optional project_id, source chat title, title, and rows_json before writing.",
      "XLSX generation uses xlsxBlobFromRows, stores the blob in R2, and inserts artifact metadata into D1.",
      "Generated artifact titles can use AI via generateArtifactTitle and fall back to safe local naming.",
      "Metric export buttons pass small row arrays directly to downloadRows for CSV or XLSX generation.",
    ],
  },
  {
    id: "teams-invites",
    title: "Teams and Scoped Invites",
    category: "Collaboration",
    icon: Users,
    status: "Available",
    summary: "Managers and Admins can create teams, projects, chats, and scoped invites.",
    howTo: [
      "Create a team from Team scope when you need a shared workspace.",
      "Invite a teammate to a team or project by email.",
      "Invitees can review and accept scoped invites from User Settings.",
    ],
    details: [
      "Create a team when a set of people needs a shared workspace separate from personal or org-wide work.",
      "Create a team project when the work has a defined delivery scope, project chats, artifacts, and actions.",
      "Invite at the team level when someone needs broad team visibility.",
      "Invite at the project level when someone should only participate in one project.",
      "Accepted invites grant access after the invited user signs in and accepts from the Invites area in User Settings.",
    ],
    technicalDetails: [
      "Teams are stored in teams, team_members records assign owner or member roles, and listMyTeams returns only memberships for the current user.",
      "createTeam inserts the team and owner membership in one flow.",
      "createScopedInvite writes scoped_invites rows for team or project targets with inviter metadata.",
      "acceptScopedInvite validates the email owner, revoked state, and accepted state before inserting membership rows.",
      "Team workspace chats require a matching team_members row and chat_members team association.",
      "Team project access requires project_members rows keyed by project_id, user_id, and team_id.",
    ],
  },
  {
    id: "profile-auth",
    title: "Profile and Access",
    category: "Account",
    icon: KeyRound,
    status: "Available",
    summary:
      "Signed-in users can authenticate with Microsoft or invited credentials, manage User Settings, reset passwords, review invites, relaunch onboarding, and sign out.",
    howTo: [
      "Open the account menu from the bottom of the persistent blue rail or from the mobile top bar.",
      "Choose User Settings to review account details.",
      "Open User Settings to replay the step-based onboarding flow.",
      "Open User Settings to update credentials.",
      "Choose Sign out to end the session.",
    ],
    details: [
      "Use the account menu for User Settings, Admin Settings, and sign-out actions.",
      "Viewer accounts can read permitted workspace content without changing records.",
      "User accounts can create and update workspace records where membership allows access.",
      "Admin accounts can manage users in addition to normal workspace editing.",
      "Use the Invites area in User Settings to review and accept scoped team or project invitations.",
    ],
    technicalDetails: [
      "Protected routes call getSession in their loaders and redirect unauthenticated users to /sign-in.",
      "Better Auth powers email/password sign-in, Microsoft Entra ID OAuth with PKCE, session lookup, sign-out, verification, and invite account creation.",
      "startMicrosoftSignIn creates the Microsoft authorization URL in a TanStack Start server function; the client receives only the URL and never handles provider tokens.",
      "The Microsoft OAuth callback exchanges the code server-side, requires the configured tenant issuer, validates the ID token issuer, and stores provider tokens only in the server-side account table.",
      "Role checks are centralized in helper flows such as requireWorkspaceEditor, requireManager, and admin route loaders.",
      "The current session user is surfaced to signed-in app routes for role-gated edit controls and AppRail account menu rendering.",
      "Token usage display is a client preference stored in localStorage under vertex-show-token-usage.",
    ],
  },
  {
    id: "admin",
    title: "Admin User Management",
    category: "Account",
    icon: ShieldCheck,
    status: "Admin",
    summary: "Admins can manage user accounts, roles, account invitations, and invite revocation.",
    howTo: [
      "Open Admin Settings from the account menu when signed in as an admin.",
      "Use the Users tab to edit names and roles or remove accounts.",
      "Use the Invites tab to create or revoke account invitations.",
    ],
    details: [
      "Use Users to review known accounts, change a display name, change a role, or remove an account.",
      "Use Invites to create first-use account invitations for allowed email addresses.",
      "Create a Viewer invite for read-only users, a Contributor invite for artifact/risk collaborators, a Manager invite for project operators, and an Admin invite for account administrators.",
      "Use admin invites only for people who should manage other user accounts.",
      "Revoke pending invites that were sent to the wrong person or are no longer needed.",
    ],
    technicalDetails: [
      "/admin/users is guarded by a loader that requires an authenticated admin role.",
      "createUserInvite validates allowed email domains, hashes the invite token, stores an auth_invites row, and attempts to send an auth email.",
      "If email delivery is unavailable, the generated invite link is exposed in the admin UI.",
      "listManagedUsers and listUserInvites use React Query with periodic refetching.",
      "updateManagedUser changes name and role fields on the user table, while deleteManagedUser removes a user account except the current admin's own account.",
      "revokeUserInvite marks pending invite rows revoked and blocks later acceptance.",
    ],
  },
  {
    id: "storage",
    title: "D1, R2, and Seed Data",
    category: "Platform",
    icon: Database,
    status: "Available",
    summary: "Structured data uses D1, artifact files use R2, and local seed data mirrors the hosted bindings.",
    howTo: [
      "Run npm run db:setup and npm run db:seed for local database setup.",
      "Run npm run r2:seed to load local R2 artifact seed files.",
      "Use remote variants only when targeting the Cloudflare account resources.",
    ],
    details: [
      "Run local setup before testing workspace, admin, chat, or artifact flows that depend on persisted data.",
      "Seed D1 when you need example workspaces, projects, chats, messages, artifacts, and membership records.",
      "Seed R2 when artifact downloads or previews need real file bytes behind the metadata.",
      "Use remote setup commands only when you intentionally want to change the Cloudflare account resources.",
      "Keep seed files and D1 metadata aligned so artifact links point to real objects.",
    ],
    technicalDetails: [
      "Drizzle schema definitions live in db/schema.ts and generated migrations live under drizzle/.",
      "drizzle/0011_workspace_action_pins.sql adds workspace_actions.pinned for explicit task, approval, and decision pinning.",
      "Local D1 setup runs the generated migration SQL through wrangler d1 execute against ai-command-center-db.",
      "Seed SQL in db/seed/ai-command-center.sql inserts workspace, project, chat, message, artifact, team, membership, and action records.",
      "R2 seed files are stored under r2-seed and mirrored to the ai-command-center-artifacts bucket by scripts/seed-r2.ps1.",
      "Cloudflare Worker deployment reads DB and ARTIFACTS_BUCKET from wrangler.jsonc, while Sites declares logical bindings in .openai/hosting.json.",
      "worker-configuration.d.ts is generated from Wrangler types and should be refreshed after binding changes.",
    ],
  },
  {
    id: "rag-ingestion",
    title: "Scoped RAG and Document Ingestion",
    category: "Platform",
    icon: FileText,
    status: "Partial",
    summary:
      "Context-aware routing decides whether prompts need Vectorize, web search, direct chat, or artifact generation while document ingestion keeps project artifacts indexed.",
    howTo: [
      "Use Team project chat for scoped RAG behavior when the platform bindings are configured.",
      "Upload an artifact to store the raw file in R2 and queue ingestion without waiting for parsing or indexing.",
      "Ask project-specific questions to retrieve indexed chunks with citation keys.",
      "Ask current or public-web questions when live context is needed; those prompts use the hybrid external search pipeline and scoped project retrieval.",
      "Use simple planning or drafting prompts without naming project history when you want direct generation without Vectorize retrieval.",
    ],
    details: [
      "Use scoped RAG when a Team project needs answers grounded in previously generated or ingested project artifacts.",
      "The prompt router runs before retrieval work, so only RAG_SEARCH and WEB_SEARCH prompts pay the project chunk retrieval cost.",
      "The router recognizes RAG_SEARCH, WEB_SEARCH, DIRECT_CHAT, ENTITY_EXTRACTION, and ARTIFACT_GENERATION as strict intent categories.",
      "Artifact uploads are accepted immediately after the raw asset is stored and the ingestion job is published, so the UI is not blocked by document processing.",
      "The artifact status starts as pending, moves to processing in the Queue consumer, and finishes as completed or failed after background ingestion.",
      "Ask questions that name the project artifact, decision history, or prior output you want the assistant to use.",
      "Read citation keys in the response to understand which indexed artifact chunks supported the answer.",
      "If the assistant says the scoped artifact history is insufficient, upload or generate the missing source material first.",
      "Treat this area as partially available until richer ingestion status and document parsing coverage are exposed in the UI.",
    ],
    technicalDetails: [
      "Scoped RAG requires DB, ARTIFACTS_BUCKET, VECTORIZE, DOCUMENT_INGESTION_QUEUE, and AI bindings.",
      "uploadArtifact writes the raw file to ARTIFACTS_BUCKET, inserts an artifacts_registry row with pending status, publishes a DocumentIngestionJob to DOCUMENT_INGESTION_QUEUE, sets HTTP 202 Accepted, and returns queued.",
      "ingestGeneratedArtifact writes raw artifact text to R2 and queues a scoped-rag-generated-artifact job.",
      "document-ingestion-worker handles queued jobs and owns expensive ingestion work: document text extraction, semantic chunking, embedTexts execution, D1 document_chunks or document_chunks_v2 inserts, and Vectorize upserts.",
      "wrangler.jsonc binds DOCUMENT_INGESTION_QUEUE as the producer for the main app, while wrangler.document-ingestion.jsonc declares the document-ingestion-queue consumer with batch size 5, timeout 30, and max retries 3.",
      "createScopedRagStreamResponse validates team and project access, re-queries the active user's D1 role, fetches project context, classifies intent with classifyPromptIntent, and dispatches to exactly one generation path.",
      "Main generation prepends a D1-backed priority context header before all other prompt content, including workspace name, active project, project status, and detailed project description.",
      "Every scoped generation path injects an absolute role directive before workspace, web, historical chunk, or user prompt content so viewer users must be refused for state changes or restricted-artifact summaries.",
      "Generated scoped RAG artifacts can pass sensitivityLabel Confidential or restricted true to store matching R2 metadata before queue ingestion.",
      "RAG_SEARCH embeds the prompt, queries Vectorize with team_id, project_id, and role-sensitive confidentiality metadata filters, loads matching chunks from D1, and streams a cited answer.",
      "WEB_SEARCH calls fetchConsolidatedWebSearch, loads scoped D1-backed historical chunks through role-filtered Vectorize matches, and streams an answer from both context sections.",
      "DIRECT_CHAT, ENTITY_EXTRACTION, and ARTIFACT_GENERATION bypass embeddings, Vectorize, and web search, then stream from the primary generation model with the same priority workspace context and role directive.",
      "chatWithScopedRag remains a TanStack Start server function wrapper, but native browser streaming uses GET /sse/workspace-events with stream=scoped-rag and query parameters for prompt, teamId, workspaceId, and projectId.",
      "The scoped RAG SSE contract emits trace, citations, thinking, token, entities, done, and stream-error events. The client closes the EventSource on done or stream-error, while transport failures use the native onerror path.",
      "Intent routing uses @cf/zai-org/glm-4.7-flash with turn-level thinking disabled to choose RAG_SEARCH, WEB_SEARCH, DIRECT_CHAT, ENTITY_EXTRACTION, or ARTIFACT_GENERATION.",
      "Citation metadata includes vector id, document name, R2 key, and match score when available.",
    ],
  },
  {
    id: "coming-soon",
    title: "Coming Soon Stubs",
    category: "Roadmap",
    icon: Zap,
    status: "Coming Soon",
    summary: "Some visible controls and backend capabilities are placeholders or partially wired.",
    howTo: [
      "Attachment button: currently shows a queued toast; full upload-from-composer workflow is coming soon.",
      "Workspace context button: currently shows a context-added toast; explicit context picker is coming soon.",
      "Artifact share buttons: currently prepare link options; richer share modal and permissions workflow are coming soon.",
      "Notifications: current decision taxonomy notification is a placeholder; actionable notification center is coming soon.",
    ],
    details: [
      "Composer attachments need a full upload, progress, permission, and artifact-linking workflow.",
      "Workspace context needs a picker so users can deliberately attach projects, artifacts, or previous chats.",
      "Artifact sharing needs a modal that shows target audience, permission level, and link behavior before a link is copied.",
      "Notifications need an actionable center with unread state, decision flags, approval reminders, and owner routing.",
      "Docs can later be personalized by role so Admins, Managers, Contributors, Viewers, and technical users see the most relevant starting points.",
    ],
    technicalDetails: [
      "Attachment and workspace context buttons currently emit toast messages from the workspace route and do not transmit files or change context state.",
      "Idea share copies an authenticated route URL, while artifact share controls currently call toast handlers and do not create durable share records or permission grants.",
      "The notification button currently emits a placeholder decision taxonomy message.",
      "Document ingestion now uses an asynchronous R2 plus Queue handoff, but the UI still needs richer status polling, retry visibility, and expanded parser coverage.",
      "External web search depends on TAVILY_API_KEY and FIRECRAWL_API_KEY and reports unavailable providers when keys are missing.",
      "Docs search is currently client-side over static section data; it is not indexed or connected to generated application metadata.",
    ],
  },
];

const userWorkflowArticles: DocArticle[] = [
  ...docSections
    .filter((section) => !["storage", "rag-ingestion"].includes(section.id))
    .map((section) => ({
      id: `workflow-${section.id}`,
      title: section.title,
      category: "User Workflows",
      icon: section.icon,
      summary: section.summary,
      status: section.status,
      blocks: [
        { title: "How To", items: section.howTo, variant: "steps" as const },
        { title: "Usage Guidance", items: section.details, variant: "notes" as const },
      ],
    })),
  {
    id: "workflow-scoped-rag",
    title: "Using Project Knowledge",
    category: "User Workflows",
    icon: FileText,
    status: "Partial",
    summary: "Use Team project chat to ask questions against project artifacts without needing to understand the retrieval pipeline.",
    blocks: [
      {
        title: "How To",
        variant: "steps",
        items: [
          "Open Team scope, select the right team, and choose the project that owns the source material.",
          "Upload or generate the artifact that should become part of the project knowledge base.",
          "Ask a project-specific question in the project chat and name the source, decision, artifact, or prior work you expect the assistant to use.",
          "Review citations or source keys in the answer when they are present, then upload missing material if the answer says the available context is insufficient.",
        ],
      },
      {
        title: "Usage Guidance",
        variant: "notes",
        items: [
          "Use project knowledge for questions that should be grounded in internal project outputs.",
          "Use the Web toggle for current external information such as recent public policies, vendor pages, or live research that should be combined with project history.",
          "Keep simple drafting prompts short and direct when you do not want the assistant to search project history.",
          "Treat this workflow as partially available until richer upload status, retry visibility, and broader document parsing are exposed in the user interface.",
        ],
      },
    ],
  },
];

const technicalArticles: DocArticle[] = [
  {
    id: "technical-rag",
    title: "RAG Orchestration",
    category: "Technical Reference",
    icon: FileText,
    status: "Partial",
    summary: "Scoped RAG routes project questions through embedding, Vectorize retrieval, D1 chunk lookup, and streamed cited generation.",
    blocks: [
      {
        title: "Implementation Details",
        variant: "technical",
        items: [
          "Scoped RAG requires DB, ARTIFACTS_BUCKET, VECTORIZE, DOCUMENT_INGESTION_QUEUE, and AI bindings.",
          "createScopedRagStreamResponse validates team and project access, re-queries the active user's D1 role, fetches project context, classifies prompt intent, and dispatches to exactly one generation path.",
          "Before generation, the system prepends an absolute role directive and a priority workspace context header from D1 with workspace name, active project name, project status, and detailed project description.",
          "Generated scoped RAG artifacts can pass sensitivityLabel Confidential or restricted true to store matching R2 metadata before queue ingestion.",
          "RAG_SEARCH embeds the prompt, queries Vectorize with team_id, project_id, and role-sensitive confidentiality metadata filters, loads matching chunks from D1, and streams a cited answer.",
          "The scoped RAG SSE contract emits trace, citations, thinking, token, entities, done, and stream-error events. The client closes the EventSource on done or stream-error, while transport failures use the native onerror path.",
          "Citation metadata includes vector id, document name, R2 key, and match score when available.",
        ],
      },
    ],
  },
  {
    id: "technical-semantic-search",
    title: "Semantic Search and Vectorize",
    category: "Technical Reference",
    icon: Search,
    status: "Partial",
    summary:
      "Semantic search stores embedded document chunks in Vectorize and retrieves them with team, project, and role-sensitive confidentiality metadata filters.",
    blocks: [
      {
        title: "Implementation Details",
        variant: "technical",
        items: [
          "Document ingestion creates semantic chunks, embeds chunk text, writes chunk records to D1, and upserts corresponding vectors into Vectorize.",
          "Vector queries are filtered by team_id and project_id so project chat retrieval stays scoped to the active team project.",
          "New vectors include confidentiality and restricted metadata; viewer queries exclude Confidential or restricted chunks before D1 chunk text is loaded into the model context.",
          "D1 remains the source of chunk metadata and readable content, while Vectorize provides similarity search and match scores.",
          "Prompt embedding happens for RAG_SEARCH and WEB_SEARCH intents; direct chat, entity extraction, and artifact generation bypass embeddings and Vectorize.",
          "Retrieved matches are converted into cited context before generation so the answer can expose source keys instead of only free-form prose.",
        ],
      },
    ],
  },
  {
    id: "technical-intent-routing",
    title: "Intent Routing",
    category: "Technical Reference",
    icon: GitBranch,
    status: "Available",
    summary: "The prompt router separates RAG, web search, direct chat, and artifact generation before expensive retrieval work starts.",
    blocks: [
      {
        title: "Implementation Details",
        variant: "technical",
        items: [
          "Project-scoped chat uses context-aware routing before RAG so direct chat, web search, artifact generation, and Vectorize retrieval use separate backend paths.",
          "Intent routing chooses RAG_SEARCH, WEB_SEARCH, DIRECT_CHAT, ENTITY_EXTRACTION, or ARTIFACT_GENERATION.",
          "WEB_SEARCH calls fetchConsolidatedWebSearch, loads scoped D1-backed historical chunks through Vectorize matches, and streams an answer from both context sections.",
          "DIRECT_CHAT, ENTITY_EXTRACTION, and ARTIFACT_GENERATION bypass embeddings, Vectorize, and web search, then stream from the primary generation model with the D1-backed priority workspace context header.",
          "Reasoning profiles map to scoped context budgets, max completion tokens, optional reasoning_effort, and thinking visibility settings.",
        ],
      },
    ],
  },
  {
    id: "technical-document-ingestion",
    title: "Document Ingestion Queue",
    category: "Technical Reference",
    icon: ClipboardList,
    status: "Partial",
    summary: "Artifact uploads are accepted quickly, then background queue consumers handle parsing, chunking, embedding, and indexing.",
    blocks: [
      {
        title: "Implementation Details",
        variant: "technical",
        items: [
          "uploadArtifact writes the raw file to ARTIFACTS_BUCKET, inserts an artifacts_registry row with pending status, publishes a DocumentIngestionJob to DOCUMENT_INGESTION_QUEUE, sets HTTP 202 Accepted, and returns queued.",
          "ingestGeneratedArtifact writes raw artifact text to R2 and queues a scoped-rag-generated-artifact job.",
          "document-ingestion-worker handles queued jobs and owns expensive ingestion work: document text extraction, semantic chunking, embedTexts execution, D1 chunk inserts, and Vectorize upserts.",
          "wrangler.jsonc binds DOCUMENT_INGESTION_QUEUE as the producer for the main app, while wrangler.document-ingestion.jsonc declares the document-ingestion-queue consumer with batch size 5, timeout 30, and max retries 3.",
          "The artifact status starts as pending, moves to processing in the Queue consumer, and finishes as completed or failed after background ingestion.",
        ],
      },
    ],
  },
  {
    id: "technical-chat-streaming",
    title: "Chat Streaming and Sync",
    category: "Technical Reference",
    icon: MessageCircle,
    status: "Available",
    summary:
      "Chat uses optimistic React Query updates, server-side message persistence, SSE token streaming, and database-backed mutation events.",
    blocks: [
      {
        title: "Implementation Details",
        variant: "technical",
        items: [
          "Chat send uses a TanStack Query v5 useMutation onMutate handler to cancel scoped chat queries, snapshot the previous cache, and append an optimistic user message with clientStatus sending.",
          "sendChatMessage persists both the user message and assistant response to chat_messages after permission checks pass.",
          "Project-scoped RAG chat uses /sse/workspace-events with stream=scoped-rag and the browser EventSource API when Team project context, AI, Vectorize, queue, DB, and R2 bindings are configured.",
          "Scoped RAG tokens are appended to the optimistic assistant message as SSE token events arrive, so Markdown renders incrementally during generation.",
          "Chat updates are published through CHAT_SYNC and consumed by /api/chat-events as server-sent events.",
        ],
      },
    ],
  },
  {
    id: "technical-state-sync",
    title: "Real-Time State Sync",
    category: "Technical Reference",
    icon: Zap,
    status: "Available",
    summary: "D1 mutation events and SSE keep workspace clients current without broad browser polling.",
    blocks: [
      {
        title: "Implementation Details",
        variant: "technical",
        items: docSections.find((section) => section.id === "realtime-sync")?.technicalDetails ?? [],
      },
    ],
  },
  {
    id: "technical-storage",
    title: "D1, R2, and Seed Data",
    category: "Technical Reference",
    icon: Database,
    status: "Available",
    summary: "Structured records live in D1, artifact bytes live in R2, and local seed commands mirror hosted bindings.",
    blocks: [
      {
        title: "Setup Instructions",
        variant: "steps",
        items: docSections.find((section) => section.id === "storage")?.howTo ?? [],
      },
      {
        title: "Implementation Details",
        variant: "technical",
        items: docSections.find((section) => section.id === "storage")?.technicalDetails ?? [],
      },
    ],
  },
  {
    id: "technical-artifacts",
    title: "Artifacts, Previews, and Exports",
    category: "Technical Reference",
    icon: Archive,
    status: "Available",
    summary:
      "Artifact metadata, R2 files, preview rendering, AI diff patching, pin/delete mutations, and generated XLSX exports share one storage model.",
    blocks: [
      {
        title: "Implementation Details",
        variant: "technical",
        items: docSections.find((section) => section.id === "artifacts")?.technicalDetails ?? [],
      },
      {
        title: "Export Details",
        variant: "technical",
        items: docSections.find((section) => section.id === "tables-exports")?.technicalDetails ?? [],
      },
    ],
  },
  {
    id: "technical-auth-access",
    title: "Authentication and Access Control",
    category: "Technical Reference",
    icon: KeyRound,
    status: "Available",
    summary: "Protected routes, Better Auth sessions, roles, team memberships, project memberships, and invites gate access.",
    blocks: [
      {
        title: "Implementation Details",
        variant: "technical",
        items: [
          ...(docSections.find((section) => section.id === "profile-auth")?.technicalDetails ?? []),
          ...(docSections.find((section) => section.id === "teams-invites")?.technicalDetails ?? []),
          ...(docSections.find((section) => section.id === "admin")?.technicalDetails ?? []),
        ],
      },
    ],
  },
  {
    id: "technical-deployment",
    title: "Infrastructure and Deployment",
    category: "Technical Reference",
    icon: ShieldCheck,
    status: "Available",
    summary: "The app is a Cloudflare Worker-compatible Sites build with D1, R2, Queue, Vectorize, and AI bindings.",
    blocks: [
      {
        title: "Implementation Details",
        variant: "technical",
        items: [
          "npm run build runs vite build and tsc --noEmit for local validation.",
          "npm run deploy runs the production build and then deploys through scripts/run-wrangler.mjs with wrangler.jsonc.",
          "Cloudflare Worker deployment reads DB and ARTIFACTS_BUCKET from wrangler.jsonc, while Sites declares logical bindings in .openai/hosting.json.",
          "Use local db:setup, db:seed, and r2:seed commands for local development; use remote variants only when intentionally changing Cloudflare account resources.",
          "worker-configuration.d.ts is generated from Wrangler types and should be refreshed after binding changes.",
        ],
      },
    ],
  },
  {
    id: "technical-roadmap-stubs",
    title: "Roadmap Stubs and Partial Wiring",
    category: "Technical Reference",
    icon: Sparkles,
    status: "Coming Soon",
    summary: "Some visible UI controls are intentionally stubbed while their durable backend workflows are completed.",
    blocks: [
      {
        title: "Implementation Details",
        variant: "technical",
        items: docSections.find((section) => section.id === "coming-soon")?.technicalDetails ?? [],
      },
    ],
  },
];

const docArticles = [...userWorkflowArticles, ...technicalArticles];
const docCategories = [
  {
    title: "User Workflows",
    description: "Feature-by-feature usage instructions without implementation detail.",
    articles: userWorkflowArticles,
  },
  {
    title: "Technical Reference",
    description: "RAG, semantic search, infrastructure, deployment, and implementation details.",
    articles: technicalArticles,
  },
];

function DocsPage() {
  const { session } = Route.useLoaderData();
  const [activeArticleId, setActiveArticleId] = useState(docArticles[0].id);
  const [searchTerm, setSearchTerm] = useState("");
  const activeArticle = docArticles.find((article) => article.id === activeArticleId) ?? docArticles[0];

  const filteredCategories = useMemo(() => {
    const normalized = searchTerm.trim().toLowerCase();
    return docCategories
      .map((category) => ({
        ...category,
        articles: category.articles.filter((article) => {
          if (!normalized) return true;
          return [article.title, article.category, article.summary, ...article.blocks.flatMap((block) => block.items)]
            .join(" ")
            .toLowerCase()
            .includes(normalized);
        }),
      }))
      .filter((category) => category.articles.length > 0);
  }, [searchTerm]);

  async function handleSignOut() {
    await authClient.signOut();
    window.location.href = "/sign-in";
  }

  return (
    <main className="h-svh overflow-hidden bg-[linear-gradient(135deg,oklch(0.985_0.006_247),oklch(0.955_0.015_240))] p-0 text-foreground lg:p-5">
      <div className="workspace-shadow grid h-full grid-cols-[72px_minmax(0,1fr)] overflow-hidden border bg-card lg:rounded-xl">
        <AppRail
          account={{
            canAdmin: isAdminRole(session.user.role),
            userEmail: session.user.email,
            userName: session.user.name,
            onSignOut: handleSignOut,
          }}
          activeItem="Docs"
          persist
        />
        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-background">
          <header className="grid min-h-16 shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b bg-card px-4 lg:min-h-19.5 lg:px-6">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase text-primary">Documentation Library</p>
              <h1 className="truncate text-lg font-semibold lg:text-2xl">VertexAI Docs</h1>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{session.user.role}</Badge>
              <Button type="button" variant="outline" onClick={() => (window.location.href = "/")}>
                Workspace
              </Button>
            </div>
          </header>

          <div className="grid min-h-0 flex-1 lg:grid-cols-[310px_minmax(0,1fr)]">
            <aside className="hidden min-h-0 border-r bg-card lg:flex lg:flex-col">
              <div className="border-b p-4">
                <label className="flex h-10 items-center gap-2 rounded-md border bg-background px-3 text-muted-foreground">
                  <Search className="size-4" />
                  <Input
                    className="h-8 border-0 px-0 shadow-none focus-visible:ring-0"
                    placeholder="Search docs"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                  />
                </label>
              </div>
              <nav className="scrollbar-thin min-h-0 flex-1 overflow-auto p-3">
                <DocNav activeArticleId={activeArticle.id} categories={filteredCategories} onSelectArticle={setActiveArticleId} />
              </nav>
            </aside>

            <article className="scrollbar-thin min-h-0 overflow-auto">
              <div className="mx-auto max-w-5xl px-4 py-5 lg:px-8 lg:py-8">
                <div className="mb-5 grid gap-3 lg:hidden">
                  <label className="flex h-10 items-center gap-2 rounded-md border bg-card px-3 text-muted-foreground">
                    <Search className="size-4" />
                    <Input
                      className="h-8 border-0 px-0 shadow-none focus-visible:ring-0"
                      placeholder="Search docs"
                      value={searchTerm}
                      onChange={(event) => setSearchTerm(event.target.value)}
                    />
                  </label>
                  <MobileDocNav activeArticleId={activeArticle.id} categories={filteredCategories} onSelectArticle={setActiveArticleId} />
                </div>

                <DocHero article={activeArticle} />
                <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_290px]">
                  <div className="grid gap-5">
                    {activeArticle.blocks.map((block) => (
                      <DocBlock
                        key={block.title}
                        audience={block.variant === "technical" ? "Technical reference" : undefined}
                        title={block.title}
                      >
                        <DocItems items={block.items} variant={block.variant ?? "notes"} />
                      </DocBlock>
                    ))}
                  </div>
                  <aside className="grid content-start gap-4">
                    <Card>
                      <CardContent className="space-y-3 p-4">
                        <div className="flex items-center gap-2">
                          <Lock className="size-4 text-primary" />
                          <strong className="text-sm">Access Notes</strong>
                        </div>
                        <p className="text-sm leading-6 text-muted-foreground">
                          Docs follow the signed-in app shell. Viewer accounts can read docs and workspace data, while Contributor, Manager,
                          and Admin roles unlock write actions.
                        </p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="space-y-3 p-4">
                        <div className="flex items-center gap-2">
                          <BookOpen className="size-4 text-primary" />
                          <strong className="text-sm">Documentation Sections</strong>
                        </div>
                        <div className="grid gap-2">
                          {docCategories.map((category) => (
                            <div key={category.title} className="rounded-md border bg-muted/25 p-3">
                              <strong className="block text-sm">{category.title}</strong>
                              <p className="mt-1 text-xs leading-5 text-muted-foreground">{category.description}</p>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  </aside>
                </div>
              </div>
            </article>
          </div>
        </section>
      </div>
    </main>
  );
}

function DocNav({
  activeArticleId,
  categories,
  onSelectArticle,
}: {
  activeArticleId: string;
  categories: typeof docCategories;
  onSelectArticle: (articleId: string) => void;
}) {
  if (categories.length === 0) {
    return <p className="px-3 py-2 text-sm text-muted-foreground">No docs match your search.</p>;
  }

  return (
    <div className="space-y-5">
      {categories.map((category) => (
        <section key={category.title}>
          <div className="mb-2 px-3">
            <h2 className="text-xs font-semibold uppercase tracking-normal text-primary">{category.title}</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{category.description}</p>
          </div>
          <div className="space-y-1">
            {category.articles.map((article) => (
              <button
                key={article.id}
                type="button"
                className={cn(
                  "flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent",
                  activeArticleId === article.id && "bg-accent text-accent-foreground",
                )}
                onClick={() => onSelectArticle(article.id)}
              >
                <article.icon className="mt-0.5 size-4 shrink-0 text-primary" />
                <span className="min-w-0">
                  <strong className="block truncate">{article.title}</strong>
                  <span className="block truncate text-xs text-muted-foreground">{article.status}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function MobileDocNav({
  activeArticleId,
  categories,
  onSelectArticle,
}: {
  activeArticleId: string;
  categories: typeof docCategories;
  onSelectArticle: (articleId: string) => void;
}) {
  if (categories.length === 0) {
    return <p className="text-sm text-muted-foreground">No docs match your search.</p>;
  }

  return (
    <div className="grid gap-3">
      {categories.map((category) => (
        <section key={category.title} className="grid gap-2">
          <h2 className="px-1 text-xs font-semibold uppercase text-primary">{category.title}</h2>
          <div className="flex gap-2 overflow-auto pb-1">
            {category.articles.map((article) => (
              <Button
                key={article.id}
                type="button"
                size="sm"
                variant={activeArticleId === article.id ? "default" : "outline"}
                onClick={() => onSelectArticle(article.id)}
              >
                {article.title}
              </Button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function DocItems({ items, variant }: { items: string[]; variant: "steps" | "notes" | "technical" }) {
  if (variant === "steps") {
    return (
      <ol className="grid gap-3">
        {items.map((item, index) => (
          <li key={item} className="grid grid-cols-[32px_minmax(0,1fr)] gap-3">
            <span className="grid size-8 place-items-center rounded-md bg-primary text-sm font-semibold text-primary-foreground">
              {index + 1}
            </span>
            <p className="pt-1 text-sm leading-6 text-muted-foreground">{item}</p>
          </li>
        ))}
      </ol>
    );
  }

  return (
    <div className="grid gap-3">
      {items.map((item) => (
        <div
          key={item}
          className={cn(
            "rounded-md border p-3 leading-6",
            variant === "technical"
              ? "border-primary/15 bg-primary/5 font-mono text-xs text-foreground"
              : "bg-muted/25 text-sm text-muted-foreground",
          )}
        >
          {item}
        </div>
      ))}
    </div>
  );
}

function DocHero({ article }: { article: DocArticle }) {
  return (
    <section className="rounded-lg border bg-card p-5 lg:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
            <article.icon className="size-6" />
          </span>
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{article.category}</Badge>
              <StatusBadge status={article.status} />
            </div>
            <h2 className="text-2xl font-semibold tracking-normal lg:text-3xl">{article.title}</h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground lg:text-base">{article.summary}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function DocBlock({ audience, children, title }: { audience?: string; children: React.ReactNode; title: string }) {
  return (
    <section className="rounded-lg border bg-card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-semibold">{title}</h3>
        {audience ? <Badge variant="info">{audience}</Badge> : null}
      </div>
      {children}
    </section>
  );
}

function StatusBadge({ status }: { status: DocStatus }) {
  if (status === "Available") return <Badge variant="success">Available</Badge>;
  if (status === "Admin") return <Badge variant="info">Admin</Badge>;
  if (status === "Partial") return <Badge variant="warning">Partial</Badge>;
  return <Badge variant="secondary">Coming Soon</Badge>;
}
