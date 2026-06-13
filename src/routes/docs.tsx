import { useEffect, useMemo, useState, type ComponentType } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import {
  Archive,
  BookOpen,
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
import { cn } from "@/lib/utils";
import { authClient } from "@/lib/auth-client";
import { getSessionSnapshot } from "@/lib/auth-workflow";

export const Route = createFileRoute("/docs")({
  loader: async () => {
    const session = await getSessionSnapshot();
    if (!session) throw redirect({ to: "/sign-in" });
    return { session };
  },
  head: () => ({
    meta: [{ title: "Docs | Vertex AI Command Center" }],
  }),
  component: DocsPage,
});

type DocStatus = "Available" | "Admin" | "Partial" | "Coming soon";

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
      "Use Medium reasoning when the request needs tradeoffs, synthesis, or a recommendation.",
      "Use High reasoning for complex planning, analysis, risk review, or multi-step work where completeness matters more than speed.",
      "Turn Web on only when the question needs current external information; leave it off for workspace-only or historical context.",
      "Branch a chat when a specific message should become the starting point for a separate thread without losing the original conversation.",
      "Token usage can be shown or hidden from the account menu depending on whether the audience needs model diagnostics.",
    ],
    technicalDetails: [
      "Chat send uses a TanStack Query v5 useMutation onMutate handler to cancel scoped chat queries, snapshot the previous cache, and append an optimistic user message with clientStatus sending.",
      "If sendChatMessage fails, onError restores the previous scoped chat cache snapshot and displays a toast notification.",
      "sendChatMessage persists both the user message and assistant response to chat_messages after permission checks pass.",
      "Initial chat titles use the lightweightChatTitleModelId Workers AI model with a local title fallback if AI is unavailable or times out.",
      "Reasoning profiles map to max completion tokens, timeout values, optional reasoning_effort, and thinking visibility settings.",
      "When web search is enabled, the chat path can request consolidated Tavily and Firecrawl context through fetchConsolidatedWebSearch.",
      "Chat updates are published through CHAT_SYNC and consumed by /api/chat-events as server-sent events.",
      "Broader workspace mutations are also written to the D1 events table and streamed through /api/events so other open clients can invalidate their TanStack Query caches without continuous browser polling.",
      "Project-scoped RAG chat uses /api/scoped-rag-stream and the browser EventSource API when Team project context, AI, Vectorize, queue, DB, and R2 bindings are configured.",
      "Scoped RAG tokens are appended to the optimistic assistant message as SSE token events arrive, so Markdown renders incrementally during generation.",
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
      "/api/events is a TanStack Start server route that validates the signed-in user, verifies Team membership when needed, reads Last-Event-ID or lastEventId, polls D1 every 2500 ms, and emits named mutation events.",
      "The SSE response uses text/event-stream, no-cache/no-transform, X-Accel-Buffering no, and keepalive comments every 20000 ms.",
      "The workspace route consumes mutation events with EventSource, persists the last event id in sessionStorage, deduplicates event ids with an in-memory set, and invalidates pmoWorkspaceQueryKey, my-teams, scoped-projects, or scoped-chats based on invalidates_json.",
      "Chat message append-level updates still use /api/chat-events and CHAT_SYNC, while /api/events provides the broader database mutation invalidation layer.",
    ],
  },
  {
    id: "artifacts",
    title: "Artifacts Library",
    category: "Content",
    icon: Archive,
    status: "Available",
    summary: "Artifacts track DOCX, XLSX, and PPTX outputs with previews, downloads, pins, and R2-backed files.",
    howTo: [
      "Open the Artifacts tab to review files for the current workspace or project.",
      "Select an artifact to view metadata and preview details in the right panel.",
      "Preview files from the artifact list or details panel, then download from the preview dialog.",
      "Pin important artifacts to keep them visible in the workspace strip.",
    ],
    details: [
      "Review the artifact summary before downloading so you know whether the file is final, draft, or pinned.",
      "Use preview for quick inspection when you only need to confirm contents or sheet structure.",
      "Download the original file when you need to edit the source document, presentation, or workbook.",
      "Pin high-value artifacts that should remain visible from the workspace overview.",
      "Delete only when the artifact should be removed from the current library and underlying storage.",
      "Pin changes update immediately and show a Pending badge while the background artifact write completes.",
      "Generated table exports show a Saving badge in the artifact list until the XLSX file and metadata are committed.",
    ],
    technicalDetails: [
      "Artifact metadata is stored in D1 artifacts rows with title, type, owner, status, r2_key, href, preview_json, and pinned fields.",
      "File bytes are resolved from R2 through /api/artifacts for generated or seeded R2-backed artifacts, with public seed copies also available under public/artifacts.",
      "Artifact pin and delete mutations cancel the workspace query, snapshot pmoWorkspaceQueryKey, update the React Query cache with setQueryData, and rollback to the snapshot on error.",
      "toggleArtifactPin updates the D1 pinned flag and refreshes merged artifact state.",
      "deleteArtifact deletes the D1 metadata row and attempts to delete the corresponding R2 object.",
      "XLSX preview uses a client-side ExcelJS dynamic import, reads visible sheets, and caps preview rendering at 100 rows by 30 columns.",
      "Rendered table export uses an optimistic artifact row with clientStatus saving before saveTableArtifact returns the persisted R2-backed artifact.",
      "saveTableArtifact converts rendered table rows into an XLSX blob, stores it in R2, and inserts matching D1 metadata with project and source chat context.",
    ],
  },
  {
    id: "ideas",
    title: "Ideas",
    category: "Workflow Tracking",
    icon: Lightbulb,
    status: "Available",
    summary: "Ideas capture improvement opportunities with category, status, owner, voting, impact, effort, and confidence.",
    howTo: [
      "Open Ideas from the workspace tabs or the blue rail.",
      "Search and filter by status to narrow the list.",
      "Create an idea with title, category, status, impact, and summary.",
      "Use the details panel to vote, pin, or change idea status.",
    ],
    details: [
      "Capture early concepts as New so they can be reviewed without losing lightweight suggestions.",
      "Move ideas to Review when they need sizing, governance review, or owner confirmation.",
      "Use Pilot for ideas being tested in a real workflow and Approved when they are ready for rollout.",
      "Use Implemented when the idea has been released into the operating model.",
      "Use Blocked when the next step depends on a missing owner, data source, governance decision, or dependency.",
      "Votes and pins help surface ideas that should stay visible during planning conversations.",
    ],
    technicalDetails: [
      "Idea status is modeled as a fixed union: New, Review, Pilot, Approved, Implemented, and Blocked.",
      "addIdea creates an in-memory scoped idea with computed impact, effort, confidence, tags, metric placeholders, and activity entries.",
      "New ideas are assigned to the active project id when a project chat is selected; otherwise projectId is null.",
      "updateIdeaStatus, voteIdea, and toggleIdeaPin are server functions gated by requireWorkspaceEditor.",
      "Ideas currently use the mutable workspace seed/state path rather than a fully persisted D1 idea write path.",
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
      "Use the action button in each row or the details panel to cycle the item status.",
      "Switch project context to see only actions tied to the selected project.",
    ],
    details: [
      "Use Decisions for commitments that need an explicit outcome, owner, and status.",
      "Use Approvals for governance or stakeholder sign-offs that need to be requested and confirmed.",
      "Use Tasks for operational follow-up, execution work, or reminders from a source conversation or artifact.",
      "Cycle status from the table for fast updates, or use the detail panel when you need context before changing status.",
      "Keep actions project-scoped when they only apply to a selected project; keep them general when they apply to the whole workspace.",
      "Approvals and tasks advance immediately in the table and show a Pending badge while the server confirms the change.",
    ],
    technicalDetails: [
      "Decisions, approvals, and tasks are represented as typed workspace action arrays in ScopedWorkspaceState.",
      "toggleDecisionStatus cycles Open to Blocked to Done and records an activity entry.",
      "Approval and task mutations use TanStack Query v5 optimistic updates: onMutate cancels the workspace query, snapshots the previous workspace, and updates the local cache with setQueryData.",
      "Approval and task onError handlers restore the previous workspace snapshot and display a toast notification if the server action fails.",
      "toggleApprovalStatus cycles Needed to Requested to Approved and records an activity entry.",
      "toggleTaskStatus cycles Open to In progress to Done and records an activity entry.",
      "Each action item can carry a nullable projectId, and the UI filters action arrays by the active scopedProjectId.",
      "The current action mutation path updates mutable workspace state and is protected by requireWorkspaceEditor.",
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
    summary: "Team owners and workspace editors can create teams, projects, chats, and scoped invites.",
    howTo: [
      "Create a team from Team scope when you need a shared workspace.",
      "Invite a teammate to a team or project by email.",
      "Invitees can review and accept scoped invites from User settings.",
    ],
    details: [
      "Create a team when a set of people needs a shared workspace separate from personal or org-wide work.",
      "Create a team project when the work has a defined delivery scope, project chats, artifacts, and actions.",
      "Invite at the team level when someone needs broad team visibility.",
      "Invite at the project level when someone should only participate in one project.",
      "Accepted invites grant access after the invited user signs in and accepts from the Invites area in User settings.",
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
    summary: "Signed-in users can manage User settings, reset passwords, review invites, relaunch onboarding, and sign out.",
    howTo: [
      "Open the account menu from the bottom of the persistent blue rail or from the mobile top bar.",
      "Choose User settings to review account details.",
      "Choose Relaunch tutorial to replay the step-based onboarding flow.",
      "Choose Reset password to update credentials.",
      "Choose Sign out to end the session.",
    ],
    details: [
      "Use the account menu for User settings, onboarding, password, admin, token usage, and sign-out actions.",
      "Viewer accounts can read permitted workspace content without changing records.",
      "User accounts can create and update workspace records where membership allows access.",
      "Admin accounts can manage users in addition to normal workspace editing.",
      "Use the Invites area in User settings to review and accept scoped team or project invitations.",
    ],
    technicalDetails: [
      "Protected routes call getSessionSnapshot in their loaders and redirect unauthenticated users to /sign-in.",
      "Better Auth powers email/password sign-in, session lookup, sign-out, verification, and invite account creation.",
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
      "Open Admin from the account menu when signed in as an admin.",
      "Use the Users tab to edit names and roles or remove accounts.",
      "Use the Invites tab to create or revoke account invitations.",
    ],
    details: [
      "Use Users to review known accounts, change a display name, change a role, or remove an account.",
      "Use Invites to create first-use account invitations for allowed email addresses.",
      "Create a viewer invite for read-only users and a user invite for collaborators who should edit workspace records.",
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
    summary: "Artifact uploads return quickly after R2 storage and queue routing, while background workers handle parsing, chunking, embeddings, D1 chunks, and Vectorize indexing.",
    howTo: [
      "Use Team project chat for scoped RAG behavior when the platform bindings are configured.",
      "Upload an artifact to store the raw file in R2 and queue ingestion without waiting for parsing or indexing.",
      "Ask project-specific questions to retrieve indexed chunks with citation keys.",
    ],
    details: [
      "Use scoped RAG when a Team project needs answers grounded in previously generated or ingested project artifacts.",
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
      "wrangler.jsonc binds DOCUMENT_INGESTION_QUEUE as the producer for the main app and declares a consumer for document-ingestion-queue with batch size 5, timeout 30, and max retries 3.",
      "createScopedRagStreamResponse validates team and project access, fetches project context, classifies intent, optionally fetches web context, queries Vectorize, loads chunks from D1, and returns a Workers AI SSE response.",
      "chatWithScopedRag remains a TanStack Start server function wrapper, but native browser streaming uses GET /api/scoped-rag-stream with query parameters for prompt, teamId, workspaceId, and projectId.",
      "The scoped RAG SSE contract emits citations, token, done, and stream-error events. The client closes the EventSource on done or stream-error, while transport failures use the native onerror path.",
      "Intent routing uses a small Workers AI model to choose RAG_SEARCH, DIRECT_CHAT, or ARTIFACT_GENERATION.",
      "Citation metadata includes vector id, document name, R2 key, and match score when available.",
    ],
  },
  {
    id: "coming-soon",
    title: "Coming Soon Stubs",
    category: "Roadmap",
    icon: Zap,
    status: "Coming soon",
    summary: "Some visible controls and backend capabilities are placeholders or partially wired.",
    howTo: [
      "Attachment button: currently shows a queued toast; full upload-from-composer workflow is coming soon.",
      "Workspace context button: currently shows a context-added toast; explicit context picker is coming soon.",
      "Share buttons: currently prepare link options; share modal and permissions workflow are coming soon.",
      "Notifications: current decision taxonomy notification is a placeholder; actionable notification center is coming soon.",
    ],
    details: [
      "Composer attachments need a full upload, progress, permission, and artifact-linking workflow.",
      "Workspace context needs a picker so users can deliberately attach projects, artifacts, or previous chats.",
      "Sharing needs a modal that shows target audience, permission level, and link behavior before a link is copied.",
      "Notifications need an actionable center with unread state, decision flags, approval reminders, and owner routing.",
      "Docs can later be personalized by role so admins, editors, viewers, and technical users see the most relevant starting points.",
    ],
    technicalDetails: [
      "Attachment and workspace context buttons currently emit toast messages from the workspace route and do not transmit files or change context state.",
      "Share controls currently call toast handlers and do not create durable share records or permission grants.",
      "The notification button currently emits a placeholder decision taxonomy message.",
      "Document ingestion now uses an asynchronous R2 plus Queue handoff, but the UI still needs richer status polling, retry visibility, and expanded parser coverage.",
      "External web search depends on TAVILY_API_KEY and FIRECRAWL_API_KEY and reports unavailable providers when keys are missing.",
      "Docs search is currently client-side over static section data; it is not indexed or connected to generated application metadata.",
    ],
  },
];

const categories = ["All", ...Array.from(new Set(docSections.map((section) => section.category)))];

function DocsPage() {
  const { session } = Route.useLoaderData();
  const [activeCategory, setActiveCategory] = useState("All");
  const [activeSectionId, setActiveSectionId] = useState(docSections[0].id);
  const [searchTerm, setSearchTerm] = useState("");
  const [showTokenUsage, setShowTokenUsage] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem("vertex-show-token-usage") !== "0";
  });
  const activeSection = docSections.find((section) => section.id === activeSectionId) ?? docSections[0];

  const filteredSections = useMemo(() => {
    const normalized = searchTerm.trim().toLowerCase();
    return docSections.filter((section) => {
      const categoryMatches = activeCategory === "All" || section.category === activeCategory;
      const textMatches =
        !normalized ||
        [section.title, section.category, section.summary, ...section.howTo, ...section.details, ...section.technicalDetails]
          .join(" ")
          .toLowerCase()
          .includes(normalized);
      return categoryMatches && textMatches;
    });
  }, [activeCategory, searchTerm]);

  useEffect(() => {
    window.localStorage.setItem("vertex-show-token-usage", showTokenUsage ? "1" : "0");
  }, [showTokenUsage]);

  async function handleSignOut() {
    await authClient.signOut();
    window.location.href = "/sign-in";
  }

  function handleStartTutorial() {
    window.sessionStorage.setItem("vertex-onboarding-tutorial-relaunch", "1");
    window.location.href = "/";
  }

  return (
    <main className="h-svh overflow-hidden bg-[linear-gradient(135deg,oklch(0.985_0.006_247),oklch(0.955_0.015_240))] p-0 text-foreground lg:p-5">
      <div className="workspace-shadow grid h-full grid-cols-[72px_minmax(0,1fr)] overflow-hidden border bg-card lg:rounded-xl">
        <AppRail
          account={{
            canAdmin: session.user.role === "admin",
            showTokenUsage,
            userEmail: session.user.email,
            userName: session.user.name,
            onShowTokenUsageChange: setShowTokenUsage,
            onSignOut: handleSignOut,
            onStartTutorial: handleStartTutorial,
          }}
          activeItem="Docs"
          persist
        />
        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-background">
          <header className="grid min-h-16 shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b bg-card px-4 lg:min-h-19.5 lg:px-6">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase text-primary">Documentation Library</p>
              <h1 className="truncate text-lg font-semibold lg:text-2xl">Vertex AI Command Center Docs</h1>
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
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {categories.map((category) => (
                    <Button
                      key={category}
                      type="button"
                      size="sm"
                      variant={activeCategory === category ? "default" : "outline"}
                      onClick={() => setActiveCategory(category)}
                    >
                      {category}
                    </Button>
                  ))}
                </div>
              </div>
              <nav className="scrollbar-thin min-h-0 flex-1 overflow-auto p-3">
                <div className="space-y-1">
                  {filteredSections.map((section) => (
                    <button
                      key={section.id}
                      type="button"
                      className={cn(
                        "flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent",
                        activeSection.id === section.id && "bg-accent text-accent-foreground",
                      )}
                      onClick={() => setActiveSectionId(section.id)}
                    >
                      <section.icon className="mt-0.5 size-4 shrink-0 text-primary" />
                      <span className="min-w-0">
                        <strong className="block truncate">{section.title}</strong>
                        <span className="block truncate text-xs text-muted-foreground">{section.category}</span>
                      </span>
                    </button>
                  ))}
                </div>
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
                  <div className="flex gap-2 overflow-auto pb-1">
                    {filteredSections.map((section) => (
                      <Button
                        key={section.id}
                        type="button"
                        size="sm"
                        variant={activeSection.id === section.id ? "default" : "outline"}
                        onClick={() => setActiveSectionId(section.id)}
                      >
                        {section.title}
                      </Button>
                    ))}
                  </div>
                </div>

                <DocHero section={activeSection} />
                <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_290px]">
                  <div className="grid gap-5">
                    <DocBlock title="How To">
                      <ol className="grid gap-3">
                        {activeSection.howTo.map((item, index) => (
                          <li key={item} className="grid grid-cols-[32px_minmax(0,1fr)] gap-3">
                            <span className="grid size-8 place-items-center rounded-md bg-primary text-sm font-semibold text-primary-foreground">
                              {index + 1}
                            </span>
                            <p className="pt-1 text-sm leading-6 text-muted-foreground">{item}</p>
                          </li>
                        ))}
                      </ol>
                    </DocBlock>
                    <DocBlock title="Usage Details">
                      <div className="grid gap-3">
                        {activeSection.details.map((item) => (
                          <div key={item} className="rounded-md border bg-muted/25 p-3 text-sm leading-6 text-muted-foreground">
                            {item}
                          </div>
                        ))}
                      </div>
                    </DocBlock>
                    <DocBlock title="Technical Notes" audience="Technical audience">
                      <div className="grid gap-3">
                        {activeSection.technicalDetails.map((item) => (
                          <div key={item} className="rounded-md border border-primary/15 bg-primary/5 p-3 font-mono text-xs leading-6 text-foreground">
                            {item}
                          </div>
                        ))}
                      </div>
                    </DocBlock>
                  </div>
                  <aside className="grid content-start gap-4">
                    <Card>
                      <CardContent className="space-y-3 p-4">
                        <div className="flex items-center gap-2">
                          <Lock className="size-4 text-primary" />
                          <strong className="text-sm">Access Notes</strong>
                        </div>
                        <p className="text-sm leading-6 text-muted-foreground">
                          Docs follow the signed-in app shell. Viewer accounts can read docs and workspace data, while user and admin roles unlock write actions.
                        </p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="space-y-3 p-4">
                        <div className="flex items-center gap-2">
                          <BookOpen className="size-4 text-primary" />
                          <strong className="text-sm">Topics</strong>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {categories.slice(1).map((category) => (
                            <Badge key={category} variant="secondary">{category}</Badge>
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

function DocHero({ section }: { section: DocSection }) {
  return (
    <section className="rounded-lg border bg-card p-5 lg:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
            <section.icon className="size-6" />
          </span>
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{section.category}</Badge>
              <StatusBadge status={section.status} />
            </div>
            <h2 className="text-2xl font-semibold tracking-normal lg:text-3xl">{section.title}</h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground lg:text-base">{section.summary}</p>
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
  return <Badge variant="secondary">Coming soon</Badge>;
}
