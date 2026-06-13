import { useEffect, useMemo, useRef, useState, type ComponentType, type FormEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useForm } from "@tanstack/react-form";
import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  Activity,
  Archive,
  ArrowUpDown,
  BarChart3,
  Bell,
  Bug,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Download,
  Eye,
  FileText,
  Folder,
  FolderOpen,
  GitBranch,
  KeyRound,
  Lightbulb,
  LogOut,
  Maximize2,
  Menu,
  Minimize2,
  MessageCircle,
  MoreHorizontal,
  Paperclip,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Plus,
  RotateCcw,
  Settings,
  Search,
  Send,
  Share2,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  Users,
  X,
  Zap,
} from "lucide-react";
import type { ExtractedChatAttachment } from "@/lib/attachment-extraction";
import { ArtifactUploader } from "@/components/ArtifactUploader";
import { ArtifactRenderer } from "@/components/ArtifactRenderer";
import { AppRail } from "@/components/AppRail";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { authClient } from "@/lib/auth-client";
import { getSessionSnapshot } from "@/lib/auth-workflow";
import type { ChatMessageInsertEvent, WorkspacePresenceUser } from "@/lib/chat-sync";
import {
  downloadChatExport,
  downloadHtmlTable,
  downloadRows,
  exportFormatLabel,
  parseChatExportRequest,
  rowsFromHtmlTable,
  type ChatExportFormat,
} from "@/lib/chat-export";
import { cn } from "@/lib/utils";
import {
  type AddIdeaInput,
  type Approval,
  type Artifact,
  type ChatAttachment,
  type ChatMessage,
  type ChatReasoningLevel,
  type ChatSection,
  type CreateWorkflowSuggestionInput,
  type CreateTaskInput,
  type ChatSummary,
  type Decision,
  type Idea,
  type IdeaStatus,
  type LlmDevTrace,
  type PmoWorkspaceState,
  type ProjectSummary,
  type RailName,
  type ScopedWorkspaceState,
  type TabName,
  type Task,
  type WorkspaceMode,
  addIdea,
  avatarAlex,
  chatReasoningLevels,
  chatReasoningProfiles,
  createApprovalFromSuggestion,
  createDecisionFromSuggestion,
  createIdeaFromSuggestion,
  createTaskFromSuggestion,
  getConversationKey,
  initials,
  pmoWorkspaceQueryKey,
  pmoWorkspaceQueryOptions,
  promptTemplates,
  sendChatMessage,
  saveTableArtifact,
  restoreArtifactVersion,
  removeSuggestedApproval,
  removeSuggestedDecision,
  removeSuggestedIdea,
  removeSuggestedTask,
  statusFilters,
  statusMeta,
  tabs,
  toggleArtifactPin,
  toggleIdeaPin,
  toggleWorkflowActionPin,
  updateApprovalStatus,
  updateDecisionStatus,
  updateIdeaStatus,
  updateTaskStatus,
  voteIdea,
  workspaceModeLabel,
  workspaceModes,
} from "@/lib/pmo-data";
import {
  type ChatWithScopedRagCitation,
} from "@/lib/rag";
import type { RealtimeMutationEvent } from "@/lib/realtime-events";
import {
  deleteScopedChat,
  deleteScopedProject,
  branchScopedChat,
  createScopedProject,
  createScopedChat,
  createScopedInvite,
  createTeam,
  listMyScopedChats,
  listMyScopedProjects,
  listMyTeams,
  type CreateChatInput,
  type CreateProjectInput,
  type BranchChatInput,
  type DeleteChatInput,
  type DeleteProjectInput,
  type RenameChatInput,
  type ScopedChatsResult,
  type TeamSummary,
  renameScopedChat,
} from "@/lib/team-workflow";

export const Route = createFileRoute("/")({
  loader: async () => {
    const session = await getSessionSnapshot();
    if (!session) throw redirect({ to: "/sign-in" });
    return { session };
  },
  pendingComponent: CommandCenterPageSkeleton,
  head: () => ({
    meta: [{ title: "Vertex AI Command Center" }],
  }),
  component: PMOCommandCenter,
});

const emptyIdeaForm: AddIdeaInput = {
  title: "",
  category: "Governance",
  status: "Not Started",
  impact: "High",
  summary: "",
};

type ToastLink = {
  href: string;
  label: string;
};

type CreateTeamInput = {
  name: string;
  description: string;
};

const emptyScopedChatsResult: ScopedChatsResult = {
  workspaceChats: [],
  projectChatsByProjectId: {},
  conversations: {},
};

const emptyChatImageSrc =
  "data:image/svg+xml,%3Csvg width='192' height='144' viewBox='0 0 192 144' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Crect x='18' y='25' width='156' height='94' rx='20' fill='%23F8FAFC'/%3E%3Crect x='34' y='42' width='87' height='12' rx='6' fill='%23215A96' fill-opacity='.18'/%3E%3Crect x='34' y='64' width='124' height='10' rx='5' fill='%23215A96' fill-opacity='.12'/%3E%3Crect x='34' y='82' width='73' height='10' rx='5' fill='%23215A96' fill-opacity='.12'/%3E%3Ccircle cx='139' cy='51' r='17' fill='%23215A96'/%3E%3Cpath d='M139 41v20M129 51h20' stroke='white' stroke-width='4' stroke-linecap='round'/%3E%3Cpath d='M61 119l-13 17-3-22' fill='%23F8FAFC'/%3E%3Crect x='18' y='25' width='156' height='94' rx='20' stroke='%23215A96' stroke-opacity='.16' stroke-width='2'/%3E%3C/svg%3E";

const onboardingCompletedKey = "vertex-onboarding-tutorial-completed";
const onboardingRelaunchKey = "vertex-onboarding-tutorial-relaunch";
const realtimeClientIdKey = "vertex-realtime-client-id";

function getRealtimeClientId() {
  if (typeof window === "undefined") return "";
  const existing = window.sessionStorage.getItem(realtimeClientIdKey);
  if (existing) return existing;
  const nextId = crypto.randomUUID();
  window.sessionStorage.setItem(realtimeClientIdKey, nextId);
  return nextId;
}

function realtimeLastEventKey(mode: WorkspaceMode, teamId: string | null, userId: string) {
  return `vertex-realtime-last-event:${mode}:${teamId ?? userId}`;
}

type TutorialStep = {
  title: string;
  description: string;
  detail: string;
  actionLabel?: string;
  onAction?: () => void;
};

function appendChatMessageToScopedChats(current: ScopedChatsResult | undefined, event: ChatMessageInsertEvent) {
  if (!current) return current;
  const conversationKey = getConversationKey(event.mode, event.projectId, event.chatId);
  const messages = current.conversations[conversationKey] ?? [];
  if (messages.some((message) => message.id === event.message.id)) return current;
  const reconciledMessages = event.message.role === "user"
    ? messages.filter((message) => message.clientStatus !== "sending" || message.text !== event.message.text)
    : messages;

  return {
    ...current,
    conversations: {
      ...current.conversations,
      [conversationKey]: [...reconciledMessages, event.message],
    },
  } satisfies ScopedChatsResult;
}

function appendChatMessageToCache(current: ScopedChatsResult | undefined, conversationKey: string, message: ChatMessage) {
  if (!current) return current;
  const messages = current.conversations[conversationKey] ?? [];
  return {
    ...current,
    conversations: {
      ...current.conversations,
      [conversationKey]: [...messages, message],
    },
  } satisfies ScopedChatsResult;
}

function updateChatMessageInCache(current: ScopedChatsResult | undefined, conversationKey: string, messageId: string, text: string) {
  if (!current) return current;
  return {
    ...current,
    conversations: {
      ...current.conversations,
      [conversationKey]: (current.conversations[conversationKey] ?? []).map((message) =>
        message.id === messageId ? { ...message, text } : message,
      ),
    },
  } satisfies ScopedChatsResult;
}

function removeOptimisticChatMessages(current: ScopedChatsResult | undefined, conversationKey: string) {
  if (!current) return current;
  return {
    ...current,
    conversations: {
      ...current.conversations,
      [conversationKey]: (current.conversations[conversationKey] ?? []).filter((message) => message.clientStatus !== "sending"),
    },
  } satisfies ScopedChatsResult;
}

function addArtifactToWorkspaceCache(current: PmoWorkspaceState | undefined, mode: WorkspaceMode, artifact: Artifact) {
  if (!current) return current;
  const scopedWorkspace = current.workspaces[mode];
  return {
    ...current,
    workspaces: {
      ...current.workspaces,
      [mode]: {
        ...scopedWorkspace,
        artifacts: [artifact, ...scopedWorkspace.artifacts.filter((item) => item.r2Key !== artifact.r2Key)],
      },
    },
  } satisfies PmoWorkspaceState;
}

function updateArtifactInWorkspaceCache(
  current: PmoWorkspaceState | undefined,
  mode: WorkspaceMode,
  r2Key: string,
  updateArtifact: (artifact: Artifact) => Artifact,
) {
  if (!current) return current;
  const scopedWorkspace = current.workspaces[mode];
  return {
    ...current,
    workspaces: {
      ...current.workspaces,
      [mode]: {
        ...scopedWorkspace,
        artifacts: scopedWorkspace.artifacts.map((artifact) =>
          artifact.r2Key === r2Key ? updateArtifact(artifact) : artifact,
        ),
      },
    },
  } satisfies PmoWorkspaceState;
}

function removeTaskFromWorkspaceCache(current: PmoWorkspaceState | undefined, mode: WorkspaceMode, id: string) {
  if (!current) return current;
  const scopedWorkspace = current.workspaces[mode];
  return {
    ...current,
    workspaces: {
      ...current.workspaces,
      [mode]: {
        ...scopedWorkspace,
        tasks: scopedWorkspace.tasks.filter((task) => task.id !== id),
      },
    },
  } satisfies PmoWorkspaceState;
}

function removeWorkflowItemFromWorkspaceCache(
  current: PmoWorkspaceState | undefined,
  mode: WorkspaceMode,
  kind: "approval" | "decision" | "idea" | "task",
  id: string,
) {
  if (!current) return current;
  const scopedWorkspace = current.workspaces[mode];
  if (kind === "approval") {
    return {
      ...current,
      workspaces: {
        ...current.workspaces,
        [mode]: {
          ...scopedWorkspace,
          approvals: scopedWorkspace.approvals.filter((approval) => approval.id !== id),
        },
      },
    } satisfies PmoWorkspaceState;
  }
  if (kind === "decision") {
    return {
      ...current,
      workspaces: {
        ...current.workspaces,
        [mode]: {
          ...scopedWorkspace,
          decisions: scopedWorkspace.decisions.filter((decision) => decision.id !== id),
        },
      },
    } satisfies PmoWorkspaceState;
  }
  if (kind === "idea") {
    return {
      ...current,
      workspaces: {
        ...current.workspaces,
        [mode]: {
          ...scopedWorkspace,
          ideas: scopedWorkspace.ideas.filter((idea) => idea.id !== id),
          pinnedIdeaIds: scopedWorkspace.pinnedIdeaIds.filter((pinnedId) => pinnedId !== id),
        },
      },
    } satisfies PmoWorkspaceState;
  }
  return removeTaskFromWorkspaceCache(current, mode, id);
}

type CreateChatDialogState = {
  section: ChatSection;
  projectId: string | null;
  projectName?: string;
} | null;

type ConfirmDialogState = {
  title: string;
  description: string;
  actionLabel: string;
  destructive?: boolean;
  onConfirm: () => Promise<void> | void;
} | null;

type InputDialogState = {
  title: string;
  description: string;
  label: string;
  defaultValue?: string;
  placeholder?: string;
  actionLabel: string;
  inputType?: "text" | "email";
  onSubmit: (value: string) => Promise<void> | void;
} | null;

type WorkflowPreviewState = {
  kind: "Approval" | "Decision" | "Idea" | "Task";
  title: string;
  originalText: string;
  meta: string;
} | null;

type PageScopeKind = "workspace" | "project";

type DetailMetric = {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  detail: string;
};

function getDetailMetrics({
  activeTab,
  artifacts,
  approvals,
  decisions,
  ideas,
  messages,
  pinnedArtifacts,
  queryState,
  scopeContextLabel,
  tasks,
  updatedAt,
}: {
  activeTab: TabName;
  artifacts: Artifact[];
  approvals: Approval[];
  decisions: Decision[];
  ideas: Idea[];
  messages: ChatMessage[];
  pinnedArtifacts: Artifact[];
  queryState: string;
  scopeContextLabel: string;
  tasks: Task[];
  updatedAt: string;
}): DetailMetric[] {
  if (activeTab === "Chat") {
    return [
      { icon: MessageCircle, label: "Messages", value: String(messages.length), detail: scopeContextLabel },
      { icon: Paperclip, label: "Artifacts", value: String(artifacts.length), detail: "Current scope" },
      { icon: Activity, label: "Query state", value: queryState, detail: updatedAt },
      { icon: Folder, label: "Context", value: scopeContextLabel === "General" ? "General" : "Scoped", detail: scopeContextLabel },
    ];
  }
  if (activeTab === "Artifacts") {
    return [
      { icon: Archive, label: "Artifacts", value: String(artifacts.length), detail: scopeContextLabel },
      { icon: Star, label: "Pinned", value: String(pinnedArtifacts.length), detail: "Current scope" },
      { icon: FileText, label: "Docs", value: String(artifacts.filter((artifact) => artifact.type === "DOCX").length), detail: "DOCX" },
      { icon: Activity, label: "Query state", value: queryState, detail: updatedAt },
    ];
  }
  if (activeTab === "Decisions") {
    return [
      { icon: ClipboardList, label: "Decisions", value: String(decisions.length), detail: scopeContextLabel },
      { icon: CheckCircle2, label: "Open", value: String(decisions.filter((decision) => decision.status !== "Completed").length), detail: "Needs action" },
      { icon: Activity, label: "Completed", value: String(decisions.filter((decision) => decision.status === "Completed").length), detail: "Decided" },
      { icon: Activity, label: "Query state", value: queryState, detail: updatedAt },
    ];
  }
  if (activeTab === "Approvals") {
    return [
      { icon: ShieldCheck, label: "Approvals", value: String(approvals.length), detail: scopeContextLabel },
      { icon: Bell, label: "Pending", value: String(approvals.filter((approval) => approval.status !== "Approved").length), detail: "Needs response" },
      { icon: CheckCircle2, label: "Approved", value: String(approvals.filter((approval) => approval.status === "Approved").length), detail: "Complete" },
      { icon: Activity, label: "Query state", value: queryState, detail: updatedAt },
    ];
  }
  if (activeTab === "Tasks") {
    return [
      { icon: CheckCircle2, label: "Tasks", value: String(tasks.length), detail: scopeContextLabel },
      { icon: Activity, label: "Open", value: String(tasks.filter((task) => task.status !== "Completed").length), detail: "Follow-ups" },
      { icon: Folder, label: "Sources", value: String(new Set(tasks.map((task) => task.source)).size), detail: "Distinct sources" },
      { icon: Activity, label: "Query state", value: queryState, detail: updatedAt },
    ];
  }
  if (activeTab === "Prompts") {
    return [
      { icon: Sparkles, label: "Prompts", value: String(promptTemplates.length), detail: scopeContextLabel },
      { icon: MessageCircle, label: "Target", value: "Chat", detail: "Use inserts into composer" },
      { icon: Folder, label: "Context", value: scopeContextLabel === "General" ? "General" : "Scoped", detail: scopeContextLabel },
      { icon: Activity, label: "Query state", value: queryState, detail: updatedAt },
    ];
  }
  return [
    { icon: Lightbulb, label: "Ideas", value: String(ideas.length), detail: scopeContextLabel },
    { icon: Activity, label: "Reviewing", value: String(ideas.filter((idea) => idea.status === "Reviewing").length), detail: "In review" },
    { icon: Star, label: "Converted", value: String(ideas.filter((idea) => idea.status === "Convert to Project").length), detail: "Project" },
    { icon: Activity, label: "Query state", value: queryState, detail: updatedAt },
  ];
}

function PMOCommandCenter() {
  const { session } = Route.useLoaderData();
  const queryClient = useQueryClient();
  const realtimeClientIdRef = useRef("");
  const realtimeSeenEventIdsRef = useRef<Set<number>>(new Set());
  const workspaceQuery = useSuspenseQuery(pmoWorkspaceQueryOptions());
  const teamsQuery = useSuspenseQuery({
    queryKey: ["my-teams"],
    queryFn: () => listMyTeams(),
  });
  const workspace = workspaceQuery.data;
  const teams = teamsQuery.data;

  const [activeRail, setActiveRail] = useState<RailName>("Workspaces");
  const [activeTab, setActiveTab] = useState<TabName>("Chat");
  const [activeMode, setActiveMode] = useState<WorkspaceMode>("Personal");
  const [activeTeamId, setActiveTeamId] = useState("");
  const activeWorkspace = workspace.workspaces[activeMode];
  const selectedTeam = teams.find((team) => team.id === activeTeamId) ?? teams[0];
  const scopedChatsQueryKey = useMemo(
    () => ["scoped-chats", activeMode, selectedTeam?.id ?? ""] as const,
    [activeMode, selectedTeam?.id],
  );
  const scopedProjectsQuery = useQuery({
    queryKey: ["scoped-projects", activeMode, selectedTeam?.id ?? ""],
    queryFn: () => listMyScopedProjects({ data: { mode: activeMode, teamId: selectedTeam?.id ?? null } }),
    placeholderData: [],
  });
  const scopedChatsQuery = useQuery({
    queryKey: scopedChatsQueryKey,
    queryFn: () => listMyScopedChats({ data: { mode: activeMode, teamId: selectedTeam?.id ?? null } }),
    placeholderData: emptyScopedChatsResult,
  });
  const scopedProjects: ProjectSummary[] = scopedProjectsQuery.data ?? [];
  const scopedChatsData = scopedChatsQuery.data ?? emptyScopedChatsResult;
  const isScopedWorkspaceLoading =
    scopedProjectsQuery.isPending ||
    scopedChatsQuery.isPending ||
    scopedProjectsQuery.isPlaceholderData ||
    scopedChatsQuery.isPlaceholderData;
  const scopedWorkspaceChats = scopedChatsData.workspaceChats;
  const scopedConversations = scopedChatsData.conversations;
  const visibleWorkspace = useMemo(() => {
    if (activeMode === "Personal") {
      return {
        ...activeWorkspace,
        projectsHeading: "Personal Projects",
        workspaceChatsHeading: "General Chats",
        unassignedProjectLabel: "General",
        projects: scopedProjects,
        workspaceChats: scopedWorkspaceChats,
        conversations: scopedConversations,
      };
    }
    if (activeMode === "Team") {
      return {
        ...activeWorkspace,
        projectsHeading: selectedTeam ? `${selectedTeam.name} Projects` : "Team Projects",
        workspaceChatsHeading: selectedTeam ? `${selectedTeam.name} Chats` : "Team Chats",
        unassignedProjectLabel: selectedTeam ? selectedTeam.name : "No team selected",
        projects: scopedProjects,
        workspaceChats: scopedWorkspaceChats,
        conversations: scopedConversations,
      };
    }
    return {
      ...activeWorkspace,
      projectsHeading: "Org Projects",
      workspaceChatsHeading: "Org Chats",
      unassignedProjectLabel: "Org",
      projects: scopedProjects,
      workspaceChats: scopedWorkspaceChats,
      conversations: scopedConversations,
    };
  }, [activeMode, activeWorkspace, scopedConversations, scopedProjects, scopedWorkspaceChats, selectedTeam]);
  const [activeProjectId, setActiveProjectId] = useState("");
  const [activeChatSection, setActiveChatSection] = useState<ChatSection>("workspace");
  const [activeChatId, setActiveChatId] = useState(visibleWorkspace.workspaceChats[0]?.id ?? "");
  const [selectedIdeaId, setSelectedIdeaId] = useState(visibleWorkspace.ideas[0]?.id ?? "");
  const [selectedDecisionId, setSelectedDecisionId] = useState(visibleWorkspace.decisions[0]?.id ?? "");
  const [selectedApprovalId, setSelectedApprovalId] = useState(visibleWorkspace.approvals[0]?.id ?? "");
  const [selectedTaskId, setSelectedTaskId] = useState(visibleWorkspace.tasks[0]?.id ?? "");
  const [selectedArtifactTitle, setSelectedArtifactTitle] = useState(visibleWorkspace.artifacts[1]?.title ?? visibleWorkspace.artifacts[0]?.title ?? "");
  const [statusFilter, setStatusFilter] = useState<IdeaStatus | "All">("All");
  const [searchTerm, setSearchTerm] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [chatAttachments, setChatAttachments] = useState<ExtractedChatAttachment[]>([]);
  const [isExtractingAttachment, setIsExtractingAttachment] = useState(false);
  const [chatReasoningLevel, setChatReasoningLevel] = useState<ChatReasoningLevel>(() => {
    if (typeof window === "undefined") return "low";
    const saved = window.localStorage.getItem("vertex-chat-reasoning-level");
    if (saved === "off" || saved === "quick") return "low";
    if (saved === "deep") return "medium";
    if (saved === "max") return "high";
    return saved && saved in chatReasoningProfiles ? saved as ChatReasoningLevel : "low";
  });
  const [webSearchEnabled, setWebSearchEnabled] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("vertex-chat-web-search") === "1";
  });
  const [presenceUsers, setPresenceUsers] = useState<WorkspacePresenceUser[]>(() => [{
    id: session.user.id,
    name: session.user.name || session.user.email || "You",
    email: session.user.email,
  }]);
  const [transientChats, setTransientChats] = useState<Record<string, ChatSummary>>({});
  const [isScopedRagStreaming, setIsScopedRagStreaming] = useState(false);
  const chatFormRef = useRef<HTMLFormElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const chatFileInputRef = useRef<HTMLInputElement>(null);
  const composerHighlightTimeoutRef = useRef<number | null>(null);
  const [isComposerHighlighted, setIsComposerHighlighted] = useState(false);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isCreateTeamOpen, setIsCreateTeamOpen] = useState(false);
  const [isCreateProjectOpen, setIsCreateProjectOpen] = useState(false);
  const [createChatState, setCreateChatState] = useState<CreateChatDialogState>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>(null);
  const [inputDialog, setInputDialog] = useState<InputDialogState>(null);
  const [previewArtifact, setPreviewArtifact] = useState<Artifact | null>(null);
  const [workflowPreview, setWorkflowPreview] = useState<WorkflowPreviewState>(null);
  const [rightOpen, setRightOpen] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [toastLink, setToastLink] = useState<ToastLink | null>(null);
  const [llmTraces, setLlmTraces] = useState<LlmDevTrace[]>([]);
  const [showTokenUsage, setShowTokenUsage] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem("vertex-show-token-usage") !== "0";
  });
  const [isTutorialOpen, setIsTutorialOpen] = useState(false);
  const [tutorialStepIndex, setTutorialStepIndex] = useState(0);
  const canEdit = session.user.role === "admin" || session.user.role === "user";

  useEffect(() => {
    const requestedRail = window.sessionStorage.getItem("vertex-target-rail") as RailName | null;
    if (!requestedRail) return;
    window.sessionStorage.removeItem("vertex-target-rail");
    handleRailClick(requestedRail);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const shouldRelaunch = window.sessionStorage.getItem(onboardingRelaunchKey) === "1";
    const hasCompleted = window.localStorage.getItem(onboardingCompletedKey) === "1";
    if (!shouldRelaunch && hasCompleted) return;
    window.sessionStorage.removeItem(onboardingRelaunchKey);
    setTutorialStepIndex(0);
    setIsTutorialOpen(true);
  }, []);

  const invalidateWorkspace = () =>
    queryClient.invalidateQueries({ queryKey: pmoWorkspaceQueryKey });
  const invalidateTeams = () => queryClient.invalidateQueries({ queryKey: ["my-teams"] });
  const invalidateProjects = () => queryClient.invalidateQueries({ queryKey: ["scoped-projects"] });
  const invalidateChats = () => queryClient.invalidateQueries({ queryKey: ["scoped-chats"] });

  const addIdeaMutation = useMutation({
    mutationFn: (input: AddIdeaInput) => addIdea({ data: { ...input, mode: activeMode, projectId: scopedProjectId } }),
    onSuccess: invalidateWorkspace,
  });
  const sendMessageMutation = useMutation({
    mutationFn: (input: { mode: WorkspaceMode; teamId?: string | null; projectId: string | null; chatId: string; chatTitle: string; text: string; model: string; reasoningLevel: ChatReasoningLevel; webSearchEnabled?: boolean; attachments?: ChatAttachment[] }) =>
      sendChatMessage({ data: input }),
    onMutate: async (input) => {
      const queryKey = scopedChatsQueryKey;
      const conversationKey = getConversationKey(input.mode, input.projectId, input.chatId);
      const optimisticMessage: ChatMessage = {
        id: `optimistic-user-${Date.now()}`,
        author: "You",
        role: "user",
        avatar: avatarAlex,
        time: clientTimeLabel(),
        text: input.text || "Attached files for review.",
        attachments: input.attachments,
        clientStatus: "sending",
      };
      await queryClient.cancelQueries({ queryKey });
      const previousScopedChats = queryClient.getQueryData<ScopedChatsResult>(queryKey);
      queryClient.setQueryData<ScopedChatsResult>(queryKey, (current) =>
        appendChatMessageToCache(current ?? emptyScopedChatsResult, conversationKey, optimisticMessage),
      );
      return { queryKey, previousScopedChats };
    },
    onSuccess: async (result) => {
      const llmTrace = (result as { llmTrace?: LlmDevTrace | null } | undefined)?.llmTrace;
      if (llmTrace) {
        setLlmTraces((traces) => [llmTrace, ...traces].slice(0, 20));
      }
      await invalidateWorkspace();
      await invalidateProjects();
      focusChatComposer();
    },
    onError: (error, _input, context) => {
      if (context?.previousScopedChats) {
        queryClient.setQueryData(context.queryKey, context.previousScopedChats);
      }
      updateToast(error instanceof Error ? error.message : "Chat submission failed");
    },
    onSettled: async (_result, _error, _input, context) => {
      await queryClient.invalidateQueries({ queryKey: context?.queryKey ?? ["scoped-chats"] });
    },
  });
  const updateStatusMutation = useMutation({
    mutationFn: (input: { id: string; status: IdeaStatus }) => updateIdeaStatus({ data: { ...input, mode: activeMode } }),
    onSuccess: invalidateWorkspace,
  });
  const updateTaskStatusMutation = useMutation({
    mutationFn: (input: { id: string; status: Task["status"] }) => updateTaskStatus({ data: { ...input, mode: activeMode } }),
    onSuccess: invalidateWorkspace,
    onError: (error) => updateToast(error instanceof Error ? error.message : "Could not update task status."),
  });
  const updateApprovalStatusMutation = useMutation({
    mutationFn: (input: { id: string; status: Approval["status"] }) => updateApprovalStatus({ data: { ...input, mode: activeMode } }),
    onSuccess: invalidateWorkspace,
    onError: (error) => updateToast(error instanceof Error ? error.message : "Could not update approval status."),
  });
  const updateDecisionStatusMutation = useMutation({
    mutationFn: (input: { id: string; status: Decision["status"] }) => updateDecisionStatus({ data: { ...input, mode: activeMode } }),
    onSuccess: invalidateWorkspace,
    onError: (error) => updateToast(error instanceof Error ? error.message : "Could not update decision status."),
  });
  const voteIdeaMutation = useMutation({
    mutationFn: (id: string) => voteIdea({ data: { id, mode: activeMode } }),
    onSuccess: invalidateWorkspace,
  });
  const toggleIdeaPinMutation = useMutation({
    mutationFn: (id: string) => toggleIdeaPin({ data: { id, mode: activeMode } }),
    onSuccess: invalidateWorkspace,
  });
  const toggleWorkflowActionPinMutation = useMutation({
    mutationFn: (input: { kind: "approval" | "decision" | "task"; id: string }) =>
      toggleWorkflowActionPin({ data: { ...input, mode: activeMode } }),
    onSuccess: invalidateWorkspace,
    onError: (error) => updateToast(error instanceof Error ? error.message : "Could not update pin."),
  });
  const toggleArtifactPinMutation = useMutation({
    mutationFn: (input: { r2Key: string; mode: WorkspaceMode }) => toggleArtifactPin({ data: input }),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: pmoWorkspaceQueryKey });
      const previousWorkspace = queryClient.getQueryData<PmoWorkspaceState>(pmoWorkspaceQueryKey);
      queryClient.setQueryData<PmoWorkspaceState>(pmoWorkspaceQueryKey, (current) =>
        updateArtifactInWorkspaceCache(current, input.mode, input.r2Key, (artifact) => {
          const isPinned = artifact.pinnedTo.includes(input.mode);
          return {
            ...artifact,
            pinnedTo: isPinned
              ? artifact.pinnedTo.filter((mode) => mode !== input.mode)
              : [...artifact.pinnedTo, input.mode],
            clientStatus: "pinning",
          };
        }),
      );
      return { previousWorkspace };
    },
    onSuccess: (workspace) => {
      queryClient.setQueryData(pmoWorkspaceQueryKey, workspace);
    },
    onError: (error, _input, context) => {
      if (context?.previousWorkspace) queryClient.setQueryData(pmoWorkspaceQueryKey, context.previousWorkspace);
      updateToast(error instanceof Error ? error.message : "Could not update artifact pin.");
    },
    onSettled: async () => {
      await invalidateWorkspace();
    },
  });
  const restoreArtifactMutation = useMutation({
    mutationFn: (input: { mode: WorkspaceMode; artifactId: string; commitMessage?: string }) => restoreArtifactVersion({ data: input }),
    onSuccess: (workspace) => {
      queryClient.setQueryData(pmoWorkspaceQueryKey, workspace);
      updateToast("Artifact version restored");
    },
    onError: (error) => {
      updateToast(error instanceof Error ? error.message : "Could not restore artifact version.");
    },
    onSettled: async () => {
      await invalidateWorkspace();
    },
  });
  const removeApprovalMutation = useMutation({
    mutationFn: (id: string) => removeSuggestedApproval({ data: { id, mode: activeMode } }),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: pmoWorkspaceQueryKey });
      const previousWorkspace = queryClient.getQueryData<PmoWorkspaceState>(pmoWorkspaceQueryKey);
      queryClient.setQueryData<PmoWorkspaceState>(pmoWorkspaceQueryKey, (current) =>
        removeWorkflowItemFromWorkspaceCache(current, activeMode, "approval", id),
      );
      return { previousWorkspace };
    },
    onSuccess: (workspace) => {
      queryClient.setQueryData(pmoWorkspaceQueryKey, workspace);
    },
    onError: (error, _id, context) => {
      if (context?.previousWorkspace) queryClient.setQueryData(pmoWorkspaceQueryKey, context.previousWorkspace);
      updateToast(error instanceof Error ? error.message : "Could not delete approval.");
    },
    onSettled: async () => {
      await invalidateWorkspace();
    },
  });
  const removeDecisionMutation = useMutation({
    mutationFn: (id: string) => removeSuggestedDecision({ data: { id, mode: activeMode } }),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: pmoWorkspaceQueryKey });
      const previousWorkspace = queryClient.getQueryData<PmoWorkspaceState>(pmoWorkspaceQueryKey);
      queryClient.setQueryData<PmoWorkspaceState>(pmoWorkspaceQueryKey, (current) =>
        removeWorkflowItemFromWorkspaceCache(current, activeMode, "decision", id),
      );
      return { previousWorkspace };
    },
    onSuccess: (workspace) => {
      queryClient.setQueryData(pmoWorkspaceQueryKey, workspace);
    },
    onError: (error, _id, context) => {
      if (context?.previousWorkspace) queryClient.setQueryData(pmoWorkspaceQueryKey, context.previousWorkspace);
      updateToast(error instanceof Error ? error.message : "Could not delete decision.");
    },
    onSettled: async () => {
      await invalidateWorkspace();
    },
  });
  const removeIdeaMutation = useMutation({
    mutationFn: (id: string) => removeSuggestedIdea({ data: { id, mode: activeMode } }),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: pmoWorkspaceQueryKey });
      const previousWorkspace = queryClient.getQueryData<PmoWorkspaceState>(pmoWorkspaceQueryKey);
      queryClient.setQueryData<PmoWorkspaceState>(pmoWorkspaceQueryKey, (current) =>
        removeWorkflowItemFromWorkspaceCache(current, activeMode, "idea", id),
      );
      return { previousWorkspace };
    },
    onSuccess: (workspace) => {
      queryClient.setQueryData(pmoWorkspaceQueryKey, workspace);
    },
    onError: (error, _id, context) => {
      if (context?.previousWorkspace) queryClient.setQueryData(pmoWorkspaceQueryKey, context.previousWorkspace);
      updateToast(error instanceof Error ? error.message : "Could not delete idea.");
    },
    onSettled: async () => {
      await invalidateWorkspace();
    },
  });
  const createTaskMutation = useMutation({
    mutationFn: (input: CreateTaskInput) => createTaskFromSuggestion({ data: input }),
    onSuccess: (result) => {
      queryClient.setQueryData(pmoWorkspaceQueryKey, result.workspace);
      if (!result.workspace.workspaces[activeMode].tasks.some((task) => task.id === result.task.id)) {
        updateToast("Task was created but is outside the current scope.");
      }
    },
    onError: (error) => {
      updateToast(error instanceof Error ? error.message : "Could not create task.");
    },
    onSettled: async () => {
      await invalidateWorkspace();
    },
  });
  const createApprovalMutation = useMutation({
    mutationFn: (input: CreateWorkflowSuggestionInput) => createApprovalFromSuggestion({ data: input }),
    onSuccess: (result) => {
      queryClient.setQueryData(pmoWorkspaceQueryKey, result.workspace);
      if (!result.workspace.workspaces[activeMode].approvals.some((approval) => approval.id === result.approval.id)) {
        updateToast("Approval was created but is outside the current scope.");
      }
    },
    onError: (error) => {
      updateToast(error instanceof Error ? error.message : "Could not create approval.");
    },
    onSettled: invalidateWorkspace,
  });
  const createDecisionMutation = useMutation({
    mutationFn: (input: CreateWorkflowSuggestionInput) => createDecisionFromSuggestion({ data: input }),
    onSuccess: (result) => {
      queryClient.setQueryData(pmoWorkspaceQueryKey, result.workspace);
      if (!result.workspace.workspaces[activeMode].decisions.some((decision) => decision.id === result.decision.id)) {
        updateToast("Decision was created but is outside the current scope.");
      }
    },
    onError: (error) => {
      updateToast(error instanceof Error ? error.message : "Could not create decision.");
    },
    onSettled: invalidateWorkspace,
  });
  const createIdeaMutation = useMutation({
    mutationFn: (input: CreateWorkflowSuggestionInput) => createIdeaFromSuggestion({ data: input }),
    onSuccess: (workspace) => {
      queryClient.setQueryData(pmoWorkspaceQueryKey, workspace);
    },
    onError: (error) => {
      updateToast(error instanceof Error ? error.message : "Could not create idea.");
    },
    onSettled: invalidateWorkspace,
  });
  const removeTaskMutation = useMutation({
    mutationFn: (id: string) => removeSuggestedTask({ data: { id, mode: activeMode } }),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: pmoWorkspaceQueryKey });
      const previousWorkspace = queryClient.getQueryData<PmoWorkspaceState>(pmoWorkspaceQueryKey);
      queryClient.setQueryData<PmoWorkspaceState>(pmoWorkspaceQueryKey, (current) =>
        removeTaskFromWorkspaceCache(current, activeMode, id),
      );
      return { previousWorkspace };
    },
    onSuccess: (workspace) => {
      queryClient.setQueryData(pmoWorkspaceQueryKey, workspace);
    },
    onError: (error, _id, context) => {
      if (context?.previousWorkspace) queryClient.setQueryData(pmoWorkspaceQueryKey, context.previousWorkspace);
      updateToast(error instanceof Error ? error.message : "Could not remove task.");
    },
    onSettled: async () => {
      await invalidateWorkspace();
    },
  });
  const createTeamMutation = useMutation({
    mutationFn: (input: { name: string; description?: string }) => createTeam({ data: input }),
    onSuccess: invalidateTeams,
  });
  const createProjectMutation = useMutation({
    mutationFn: (input: CreateProjectInput) => createScopedProject({ data: input }),
    onSuccess: invalidateProjects,
  });
  const deleteProjectMutation = useMutation({
    mutationFn: (input: DeleteProjectInput) => deleteScopedProject({ data: input }),
    onSuccess: async () => {
      await invalidateProjects();
      await invalidateChats();
    },
  });
  const createChatMutation = useMutation({
    mutationFn: (input: CreateChatInput) => createScopedChat({ data: input }),
    onSuccess: () => {
      void invalidateChats();
      void invalidateProjects();
    },
  });
  const branchChatMutation = useMutation({
    mutationFn: (input: BranchChatInput) => branchScopedChat({ data: input }),
    onSuccess: async () => {
      await invalidateChats();
      await invalidateProjects();
    },
  });
  const deleteChatMutation = useMutation({
    mutationFn: (input: DeleteChatInput) => deleteScopedChat({ data: input }),
    onSuccess: async () => {
      await invalidateChats();
      await invalidateProjects();
    },
  });
  const renameChatMutation = useMutation({
    mutationFn: (input: RenameChatInput) => renameScopedChat({ data: input }),
    onSuccess: async () => {
      await invalidateChats();
      await invalidateProjects();
    },
  });
  const scopedInviteMutation = useMutation({
    mutationFn: (input: { scope: "team" | "project"; targetId: string; targetName: string; email: string; targetTeamId?: string | null }) =>
      createScopedInvite({ data: input }),
  });
  const activeProject = visibleWorkspace.projects.find((project) => project.id === activeProjectId);
  const projectChats = activeProject?.projectChats ?? [];
  const activeChat =
    activeChatSection === "project"
      ? projectChats.find((chat) => chat.id === activeChatId) ?? transientChats[activeChatId] ?? projectChats[0]
      : visibleWorkspace.workspaceChats.find((chat) => chat.id === activeChatId) ?? transientChats[activeChatId] ?? visibleWorkspace.workspaceChats[0];
  const scopedProjectId = activeChatSection === "project" ? activeProject?.id ?? null : null;
  const conversationKey = activeChat ? getConversationKey(activeMode, scopedProjectId, activeChat.id) : "";
  const workspaceTitle = `${workspaceModeLabel(activeMode)} workspace`;
  const isWorkspaceRail = activeRail === "Workspaces";
  const scopeContextLabel = activeProject && scopedProjectId ? activeProject.name : visibleWorkspace.unassignedProjectLabel;
  const pageScopeKind: PageScopeKind = scopedProjectId ? "project" : "workspace";
  const baseScopeName = activeMode === "Team" ? selectedTeam?.name ?? "Team" : workspaceModeLabel(activeMode);
  const pageScopeDescription =
    pageScopeKind === "project"
      ? "Items tied to this project."
      : "Items not tied to a project.";
  const pageBreadcrumbLabel =
    activeMode === "Personal" && pageScopeKind === "workspace"
      ? "Personal / General"
      : pageScopeKind === "project"
        ? `${baseScopeName} / ${activeProject?.name ?? "Project"}`
        : `${baseScopeName} / General`;
  const scopedIdeas = useMemo(
    () => visibleWorkspace.ideas.filter((idea) => idea.projectId === scopedProjectId),
    [scopedProjectId, visibleWorkspace.ideas],
  );
  const scopedArtifacts = useMemo(
    () => visibleWorkspace.artifacts.filter((artifact) => artifact.projectId === scopedProjectId),
    [scopedProjectId, visibleWorkspace.artifacts],
  );
  const scopedDecisions = useMemo(
    () => visibleWorkspace.decisions.filter((decision) => decision.projectId === scopedProjectId),
    [scopedProjectId, visibleWorkspace.decisions],
  );
  const scopedApprovals = useMemo(
    () => visibleWorkspace.approvals.filter((approval) => approval.projectId === scopedProjectId),
    [scopedProjectId, visibleWorkspace.approvals],
  );
  const scopedTasks = useMemo(
    () => visibleWorkspace.tasks.filter((task) => task.projectId === scopedProjectId),
    [scopedProjectId, visibleWorkspace.tasks],
  );
  const scopedPrompts = useMemo(
    () => promptTemplates.map((prompt) => `${scopeContextLabel}: ${prompt}`),
    [scopeContextLabel],
  );
  const currentMessages = activeChat ? visibleWorkspace.conversations[conversationKey] ?? [] : [];

  const selectedIdea = scopedIdeas.find((idea) => idea.id === selectedIdeaId) ?? scopedIdeas[0];
  const selectedArtifact =
    scopedArtifacts.find((artifact) => artifact.title === selectedArtifactTitle) ?? scopedArtifacts[0];
  const selectedDecision =
    scopedDecisions.find((decision) => decision.id === selectedDecisionId)
    ?? scopedDecisions.find((decision) => decision.status !== "Completed")
    ?? scopedDecisions[0];
  const selectedApproval =
    scopedApprovals.find((approval) => approval.id === selectedApprovalId)
    ?? scopedApprovals.find((approval) => !["Approved", "Not Approved"].includes(approval.status))
    ?? scopedApprovals[0];
  const selectedTask =
    scopedTasks.find((task) => task.id === selectedTaskId)
    ?? scopedTasks.find((task) => task.status !== "Completed")
    ?? scopedTasks[0];

  const pinnedIdeas = visibleWorkspace.pinnedIdeaIds
    .map((id) => scopedIdeas.find((idea) => idea.id === id))
    .filter((idea): idea is Idea => Boolean(idea));
  const pinnedArtifacts = scopedArtifacts.filter((artifact) => artifact.pinnedTo.includes(activeMode));
  const pinnedApprovals = scopedApprovals.filter((approval) => approval.pinned);
  const pinnedDecisions = scopedDecisions.filter((decision) => decision.pinned);
  const pinnedTasks = scopedTasks.filter((task) => task.pinned);

  const filteredIdeas = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    return scopedIdeas.filter((idea) => {
      const statusMatches = statusFilter === "All" || idea.status === statusFilter;
      const textMatches =
        !normalizedSearch ||
        [idea.title, idea.category, idea.owner, idea.summary, ...idea.tags]
          .join(" ")
          .toLowerCase()
          .includes(normalizedSearch);
      return statusMatches && textMatches;
    });
  }, [scopedIdeas, searchTerm, statusFilter]);

  const metrics = getDetailMetrics({
    activeTab,
    artifacts: scopedArtifacts,
    approvals: scopedApprovals,
    decisions: scopedDecisions,
    ideas: scopedIdeas,
    messages: currentMessages,
    pinnedArtifacts,
    queryState: workspaceQuery.isFetching ? "Syncing" : "Fresh",
    scopeContextLabel,
    tasks: scopedTasks,
    updatedAt: visibleWorkspace.updatedAt,
  });

  useEffect(() => {
    setSelectedIdeaId((current) =>
      current && scopedIdeas.some((idea) => idea.id === current)
        ? current
        : scopedIdeas[0]?.id ?? "",
    );
    setSelectedArtifactTitle((current) =>
      current && scopedArtifacts.some((artifact) => artifact.title === current)
        ? current
        : scopedArtifacts[0]?.title ?? "",
    );
    setSelectedDecisionId((current) =>
      current && scopedDecisions.some((decision) => decision.id === current)
        ? current
        : scopedDecisions.find((decision) => decision.status !== "Completed")?.id ?? scopedDecisions[0]?.id ?? "",
    );
    setSelectedApprovalId((current) =>
      current && scopedApprovals.some((approval) => approval.id === current)
        ? current
        : scopedApprovals.find((approval) => !["Approved", "Not Approved"].includes(approval.status))?.id ?? scopedApprovals[0]?.id ?? "",
    );
    setSelectedTaskId((current) =>
      current && scopedTasks.some((task) => task.id === current)
        ? current
        : scopedTasks.find((task) => task.status !== "Completed")?.id ?? scopedTasks[0]?.id ?? "",
    );
  }, [scopedApprovals, scopedArtifacts, scopedDecisions, scopedIdeas, scopedTasks]);

  useEffect(() => {
    const activeProjectExists = activeProjectId
      ? visibleWorkspace.projects.some((project) => project.id === activeProjectId)
      : true;
    if (!activeProjectExists) {
      setActiveProjectId("");
      setActiveChatSection("workspace");
    }

    const workspaceChatExists = visibleWorkspace.workspaceChats.some((chat) => chat.id === activeChatId);
    const projectWithActiveChat = visibleWorkspace.projects.find((project) =>
      project.projectChats.some((chat) => chat.id === activeChatId),
    );
    const activeChatExists =
      (activeChatSection === "workspace" && workspaceChatExists) ||
      (activeChatSection === "project" && Boolean(projectWithActiveChat)) ||
      Boolean(transientChats[activeChatId]);

    if (!activeChatExists) {
      const nextWorkspaceChat = visibleWorkspace.workspaceChats[0];
      if (nextWorkspaceChat) {
        setActiveChatSection("workspace");
        setActiveChatId(nextWorkspaceChat.id);
      } else {
        const nextProjectWithChat = visibleWorkspace.projects.find((project) => project.projectChats.length > 0);
        if (nextProjectWithChat) {
          setActiveProjectId(nextProjectWithChat.id);
          setActiveChatSection("project");
          setActiveChatId(nextProjectWithChat.projectChats[0]?.id ?? "");
        } else {
          setActiveChatId("");
        }
      }
    }

    if (activeChatSection === "project" && projectWithActiveChat && projectWithActiveChat.id !== activeProjectId) {
      setActiveProjectId(projectWithActiveChat.id);
    }

  }, [activeChatId, activeChatSection, activeProjectId, transientChats, visibleWorkspace]);

  useEffect(() => {
    if (activeMode === "Team" && teams.length > 0 && !teams.some((team) => team.id === activeTeamId)) {
      setActiveTeamId(teams[0].id);
    }
  }, [activeMode, activeTeamId, teams]);

  useEffect(() => {
    window.localStorage.setItem("vertex-show-token-usage", showTokenUsage ? "1" : "0");
  }, [showTokenUsage]);

  useEffect(() => {
    window.localStorage.setItem("vertex-chat-reasoning-level", chatReasoningLevel);
  }, [chatReasoningLevel]);

  useEffect(() => {
    window.localStorage.setItem("vertex-chat-web-search", webSearchEnabled ? "1" : "0");
  }, [webSearchEnabled]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (activeMode === "Team" && !selectedTeam) return;

    setPresenceUsers([{
      id: session.user.id,
      name: session.user.name || session.user.email || "You",
      email: session.user.email,
    }]);
    const params = new URLSearchParams({ mode: activeMode });
    if (activeMode === "Team" && selectedTeam?.id) params.set("teamId", selectedTeam.id);
    const events = new EventSource(`/api/chat-events?${params.toString()}`);

    events.addEventListener("chat-message", (messageEvent) => {
      try {
        const event = JSON.parse(messageEvent.data) as ChatMessageInsertEvent;
        queryClient.setQueryData<ScopedChatsResult>(scopedChatsQueryKey, (current) =>
          appendChatMessageToScopedChats(current, event),
        );
      } catch (error) {
        console.warn("Could not apply chat sync event.", error);
      }
    });

    events.addEventListener("presence", (presenceEvent) => {
      try {
        const users = JSON.parse(presenceEvent.data) as WorkspacePresenceUser[];
        setPresenceUsers(users);
      } catch (error) {
        console.warn("Could not apply workspace presence event.", error);
      }
    });

    events.addEventListener("error", () => {
      if (events.readyState === EventSource.CLOSED) {
        void queryClient.invalidateQueries({ queryKey: scopedChatsQueryKey });
      }
    });

    return () => events.close();
  }, [activeMode, queryClient, scopedChatsQueryKey, selectedTeam, session.user.email, session.user.id, session.user.name]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (activeMode === "Team" && !selectedTeam) return;

    const clientId = getRealtimeClientId();
    realtimeClientIdRef.current = clientId;
    const teamId = activeMode === "Team" ? selectedTeam?.id ?? null : null;
    const lastEventStorageKey = realtimeLastEventKey(activeMode, teamId, session.user.id);
    const lastEventId = window.sessionStorage.getItem(lastEventStorageKey);
    const params = new URLSearchParams({ mode: activeMode, clientId });
    if (teamId) params.set("teamId", teamId);
    if (lastEventId) params.set("lastEventId", lastEventId);

    const events = new EventSource(`/api/events?${params.toString()}`);

    events.addEventListener("mutation", (mutationEvent) => {
      try {
        const event = JSON.parse(mutationEvent.data) as RealtimeMutationEvent;
        if (event.sourceClientId && event.sourceClientId === realtimeClientIdRef.current) return;
        if (realtimeSeenEventIdsRef.current.has(event.id)) return;

        realtimeSeenEventIdsRef.current.add(event.id);
        if (realtimeSeenEventIdsRef.current.size > 500) {
          const oldest = realtimeSeenEventIdsRef.current.values().next().value;
          if (typeof oldest === "number") realtimeSeenEventIdsRef.current.delete(oldest);
        }
        window.sessionStorage.setItem(lastEventStorageKey, String(event.id));

        if (event.invalidates.includes("workspace")) void invalidateWorkspace();
        if (event.invalidates.includes("teams")) void invalidateTeams();
        if (event.invalidates.includes("projects")) void invalidateProjects();
        if (event.invalidates.includes("chats")) void invalidateChats();
      } catch (error) {
        console.warn("Could not apply realtime mutation event.", error);
      }
    });

    events.addEventListener("stream-error", (errorEvent) => {
      console.warn("Realtime event stream reported an error.", (errorEvent as MessageEvent).data);
    });

    events.onerror = () => {
      if (events.readyState === EventSource.CLOSED) {
        void invalidateWorkspace();
        void invalidateProjects();
        void invalidateChats();
      }
    };

    return () => events.close();
  }, [activeMode, queryClient, selectedTeam, session.user.id]);

  useEffect(() => {
    if (canEdit && activeTab === "Chat" && activeChatId) {
      focusChatComposer();
    }
  }, [activeChatId, activeTab, canEdit]);

  function updateToast(message: string, link?: ToastLink) {
    setToast(message);
    setToastLink(link ?? null);
    window.setTimeout(() => {
      setToast(null);
      setToastLink(null);
    }, 4200);
  }

  function handleRailClick(label: RailName) {
    setActiveRail(label);
    const nextTab: Partial<Record<RailName, TabName>> = {
      Workspaces: "Chat",
      Chats: "Chat",
      Ideas: "Ideas",
      Artifacts: "Artifacts",
      Decisions: "Decisions",
      Approvals: "Approvals",
      Tasks: "Tasks",
      Prompts: "Prompts",
    };
    setActiveTab(nextTab[label] ?? "Ideas");
  }

  function startTutorial() {
    setTutorialStepIndex(0);
    setIsTutorialOpen(true);
  }

  function completeTutorial() {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(onboardingCompletedKey, "1");
      window.sessionStorage.removeItem(onboardingRelaunchKey);
    }
    setIsTutorialOpen(false);
  }

  const tutorialSteps: TutorialStep[] = [
    {
      title: "Start in your workspace",
      description: "The blue rail stays with you as you move through the app. Use it to return to Workspaces, Chats, Ideas, Artifacts, Docs, and Settings.",
      detail: "The main workspace opens in Personal scope so new users can try the assistant without exposing work to a team.",
      actionLabel: "Show workspace",
      onAction: () => {
        setActiveMode("Personal");
        handleRailClick("Workspaces");
      },
    },
    {
      title: "Create your first chat",
      description: "Chats keep AI conversations organized by personal, team, org, or project context.",
      detail: "Create separate chats for different workstreams so history, artifacts, and future branches stay easy to find.",
      actionLabel: "Open new chat form",
      onAction: () => {
        setActiveMode("Personal");
        handleRailClick("Workspaces");
        setCreateChatState({ section: "workspace", projectId: null });
      },
    },
    {
      title: "Create your first team",
      description: "Team workspaces let a group share projects, chats, artifacts, and scoped invites.",
      detail: "After a team exists, switch to Team scope and create shared project work inside that team.",
      actionLabel: "Open team form",
      onAction: () => {
        setActiveMode("Team");
        setIsCreateTeamOpen(true);
      },
    },
    {
      title: "Create your first project",
      description: "Projects collect focused chats, artifacts, decisions, approvals, tasks, and prompts under one delivery scope.",
      detail: "Use projects when work has a clear owner, timeline, or artifact set.",
      actionLabel: "Open project form",
      onAction: () => {
        handleRailClick("Workspaces");
        setIsCreateProjectOpen(true);
      },
    },
    {
      title: "Review artifacts and actions",
      description: "Artifacts, Ideas, Decisions, Approvals, and Tasks are available from the workspace tabs and the blue rail.",
      detail: "Pinned outputs appear at the top of the workspace so important files and ideas stay visible.",
      actionLabel: "Show artifacts",
      onAction: () => handleRailClick("Artifacts"),
    },
    {
      title: "Use prompts and settings later",
      description: "Prompt templates help start structured assistant requests. Settings lets you relaunch this tutorial whenever you need a reset.",
      detail: "The tutorial is skippable now and available again from User Settings.",
      actionLabel: "Open settings",
      onAction: () => (window.location.href = "/profile"),
    },
  ];

  function handleWorkspaceMode(mode: WorkspaceMode) {
    setActiveMode(mode);
    setActiveProjectId("");
    setActiveChatSection("workspace");
    setRightOpen(true);
  }

  function handleProjectSelect(project: ProjectSummary) {
    setActiveProjectId(project.id);
    setActiveChatSection("project");
    setActiveChatId(project.projectChats[0]?.id ?? "");
    setActiveTab("Chat");
    setRightOpen(true);
  }

  function handleChatSelect(section: ChatSection, chatId: string) {
    if (section === "workspace") {
      setActiveProjectId("");
      setActiveChatSection(section);
      setActiveChatId(chatId);
      setActiveTab("Chat");
      return;
    }
    const project = visibleWorkspace.projects.find((item) => item.projectChats.some((chat) => chat.id === chatId));
    if (project) setActiveProjectId(project.id);
    setActiveChatSection(section);
    setActiveChatId(chatId);
    setActiveTab("Chat");
  }

  function clientTimeLabel() {
    return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  function handleCreateTeam() {
    if (!canEdit) {
      updateToast("Viewer access is read-only");
      return;
    }
    setIsCreateTeamOpen(true);
  }

  async function handleCreateTeamSubmit(value: CreateTeamInput) {
    const team = await createTeamMutation.mutateAsync(value);
    await invalidateTeams();
    setActiveTeamId(team.id);
    setIsCreateTeamOpen(false);
    updateToast(`${team.name} team created`);
  }

  function handleCreateProject() {
    if (!canEdit) {
      updateToast("Viewer access is read-only");
      return;
    }
    if (activeMode === "Team" && !selectedTeam) {
      updateToast("Create or select a team before adding a team project.");
      return;
    }
    setIsCreateProjectOpen(true);
  }

  async function handleCreateProjectSubmit(value: Omit<CreateProjectInput, "mode" | "teamId">) {
    const project = await createProjectMutation.mutateAsync({
      ...value,
      mode: activeMode,
      teamId: activeMode === "Team" ? selectedTeam?.id ?? null : null,
    });
    await invalidateProjects();
    setActiveProjectId(project.id);
    setActiveChatSection("project");
    setActiveChatId("");
    setIsCreateProjectOpen(false);
    updateToast(`${project.name} project created`);
  }

  useEffect(() => {
    return () => {
      if (composerHighlightTimeoutRef.current !== null) {
        window.clearTimeout(composerHighlightTimeoutRef.current);
      }
    };
  }, []);

  function focusChatComposer({ highlight = false }: { highlight?: boolean } = {}) {
    if (highlight) {
      setIsComposerHighlighted(true);
      if (composerHighlightTimeoutRef.current !== null) {
        window.clearTimeout(composerHighlightTimeoutRef.current);
      }
      composerHighlightTimeoutRef.current = window.setTimeout(() => {
        setIsComposerHighlighted(false);
        composerHighlightTimeoutRef.current = null;
      }, 1800);
    }
    window.setTimeout(() => chatInputRef.current?.focus(), 0);
  }

  async function createFreshChat({
    contextLabel,
    projectId,
    section,
  }: {
    contextLabel: string;
    projectId: string | null;
    section: ChatSection;
  }) {
    const chat = await createChatMutation.mutateAsync({
      mode: activeMode,
      teamId: activeMode === "Team" ? selectedTeam?.id ?? null : null,
      projectId,
      section,
      title: `${contextLabel} AI Chat`,
      description: `AI chatbot scoped to ${contextLabel}.`,
    });
    setTransientChats((chats) => ({ ...chats, [chat.id]: chat }));
    setActiveChatSection(section);
    setActiveChatId(chat.id);
    setActiveTab("Chat");
    setRightOpen(true);
    setChatInput("");
    focusChatComposer({ highlight: true });
    updateToast(`${chat.title} started`);
    return chat;
  }

  async function handleBranchMessage(message: ChatMessage) {
    if (!canEdit) {
      updateToast("Viewer access is read-only");
      return;
    }
    if (!activeChat) {
      updateToast("Select a chat before branching context.");
      return;
    }
    if (activeMode === "Team" && !selectedTeam) {
      updateToast("Select a team before branching context.");
      return;
    }

    try {
      const result = await branchChatMutation.mutateAsync({
        mode: activeMode,
        teamId: activeMode === "Team" ? selectedTeam?.id ?? null : null,
        projectId: scopedProjectId,
        section: activeChatSection,
        chatId: activeChat.id,
        messageId: message.id,
      });
      setTransientChats((chats) => ({ ...chats, [result.chat.id]: result.chat }));
      setActiveChatSection(activeChatSection);
      setActiveChatId(result.chat.id);
      setActiveTab("Chat");
      setRightOpen(true);
      setChatInput("");
      focusChatComposer({ highlight: true });
      updateToast(`${result.chat.title} started from selected context`);
    } catch (error) {
      updateToast(error instanceof Error ? error.message : "Could not branch context.");
    }
  }

  async function handleOpenWorkspaceChat() {
    if (!canEdit) {
      updateToast("Viewer access is read-only");
      return;
    }
    if (activeMode === "Team" && !selectedTeam) {
      updateToast("Create or select a team before adding a team chat.");
      return;
    }
    setActiveProjectId("");
    await createFreshChat({
      contextLabel: workspaceModeLabel(activeMode),
      projectId: null,
      section: "workspace",
    });
  }

  async function runScopedRagStream({
    key,
    projectId,
    prompt,
    teamId,
    workspaceId,
  }: {
    key: string;
    projectId: string;
    prompt: string;
    teamId: string;
    workspaceId: string;
  }) {
    const userMessage: ChatMessage = {
      id: `optimistic-user-${Date.now()}`,
      author: "You",
      role: "user",
      avatar: avatarAlex,
      time: clientTimeLabel(),
      text: prompt,
    };
    const assistantMessageId = `streaming-assistant-${Date.now()}`;
    const assistantMessage: ChatMessage = {
      id: assistantMessageId,
      author: "VertexAI",
      role: "assistant",
      time: clientTimeLabel(),
      text: "",
    };
    let tokenText = "";
    let citations: ChatWithScopedRagCitation[] = [];
    const renderStreamingText = () => {
      const citationText = formatScopedRagCitations(citations);
      return `${tokenText}${citationText ? `\n\n${citationText}` : ""}`.trimStart();
    };

    await queryClient.cancelQueries({ queryKey: scopedChatsQueryKey });
    const previousScopedChats = queryClient.getQueryData<ScopedChatsResult>(scopedChatsQueryKey);
    queryClient.setQueryData<ScopedChatsResult>(scopedChatsQueryKey, (current) => {
      const withUser = appendChatMessageToCache(current ?? emptyScopedChatsResult, key, userMessage);
      return appendChatMessageToCache(withUser, key, assistantMessage);
    });
    setIsScopedRagStreaming(true);
    try {
      await consumeScopedRagEventSource({ prompt, teamId, workspaceId, projectId }, {
        onCitations: (nextCitations) => {
          citations = nextCitations;
          queryClient.setQueryData<ScopedChatsResult>(scopedChatsQueryKey, (current) =>
            updateChatMessageInCache(current, key, assistantMessageId, renderStreamingText()),
          );
        },
        onToken: (token) => {
          tokenText += token;
          queryClient.setQueryData<ScopedChatsResult>(scopedChatsQueryKey, (current) =>
            updateChatMessageInCache(current, key, assistantMessageId, renderStreamingText()),
          );
        },
        onError: (message) => {
          throw new Error(message);
        },
      });

      queryClient.setQueryData<ScopedChatsResult>(scopedChatsQueryKey, (current) =>
        updateChatMessageInCache(current, key, assistantMessageId, renderStreamingText() || "The model did not return a response."),
      );
    } catch (error) {
      queryClient.setQueryData(scopedChatsQueryKey, previousScopedChats ?? emptyScopedChatsResult);
      throw error;
    } finally {
      setIsScopedRagStreaming(false);
    }
  }

  async function handleAddProjectChat(project: ProjectSummary) {
    if (!canEdit) {
      updateToast("Viewer access is read-only");
      return;
    }
    if (activeMode === "Team" && !selectedTeam) {
      updateToast("Create or select a team before adding a team project chat.");
      return;
    }
    setActiveProjectId(project.id);
    await createFreshChat({
      contextLabel: project.name,
      projectId: project.id,
      section: "project",
    });
  }

  function handleDeleteProject(project: ProjectSummary) {
    if (!canEdit) {
      updateToast("Viewer access is read-only");
      return;
    }
    if (activeMode === "Team" && !selectedTeam) {
      updateToast("Select a team before deleting a team project.");
      return;
    }
    setConfirmDialog({
      title: `Delete ${project.name}`,
      description: "This removes the project, its project chats, and all messages in those chats.",
      actionLabel: "Delete project",
      destructive: true,
      onConfirm: async () => {
        await deleteProjectMutation.mutateAsync({
          mode: activeMode,
          teamId: activeMode === "Team" ? selectedTeam?.id ?? null : null,
          projectId: project.id,
        });
        if (project.id === activeProjectId) {
          setActiveProjectId("");
          setActiveChatSection("workspace");
          setActiveChatId(visibleWorkspace.workspaceChats[0]?.id ?? "");
        }
        setActiveTab("Chat");
        updateToast(`${project.name} deleted`);
      },
    });
  }

  function handleDeleteChat({
    chat,
    project,
    section,
  }: {
    chat: ChatSummary;
    project?: ProjectSummary;
    section: ChatSection;
  }) {
    if (!canEdit) {
      updateToast("Viewer access is read-only");
      return;
    }
    if (activeMode === "Team" && !selectedTeam) {
      updateToast("Select a team before deleting a team chat.");
      return;
    }
    setConfirmDialog({
      title: `Delete ${chat.title}`,
      description: "This removes the chat and all messages in it.",
      actionLabel: "Delete chat",
      destructive: true,
      onConfirm: async () => {
        await deleteChatMutation.mutateAsync({
          mode: activeMode,
          teamId: activeMode === "Team" ? selectedTeam?.id ?? null : null,
          projectId: section === "project" ? project?.id ?? null : null,
          section,
          chatId: chat.id,
        });
        if (chat.id === activeChatId && section === activeChatSection) {
          if (section === "project" && project) {
            const nextChat = project.projectChats.find((item) => item.id !== chat.id);
            setActiveProjectId(project.id);
            if (nextChat) {
              setActiveChatSection("project");
              setActiveChatId(nextChat.id);
            } else {
              setActiveChatSection("workspace");
              setActiveChatId(visibleWorkspace.workspaceChats[0]?.id ?? "");
            }
          } else {
            const nextChat = visibleWorkspace.workspaceChats.find((item) => item.id !== chat.id);
            setActiveChatSection("workspace");
            setActiveChatId(nextChat?.id ?? "");
          }
        }
        setActiveTab("Chat");
        updateToast(`${chat.title} deleted`);
      },
    });
  }

  function handleRenameChat({
    chat,
    project,
    section,
  }: {
    chat: ChatSummary;
    project?: ProjectSummary;
    section: ChatSection;
  }) {
    if (!canEdit) {
      updateToast("Viewer access is read-only");
      return;
    }
    if (activeMode === "Team" && !selectedTeam) {
      updateToast("Select a team before renaming a team chat.");
      return;
    }
    setInputDialog({
      title: "Rename chat",
      description: "Update the chat name shown in the sidebar.",
      label: "Chat name",
      defaultValue: chat.title,
      placeholder: "Example: Launch planning assistant",
      actionLabel: "Rename chat",
      onSubmit: async (value) => {
        const title = value.trim();
        if (!title || title === chat.title) return;
        const renamed = await renameChatMutation.mutateAsync({
          mode: activeMode,
          teamId: activeMode === "Team" ? selectedTeam?.id ?? null : null,
          projectId: section === "project" ? project?.id ?? null : null,
          section,
          chatId: chat.id,
          title,
        });
        updateToast(`${renamed.title} renamed`);
        focusChatComposer();
      },
    });
  }

  async function handleCreateChatSubmit(value: Omit<CreateChatInput, "mode" | "teamId" | "projectId" | "section">) {
    if (!createChatState) return;
    const chat = await createChatMutation.mutateAsync({
      ...value,
      mode: activeMode,
      teamId: activeMode === "Team" ? selectedTeam?.id ?? null : null,
      projectId: createChatState.projectId,
      section: createChatState.section,
    });
    setTransientChats((chats) => ({ ...chats, [chat.id]: chat }));
    setActiveChatSection(createChatState.section);
    setActiveChatId(chat.id);
    setCreateChatState(null);
    setActiveTab("Chat");
    setRightOpen(true);
    setChatInput("");
    focusChatComposer({ highlight: true });
    updateToast(`${chat.title} chat created`);
  }

  async function ensureActiveChatForSubmit() {
    if (activeChat) {
      return {
        chat: activeChat,
        projectId: scopedProjectId,
        section: activeChatSection,
      };
    }
    const section = activeChatSection === "project" && activeProject ? "project" : "workspace";
    const projectId = section === "project" ? activeProject?.id ?? null : null;
    const contextLabel = section === "project" ? activeProject?.name ?? "Project" : workspaceModeLabel(activeMode);
    const chat = await createFreshChat({ contextLabel, projectId, section });
    return { chat, projectId, section };
  }

  async function handleAttachFiles(files: FileList | null) {
    if (!files?.length) return;
    const availableSlots = Math.max(0, 6 - chatAttachments.length);
    if (availableSlots === 0) {
      updateToast("Remove an attachment before adding another file.");
      return;
    }
    setIsExtractingAttachment(true);
    try {
      const { extractChatAttachment } = await import("@/lib/attachment-extraction");
      const selectedFiles = Array.from(files).slice(0, availableSlots);
      const extracted = await Promise.all(selectedFiles.map((file) => extractChatAttachment(file)));
      setChatAttachments((current) => [...current, ...extracted].slice(0, 6));
      const failed = extracted.filter((attachment) => attachment.status === "error");
      if (failed.length > 0) {
        updateToast(`${failed.length} attachment${failed.length === 1 ? "" : "s"} could not be read.`);
      } else {
        updateToast(`${extracted.length} attachment${extracted.length === 1 ? "" : "s"} ready for Gemma 4`);
      }
    } catch (error) {
      updateToast(error instanceof Error ? error.message : "Could not attach file.");
    } finally {
      setIsExtractingAttachment(false);
      if (chatFileInputRef.current) chatFileInputRef.current.value = "";
    }
  }

  function removeChatAttachment(id: string) {
    setChatAttachments((attachments) => attachments.filter((attachment) => attachment.id !== id));
  }

  function handleInviteTeam(team: TeamSummary) {
    if (!canEdit) {
      updateToast("Viewer access is read-only");
      return;
    }
    setInputDialog({
      title: `Invite user to ${team.name}`,
      description: "Send an invitation to this team workspace.",
      label: "Email address",
      placeholder: "name@example.com",
      actionLabel: "Send invite",
      inputType: "email",
      onSubmit: async (value) => {
        const email = value.trim();
        if (!email) return;
        await scopedInviteMutation.mutateAsync({
          scope: "team",
          targetId: team.id,
          targetName: team.name,
          email,
        });
        updateToast(`Invited ${email} to ${team.name}.`, { href: "/profile/invites", label: "Manage invites" });
      },
    });
  }

  function handleInviteProject(project: ProjectSummary) {
    if (!canEdit) {
      updateToast("Viewer access is read-only");
      return;
    }
    setInputDialog({
      title: `Invite user to ${project.name}`,
      description: "Send an invitation to this project workspace.",
      label: "Email address",
      placeholder: "name@example.com",
      actionLabel: "Send invite",
      inputType: "email",
      onSubmit: async (value) => {
        const email = value.trim();
        if (!email) return;
        await scopedInviteMutation.mutateAsync({
          scope: "project",
          targetId: project.id,
          targetTeamId: activeMode === "Team" ? selectedTeam?.id ?? null : null,
          targetName: project.name,
          email,
        });
        updateToast(`Invited ${email} to ${project.name}.`, { href: "/profile/invites", label: "Manage invites" });
      },
    });
  }

  async function handleSendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit) {
      updateToast("Viewer access is read-only");
      return;
    }
    const text = chatInput.trim();
    const readyAttachments = chatAttachments.filter((attachment) => attachment.status !== "error");
    if (!text && readyAttachments.length === 0) return;
    let targetConversationKey = "";
    let usedSendMessageMutation = false;
    try {
      const target = await ensureActiveChatForSubmit();
      targetConversationKey = getConversationKey(activeMode, target.projectId, target.chat.id);
      setChatInput("");
      setChatAttachments([]);
      setActiveTab("Chat");
      setRightOpen(true);
      const teamId = activeMode === "Team" ? selectedTeam?.id ?? "" : "";
      if (teamId && target.projectId && !webSearchEnabled && readyAttachments.length === 0) {
        await runScopedRagStream({
          key: targetConversationKey,
          projectId: target.projectId,
          prompt: text,
          teamId,
          workspaceId: `ws-${activeWorkspace.scope}`,
        });
        updateToast("Scoped RAG response streamed");
        return;
      }

      usedSendMessageMutation = true;
      await sendMessageMutation.mutateAsync({
        mode: activeMode,
        teamId: activeMode === "Team" ? selectedTeam?.id ?? null : null,
        projectId: target.projectId,
        chatId: target.chat.id,
        chatTitle: target.chat.title,
        text,
        model: "Gemma 4 26B",
        reasoningLevel: chatReasoningLevel,
        webSearchEnabled,
        attachments: readyAttachments,
      });
      updateToast("VertexAI response added");
    } catch (error) {
      setChatInput(text);
      setChatAttachments(readyAttachments);
      if (!usedSendMessageMutation) {
        if (targetConversationKey) {
          queryClient.setQueryData<ScopedChatsResult>(scopedChatsQueryKey, (current) =>
            removeOptimisticChatMessages(current, targetConversationKey),
          );
        }
        updateToast(error instanceof Error ? error.message : "Chat submission failed");
      }
    }
  }

  function handleChatInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    chatFormRef.current?.requestSubmit();
  }

  function handleChatSubmitButton() {
    chatFormRef.current?.requestSubmit();
  }

  async function handleAddIdea(value: AddIdeaInput) {
    if (!canEdit) {
      updateToast("Viewer access is read-only");
      return;
    }
    await addIdeaMutation.mutateAsync(value);
    setIsAddOpen(false);
    setActiveTab("Ideas");
    setRightOpen(true);
    updateToast("Idea added through TanStack Form");
  }

  async function handleIdeaStatusChange(idea: Idea, status: IdeaStatus) {
    if (!canEdit) {
      updateToast("Viewer access is read-only");
      return;
    }
    if (status === "Convert to Project" && idea.status !== "Convert to Project") {
      if (activeMode === "Team" && !selectedTeam) {
        updateToast("Select a team before converting an idea to a team project.");
        return;
      }
      await createProjectMutation.mutateAsync({
        mode: activeMode,
        teamId: activeMode === "Team" ? selectedTeam?.id ?? null : null,
        name: idea.title,
        description: idea.originalText || idea.summary || "Created from an idea.",
        status: "Planning",
      });
      await invalidateProjects();
      updateToast(`Created project "${idea.title}"`);
    }
    updateStatusMutation.mutate({ id: idea.id, status });
  }

  async function handleSignOut() {
    await authClient.signOut();
    window.location.href = "/sign-in";
  }

  return (
    <main className="h-svh overflow-hidden bg-[linear-gradient(135deg,oklch(0.985_0.006_247),oklch(0.955_0.015_240))] p-0 text-foreground lg:p-5">
      <RenderedTableExportControls
        activeMode={activeMode}
        activeChatTitle={activeChat?.title}
        artifacts={scopedArtifacts}
        canEdit={canEdit}
        projectId={scopedProjectId}
        selectedArtifact={selectedArtifact}
        onSaved={(title) => updateToast(`Saved "${title}" to Artifacts`)}
        onError={(message) => updateToast(message)}
      />
      <div className="workspace-shadow relative grid h-full overflow-hidden border bg-card lg:grid-cols-[72px_minmax(0,1fr)] lg:rounded-xl">
        <PrimaryRail
          activeRail={activeRail}
          canAdmin={session.user.role === "admin"}
          showTokenUsage={showTokenUsage}
          userEmail={session.user.email}
          userName={session.user.name}
          onRailClick={handleRailClick}
          onShowTokenUsageChange={setShowTokenUsage}
          onSignOut={handleSignOut}
          onStartTutorial={startTutorial}
        />

        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-background">
          <Topbar
            canAdmin={session.user.role === "admin"}
            presenceUsers={presenceUsers}
            searchTerm={searchTerm}
            userEmail={session.user.email}
            userName={session.user.name}
            showTokenUsage={showTokenUsage}
            onSearchTerm={setSearchTerm}
            onShowTokenUsageChange={setShowTokenUsage}
            onSignOut={handleSignOut}
            onStartTutorial={startTutorial}
            onMobileMenu={() => handleRailClick("Workspaces")}
            onNotify={() => updateToast("Decision taxonomy is still blocked")}
          />

          <Contextbar
            activeMode={activeMode}
            activeTeamId={selectedTeam?.id ?? ""}
            breadcrumbLabel={pageBreadcrumbLabel}
            canEdit={canEdit}
            showScopeTabs
            teams={teams}
            onCreateTeam={handleCreateTeam}
            onInviteTeam={handleInviteTeam}
            onModeChange={handleWorkspaceMode}
            onTeamChange={setActiveTeamId}
          />

          <div
            className={cn(
              "grid min-h-0 flex-1 bg-card",
              isWorkspaceRail
                ? rightOpen
                  ? "lg:grid-cols-[260px_minmax(430px,1fr)_minmax(320px,380px)] xl:grid-cols-[280px_minmax(520px,1fr)_390px]"
                  : "lg:grid-cols-[260px_minmax(430px,1fr)_56px] xl:grid-cols-[280px_minmax(520px,1fr)_56px]"
                : "lg:grid-cols-1",
            )}
          >
            {isWorkspaceRail ? (
              <>
                {isScopedWorkspaceLoading ? (
                  <ProjectNavSkeleton />
                ) : (
                  <ProjectNav
                    activeChatId={activeChat?.id ?? ""}
                    activeChatSection={activeChatSection}
                    activeMode={activeMode}
                    activeProjectId={activeProject?.id ?? ""}
                    canEdit={canEdit}
                    workspace={visibleWorkspace}
                    onAddProjectChat={handleAddProjectChat}
                    onChatSelect={handleChatSelect}
                    onCreateProject={handleCreateProject}
                    onDeleteChat={handleDeleteChat}
                    onDeleteProject={handleDeleteProject}
                    onOpenWorkspaceChat={handleOpenWorkspaceChat}
                    onInviteProject={handleInviteProject}
                    onProjectSelect={handleProjectSelect}
                    onRenameChat={handleRenameChat}
                  />
                )}

                <section className="flex min-h-0 min-w-0 flex-col overflow-hidden border-r">
                  {isScopedWorkspaceLoading ? (
                    <WorkspaceMainSkeleton />
                  ) : (
                    <>
                      <PinnedStrip
                        artifacts={pinnedArtifacts}
                        approvals={pinnedApprovals}
                        decisions={pinnedDecisions}
                        ideas={pinnedIdeas}
                        tasks={pinnedTasks}
                        onSelectArtifact={(artifact) => {
                          setSelectedArtifactTitle(artifact.title);
                          setActiveTab("Artifacts");
                          setPreviewArtifact(artifact);
                        }}
                        onSelectApproval={(approval) => {
                          setSelectedApprovalId(approval.id);
                          setActiveTab("Approvals");
                          setRightOpen(true);
                        }}
                        onSelectDecision={(decision) => {
                          setSelectedDecisionId(decision.id);
                          setActiveTab("Decisions");
                          setRightOpen(true);
                        }}
                        onSelectIdea={(idea) => {
                          setSelectedIdeaId(idea.id);
                          setActiveTab("Ideas");
                          setRightOpen(true);
                        }}
                        onSelectTask={(task) => {
                          setSelectedTaskId(task.id);
                          setActiveTab("Tasks");
                          setRightOpen(true);
                        }}
                      />

                      <ScopeTabs
                        activeTab={activeTab}
                        onTabChange={setActiveTab}
                      />

                      <section
                        className={cn(
                          "min-h-0 flex-1",
                          activeTab === "Chat"
                            ? "flex flex-col overflow-hidden"
                            : "scrollbar-thin overflow-auto p-4 pb-32",
                        )}
                      >
                        {activeTab === "Chat" ? (
                          <ChatView
                            approvals={scopedApprovals}
                            activeMode={activeMode}
                            activeProjectId={activeChatSection === "project" ? activeProject?.id ?? null : null}
                            canBranch={canEdit && !branchChatMutation.isPending}
                            canEdit={canEdit}
                            chatTitle={activeChat?.title}
                            decisions={scopedDecisions}
                            ideas={scopedIdeas}
                            isTyping={sendMessageMutation.isPending || isScopedRagStreaming}
                            llmTraces={llmTraces}
                            messages={currentMessages}
                            pendingApproval={false}
                            pendingTask={false}
                            pendingTaskRemovalId={removeTaskMutation.isPending ? removeTaskMutation.variables ?? null : null}
                            pendingTaskTitle={createTaskMutation.isPending ? createTaskMutation.variables?.title ?? null : null}
                            showTokenUsage={showTokenUsage}
                            tasks={scopedTasks}
                            onBranchContext={handleBranchMessage}
                            onCreateApproval={(input) => createApprovalMutation.mutate(input)}
                            onCreateDecision={(input) => createDecisionMutation.mutate(input)}
                            onCreateIdea={(input) => createIdeaMutation.mutate(input)}
                            onCreateTask={(input) => createTaskMutation.mutate(input)}
                            onToggleApproval={() => undefined}
                            onToggleTask={() => undefined}
                          />
                        ) : null}
                    {activeTab === "Ideas" ? (
                      <IdeasView
                        canEdit={canEdit}
                        ideas={filteredIdeas}
                        searchTerm={searchTerm}
                        statusFilter={statusFilter}
                        pinnedIdeaIds={visibleWorkspace.pinnedIdeaIds}
                        onAddIdea={() => setIsAddOpen(true)}
                        onSearchTerm={setSearchTerm}
                        onDeleteIdea={(id) => removeIdeaMutation.mutate(id)}
                        onPreviewIdea={(idea) => setWorkflowPreview(workflowPreviewFromIdea(idea))}
                        onSelectIdea={(idea) => {
                          setSelectedIdeaId(idea.id);
                          setRightOpen(true);
                        }}
                        onStatusChange={handleIdeaStatusChange}
                        onStatusFilter={setStatusFilter}
                        onToggleIdeaPin={(id) => toggleIdeaPinMutation.mutate(id)}
                      />
                    ) : null}
                    {activeTab === "Artifacts" ? (
                      <ArtifactsView
                        activeMode={activeMode}
                        canEdit={canEdit}
                        artifacts={scopedArtifacts}
                        selectedArtifactTitle={selectedArtifact?.title}
                        onPreview={setPreviewArtifact}
                        onSelectArtifact={(artifact) => {
                          setSelectedArtifactTitle(artifact.title);
                          setRightOpen(true);
                        }}
                        onShare={() => updateToast("Share options prepared")}
                        onTogglePin={(artifact) =>
                          toggleArtifactPinMutation.mutate({ r2Key: artifact.r2Key, mode: activeMode })
                        }
                      />
                    ) : null}
                    {activeTab === "Decisions" ? (
                      <DecisionView
                        canEdit={canEdit}
                        decisions={scopedDecisions}
                        onDelete={(id) => removeDecisionMutation.mutate(id)}
                        onPreview={(decision) => setWorkflowPreview(workflowPreviewFromDecision(decision))}
                        onSelect={(decision) => {
                          setSelectedDecisionId(decision.id);
                          setRightOpen(true);
                        }}
                        onStatusChange={(id, status) => updateDecisionStatusMutation.mutate({ id, status })}
                        onTogglePin={(id) => toggleWorkflowActionPinMutation.mutate({ kind: "decision", id })}
                      />
                    ) : null}
                    {activeTab === "Approvals" ? (
                      <ApprovalView
                        canEdit={canEdit}
                        approvals={scopedApprovals}
                        onDelete={(id) => removeApprovalMutation.mutate(id)}
                        onPreview={(approval) => setWorkflowPreview(workflowPreviewFromApproval(approval))}
                        onSelect={(approval) => {
                          setSelectedApprovalId(approval.id);
                          setRightOpen(true);
                        }}
                        onStatusChange={(id, status) => updateApprovalStatusMutation.mutate({ id, status })}
                        onTogglePin={(id) => toggleWorkflowActionPinMutation.mutate({ kind: "approval", id })}
                      />
                    ) : null}
                    {activeTab === "Tasks" ? (
                      <TaskView
                        canEdit={canEdit}
                        tasks={scopedTasks}
                        onDelete={(id) => removeTaskMutation.mutate(id)}
                        onStatusChange={(id, status) => updateTaskStatusMutation.mutate({ id, status })}
                        onPreview={(task) => setWorkflowPreview(workflowPreviewFromTask(task))}
                        onSelect={(task) => {
                          setSelectedTaskId(task.id);
                          setRightOpen(true);
                        }}
                        onTogglePin={(id) => toggleWorkflowActionPinMutation.mutate({ kind: "task", id })}
                      />
                    ) : null}
                        {activeTab === "Prompts" ? (
                          <PromptView
                            canEdit={canEdit}
                            prompts={scopedPrompts}
                            onUsePrompt={(prompt) => {
                              setChatInput(prompt);
                              setActiveTab("Chat");
                            }}
                          />
                        ) : null}
                      </section>
                    </>
                  )}

                  {isScopedWorkspaceLoading ? null : canEdit ? (
                    <form
                      ref={chatFormRef}
                      className={cn(
                        "fixed inset-x-3 bottom-3 z-50 grid grid-cols-[minmax(0,1fr)_38px_44px] gap-2 rounded-xl border bg-card/95 p-3 shadow-[0_18px_60px_rgb(15_23_42/0.22)] backdrop-blur transition-[border-color,box-shadow] lg:left-92 xl:left-97",
                        isComposerHighlighted && "border-primary/70 shadow-[0_18px_70px_rgb(0_56_101/0.28),0_0_0_3px_rgb(0_56_101/0.18)]",
                        rightOpen ? "lg:right-104 xl:right-106.5" : "lg:right-18 xl:right-18",
                      )}
                      onSubmit={handleSendMessage}
                    >
                      <div className="col-span-3 flex flex-wrap items-center gap-1.5">
                        <span className="mr-1 inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground">
                          <Zap className="size-3.5" />
                          Reasoning
                        </span>
                        {chatReasoningLevels.map((level) => {
                          const profile = chatReasoningProfiles[level];
                          const isSelected = chatReasoningLevel === level;
                          return (
                            <button
                              key={level}
                              type="button"
                              aria-pressed={isSelected}
                              className={cn(
                                "h-7 rounded-md border px-2 text-xs font-semibold transition-colors",
                                isSelected
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "border-input bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
                              )}
                              title={`${profile.label}: ${profile.maxCompletionTokens.toLocaleString()} tokens, ${Math.round(profile.timeoutMs / 1000)}s timeout`}
                              onClick={() => setChatReasoningLevel(level)}
                            >
                              {profile.shortLabel}
                            </button>
                          );
                        })}
                        <button
                          type="button"
                          aria-pressed={webSearchEnabled}
                          className={cn(
                            "ml-2 inline-flex h-7 items-center gap-1.5 rounded-full border px-2 text-xs font-semibold transition-colors",
                            webSearchEnabled
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-input bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
                          )}
                          title={webSearchEnabled ? "Web search on: fetch current web context before asking VertexAI" : "Web search off: use workspace context and model knowledge only"}
                          onClick={() => setWebSearchEnabled((enabled) => !enabled)}
                        >
                          <span>Web</span>
                          <span
                            aria-hidden="true"
                            className={cn(
                              "relative inline-flex h-4 w-7 items-center rounded-full transition-colors",
                              webSearchEnabled ? "bg-primary-foreground/25" : "bg-muted",
                            )}
                          >
                            <span
                              className={cn(
                                "block size-3 rounded-full bg-current transition-transform",
                                webSearchEnabled ? "translate-x-3.5" : "translate-x-0.5",
                              )}
                            />
                          </span>
                          <span className="w-5 text-left">{webSearchEnabled ? "On" : "Off"}</span>
                        </button>
                        <span className="ml-auto text-xs text-muted-foreground">
                          {chatReasoningProfiles[chatReasoningLevel].maxCompletionTokens.toLocaleString()} tokens / {Math.round(chatReasoningProfiles[chatReasoningLevel].timeoutMs / 1000)}s
                        </span>
                      </div>
                      {chatAttachments.length > 0 ? (
                        <div className="col-span-3 flex flex-wrap gap-1.5">
                          {chatAttachments.map((attachment) => (
                            <span
                              key={attachment.id}
                              className={cn(
                                "inline-flex max-w-full items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs",
                                attachment.status === "error" && "border-destructive/40 bg-destructive/5 text-destructive",
                              )}
                              title={attachment.error ?? `${attachment.name} is ready for Gemma 4 context`}
                            >
                              <FileText className="size-3.5 shrink-0" />
                              <span className="max-w-44 truncate font-medium">{attachment.name}</span>
                              <span className="shrink-0 text-muted-foreground">{attachment.extension.toUpperCase()}</span>
                              <button
                                type="button"
                                className="grid size-4 shrink-0 place-items-center rounded-sm hover:bg-accent"
                                aria-label={`Remove ${attachment.name}`}
                                onClick={() => removeChatAttachment(attachment.id)}
                              >
                                <X className="size-3" />
                              </button>
                            </span>
                          ))}
                        </div>
                      ) : null}
                      <Input
                        aria-label="Ask the PMO assistant"
                        placeholder={`Message VertexAI about ${scopeContextLabel} / ${activeChat?.title ?? "new AI chat"}`}
                        ref={chatInputRef}
                        className={cn(
                          "transition-[background-color,border-color,box-shadow]",
                          isComposerHighlighted && "border-primary bg-primary/5 shadow-[0_0_0_3px_rgb(0_56_101/0.18)]",
                        )}
                        disabled={sendMessageMutation.isPending || isScopedRagStreaming || isExtractingAttachment}
                        value={chatInput}
                        onKeyDown={handleChatInputKeyDown}
                        onChange={(event) => setChatInput(event.target.value)}
                      />
                      <input
                        ref={chatFileInputRef}
                        className="sr-only"
                        type="file"
                        multiple
                        accept=".pdf,.xlsx,.pptx,.docx,.csv,.txt"
                        onChange={(event) => void handleAttachFiles(event.target.files)}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label="Attach file"
                        title="Attach PDF, XLSX, PPTX, DOCX, CSV, or TXT"
                        disabled={sendMessageMutation.isPending || isScopedRagStreaming || isExtractingAttachment}
                        onClick={() => chatFileInputRef.current?.click()}
                      >
                        <Paperclip />
                      </Button>
                      <Button type="button" size="icon" aria-label="Send message" disabled={sendMessageMutation.isPending || isScopedRagStreaming || isExtractingAttachment || (!chatInput.trim() && chatAttachments.every((attachment) => attachment.status === "error"))} onClick={handleChatSubmitButton}>
                        <Send />
                      </Button>
                    </form>
                  ) : (
                    <div
                      className={cn(
                        "fixed inset-x-3 bottom-3 z-50 rounded-xl border bg-card/95 p-3 text-sm text-muted-foreground shadow-[0_18px_60px_rgb(15_23_42/0.22)] backdrop-blur lg:left-92 xl:left-97",
                        rightOpen ? "lg:right-104 xl:right-106.5" : "lg:right-18 xl:right-18",
                      )}
                    >
                      Viewer access is read-only.
                    </div>
                  )}
                </section>

                {rightOpen ? (
                  isScopedWorkspaceLoading ? (
                    <DetailPanelSkeleton />
                  ) : (
                    <DetailPanel
                      activeMode={activeMode}
                      activeTab={activeTab}
                      activeChat={activeChat}
                      artifact={selectedArtifact}
                      approval={selectedApproval}
                      canEdit={canEdit}
                      decision={selectedDecision}
                      idea={selectedIdea}
                      isPinned={selectedIdea ? visibleWorkspace.pinnedIdeaIds.includes(selectedIdea.id) : false}
                      messages={currentMessages}
                      metrics={metrics}
                      prompts={scopedPrompts}
                      scopeContextLabel={scopeContextLabel}
                      task={selectedTask}
                      workspaceTitle={workspaceTitle}
                      onClose={() => setRightOpen(false)}
                      onPreviewArtifact={(artifact) => setPreviewArtifact(artifact)}
                      onRestoreArtifactVersion={(artifactId) =>
                        restoreArtifactMutation.mutate({ mode: activeMode, artifactId })
                      }
                      onShare={() => updateToast("Share link options ready")}
                      onStatusChange={(status) => selectedIdea && updateStatusMutation.mutate({ id: selectedIdea.id, status })}
                      onToggleArtifactPin={() =>
                        selectedArtifact && toggleArtifactPinMutation.mutate({ r2Key: selectedArtifact.r2Key, mode: activeMode })
                      }
                      onToggleIdeaPin={() => selectedIdea && toggleIdeaPinMutation.mutate(selectedIdea.id)}
                      onToggleWorkflowPin={(kind, id) => toggleWorkflowActionPinMutation.mutate({ kind, id })}
                      onDeleteApproval={(id) => removeApprovalMutation.mutate(id)}
                      onDeleteDecision={(id) => removeDecisionMutation.mutate(id)}
                      onDeleteIdea={(id) => removeIdeaMutation.mutate(id)}
                      onDeleteTask={(id) => removeTaskMutation.mutate(id)}
                      onPreviewWorkflow={(preview) => setWorkflowPreview(preview)}
                      onUsePrompt={(prompt) => {
                        setChatInput(prompt);
                        setActiveTab("Chat");
                      }}
                      onVoteIdea={() => selectedIdea && voteIdeaMutation.mutate(selectedIdea.id)}
                    />
                  )
                ) : (
                  <aside className="hidden min-h-0 border-l bg-muted/35 p-2 lg:flex lg:items-start lg:justify-center">
                    <Button type="button" variant="outline" size="icon" aria-label="Open details flyout" title="Open details" onClick={() => setRightOpen(true)}>
                      <PanelRightOpen />
                    </Button>
                  </aside>
                )}
              </>
            ) : (
              isScopedWorkspaceLoading ? (
                <CategoryTablePageSkeleton />
              ) : (
                <CategoryTablePage
                  activeMode={activeMode}
                  canEdit={canEdit}
                  rail={activeRail}
                  workspace={visibleWorkspace}
                  onUsePrompt={(prompt) => {
                    setChatInput(prompt);
                    setActiveRail("Workspaces");
                    setActiveTab("Chat");
                  }}
                />
              )
            )}
          </div>
        </section>

        {toast ? (
          <div className="fixed right-4 bottom-24 z-40 flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-xs font-medium shadow-lg">
            <span className="size-2 rounded-full bg-success" />
            {toast}
            {toastLink ? (
              <a className="font-semibold text-primary underline-offset-4 hover:underline" href={toastLink.href}>
                {toastLink.label}
              </a>
            ) : null}
          </div>
        ) : null}
      </div>

      <TutorialDialog
        canAct={canEdit}
        open={isTutorialOpen}
        stepIndex={tutorialStepIndex}
        steps={tutorialSteps}
        onComplete={completeTutorial}
        onOpenChange={(open) => {
          if (open) {
            setIsTutorialOpen(true);
            return;
          }
          completeTutorial();
        }}
        onStepChange={setTutorialStepIndex}
      />
      {canEdit ? (
        <>
          <AddIdeaDialog
            open={isAddOpen}
            pending={addIdeaMutation.isPending}
            onOpenChange={setIsAddOpen}
            onSubmit={handleAddIdea}
          />
          <CreateTeamDialog
            open={isCreateTeamOpen}
            pending={createTeamMutation.isPending}
            onOpenChange={setIsCreateTeamOpen}
            onSubmit={handleCreateTeamSubmit}
          />
          <CreateProjectDialog
            mode={activeMode}
            open={isCreateProjectOpen}
            pending={createProjectMutation.isPending}
            teamName={activeMode === "Team" ? selectedTeam?.name : undefined}
            onOpenChange={setIsCreateProjectOpen}
            onSubmit={handleCreateProjectSubmit}
          />
          <CreateChatDialog
            contextLabel={createChatState?.section === "project" ? createChatState.projectName ?? "Project" : workspaceModeLabel(activeMode)}
            open={Boolean(createChatState)}
            pending={createChatMutation.isPending}
            section={createChatState?.section ?? "workspace"}
            onOpenChange={(open) => !open && setCreateChatState(null)}
            onSubmit={handleCreateChatSubmit}
          />
        </>
      ) : null}
      <BrandedConfirmDialog
        state={confirmDialog}
        onOpenChange={(open) => {
          if (!open) setConfirmDialog(null);
        }}
      />
      <BrandedInputDialog
        state={inputDialog}
        onOpenChange={(open) => {
          if (!open) setInputDialog(null);
        }}
      />
      <ArtifactPreviewDialog artifact={previewArtifact} onOpenChange={(open) => !open && setPreviewArtifact(null)} />
      <WorkflowPreviewDialog preview={workflowPreview} onOpenChange={(open) => !open && setWorkflowPreview(null)} />
      {import.meta.env.DEV ? <LlmDevtools traces={llmTraces} /> : null}
    </main>
  );
}

function SkeletonBlock({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-md bg-muted", className)} />;
}

function SkeletonRows({ count, className }: { count: number; className?: string }) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <SkeletonBlock key={index} className={className} />
      ))}
    </>
  );
}

function CommandCenterPageSkeleton() {
  return (
    <main className="h-svh overflow-hidden bg-[linear-gradient(135deg,oklch(0.985_0.006_247),oklch(0.955_0.015_240))] p-0 text-foreground lg:p-5">
      <div className="workspace-shadow relative grid h-full overflow-hidden border bg-card lg:grid-cols-[72px_minmax(0,1fr)] lg:rounded-xl">
        <aside className="hidden min-h-0 flex-col items-center gap-3 bg-sidebar px-2 py-5 lg:flex">
          <SkeletonBlock className="mb-4 size-10 bg-white/80" />
          <SkeletonRows count={4} className="size-12 bg-white/15" />
          <div className="flex-1" />
          <SkeletonBlock className="size-10 rounded-full bg-white/15" />
        </aside>
        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-background">
          <header className="grid min-h-16 shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b bg-card px-3 lg:min-h-19.5 lg:grid-cols-[minmax(220px,1fr)_minmax(260px,360px)_auto] lg:px-5">
            <div className="flex min-w-0 items-center gap-3">
              <SkeletonBlock className="size-10 lg:hidden" />
              <SkeletonBlock className="hidden h-7 w-40 sm:block" />
              <SkeletonBlock className="h-6 w-52" />
            </div>
            <SkeletonBlock className="hidden h-9 lg:block" />
            <div className="flex items-center gap-2">
              <SkeletonBlock className="size-9" />
              <SkeletonBlock className="hidden h-9 w-24 md:block" />
            </div>
          </header>
          <section className="shrink-0 border-b bg-card px-3 py-3 lg:px-5">
            <div className="flex min-w-0 flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div className="space-y-2">
                <div className="flex overflow-hidden rounded-md border">
                  <SkeletonRows count={3} className="h-9 w-28 rounded-none" />
                </div>
                <SkeletonBlock className="h-4 w-48" />
              </div>
              <SkeletonBlock className="h-9 w-64" />
            </div>
          </section>
          <div className="grid min-h-0 flex-1 bg-card lg:grid-cols-[260px_minmax(430px,1fr)_minmax(320px,380px)] xl:grid-cols-[280px_minmax(520px,1fr)_390px]">
            <ProjectNavSkeleton />
            <WorkspaceMainSkeleton />
            <DetailPanelSkeleton />
          </div>
        </section>
      </div>
    </main>
  );
}

function ProjectNavSkeleton() {
  return (
    <aside className="scrollbar-thin hidden min-h-0 overflow-auto border-r bg-muted/40 p-3 lg:block">
      <div className="mb-3 flex items-center justify-between px-2">
        <SkeletonBlock className="h-4 w-32" />
        <SkeletonBlock className="size-7" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="space-y-2">
            <SkeletonBlock className="h-9 w-full" />
            <div className="ml-4 space-y-1 border-l pl-3">
              <SkeletonBlock className="h-8 w-11/12" />
              <SkeletonBlock className="h-8 w-9/12" />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-5 flex items-center justify-between px-2">
        <SkeletonBlock className="h-4 w-28" />
        <SkeletonBlock className="size-7" />
      </div>
      <div className="mt-2 space-y-1">
        <SkeletonRows count={3} className="h-9 w-full" />
      </div>
    </aside>
  );
}

function WorkspaceMainSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <section className="shrink-0 border-b bg-card px-4 py-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="space-y-2">
            <SkeletonBlock className="h-3 w-24" />
            <SkeletonBlock className="h-4 w-48" />
          </div>
          <SkeletonBlock className="h-9 w-20" />
        </div>
        <div className="flex gap-2 overflow-hidden">
          <SkeletonRows count={3} className="h-24 min-w-56 flex-1" />
        </div>
      </section>
      <div className="flex shrink-0 gap-1 border-b bg-card px-3 py-2">
        <SkeletonRows count={6} className="h-9 w-24" />
      </div>
      <section className="min-h-0 flex-1 overflow-hidden p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="space-y-2">
            <SkeletonBlock className="h-3 w-28" />
            <SkeletonBlock className="h-7 w-64" />
          </div>
          <SkeletonBlock className="h-9 w-28" />
        </div>
        <div className="space-y-3">
          <SkeletonBlock className="h-11 w-full" />
          <div className="overflow-hidden rounded-lg border bg-card">
            <div className="grid grid-cols-4 gap-3 border-b p-3">
              <SkeletonRows count={4} className="h-4" />
            </div>
            <div className="space-y-3 p-3">
              <SkeletonRows count={6} className="h-12" />
            </div>
          </div>
        </div>
      </section>
      <div className="mx-3 mb-3 grid shrink-0 grid-cols-[minmax(0,1fr)_38px_38px_44px] gap-2 rounded-xl border bg-card/95 p-3 shadow-[0_18px_60px_rgb(15_23_42/0.22)] lg:mx-4">
        <SkeletonBlock className="col-span-4 h-7" />
        <SkeletonBlock className="h-9" />
        <SkeletonBlock className="size-9" />
        <SkeletonBlock className="size-9" />
        <SkeletonBlock className="size-9" />
      </div>
    </div>
  );
}

function DetailPanelSkeleton() {
  return (
    <aside className="scrollbar-thin hidden min-h-0 overflow-auto bg-muted/35 p-4 lg:block">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="space-y-2">
          <SkeletonBlock className="h-3 w-32" />
          <SkeletonBlock className="h-4 w-44" />
        </div>
        <SkeletonBlock className="h-9 w-20" />
      </div>
      <div className="mb-4 grid grid-cols-2 gap-2">
        <SkeletonRows count={4} className="h-28" />
      </div>
      <div className="rounded-lg border bg-card p-4">
        <div className="mb-4 flex items-start gap-3">
          <SkeletonBlock className="size-10" />
          <div className="flex-1 space-y-2">
            <SkeletonBlock className="h-4 w-24" />
            <SkeletonBlock className="h-6 w-full" />
          </div>
        </div>
        <div className="space-y-3">
          <SkeletonBlock className="h-4 w-full" />
          <SkeletonBlock className="h-4 w-10/12" />
          <SkeletonBlock className="h-20 w-full" />
        </div>
      </div>
    </aside>
  );
}

function CategoryTablePageSkeleton() {
  return (
    <section className="scrollbar-thin min-h-0 overflow-auto bg-background p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="space-y-2">
          <SkeletonBlock className="h-3 w-28" />
          <SkeletonBlock className="h-7 w-72" />
        </div>
        <SkeletonBlock className="h-9 w-28" />
      </div>
      <div className="grid gap-4 lg:grid-cols-4">
        <SkeletonRows count={4} className="h-28" />
      </div>
      <div className="mt-4 overflow-hidden rounded-lg border bg-card">
        <div className="grid grid-cols-5 gap-3 border-b p-3">
          <SkeletonRows count={5} className="h-4" />
        </div>
        <div className="space-y-3 p-3">
          <SkeletonRows count={8} className="h-12" />
        </div>
      </div>
    </section>
  );
}

type LlmDevtoolsPane = "request" | "response" | "thinking" | "raw";

function LlmDevtools({ traces }: { traces: LlmDevTrace[] }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [activePane, setActivePane] = useState<LlmDevtoolsPane>("request");
  const resizeStartRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const devtoolsPanelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!selectedTraceId && traces[0]) setSelectedTraceId(traces[0].id);
    if (selectedTraceId && traces.length > 0 && !traces.some((trace) => trace.id === selectedTraceId)) {
      setSelectedTraceId(traces[0].id);
    }
  }, [selectedTraceId, traces]);

  const selectedTrace = traces.find((trace) => trace.id === selectedTraceId) ?? traces[0] ?? null;
  const panes: Array<{ id: LlmDevtoolsPane; label: string }> = [
    { id: "request", label: "Request" },
    { id: "response", label: "Response" },
    { id: "thinking", label: "Thinking" },
    { id: "raw", label: "Raw" },
  ];
  function handleResizeStart(event: PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const panel = devtoolsPanelRef.current;
    resizeStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      width: panel?.offsetWidth ?? 760,
      height: panel?.offsetHeight ?? 520,
    };
  }

  function handleResizeMove(event: PointerEvent<HTMLButtonElement>) {
    const start = resizeStartRef.current;
    if (!start) return;
    const panel = devtoolsPanelRef.current;
    if (!panel) return;
    const width = Math.min(Math.max(start.width + start.x - event.clientX, 340), Math.max(340, window.innerWidth - 32));
    const height = Math.min(Math.max(start.height + start.y - event.clientY, 320), Math.max(320, window.innerHeight - 32));
    panel.style.width = `${width}px`;
    panel.style.height = `${height}px`;
  }

  function handleResizeEnd(event: PointerEvent<HTMLButtonElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    resizeStartRef.current = null;
  }

  if (!isOpen) {
    return (
      <button
        aria-label="Open LLM devtools"
        className="fixed right-4 bottom-4 z-50 grid size-11 place-items-center rounded-md border bg-card text-foreground shadow-lg transition-colors hover:bg-accent"
        type="button"
        onClick={() => {
          setIsOpen(true);
          setIsMinimized(false);
        }}
      >
        <Bug className="size-5" />
      </button>
    );
  }

  if (isMinimized) {
    return (
      <div className="fixed right-4 bottom-4 z-50 flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-xs font-semibold shadow-lg">
        <Bug className="size-4" />
        <span>LLM Devtools</span>
        {traces.length ? <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">{traces.length}</span> : null}
        <Button type="button" variant="ghost" size="icon" aria-label="Restore LLM devtools" onClick={() => setIsMinimized(false)}>
          <Maximize2 className="size-4" />
        </Button>
        <Button type="button" variant="ghost" size="icon" aria-label="Close LLM devtools" onClick={() => setIsOpen(false)}>
          <X className="size-4" />
        </Button>
      </div>
    );
  }

  return (
    <section
      ref={devtoolsPanelRef}
      aria-label="LLM devtools"
      className="fixed right-4 bottom-4 z-50 flex h-[520px] max-h-[calc(100vh-2rem)] min-h-80 w-[760px] max-w-[calc(100vw-2rem)] min-w-85 flex-col overflow-hidden rounded-md border bg-card text-card-foreground shadow-2xl"
    >
      <button
        aria-label="Resize LLM devtools"
        className="absolute left-0 top-0 z-10 grid size-7 cursor-nwse-resize place-items-center rounded-br-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        type="button"
        onPointerDown={handleResizeStart}
        onPointerMove={handleResizeMove}
        onPointerUp={handleResizeEnd}
        onPointerCancel={handleResizeEnd}
      >
        <Maximize2 className="size-3 -rotate-90" />
      </button>
      <header className="flex items-center gap-3 border-b bg-muted/60 py-2 pl-8 pr-3">
        <Bug className="size-4 text-primary" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">LLM Devtools</h2>
          <p className="truncate text-xs text-muted-foreground">
            {selectedTrace ? `${selectedTrace.model} / ${selectedTrace.chatTitle} / ${selectedTrace.durationMs}ms` : "No LLM calls captured yet"}
          </p>
        </div>
        <Button type="button" variant="ghost" size="icon" aria-label="Minimize LLM devtools" onClick={() => setIsMinimized(true)}>
          <Minimize2 className="size-4" />
        </Button>
        <Button type="button" variant="ghost" size="icon" aria-label="Close LLM devtools" onClick={() => setIsOpen(false)}>
          <X className="size-4" />
        </Button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)]">
        <aside className="min-h-0 overflow-y-auto border-r bg-muted/25 p-2">
          {traces.length ? (
            traces.map((trace) => (
              <button
                className={cn(
                  "mb-2 block w-full rounded-md border bg-background p-2 text-left text-xs transition-colors hover:border-primary/50",
                  selectedTrace?.id === trace.id && "border-primary bg-accent/60",
                )}
                key={trace.id}
                type="button"
                onClick={() => setSelectedTraceId(trace.id)}
              >
                <span className="block truncate font-semibold">{trace.chatTitle}</span>
                <span className="block truncate text-muted-foreground">{new Date(trace.timestamp).toLocaleTimeString()} / {trace.durationMs}ms</span>
                {trace.error ? <span className="mt-1 block truncate text-destructive">{trace.error}</span> : null}
              </button>
            ))
          ) : (
            <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">Send a chat message to capture the Gemma request and response.</p>
          )}
        </aside>

        <div className="flex min-h-0 flex-col">
          <div className="flex flex-wrap gap-1 border-b p-2">
            {panes.map((pane) => (
              <button
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                  activePane === pane.id && "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
                )}
                key={pane.id}
                type="button"
                onClick={() => setActivePane(pane.id)}
              >
                {pane.label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-3">
            {selectedTrace ? <LlmDevtoolsPaneContent pane={activePane} trace={selectedTrace} /> : <p className="text-sm text-muted-foreground">No trace selected.</p>}
          </div>
        </div>
      </div>
    </section>
  );
}

function LlmDevtoolsPaneContent({ pane, trace }: { pane: LlmDevtoolsPane; trace: LlmDevTrace }) {
  if (pane === "request") {
    return (
      <div className="space-y-3">
        {trace.request.messages.map((message, index) => (
          <article className="rounded-md border bg-background p-3" key={`${message.role}-${index}`}>
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="rounded bg-muted px-2 py-1 text-xs font-semibold uppercase text-muted-foreground">{message.role}</span>
              <span className="text-xs text-muted-foreground">{message.content.length.toLocaleString()} chars</span>
            </div>
            <pre className="whitespace-pre-wrap wrap-break-word font-mono text-xs leading-relaxed">{message.content}</pre>
          </article>
        ))}
        <pre className="rounded-md border bg-muted/30 p-3 font-mono text-xs">{JSON.stringify({
          max_completion_tokens: trace.request.max_completion_tokens,
          reasoningLevel: trace.request.reasoningLevel,
          reasoning_effort: trace.request.reasoning_effort,
          webSearch: trace.webSearch,
          timeoutMs: trace.request.timeoutMs,
          temperature: trace.request.temperature,
        }, null, 2)}</pre>
      </div>
    );
  }

  if (pane === "response") {
    return (
      <div className="space-y-3">
        <LlmTraceDiagnostics trace={trace} />
        <pre className="whitespace-pre-wrap wrap-break-word rounded-md border bg-background p-3 font-mono text-xs leading-relaxed">{trace.responseText}</pre>
      </div>
    );
  }

  if (pane === "thinking") {
    return (
      <div className="space-y-3">
        <LlmTraceDiagnostics trace={trace} />
        {trace.thinkingText ? (
          <pre className="whitespace-pre-wrap wrap-break-word rounded-md border bg-background p-3 font-mono text-xs italic leading-relaxed">{trace.thinkingText}</pre>
        ) : (
          <p className="rounded-md border border-dashed p-3 text-sm italic text-muted-foreground">No thinking or reasoning field was returned by this model response.</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <LlmTraceDiagnostics trace={trace} />
      <pre className="whitespace-pre-wrap wrap-break-word rounded-md border bg-background p-3 font-mono text-xs leading-relaxed">{JSON.stringify(trace.rawResponse, null, 2)}</pre>
    </div>
  );
}

function LlmTraceDiagnostics({ trace }: { trace: LlmDevTrace }) {
  return (
    <div className="grid gap-2 rounded-md border bg-muted/30 p-3 text-xs sm:grid-cols-2">
      <span>
        <strong className="block text-muted-foreground">Finish reason</strong>
        {trace.diagnostics.finishReason ?? "Not returned"}
      </span>
      <span>
        <strong className="block text-muted-foreground">Duration</strong>
        {trace.durationMs}ms
      </span>
      <span>
        <strong className="block text-muted-foreground">Response chars</strong>
        {trace.diagnostics.responseTextChars.toLocaleString()}
      </span>
      <span>
        <strong className="block text-muted-foreground">Thinking chars</strong>
        {trace.diagnostics.thinkingTextChars.toLocaleString()}
      </span>
      <span className="sm:col-span-2">
        <strong className="block text-muted-foreground">Web search</strong>
        {trace.webSearch?.enabled ? `${trace.webSearch.provider}: ${trace.webSearch.results.length} result${trace.webSearch.results.length === 1 ? "" : "s"}${trace.webSearch.error ? ` (${trace.webSearch.error})` : ""}` : "Off"}
      </span>
      <span className="sm:col-span-2">
        <strong className="block text-muted-foreground">Usage</strong>
        {trace.diagnostics.usage ? (
          <code className="wrap-break-word">{JSON.stringify(trace.diagnostics.usage)}</code>
        ) : (
          "Not returned"
        )}
      </span>
      {trace.diagnostics.finishReason === "length" ? (
        <span className="rounded-md border border-warning/40 bg-warning/10 p-2 text-warning sm:col-span-2">
          The model stopped because the completion token limit was reached.
        </span>
      ) : (
        null
      )}
    </div>
  );
}

function PrimaryRail({
  activeRail,
  canAdmin,
  showTokenUsage,
  userEmail,
  userName,
  onRailClick,
  onShowTokenUsageChange,
  onSignOut,
  onStartTutorial,
}: {
  activeRail: RailName;
  canAdmin: boolean;
  showTokenUsage: boolean;
  userEmail: string;
  userName: string;
  onRailClick: (rail: RailName) => void;
  onShowTokenUsageChange: (value: boolean) => void;
  onSignOut: () => void;
  onStartTutorial: () => void;
}) {
  return (
    <AppRail
      account={{
        canAdmin,
        showTokenUsage,
        userEmail,
        userName,
        onShowTokenUsageChange,
        onSignOut,
        onStartTutorial,
      }}
      activeItem={activeRail === "Workspaces" || activeRail === "Chats" || activeRail === "Ideas" || activeRail === "Artifacts" ? activeRail : undefined}
      onRailClick={onRailClick}
    />
  );
}

function Topbar({
  canAdmin,
  presenceUsers,
  searchTerm,
  showTokenUsage,
  userEmail,
  userName,
  onMobileMenu,
  onNotify,
  onSearchTerm,
  onShowTokenUsageChange,
  onSignOut,
  onStartTutorial,
}: {
  canAdmin: boolean;
  presenceUsers: WorkspacePresenceUser[];
  searchTerm: string;
  showTokenUsage: boolean;
  userEmail: string;
  userName: string;
  onMobileMenu: () => void;
  onNotify: () => void;
  onSearchTerm: (value: string) => void;
  onShowTokenUsageChange: (value: boolean) => void;
  onSignOut: () => void;
  onStartTutorial: () => void;
}) {
  return (
    <header className="grid min-h-16 shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b bg-card px-3 lg:min-h-19.5 lg:grid-cols-[minmax(200px,1fr)_minmax(340px,460px)_auto] lg:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <Button className="lg:hidden" type="button" variant="outline" size="icon" aria-label="Open menu" onClick={onMobileMenu}>
          <Menu />
        </Button>
        <img alt="Vertex Education" className="hidden h-7 w-auto sm:block" src="/vertex-horizontal.svg" />
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold lg:text-xl">AI Command Center</h1>
        </div>
      </div>
      <div className="hidden min-w-0 items-center justify-end gap-3 lg:flex">
        <WorkspacePresence users={presenceUsers} />
        <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border bg-background px-3 text-muted-foreground">
          <Search className="size-4" />
          <Input
            className="h-7 border-0 px-0 shadow-none focus-visible:ring-0"
            placeholder="Search ideas, artifacts, owners"
            value={searchTerm}
            onChange={(event) => onSearchTerm(event.target.value)}
          />
        </label>
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="icon" aria-label="Notifications" onClick={onNotify}>
          <Bell />
        </Button>
        <Button type="button" variant="outline" className="hidden md:inline-flex">
          <Users />
          AI Ops
        </Button>
        <div className="lg:hidden">
          <AccountMenu
            align="topbar"
            canAdmin={canAdmin}
            showTokenUsage={showTokenUsage}
            userEmail={userEmail}
            userName={userName}
            onShowTokenUsageChange={onShowTokenUsageChange}
            onSignOut={onSignOut}
            onStartTutorial={onStartTutorial}
          />
        </div>
      </div>
    </header>
  );
}

const presenceSwatches = [
  "border-primary/25 bg-primary text-primary-foreground",
  "border-success/25 bg-success text-success-foreground",
  "border-warning/25 bg-warning text-warning-foreground",
  "border-accent-foreground/15 bg-accent text-accent-foreground",
];

function WorkspacePresence({ users }: { users: WorkspacePresenceUser[] }) {
  const [isOpen, setIsOpen] = useState(false);
  const visibleUsers = users.slice(0, 3);
  const overflowUsers = users.slice(3);

  if (users.length === 0) {
    return (
      <div className="flex h-9 items-center gap-1" aria-label="No active workspace users">
        <span className="size-2 rounded-full bg-muted-foreground/40" />
      </div>
    );
  }

  return (
    <div className="relative flex h-9 shrink-0 items-center gap-1.5" aria-label={`${users.length} active workspace user${users.length === 1 ? "" : "s"}`}>
      <div className="flex -space-x-2">
        {visibleUsers.map((user, index) => (
          <WorkspacePresenceAvatar key={user.id} user={user} swatch={presenceSwatches[index % presenceSwatches.length]} />
        ))}
      </div>
      {overflowUsers.length > 0 ? (
        <>
          <button
            type="button"
            className="grid h-7 min-w-7 place-items-center rounded-full border bg-background px-1.5 text-xs font-semibold text-muted-foreground shadow-xs hover:bg-accent hover:text-foreground"
            aria-expanded={isOpen}
            aria-haspopup="menu"
            aria-label={`Show ${overflowUsers.length} more active user${overflowUsers.length === 1 ? "" : "s"}`}
            onClick={() => setIsOpen((open) => !open)}
          >
            +{overflowUsers.length}
          </button>
          {isOpen ? (
            <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-64 rounded-md border bg-popover p-2 text-popover-foreground shadow-lg" role="menu">
              <p className="px-2 pb-2 text-xs font-semibold text-muted-foreground">Also active now</p>
              <div className="space-y-1">
                {overflowUsers.map((user, index) => (
                  <div key={user.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm" role="menuitem">
                    <WorkspacePresenceAvatar user={user} swatch={presenceSwatches[(index + 3) % presenceSwatches.length]} />
                    <div className="min-w-0">
                      <p className="truncate font-medium">{user.name}</p>
                      {user.email ? <p className="truncate text-xs text-muted-foreground">{user.email}</p> : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function WorkspacePresenceAvatar({ user, swatch }: { user: WorkspacePresenceUser; swatch: string }) {
  return (
    <span className="group relative inline-grid size-7 place-items-center rounded-full border-2 border-card">
      <span className={cn("grid size-7 place-items-center rounded-full text-[10px] font-bold shadow-xs", swatch)}>
        {initials(user.name || user.email || "User")}
      </span>
      <span className="pointer-events-none absolute top-[calc(100%+8px)] z-50 max-w-48 truncate rounded-md border bg-popover px-2 py-1 text-xs font-medium text-popover-foreground opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
        {user.name}
      </span>
    </span>
  );
}

function AccountMenu({
  align,
  canAdmin,
  showTokenUsage,
  userEmail,
  userName,
  onShowTokenUsageChange,
  onSignOut,
  onStartTutorial,
}: {
  align: "rail" | "topbar";
  canAdmin: boolean;
  showTokenUsage: boolean;
  userEmail: string;
  userName: string;
  onShowTokenUsageChange: (value: boolean) => void;
  onSignOut: () => void;
  onStartTutorial: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const displayName = userName || userEmail;
  const userInitials = initials(displayName || userEmail);

  function runMenuAction(action: () => void) {
    setIsOpen(false);
    action();
  }

  return (
    <div className="relative">
      <button
        type="button"
        className={cn(
          "grid size-10 place-items-center rounded-full border text-sm font-semibold transition-colors",
          align === "rail"
            ? "border-white/30 bg-white/10 text-white hover:bg-white/20"
            : "border-input bg-background text-foreground shadow-xs hover:bg-accent",
        )}
        aria-haspopup="menu"
        aria-label="Open user menu"
        title={userEmail}
        onClick={() => setIsOpen((value) => !value)}
      >
        {userInitials}
      </button>

      {isOpen ? (
        <div
          className={cn(
            "absolute z-50 w-72 rounded-md border bg-popover p-2 text-popover-foreground shadow-lg",
            align === "rail" ? "bottom-0 left-[calc(100%+12px)]" : "right-0 top-[calc(100%+8px)]",
          )}
          role="menu"
        >
          <div className="mb-2 flex items-center gap-3 rounded-md bg-muted/60 p-3">
            <div className="grid size-10 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
              {userInitials}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{displayName}</p>
              <p className="truncate text-xs text-muted-foreground">{userEmail}</p>
            </div>
          </div>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent"
            role="menuitem"
            onClick={() => runMenuAction(() => (window.location.href = "/profile"))}
          >
            <Settings className="size-4" />
            User settings
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent"
            role="menuitem"
            onClick={() => runMenuAction(onStartTutorial)}
          >
            <CheckCircle2 className="size-4" />
            Relaunch tutorial
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent"
            role="menuitem"
            onClick={() => runMenuAction(() => (window.location.href = "/profile/password"))}
          >
            <KeyRound className="size-4" />
            Reset password
          </button>
          {canAdmin ? (
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent"
              role="menuitem"
              onClick={() => runMenuAction(() => (window.location.href = "/admin/users"))}
            >
              <ShieldCheck className="size-4" />
              Admin
            </button>
          ) : null}
          <div className="my-2 border-t" />
          <label className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-accent">
            <span className="flex items-center gap-2">
              <Zap className="size-4" />
              Show token usage
            </span>
            <input
              checked={showTokenUsage}
              className="sr-only"
              type="checkbox"
              onChange={(event) => onShowTokenUsageChange(event.target.checked)}
            />
            <span
              className={cn(
                "flex h-5 w-9 items-center rounded-full border p-0.5 transition-colors",
                showTokenUsage ? "border-primary bg-primary" : "border-input bg-muted",
              )}
            >
              <span
                className={cn(
                  "size-3.5 rounded-full bg-background shadow-sm transition-transform",
                  showTokenUsage && "translate-x-4",
                )}
              />
            </span>
          </label>
          <div className="my-2 border-t" />
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-destructive hover:bg-destructive/10"
            role="menuitem"
            onClick={() => runMenuAction(onSignOut)}
          >
            <LogOut className="size-4" />
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Contextbar({
  activeMode,
  activeTeamId,
  breadcrumbLabel,
  canEdit,
  showScopeTabs,
  teams,
  onCreateTeam,
  onInviteTeam,
  onModeChange,
  onTeamChange,
}: {
  activeMode: WorkspaceMode;
  activeTeamId: string;
  breadcrumbLabel: string;
  canEdit: boolean;
  showScopeTabs: boolean;
  teams: TeamSummary[];
  onCreateTeam: () => void;
  onInviteTeam: (team: TeamSummary) => void;
  onModeChange: (mode: WorkspaceMode) => void;
  onTeamChange: (teamId: string) => void;
}) {
  const selectedTeam = teams.find((team) => team.id === activeTeamId);

  return (
    <section className="shrink-0 border-b bg-card px-3 py-3 lg:px-5">
      <div className="flex min-w-0 flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0 space-y-2">
          {showScopeTabs ? (
            <div className="flex w-full overflow-hidden rounded-md border md:w-fit">
              {workspaceModes.map((mode) => (
                <button
                  className={cn(
                    "h-9 min-w-0 flex-1 px-3 text-xs font-medium text-muted-foreground transition-colors md:min-w-28",
                    activeMode === mode && "bg-primary text-primary-foreground",
                  )}
                  key={mode}
                  type="button"
                  onClick={() => onModeChange(mode)}
                >
                  {workspaceModeLabel(mode)}
                </button>
              ))}
            </div>
          ) : null}
          <div className="min-w-0 truncate text-xs font-medium text-muted-foreground">
            Location / {breadcrumbLabel}
          </div>
        </div>
        {activeMode === "Team" ? (
          <div className="flex min-w-0 flex-wrap items-center gap-2 md:justify-end">
            <Label className="text-xs font-semibold uppercase text-muted-foreground" htmlFor="team-select">
              Team
            </Label>
            <select
              id="team-select"
              aria-label="Select team"
              title="Select team"
              className="h-9 min-w-56 rounded-md border bg-background px-3 text-sm"
              value={activeTeamId}
              onChange={(event) => onTeamChange(event.target.value)}
            >
              {teams.length === 0 ? <option value="">No teams assigned</option> : null}
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
            {canEdit ? (
              <>
                <Button type="button" variant="outline" size="sm" onClick={onCreateTeam}>
                  <Plus />
                  New team
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!selectedTeam}
                  onClick={() => selectedTeam && onInviteTeam(selectedTeam)}
                >
                  <Users />
                  Invite user
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ProjectNav({
  activeChatId,
  activeChatSection,
  activeMode,
  activeProjectId,
  canEdit,
  workspace,
  onAddProjectChat,
  onChatSelect,
  onCreateProject,
  onDeleteChat,
  onDeleteProject,
  onInviteProject,
  onOpenWorkspaceChat,
  onProjectSelect,
  onRenameChat,
}: {
  activeChatId: string;
  activeChatSection: ChatSection;
  activeMode: WorkspaceMode;
  activeProjectId: string;
  canEdit: boolean;
  workspace: ScopedWorkspaceState;
  onAddProjectChat: (project: ProjectSummary) => void;
  onChatSelect: (section: ChatSection, chatId: string) => void;
  onCreateProject: () => void;
  onDeleteChat: (input: { chat: ChatSummary; project?: ProjectSummary; section: ChatSection }) => void;
  onDeleteProject: (project: ProjectSummary) => void;
  onInviteProject: (project: ProjectSummary) => void;
  onOpenWorkspaceChat: () => void;
  onProjectSelect: (project: ProjectSummary) => void;
  onRenameChat: (input: { chat: ChatSummary; project?: ProjectSummary; section: ChatSection }) => void;
}) {
  const showProjectInvite = activeMode === "Team" || activeMode === "Org";

  return (
    <aside className="scrollbar-thin hidden min-h-0 overflow-auto border-r bg-muted/40 p-3 lg:block">
      <div className="mb-2 flex items-center justify-between px-2 text-xs font-semibold uppercase text-muted-foreground">
        <span>{workspace.projectsHeading}</span>
        {canEdit ? (
          <button
            aria-label={`Create ${workspace.projectsHeading}`}
            className="grid size-7 place-items-center rounded-md hover:bg-accent hover:text-accent-foreground"
            type="button"
            onClick={onCreateProject}
          >
            <Plus className="size-4" />
          </button>
        ) : null}
      </div>
      {workspace.projects.map((project) => (
        <div className="mb-2" key={project.id}>
          <div className="group/project-row relative flex items-center gap-1">
            <button
              className={cn(
                "flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                project.id === activeProjectId && "bg-accent text-accent-foreground font-medium",
              )}
              type="button"
              onClick={() => onProjectSelect(project)}
            >
              {project.id === activeProjectId ? <FolderOpen className="size-4" /> : <Folder className="size-4" />}
              <span className="min-w-0 flex-1 truncate">{project.name}</span>
            </button>
            {canEdit ? (
              <details className="group relative opacity-0 transition-opacity focus-within:opacity-100 group-hover/project-row:opacity-100">
                <summary className="grid size-8 cursor-pointer list-none place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground">
                  <MoreHorizontal className="size-4" />
                </summary>
                <div className="absolute right-0 z-20 mt-1 w-44 rounded-md border bg-popover p-1 text-popover-foreground shadow-lg">
                  <div className="flex items-center gap-2 px-2 py-1.5 text-xs font-semibold uppercase text-muted-foreground">
                    <ShieldCheck className="size-3.5" />
                    Project
                  </div>
                  <button
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                    type="button"
                    onClick={() => onAddProjectChat(project)}
                  >
                    <MessageCircle className="size-4" />
                    New chat
                  </button>
                  {showProjectInvite ? (
                    <button
                      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                      type="button"
                      onClick={() => onInviteProject(project)}
                    >
                      <Users className="size-4" />
                      Invite user
                    </button>
                  ) : null}
                  <button
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10"
                    type="button"
                    onClick={() => onDeleteProject(project)}
                  >
                    <Trash2 className="size-4" />
                    Delete project
                  </button>
                </div>
              </details>
            ) : null}
          </div>
          <div className="mt-1 ml-4 space-y-1 border-l pl-3">
            {project.projectChats.map((chat) => (
              <div className="group/chat-row relative flex items-center gap-1" key={chat.id}>
                <button
                  className={cn(
                    "flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                    activeChatSection === "project" && chat.id === activeChatId && "bg-card text-primary shadow-xs",
                  )}
                  type="button"
                  onClick={() => onChatSelect("project", chat.id)}
                >
                  <MessageCircle className="size-4" />
                  <span className="min-w-0 flex-1 truncate" title={chat.title}>{chat.title}</span>
                </button>
                {canEdit ? (
                  <details className="group relative opacity-0 transition-opacity focus-within:opacity-100 group-hover/chat-row:opacity-100">
                    <summary className="grid size-7 cursor-pointer list-none place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground">
                      <MoreHorizontal className="size-4" />
                    </summary>
                    <div className="absolute right-0 z-20 mt-1 w-40 rounded-md border bg-popover p-1 text-popover-foreground shadow-lg">
                      <button
                        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                        type="button"
                        onClick={() => onRenameChat({ chat, project, section: "project" })}
                      >
                        <Pencil className="size-4" />
                        Rename chat
                      </button>
                      <button
                        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10"
                        type="button"
                        onClick={() => onDeleteChat({ chat, project, section: "project" })}
                      >
                        <Trash2 className="size-4" />
                        Delete chat
                      </button>
                    </div>
                  </details>
                ) : null}
              </div>
            ))}
            {project.projectChats.length === 0 ? (
              <div className="px-2 py-1 text-xs text-muted-foreground">No project chats yet.</div>
            ) : null}
          </div>
        </div>
      ))}
      {workspace.projects.length === 0 ? (
        <div className="rounded-md border border-dashed bg-card px-3 py-4 text-sm text-muted-foreground">
          No assigned projects yet.
        </div>
      ) : null}

      <div className="mt-5 flex items-center justify-between px-2 text-xs font-semibold uppercase text-muted-foreground">
        <span>{workspace.workspaceChatsHeading}</span>
        {canEdit ? (
          <button
            aria-label={`Open ${workspace.workspaceChatsHeading} composer`}
            className="grid size-7 place-items-center rounded-md hover:bg-accent hover:text-accent-foreground"
            type="button"
            onClick={onOpenWorkspaceChat}
          >
            <Plus className="size-4" />
          </button>
        ) : null}
      </div>
      <div className="mt-2 space-y-1">
        {workspace.workspaceChats.map((chat) => (
          <div className="group/chat-row relative flex items-center gap-1" key={chat.id}>
            <button
              className={cn(
                "flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                activeChatSection === "workspace" && chat.id === activeChatId && "bg-card text-primary shadow-xs",
              )}
              type="button"
              onClick={() => onChatSelect("workspace", chat.id)}
            >
              <MessageCircle className="size-4" />
              <span className="min-w-0 flex-1 truncate" title={chat.title}>{chat.title}</span>
            </button>
            {canEdit ? (
              <details className="group relative opacity-0 transition-opacity focus-within:opacity-100 group-hover/chat-row:opacity-100">
                <summary className="grid size-8 cursor-pointer list-none place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground">
                  <MoreHorizontal className="size-4" />
                </summary>
                <div className="absolute right-0 z-20 mt-1 w-40 rounded-md border bg-popover p-1 text-popover-foreground shadow-lg">
                  <button
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                    type="button"
                    onClick={() => onRenameChat({ chat, section: "workspace" })}
                  >
                    <Pencil className="size-4" />
                    Rename chat
                  </button>
                  <button
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10"
                    type="button"
                    onClick={() => onDeleteChat({ chat, section: "workspace" })}
                  >
                    <Trash2 className="size-4" />
                    Delete chat
                  </button>
                </div>
              </details>
            ) : null}
          </div>
        ))}
        {workspace.workspaceChats.length === 0 ? (
          <div className="rounded-md border border-dashed bg-card px-3 py-3 text-sm text-muted-foreground">
            No workspace chats yet.
          </div>
        ) : null}
      </div>
    </aside>
  );
}

function PinnedStrip({
  artifacts,
  approvals,
  decisions,
  ideas,
  tasks,
  onSelectArtifact,
  onSelectApproval,
  onSelectDecision,
  onSelectIdea,
  onSelectTask,
}: {
  artifacts: Artifact[];
  approvals: Approval[];
  decisions: Decision[];
  ideas: Idea[];
  tasks: Task[];
  onSelectArtifact: (artifact: Artifact) => void;
  onSelectApproval: (approval: Approval) => void;
  onSelectDecision: (decision: Decision) => void;
  onSelectIdea: (idea: Idea) => void;
  onSelectTask: (task: Task) => void;
}) {
  const hasPinnedItems = ideas.length > 0 || artifacts.length > 0 || approvals.length > 0 || decisions.length > 0 || tasks.length > 0;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollControls, setScrollControls] = useState({
    canScrollLeft: false,
    canScrollRight: false,
  });

  function updateScrollControls() {
    const container = scrollRef.current;
    if (!container) return;
    const maxScroll = container.scrollWidth - container.clientWidth;
    setScrollControls({
      canScrollLeft: container.scrollLeft > 1,
      canScrollRight: maxScroll - container.scrollLeft > 1,
    });
  }

  useEffect(() => {
    updateScrollControls();
    const container = scrollRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver(updateScrollControls);
    resizeObserver.observe(container);
    container.addEventListener("scroll", updateScrollControls, { passive: true });
    window.addEventListener("resize", updateScrollControls);

    return () => {
      resizeObserver.disconnect();
      container.removeEventListener("scroll", updateScrollControls);
      window.removeEventListener("resize", updateScrollControls);
    };
  }, [approvals.length, artifacts.length, decisions.length, ideas.length, tasks.length]);

  function scrollPinnedItems(direction: -1 | 1) {
    const container = scrollRef.current;
    if (!container) return;
    const cards = Array.from(container.querySelectorAll<HTMLElement>("[data-pinned-card='true']"));
    if (cards.length === 0) return;

    const currentLeft = container.scrollLeft;
    const currentRight = currentLeft + container.clientWidth;
    const maxScroll = container.scrollWidth - container.clientWidth;
    let nextCard: HTMLElement | undefined;
    if (direction === 1) {
      nextCard = cards.find((card) => card.offsetLeft + card.offsetWidth > currentRight + 1);
    } else {
      for (let index = cards.length - 1; index >= 0; index -= 1) {
        if (cards[index].offsetLeft < currentLeft - 1) {
          nextCard = cards[index];
          break;
        }
      }
    }
    const nextLeft = nextCard ? Math.min(nextCard.offsetLeft, maxScroll) : direction === 1 ? maxScroll : 0;
    container.scrollTo({ left: nextLeft, behavior: "smooth" });
  }

  return (
    <section className="shrink-0 border-b bg-card px-4 py-3">
      <SectionHeader
        eyebrow="Pinned Items"
        description="Quick access for the current view."
        size="sm"
      />
      <div className="flex items-stretch gap-2">
        {hasPinnedItems && scrollControls.canScrollLeft ? (
          <Button type="button" variant="outline" size="icon" className="h-auto min-h-20 shrink-0 self-stretch" aria-label="Previous pinned items" title="Previous pinned items" onClick={() => scrollPinnedItems(-1)}>
            <ChevronLeft className="size-4" />
          </Button>
        ) : null}
        <div ref={scrollRef} className="scrollbar-thin flex min-w-0 flex-1 snap-x snap-mandatory gap-2 overflow-x-auto scroll-smooth pb-1">
          {!hasPinnedItems ? (
            <div className="grid min-h-24 w-full place-items-center rounded-lg border border-dashed bg-background p-4 text-center text-sm text-muted-foreground">
              No pinned items in this scope.
            </div>
          ) : null}
          {ideas.map((idea) => (
            <button
              data-pinned-card="true"
              className="grid min-h-20 w-56 shrink-0 snap-start gap-1.5 rounded-md border bg-background p-2.5 text-left hover:border-primary/40 hover:bg-accent/30"
              key={idea.id}
              type="button"
              onClick={() => onSelectIdea(idea)}
            >
              <StatusBadge status={idea.status} />
              <strong className="line-clamp-2 text-sm leading-snug">{idea.title}</strong>
              <span className="line-clamp-1 text-xs text-muted-foreground">{idea.summary}</span>
            </button>
          ))}
          {approvals.map((approval) => (
            <button
              data-pinned-card="true"
              className="grid min-h-20 w-56 shrink-0 snap-start grid-cols-[28px_minmax(0,1fr)] gap-2 rounded-md border bg-background p-2.5 text-left hover:border-primary/40 hover:bg-accent/30"
              key={approval.id}
              type="button"
              onClick={() => onSelectApproval(approval)}
            >
              <span className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground">
                <ShieldCheck className="size-4" />
              </span>
              <span className="min-w-0">
                <strong className="line-clamp-2 text-sm leading-snug">{approval.title}</strong>
                <em className="mt-0.5 block text-xs not-italic text-muted-foreground">Approval / {approval.status}</em>
              </span>
            </button>
          ))}
          {decisions.map((decision) => (
            <button
              data-pinned-card="true"
              className="grid min-h-20 w-56 shrink-0 snap-start grid-cols-[28px_minmax(0,1fr)] gap-2 rounded-md border bg-background p-2.5 text-left hover:border-primary/40 hover:bg-accent/30"
              key={decision.id}
              type="button"
              onClick={() => onSelectDecision(decision)}
            >
              <span className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground">
                <ClipboardList className="size-4" />
              </span>
              <span className="min-w-0">
                <strong className="line-clamp-2 text-sm leading-snug">{decision.title}</strong>
                <em className="mt-0.5 block text-xs not-italic text-muted-foreground">Decision / {decision.status}</em>
              </span>
            </button>
          ))}
          {tasks.map((task) => (
            <button
              data-pinned-card="true"
              className="grid min-h-20 w-56 shrink-0 snap-start grid-cols-[28px_minmax(0,1fr)] gap-2 rounded-md border bg-background p-2.5 text-left hover:border-primary/40 hover:bg-accent/30"
              key={task.id}
              type="button"
              onClick={() => onSelectTask(task)}
            >
              <span className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground">
                <CheckCircle2 className="size-4" />
              </span>
              <span className="min-w-0">
                <strong className="line-clamp-2 text-sm leading-snug">{task.title}</strong>
                <em className="mt-0.5 block text-xs not-italic text-muted-foreground">Task / {task.status}</em>
              </span>
            </button>
          ))}
          {artifacts.map((artifact) => (
            <button
              data-pinned-card="true"
              className="grid min-h-20 w-56 shrink-0 snap-start grid-cols-[28px_minmax(0,1fr)] gap-2 rounded-md border bg-background p-2.5 text-left hover:border-primary/40 hover:bg-accent/30"
              key={artifact.title}
              type="button"
              onClick={() => onSelectArtifact(artifact)}
            >
              <span className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground">
                {artifactIcon(artifact.type)}
              </span>
              <span className="min-w-0">
                <strong className="line-clamp-2 text-sm leading-snug">{artifact.title}</strong>
                <em className="mt-0.5 block text-xs not-italic text-muted-foreground">
                  {artifact.type} / {artifact.status}
                </em>
              </span>
            </button>
          ))}
        </div>
        {hasPinnedItems && scrollControls.canScrollRight ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-auto min-h-20 shrink-0 self-stretch"
            aria-label="Next pinned items"
            title="Next pinned items"
            onClick={() => scrollPinnedItems(1)}
          >
            <ChevronRight className="size-4" />
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function ScopeTabs({
  activeTab,
  onTabChange,
}: {
  activeTab: TabName;
  onTabChange: (tab: TabName) => void;
}) {
  return (
    <section className="shrink-0 border-b bg-background px-4">
      <SectionHeader
        eyebrow="Your Workspace"
        description="Work across chats, ideas, artifacts, and actions in the selected scope."
      />
      <div className="scrollbar-thin flex h-12 items-end gap-4 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            className={cn(
              "h-12 whitespace-nowrap border-b-2 border-transparent text-sm font-medium text-muted-foreground",
              tab === activeTab && "border-primary text-primary",
            )}
            key={tab}
            type="button"
            onClick={() => onTabChange(tab)}
          >
            {tab}
          </button>
        ))}
      </div>
    </section>
  );
}

function SectionHeader({
  actions,
  description,
  eyebrow,
  size = "default",
  title,
}: {
  actions?: ReactNode;
  description?: string;
  eyebrow: string;
  size?: "default" | "sm";
  title?: string;
}) {
  return (
    <div className={cn("mb-4 flex min-w-0 items-start justify-between gap-3", size === "sm" && "mb-3")}>
      <div className="min-w-0">
        <span className="text-xs font-semibold uppercase text-muted-foreground">{eyebrow}</span>
        {title ? <h2 className={cn("truncate font-semibold", size === "sm" ? "text-base" : "text-xl")}>{title}</h2> : null}
        {description ? <p className={cn("mt-1 truncate text-muted-foreground", size === "sm" ? "text-xs" : "text-sm")}>{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

function ChatView({
  approvals,
  activeMode,
  activeProjectId,
  canBranch,
  canEdit,
  chatTitle,
  decisions,
  ideas,
  isTyping,
  llmTraces,
  messages,
  pendingApproval,
  pendingTask,
  pendingTaskRemovalId,
  pendingTaskTitle,
  tasks,
  onBranchContext,
  onCreateApproval,
  onCreateDecision,
  onCreateIdea,
  onCreateTask,
  onToggleApproval,
  onToggleTask,
  showTokenUsage,
}: {
  approvals: Approval[];
  activeMode: WorkspaceMode;
  activeProjectId: string | null;
  canBranch: boolean;
  canEdit: boolean;
  chatTitle?: string;
  decisions: Decision[];
  ideas: Idea[];
  isTyping: boolean;
  llmTraces: LlmDevTrace[];
  messages: ChatMessage[];
  pendingApproval: boolean;
  pendingTask: boolean;
  pendingTaskRemovalId: string | null;
  pendingTaskTitle: string | null;
  tasks: Task[];
  onBranchContext: (message: ChatMessage) => void;
  onCreateApproval: (input: CreateWorkflowSuggestionInput) => void;
  onCreateDecision: (input: CreateWorkflowSuggestionInput) => void;
  onCreateIdea: (input: CreateWorkflowSuggestionInput) => void;
  onCreateTask: (input: CreateTaskInput) => void;
  onToggleApproval: (id: string) => void;
  onToggleTask: (id: string) => void;
  showTokenUsage: boolean;
}) {
  const messageEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages, isTyping]);

  const showEmptyChatPlaceholder = messages.length === 0 && !isTyping;

  return (
    <div className="scrollbar-thin min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
      {showEmptyChatPlaceholder ? (
        <div className="flex min-h-full items-center justify-center px-4 py-12">
          <div className="flex max-w-sm flex-col items-center text-center">
            <img
              alt=""
              aria-hidden="true"
              className="mb-5 h-32 w-44 object-contain"
              src={emptyChatImageSrc}
            />
            <h2 className="text-lg font-semibold text-foreground">Start a new chat</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Send a message to begin. The chat name will update after the first response is complete.
            </p>
          </div>
        </div>
      ) : null}
      {messages.map((message, index) => {
        const isUser = message.role === "user";
        const previousUserMessage = [...messages.slice(0, index)].reverse().find((item) => item.role === "user");
        const tokenUsage = !isUser ? getTokenUsageForMessage(message, llmTraces) : null;
        return (
          <article className={cn("flex gap-3", isUser ? "justify-end" : "justify-start")} key={message.id}>
            {!isUser ? (
              <div className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">V</div>
            ) : null}
            <div className={cn("max-w-[78%] space-y-1", isUser && "items-end text-right")}>
              <div className={cn("flex flex-wrap items-center gap-2 text-xs text-muted-foreground", isUser && "justify-end")}>
                <strong className="text-sm text-foreground">{isUser ? "You" : "VertexAI"}</strong>
                <span>{message.time}</span>
                {message.clientStatus === "sending" ? (
                  <span className="rounded-md border bg-background px-1.5 py-0.5 text-[11px] font-semibold uppercase text-muted-foreground">
                    Sending
                  </span>
                ) : null}
                {!isUser && showTokenUsage && tokenUsage ? <TokenUsageBadge usage={tokenUsage} /> : null}
              </div>
              <div
                className={cn(
                  "rounded-2xl px-4 py-3 text-left text-sm leading-6 shadow-xs",
                  isUser
                    ? "rounded-br-sm bg-primary text-primary-foreground"
                    : "rounded-bl-sm border bg-muted/60 text-foreground",
                  message.clientStatus === "sending" && "opacity-75",
                )}
              >
                {isUser ? message.text : (
                  <AssistantResponseContent
                    approvals={approvals}
                    canEdit={canEdit}
                    chatTitle={chatTitle}
                    activeMode={activeMode}
                    activeProjectId={activeProjectId}
                    decisions={decisions}
                    ideas={ideas}
                    pendingApproval={pendingApproval}
                    pendingTask={pendingTask}
                    pendingTaskRemovalId={pendingTaskRemovalId}
                    pendingTaskTitle={pendingTaskTitle}
                    requestedFormats={parseChatExportRequest(previousUserMessage?.text ?? "")}
                    requestedIdeas={wasIdeaRequest(previousUserMessage?.text ?? "")}
                    requestedJson={wasJsonRequested(previousUserMessage?.text ?? "")}
                    tasks={tasks}
                    title={previousUserMessage?.text ?? "Vertex AI chat export"}
                    text={message.text}
                    onCreateApproval={onCreateApproval}
                    onCreateDecision={onCreateDecision}
                    onCreateIdea={onCreateIdea}
                    onCreateTask={onCreateTask}
                    onToggleApproval={onToggleApproval}
                    onToggleTask={onToggleTask}
                  />
                )}
              </div>
              {message.attachments?.length ? (
                <div className={cn("flex flex-wrap gap-1.5", isUser && "justify-end")}>
                  {message.attachments.map((attachment) => (
                    <span
                      key={attachment.id}
                      className={cn(
                        "inline-flex max-w-full items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-xs text-foreground",
                        attachment.status === "partial" && "border-amber-300 bg-amber-50",
                        attachment.status === "error" && "border-destructive/40 bg-destructive/5 text-destructive",
                      )}
                      title={attachment.error ?? `${attachment.name} was included as Gemma 4 context`}
                    >
                      <FileText className="size-3.5 shrink-0" />
                      <span className="max-w-48 truncate font-medium">{attachment.name}</span>
                      <span className="shrink-0 text-muted-foreground">{attachment.extension.toUpperCase()}</span>
                    </span>
                  ))}
                </div>
              ) : null}
              {canBranch && message.clientStatus !== "sending" ? (
                <div className="flex justify-start">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 px-2 text-xs"
                    title="Branch Context"
                    aria-label={`Branch context from ${isUser ? "your" : "VertexAI"} message at ${message.time}`}
                    onClick={() => onBranchContext(message)}
                  >
                    <GitBranch className="size-3.5" />
                    <span>Branch Context</span>
                  </Button>
                </div>
              ) : null}
              {message.artifact ? (
                <button className="mt-2 grid min-h-14 max-w-lg grid-cols-[34px_minmax(0,1fr)_24px] items-center gap-2 rounded-md border bg-card p-2 text-left">
                  <span className="grid size-8 place-items-center rounded-md bg-primary text-primary-foreground">
                    {artifactIcon(message.artifact.type)}
                  </span>
                  <span className="min-w-0">
                    <strong className="block truncate text-sm">{message.artifact.title}</strong>
                    <em className="block text-xs not-italic text-muted-foreground">{message.artifact.meta}</em>
                  </span>
                  <Eye className="size-4 text-muted-foreground" />
                </button>
              ) : null}
            </div>
            {isUser ? (
              <div className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-sm font-semibold text-muted-foreground">You</div>
            ) : null}
          </article>
        );
      })}
      {isTyping ? (
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <div className="grid size-9 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">V</div>
          <div className="rounded-2xl rounded-bl-sm border bg-muted/60 px-4 py-3">
            <span className="animate-pulse">VertexAI is typing...</span>
          </div>
        </div>
      ) : null}
      <div className="h-32 shrink-0" ref={messageEndRef} />
    </div>
  );
}

type MessageTokenUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

function getTokenUsageForMessage(message: ChatMessage, traces: LlmDevTrace[]): MessageTokenUsage | null {
  const trace = traces.find((item) => item.responseText === message.text);
  if (!trace) return null;
  const usage = trace.diagnostics.tokenUsage;
  if (usage.inputTokens === null && usage.outputTokens === null && usage.totalTokens === null) return null;
  return usage;
}

function TokenUsageBadge({ usage }: { usage: MessageTokenUsage }) {
  const input = usage.inputTokens !== null ? usage.inputTokens.toLocaleString() : "?";
  const output = usage.outputTokens !== null ? usage.outputTokens.toLocaleString() : "?";
  const total = usage.totalTokens !== null ? usage.totalTokens.toLocaleString() : "?";
  return (
    <span className="inline-flex items-center gap-1 rounded-md border bg-background px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground" title={`Input ${input}, output ${output}, total ${total} tokens`}>
      <Zap className="size-3" />
      <span>in {input}</span>
      <span>/</span>
      <span>out {output}</span>
      <span>/</span>
      <span>total {total}</span>
    </span>
  );
}

type ScopedRagSseHandlers = {
  onCitations: (citations: ChatWithScopedRagCitation[]) => void;
  onError: (message: string) => void;
  onToken: (token: string) => void;
};

function consumeScopedRagEventSource(input: {
  projectId: string;
  prompt: string;
  teamId: string;
  workspaceId: string;
}, handlers: ScopedRagSseHandlers) {
  return new Promise<void>((resolve, reject) => {
    const eventSource = new EventSource(scopedRagStreamUrl(input));
    let completed = false;

    eventSource.addEventListener("citations", (event) => {
      const payload = parseScopedRagSsePayload(event as MessageEvent);
      const citations = typeof payload === "object" && payload ? (payload as { citations?: unknown }).citations : null;
      if (Array.isArray(citations)) handlers.onCitations(citations.filter(isScopedRagCitation));
    });

    eventSource.addEventListener("token", (event) => {
      const payload = parseScopedRagSsePayload(event as MessageEvent);
      const token = typeof payload === "object" && payload ? (payload as { token?: unknown }).token : payload;
      if (typeof token === "string") handlers.onToken(token);
    });

    eventSource.addEventListener("done", () => {
      completed = true;
      eventSource.close();
      resolve();
    });

    eventSource.addEventListener("stream-error", (event) => {
      if (completed) return;
      const payload = parseScopedRagSsePayload(event as MessageEvent);
      const message = typeof payload === "object" && payload ? (payload as { message?: unknown }).message : payload;
      const errorMessage = typeof message === "string" ? message : "Scoped RAG stream failed.";
      completed = true;
      eventSource.close();
      try {
        handlers.onError(errorMessage);
      } catch {
        // The promise rejection below is the consumer-facing failure path.
      }
      reject(new Error(errorMessage));
    });

    eventSource.onerror = () => {
      if (completed) return;
      const errorMessage = "Scoped RAG stream connection failed.";
      completed = true;
      eventSource.close();
      reject(new Error(errorMessage));
    };
  });
}

function scopedRagStreamUrl(input: {
  projectId: string;
  prompt: string;
  teamId: string;
  workspaceId: string;
}) {
  const params = new URLSearchParams({
    prompt: input.prompt,
    teamId: input.teamId,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
  });
  return `/api/scoped-rag-stream?${params.toString()}`;
}

function parseScopedRagSsePayload(event: MessageEvent) {
  let payload: unknown;
  try {
    payload = JSON.parse(event.data);
  } catch {
    payload = event.data;
  }
  return payload;
}

function isScopedRagCitation(value: unknown): value is ChatWithScopedRagCitation {
  if (!value || typeof value !== "object") return false;
  const citation = value as Partial<ChatWithScopedRagCitation>;
  return typeof citation.id === "string" && typeof citation.documentName === "string" && typeof citation.r2Key === "string";
}

function formatScopedRagCitations(citations: ChatWithScopedRagCitation[]) {
  if (!citations.length) return "";
  const uniqueCitations = citations.filter(
    (citation, index, list) => list.findIndex((item) => item.r2Key === citation.r2Key) === index,
  );
  const rows = uniqueCitations.map((citation) => {
    const score = citation.score === null ? "" : `, score ${citation.score.toFixed(3)}`;
    return `- ${citation.documentName} ([r2_key: ${citation.r2Key}]${score})`;
  });
  return ["**Sources**", ...rows].join("\n");
}

type ParsedAssistantResponse =
  | { kind: "json"; content: string }
  | { kind: "markdown"; content: string }
  | { kind: "text"; content: string };

function wasJsonRequested(prompt: string) {
  return /\b(json|schema|object|array)\b/i.test(prompt) && /\b(return|respond|output|format|give|as|in)\b/i.test(prompt);
}

function wasIdeaRequest(prompt: string) {
  return /\b(idea|ideas|opportunit(?:y|ies)|suggestion|suggestions|brainstorm|recommendations?|improvements?|enhancements?)\b/i.test(prompt)
    && /\b(give|suggest|recommend|brainstorm|identify|surface|list|propose|what|how|ways)\b/i.test(prompt);
}

function parseAssistantResponse(text: string, requestedJson: boolean): ParsedAssistantResponse {
  const trimmed = text.trim();
  const jsonCandidate = extractJsonCandidate(trimmed);
  if (jsonCandidate) {
    try {
      const parsed = JSON.parse(jsonCandidate);
      if (requestedJson || hasWorkflowActionSchema(parsed)) {
        return { kind: "json", content: JSON.stringify(parsed, null, 2) };
      }
      const extracted = extractReadableJson(parsed);
      return {
        kind: looksLikeMarkdown(extracted) ? "markdown" : "text",
        content: extracted,
      };
    } catch {
      // Fall through to normal markdown/text detection.
    }
  }

  return looksLikeMarkdown(trimmed)
    ? { kind: "markdown", content: trimmed }
    : { kind: "text", content: trimmed };
}

function extractJsonCandidate(text: string) {
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) return fenced[1].trim();
  if ((text.startsWith("{") && text.endsWith("}")) || (text.startsWith("[") && text.endsWith("]"))) return text;
  return "";
}

function hasWorkflowActionSchema(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasWorkflowActionSchema);
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return Object.entries(record).some(([key, nestedValue]) => {
    const normalizedKey = key.toLowerCase().replace(/[^a-z]/g, "");
    if ([
      "approval",
      "approvals",
      "pendingapproval",
      "pendingapprovals",
      "decision",
      "decisions",
      "idea",
      "ideas",
      "suggestedidea",
      "suggestedideas",
      "potentialidea",
      "potentialideas",
      "opportunity",
      "opportunities",
      "improvement",
      "improvements",
      "enhancement",
      "enhancements",
      "suggestion",
      "suggestions",
      "task",
      "tasks",
      "assignedtask",
      "assignedtasks",
    ].includes(normalizedKey)) {
      return true;
    }
    return hasWorkflowActionSchema(nestedValue);
  });
}

function extractReadableJson(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null) return "";
  if (Array.isArray(value)) {
    return value
      .map((item) => extractReadableJson(item))
      .filter(Boolean)
      .join("\n");
  }
  if (!value || typeof value !== "object") return "";

  const record = value as Record<string, unknown>;
  for (const key of ["answer", "response", "message", "text", "content", "output", "summary", "result"]) {
    const extracted = extractReadableJson(record[key]);
    if (extracted) return extracted;
  }

  return Object.entries(record)
    .map(([key, nestedValue]) => {
      const extracted = extractReadableJson(nestedValue);
      return extracted ? `${titleCase(key)}: ${extracted}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

function titleCase(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function looksLikeMarkdown(text: string) {
  return [
    /^#{1,6}\s+/m,
    /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/m,
    /^\s*[-*+]\s+/m,
    /^\s*\d+\.\s+/m,
    /```[\s\S]*?```/,
    /`[^`]+`/,
    /\*\*[^*]+\*\*/,
    /\[[^\]]+\]\([^)]+\)/,
    /^\|.+\|$/m,
  ].some((pattern) => pattern.test(text));
}

function AssistantResponseContent({
  activeMode,
  activeProjectId,
  approvals,
  canEdit,
  chatTitle,
  decisions,
  ideas,
  pendingApproval,
  pendingTask,
  pendingTaskRemovalId,
  pendingTaskTitle,
  requestedFormats,
  requestedIdeas,
  requestedJson,
  tasks,
  text,
  title,
  onCreateApproval,
  onCreateDecision,
  onCreateIdea,
  onCreateTask,
  onToggleApproval,
  onToggleTask,
}: {
  activeMode: WorkspaceMode;
  activeProjectId: string | null;
  approvals: Approval[];
  canEdit: boolean;
  chatTitle?: string;
  decisions: Decision[];
  ideas: Idea[];
  pendingApproval: boolean;
  pendingTask: boolean;
  pendingTaskRemovalId: string | null;
  pendingTaskTitle: string | null;
  requestedFormats: ChatExportFormat[];
  requestedIdeas: boolean;
  requestedJson: boolean;
  tasks: Task[];
  text: string;
  title: string;
  onCreateApproval: (input: CreateWorkflowSuggestionInput) => void;
  onCreateDecision: (input: CreateWorkflowSuggestionInput) => void;
  onCreateIdea: (input: CreateWorkflowSuggestionInput) => void;
  onCreateTask: (input: CreateTaskInput) => void;
  onToggleApproval: (id: string) => void;
  onToggleTask: (id: string) => void;
}) {
  const parsed = parseAssistantResponse(text, requestedJson);
  const workflowActions = {
    approvals,
    decisions,
    ideas,
    tasks,
    canEdit,
    pendingApproval,
    pendingTask,
    pendingTaskRemovalId: pendingTaskRemovalId ?? undefined,
    pendingTaskTitle: pendingTaskTitle ?? undefined,
    preferredSuggestionKind: requestedIdeas ? "idea" as const : undefined,
    activeMode,
    activeProjectId,
    sourceTitle: chatTitle,
    onCreateApproval,
    onCreateDecision,
    onCreateIdea,
    onCreateTask,
    onToggleApproval,
    onToggleTask,
  };
  const exportActions = requestedFormats.length ? (
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      {requestedFormats.map((format) => (
        <Button
          key={format}
          type="button"
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 px-2 text-xs"
          onClick={() => downloadChatExport(format, parsed.content, title)}
        >
          <Download className="size-3.5" />
          {exportFormatLabel(format)}
        </Button>
      ))}
    </div>
  ) : null;
  if (parsed.kind === "json") {
    return (
      <div data-source-chat-title={chatTitle ?? ""}>
        {exportActions}
        <ArtifactRenderer fileType="json" previewJson={parsed.content} workflowActions={workflowActions} />
      </div>
    );
  }
  if (parsed.kind === "markdown") {
    return (
      <div data-source-chat-title={chatTitle ?? ""}>
        {exportActions}
        <ArtifactRenderer fileType="markdown" previewJson={{ markdown: parsed.content }} workflowActions={workflowActions} />
      </div>
    );
  }
  return (
    <div data-source-chat-title={chatTitle ?? ""}>
      {exportActions}
      <p className="whitespace-pre-wrap">{parsed.content}</p>
    </div>
  );
}

function RenderedTableExportControls({
  activeMode,
  activeChatTitle,
  artifacts,
  canEdit,
  onError,
  onSaved,
  projectId,
  selectedArtifact,
}: {
  activeMode: WorkspaceMode;
  activeChatTitle?: string;
  artifacts: Artifact[];
  canEdit: boolean;
  onError: (message: string) => void;
  onSaved: (title: string) => void;
  projectId: string | null;
  selectedArtifact?: Artifact;
}) {
  const queryClient = useQueryClient();
  const savedTablesRef = useRef(new Set<string>());
  const savingTablesRef = useRef(new Set<string>());
  const saveMutation = useMutation({
    mutationFn: (formData: FormData) => saveTableArtifact({ data: formData }),
    onMutate: async (formData) => {
      await queryClient.cancelQueries({ queryKey: pmoWorkspaceQueryKey });
      const previousWorkspace = queryClient.getQueryData<PmoWorkspaceState>(pmoWorkspaceQueryKey);
      const title = typeof formData.get("title") === "string" ? String(formData.get("title")) : "Table export";
      const modeValue = formData.get("mode");
      const optimisticMode = workspaceModes.includes(modeValue as WorkspaceMode) ? modeValue as WorkspaceMode : activeMode;
      const projectIdValue = formData.get("project_id");
      const sourceChatTitleValue = formData.get("chat_title");
      const rowsJson = formData.get("rows_json");
      const optimisticPreview = parsePreviewRows(typeof rowsJson === "string" ? rowsJson : "");
      const optimisticR2Key = `optimistic-artifact-${Date.now()}`;
      const optimisticArtifact: Artifact = {
        id: optimisticR2Key,
        projectId: typeof projectIdValue === "string" && projectIdValue ? projectIdValue : null,
        sourceChatTitle: typeof sourceChatTitleValue === "string" && sourceChatTitleValue ? sourceChatTitleValue : undefined,
        title,
        type: "XLSX",
        owner: "You",
        date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
        status: "Draft",
        summary: "Saving XLSX artifact...",
        href: "#",
        r2Key: optimisticR2Key,
        preview: ["Saving table export", title],
        previewJson: {
          kind: "table",
          preview: ["Saving table export", title],
          columns: optimisticPreview.columns,
          rows: optimisticPreview.rows,
        },
        pinnedTo: [],
        version: 1,
        commitMessage: "Saving from chat table export",
        clientStatus: "saving",
      };
      queryClient.setQueryData<PmoWorkspaceState>(pmoWorkspaceQueryKey, (current) =>
        addArtifactToWorkspaceCache(current, optimisticMode, optimisticArtifact),
      );
      return { previousWorkspace };
    },
    onSuccess: async (result, formData) => {
      const tableKey = formData.get("table_key");
      if (typeof tableKey === "string") savedTablesRef.current.add(tableKey);
      if (typeof tableKey === "string") savingTablesRef.current.delete(tableKey);
      const workspace = (result as { workspace?: PmoWorkspaceState } | undefined)?.workspace;
      if (workspace) queryClient.setQueryData(pmoWorkspaceQueryKey, workspace);
      const artifact = (result as { artifact?: Artifact } | undefined)?.artifact;
      const title = artifact?.title ?? formData.get("title");
      onSaved(typeof title === "string" ? title : "Table export");
    },
    onError: (error, _formData, context) => {
      const tableKey = _formData.get("table_key");
      if (typeof tableKey === "string") savingTablesRef.current.delete(tableKey);
      if (context?.previousWorkspace) queryClient.setQueryData(pmoWorkspaceQueryKey, context.previousWorkspace);
      onError(error instanceof Error ? error.message : "Could not save artifact.");
    },
  });
  const saveMutateRef = useRef(saveMutation.mutate);

  useEffect(() => {
    saveMutateRef.current = saveMutation.mutate;
  }, [saveMutation.mutate]);

  useEffect(() => {
    const controlsClass = "rendered-table-export-controls";
    const buttonClass = "rounded-md border bg-background px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-accent hover:text-foreground";

    function tableTitle(table: HTMLTableElement) {
      const container = table.closest("section, article, aside, div");
      return container?.querySelector("h1,h2,h3,strong")?.textContent?.trim()
        || table.getAttribute("aria-label")
        || "table-export";
    }

    function sourceChatTitle(table: HTMLTableElement) {
      const value = table.closest("[data-source-chat-title]")?.getAttribute("data-source-chat-title")?.trim();
      return value || activeChatTitle || "";
    }

    function tableKey(table: HTMLTableElement) {
      const content = `${activeMode}::${projectId ?? "general"}::${tableTitle(table)}::${table.textContent ?? ""}`;
      let hash = 0;
      for (let index = 0; index < content.length; index += 1) {
        hash = Math.imul(31, hash) + content.charCodeAt(index) | 0;
      }
      return `table-${Math.abs(hash)}`;
    }

    function normalizePreviewRows(columns: unknown, rows: unknown) {
      if (!Array.isArray(rows)) return null;
      const normalizedColumns = Array.isArray(columns)
        ? columns.map((column) => String(column ?? ""))
        : [];
      const normalizedRows = rows.map((row) => Array.isArray(row)
        ? row.map((cell) => String(cell ?? ""))
        : [String(row ?? "")]);
      return { columns: normalizedColumns, rows: normalizedRows };
    }

    function tablePreviewSignature(table: HTMLTableElement) {
      const preview = parsePreviewRows(JSON.stringify(rowsFromHtmlTable(table)));
      return JSON.stringify({
        projectId: projectId ?? null,
        columns: preview.columns.map((column) => String(column ?? "")),
        rows: preview.rows.map((row) => row.map((cell) => String(cell ?? ""))),
      });
    }

    function artifactPreviewSignature(artifact: Artifact) {
      if (artifact.type !== "XLSX" || (artifact.projectId ?? null) !== (projectId ?? null)) return null;
      if (!artifact.previewJson || typeof artifact.previewJson !== "object" || Array.isArray(artifact.previewJson)) return null;
      const preview = artifact.previewJson as { columns?: unknown; kind?: unknown; rows?: unknown };
      if (preview.kind !== "table") return null;
      const normalized = normalizePreviewRows(preview.columns, preview.rows);
      if (!normalized) return null;
      return JSON.stringify({
        projectId: artifact.projectId ?? null,
        columns: normalized.columns,
        rows: normalized.rows,
      });
    }

    function tableHasSavedArtifact(table: HTMLTableElement) {
      const signature = tablePreviewSignature(table);
      return artifacts.some((artifact) => artifactPreviewSignature(artifact) === signature);
    }

    function button(label: string, title: string, onClick: () => void) {
      const control = document.createElement("button");
      control.type = "button";
      control.className = buttonClass;
      control.textContent = label;
      control.title = title;
      control.setAttribute("aria-label", title);
      control.addEventListener("click", onClick);
      return control;
    }

    function hasSaveableRows(table: HTMLTableElement) {
      const rows = Array.from(table.querySelectorAll("tbody tr"));
      if (rows.length === 0) return false;
      return rows.some((row) => {
        const cells = Array.from(row.querySelectorAll("td,th"));
        if (cells.length === 0) return false;
        if (cells.length === 1 && cells[0].hasAttribute("colspan")) return false;
        return cells.some((cell) => {
          const text = cell.textContent?.trim() ?? "";
          return text && text.toLowerCase() !== "no results.";
        });
      });
    }

    function populateControls(controls: HTMLElement, table: HTMLTableElement) {
      controls.replaceChildren(
        button("CSV", "Export table as CSV", () => downloadHtmlTable("csv", tableTitle(table), table)),
        button("XLSX", "Export table as XLSX", () => downloadHtmlTable("xlsx", tableTitle(table), table)),
      );

      if (canEdit && hasSaveableRows(table)) {
        const key = tableKey(table);
        const saveTable = (saveButton: HTMLButtonElement, updateArtifact: boolean) => {
          const title = tableTitle(table);
          const formData = new FormData();
          formData.set("mode", activeMode);
          if (projectId) formData.set("project_id", projectId);
          const sourceTitle = sourceChatTitle(table);
          if (sourceTitle) formData.set("chat_title", sourceTitle);
          formData.set("title", title);
          formData.set("table_key", key);
          formData.set("rows_json", JSON.stringify(rowsFromHtmlTable(table)));
          if (updateArtifact && selectedArtifact) {
            formData.set("base_artifact_id", selectedArtifact.id);
            formData.set("commit_message", `Updated from ${sourceTitle || activeChatTitle || "follow-on chat"}`);
          }
          savingTablesRef.current.add(key);
          saveButton.disabled = true;
          saveButton.textContent = "Saving...";
          saveButton.className = `${buttonClass} cursor-wait opacity-60`;
          saveMutateRef.current(formData, {
            onSuccess: () => {
              saveButton.disabled = true;
              saveButton.textContent = "Saved to Artifacts";
              saveButton.className = `${buttonClass} cursor-not-allowed opacity-50`;
            },
            onError: () => {
              saveButton.disabled = false;
              saveButton.textContent = "Save to Artifacts";
              saveButton.className = buttonClass;
            },
          });
        };
        const saveButton = button("Save to Artifacts", "Save table as XLSX artifact", () => {
          saveTable(saveButton, false);
        });
        if (savingTablesRef.current.has(key)) {
          saveButton.disabled = true;
          saveButton.textContent = "Saving...";
          saveButton.className = `${buttonClass} cursor-wait opacity-60`;
        } else if (savedTablesRef.current.has(key) || tableHasSavedArtifact(table)) {
          saveButton.disabled = true;
          saveButton.textContent = "Saved to Artifacts";
          saveButton.className = `${buttonClass} cursor-not-allowed opacity-50`;
        }
        controls.appendChild(saveButton);
        if (selectedArtifact?.id.startsWith("artifact-") && selectedArtifact.type === "XLSX" && selectedArtifact.projectId === projectId) {
          const updateButton = button("Update Selected", `Create version ${selectedArtifact.version + 1} of ${selectedArtifact.title}`, () => {
            saveTable(updateButton, true);
          });
          controls.appendChild(updateButton);
        }
      }
    }

    function addControls() {
      document.querySelectorAll<HTMLTableElement>("table").forEach((table) => {
        if (!table.closest("[data-rendered-markdown='true']")) return;
        if (table.closest(`.${controlsClass}`)) return;
        const anchor = table.parentElement && !table.parentElement.classList.contains(controlsClass)
          ? table.parentElement
          : table;
        const existingControls =
          table.nextElementSibling instanceof HTMLElement && table.nextElementSibling.classList.contains(controlsClass)
            ? table.nextElementSibling
            : table.previousElementSibling instanceof HTMLElement && table.previousElementSibling.classList.contains(controlsClass)
              ? table.previousElementSibling
              : anchor.nextElementSibling instanceof HTMLElement && anchor.nextElementSibling.classList.contains(controlsClass)
                ? anchor.nextElementSibling
                : anchor.previousElementSibling instanceof HTMLElement && anchor.previousElementSibling.classList.contains(controlsClass)
                  ? anchor.previousElementSibling
                  : null;
        if (existingControls) {
          existingControls.className = `${controlsClass} mt-2 flex w-full justify-start gap-1`;
          if (existingControls !== anchor.nextElementSibling) {
            anchor.parentElement?.insertBefore(existingControls, anchor.nextSibling);
          }
          table.dataset.exportControls = "true";
          return;
        }
        if (table.dataset.exportControls === "true") return;
        table.dataset.exportControls = "true";

        const controls = document.createElement("div");
        controls.className = `${controlsClass} mt-2 flex w-full justify-start gap-1`;
        populateControls(controls, table);
        anchor.parentElement?.insertBefore(controls, anchor.nextSibling);
      });
    }

    addControls();
    const observer = new MutationObserver(addControls);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      document.querySelectorAll<HTMLElement>(`.${controlsClass}`).forEach((element) => element.remove());
      document.querySelectorAll<HTMLTableElement>("table[data-export-controls='true']").forEach((table) => {
        delete table.dataset.exportControls;
      });
    };
  }, [activeMode, activeChatTitle, artifacts, canEdit, projectId, selectedArtifact]);

  return null;
}

type WorkflowLineItem = {
  id: string;
  title: string;
  originalText?: string;
  meta: string;
  statusControl?: ReactNode;
  complete?: "success" | "destructive";
  pinned?: boolean;
};

const approvalStatusOptions: Approval["status"][] = ["Not Reviewed", "Reviewing", "Approved", "Not Approved"];
const decisionStatusOptions: Decision["status"][] = ["Not Completed", "Completed"];
const ideaStatusOptions: IdeaStatus[] = ["Not Started", "Reviewing", "Convert to Project", "Dismiss"];

function WorkflowStatusSelect<TStatus extends string>({
  disabled,
  label,
  onChange,
  options,
  value,
}: {
  disabled?: boolean;
  label: string;
  onChange: (value: TStatus) => void;
  options: TStatus[];
  value: TStatus;
}) {
  return (
    <select
      aria-label={label}
      title={label}
      className="h-8 rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      disabled={disabled}
      value={value}
      onChange={(event) => onChange(event.target.value as TStatus)}
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

function WorkflowLineList({
  canEdit,
  emptyLabel,
  items,
  onDelete,
  onPreview,
  onSelect,
  onTogglePin,
}: {
  canEdit: boolean;
  emptyLabel: string;
  items: WorkflowLineItem[];
  onDelete: (id: string) => void;
  onPreview: (item: WorkflowLineItem) => void;
  onSelect: (item: WorkflowLineItem) => void;
  onTogglePin?: (id: string) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="grid min-h-28 place-items-center rounded-md border border-dashed bg-background p-4 text-center text-sm text-muted-foreground">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div
          key={item.id}
          role="button"
          tabIndex={0}
          className="flex cursor-pointer items-center gap-3 rounded-md border bg-background p-3 text-left transition-colors hover:bg-accent/45 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          onClick={() => onSelect(item)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            onSelect(item);
          }}
        >
          <span className="min-w-0 flex-1">
            <strong
              className={cn(
                "block truncate text-sm",
                item.complete === "success" && "text-success line-through decoration-success decoration-2",
                item.complete === "destructive" && "text-destructive line-through decoration-destructive decoration-2",
              )}
            >
              {item.title}
            </strong>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">{item.meta}</span>
          </span>
          <div className="flex shrink-0 items-center gap-2" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
            {canEdit && onTogglePin ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={item.pinned ? `Unpin ${item.title}` : `Pin ${item.title}`}
                title={item.pinned ? "Unpin" : "Pin"}
                onClick={() => onTogglePin(item.id)}
              >
                <Star className={cn(item.pinned && "fill-warning text-warning")} />
                {item.pinned ? "Pinned" : "Pin"}
              </Button>
            ) : null}
            {item.statusControl}
            <Button type="button" variant="outline" size="sm" onClick={() => onPreview(item)}>
              <Eye />
              Preview
            </Button>
            {canEdit ? (
              <Button type="button" variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => onDelete(item.id)}>
                <Trash2 />
                Delete
              </Button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function IdeasView({
  canEdit,
  ideas,
  pinnedIdeaIds,
  searchTerm,
  statusFilter,
  onAddIdea,
  onDeleteIdea,
  onPreviewIdea,
  onSearchTerm,
  onSelectIdea,
  onStatusChange,
  onStatusFilter,
  onToggleIdeaPin,
}: {
  canEdit: boolean;
  ideas: Idea[];
  pinnedIdeaIds: string[];
  searchTerm: string;
  statusFilter: IdeaStatus | "All";
  onAddIdea: () => void;
  onDeleteIdea: (id: string) => void;
  onPreviewIdea: (idea: Idea) => void;
  onSearchTerm: (value: string) => void;
  onSelectIdea: (idea: Idea) => void;
  onStatusChange: (idea: Idea, status: IdeaStatus) => void;
  onStatusFilter: (value: IdeaStatus | "All") => void;
  onToggleIdeaPin: (id: string) => void;
}) {
  const lineItems = useMemo<WorkflowLineItem[]>(
    () => ideas.map((idea) => ({
      id: idea.id,
      title: idea.title,
      originalText: idea.originalText,
      meta: `${idea.owner} / ${idea.category} / ${idea.votes} votes${pinnedIdeaIds.includes(idea.id) ? " / Pinned" : ""}`,
      complete: idea.status === "Convert to Project" ? "success" : idea.status === "Dismiss" ? "destructive" : undefined,
      pinned: pinnedIdeaIds.includes(idea.id),
      statusControl: (
        <WorkflowStatusSelect
          disabled={!canEdit}
          label={`Idea status for ${idea.title}`}
          options={ideaStatusOptions}
          value={idea.status}
          onChange={(status) => onStatusChange(idea, status)}
        />
      ),
    })),
    [canEdit, ideas, onStatusChange, pinnedIdeaIds],
  );
  const ideasById = useMemo(() => new Map(ideas.map((idea) => [idea.id, idea])), [ideas]);

  return (
    <div className="space-y-4">
      <SectionHeader
        eyebrow="Improvement queue"
        title={`${ideas.length} PMO ideas in view`}
        actions={canEdit ? (
          <Button type="button" onClick={onAddIdea} data-testid="open-add-idea">
            <Plus />
            Add idea
          </Button>
        ) : null}
      />
      <div className="grid gap-2 xl:grid-cols-[280px_minmax(0,1fr)]">
        <label className="flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-muted-foreground">
          <Search className="size-4" />
          <Input
            className="h-7 border-0 px-0 shadow-none focus-visible:ring-0"
            placeholder="Search idea queue"
            value={searchTerm}
            onChange={(event) => onSearchTerm(event.target.value)}
          />
        </label>
        <div className="scrollbar-thin flex gap-2 overflow-x-auto">
          {statusFilters.map((status) => (
            <Button
              key={status}
              type="button"
              size="sm"
              variant={status === statusFilter ? "default" : "outline"}
              onClick={() => onStatusFilter(status)}
            >
              {status === "All" ? "All" : statusMeta[status].label}
            </Button>
          ))}
        </div>
      </div>
      <WorkflowLineList
        canEdit={canEdit}
        emptyLabel="No ideas match this view."
        items={lineItems}
        onDelete={onDeleteIdea}
        onPreview={(item) => {
          const idea = ideasById.get(item.id);
          if (idea) onPreviewIdea(idea);
        }}
        onSelect={(item) => {
          const idea = ideasById.get(item.id);
          if (idea) onSelectIdea(idea);
        }}
        onTogglePin={onToggleIdeaPin}
      />
    </div>
  );
}

function ArtifactsView({
  activeMode,
  canEdit,
  artifacts,
  selectedArtifactTitle,
  onPreview,
  onSelectArtifact,
  onShare,
  onTogglePin,
}: {
  activeMode: WorkspaceMode;
  canEdit: boolean;
  artifacts: Artifact[];
  selectedArtifactTitle?: string;
  onPreview: (artifact: Artifact) => void;
  onSelectArtifact: (artifact: Artifact) => void;
  onShare: () => void;
  onTogglePin: (artifact: Artifact) => void;
}) {
  const columns = useMemo<ColumnDef<Artifact>[]>(
    () => [
      {
        accessorKey: "title",
        header: "Artifact",
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
              {artifactIcon(row.original.type)}
            </span>
            <span className="min-w-0">
              <strong className="block truncate">{row.original.title}</strong>
              <em className="block text-xs not-italic text-muted-foreground">
                {row.original.clientStatus === "saving"
                  ? "Saving..."
                  : row.original.clientStatus === "pinning"
                    ? "Updating pin..."
                    : `v${row.original.version} / ${row.original.summary}`}
              </em>
            </span>
          </div>
        ),
      },
      { accessorKey: "type", header: "Type" },
      { accessorKey: "owner", header: "Owner" },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => {
          if (row.original.clientStatus === "saving") return <Badge variant="warning">Saving</Badge>;
          if (row.original.clientStatus === "pinning") return <Badge variant="warning">Pending</Badge>;
          return row.original.status;
        },
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Preview ${row.original.title}`}
              disabled={Boolean(row.original.clientStatus)}
              onClick={(event) => {
                event.stopPropagation();
                onPreview(row.original);
              }}
            >
              <Eye />
            </Button>
            {canEdit ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={row.original.pinnedTo.includes(activeMode) ? `Unpin ${row.original.title}` : `Pin ${row.original.title}`}
                  title={row.original.pinnedTo.includes(activeMode) ? "Unpin artifact" : "Pin artifact"}
                  disabled={Boolean(row.original.clientStatus)}
                  onClick={(event) => {
                    event.stopPropagation();
                    onTogglePin(row.original);
                  }}
                >
                  <Star className={cn("text-muted-foreground", row.original.pinnedTo.includes(activeMode) && "fill-warning text-warning")} />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`${row.original.title} is protected by immutable version history`}
                  title="Artifacts are immutable. Restore older versions from the timeline."
                  disabled
                >
                <ShieldCheck className="text-muted-foreground" />
              </Button>
            </>
            ) : null}
            {row.original.clientStatus ? (
              <Button type="button" variant="ghost" size="icon" aria-label={`Download ${row.original.title}`} disabled>
                <Download />
              </Button>
            ) : (
              <Button asChild variant="ghost" size="icon" aria-label={`Download ${row.original.title}`}>
                <a href={row.original.href} download aria-label={`Download ${row.original.title}`} title={`Download ${row.original.title}`} onClick={(event) => event.stopPropagation()}>
                  <Download />
                </a>
              </Button>
            )}
          </div>
        ),
      },
    ],
    [activeMode, canEdit, onPreview, onTogglePin],
  );

  return (
    <div className="space-y-4">
      <SectionHeader
        eyebrow="Artifacts"
        title={`Pin artifacts to ${workspaceModeLabel(activeMode)}`}
        actions={canEdit ? (
          <div className="flex shrink-0 items-center gap-2">
            <ArtifactUploader />
            <Button type="button" variant="outline" onClick={onShare}>
              <Share2 />
              Share
            </Button>
          </div>
        ) : null}
      />
      <DataTable
        columns={columns}
        data={artifacts}
        selectedId={selectedArtifactTitle}
        getRowId={(artifact) => artifact.title}
        onRowClick={(artifact) => {
          if (artifact.clientStatus) return;
          onSelectArtifact(artifact);
        }}
      />
    </div>
  );
}

function DecisionView({
  canEdit,
  decisions,
  onDelete,
  onPreview,
  onSelect,
  onStatusChange,
  onTogglePin,
}: {
  canEdit: boolean;
  decisions: Decision[];
  onDelete: (id: string) => void;
  onPreview: (decision: Decision) => void;
  onSelect: (decision: Decision) => void;
  onStatusChange: (id: string, status: Decision["status"]) => void;
  onTogglePin: (id: string) => void;
}) {
  const decisionsById = useMemo(() => new Map(decisions.map((decision) => [decision.id, decision])), [decisions]);
  const items = useMemo<WorkflowLineItem[]>(
    () => decisions.map((decision) => ({
      id: decision.id,
      title: decision.title,
      originalText: decision.originalText,
      meta: `${decision.owner} / ${decision.due}`,
      complete: decision.status === "Completed" ? "success" : undefined,
      pinned: decision.pinned,
      statusControl: (
        <WorkflowStatusSelect
          disabled={!canEdit}
          label={`Decision status for ${decision.title}`}
          options={decisionStatusOptions}
          value={decision.status}
          onChange={(status) => onStatusChange(decision.id, status)}
        />
      ),
    })),
    [canEdit, decisions, onStatusChange],
  );

  return (
    <div className="space-y-4">
      <SectionHeader eyebrow="Workflow status" title="Open governance actions" description={`${decisions.filter((decision) => decision.status !== "Completed").length} decisions need PMO attention`} />
      <WorkflowLineList
        canEdit={canEdit}
        emptyLabel="No decisions in this scope."
        items={items}
        onDelete={onDelete}
        onPreview={(item) => {
          const decision = decisionsById.get(item.id);
          if (decision) onPreview(decision);
        }}
        onSelect={(item) => {
          const decision = decisionsById.get(item.id);
          if (decision) onSelect(decision);
        }}
        onTogglePin={onTogglePin}
      />
    </div>
  );
}

function ApprovalView({
  approvals,
  canEdit,
  onDelete,
  onPreview,
  onSelect,
  onStatusChange,
  onTogglePin,
}: {
  approvals: Approval[];
  canEdit: boolean;
  onDelete: (id: string) => void;
  onPreview: (approval: Approval) => void;
  onSelect: (approval: Approval) => void;
  onStatusChange: (id: string, status: Approval["status"]) => void;
  onTogglePin: (id: string) => void;
}) {
  const approvalsById = useMemo(() => new Map(approvals.map((approval) => [approval.id, approval])), [approvals]);
  const items = useMemo<WorkflowLineItem[]>(
    () => approvals.map((approval) => ({
      id: approval.id,
      title: approval.title,
      originalText: approval.originalText,
      meta: `${approval.owner} / ${approval.due}`,
      complete: approval.status === "Approved" ? "success" : approval.status === "Not Approved" ? "destructive" : undefined,
      pinned: approval.pinned,
      statusControl: (
        <WorkflowStatusSelect
          disabled={!canEdit}
          label={`Approval status for ${approval.title}`}
          options={approvalStatusOptions}
          value={approval.status}
          onChange={(status) => onStatusChange(approval.id, status)}
        />
      ),
    })),
    [approvals, canEdit, onStatusChange],
  );

  return (
    <div className="space-y-4">
      <SectionHeader eyebrow="Workflow status" title="Approval queue" description={`${approvals.filter((approval) => !["Approved", "Not Approved"].includes(approval.status)).length} approvals need attention`} />
      <WorkflowLineList
        canEdit={canEdit}
        emptyLabel="No approvals in this scope."
        items={items}
        onDelete={onDelete}
        onPreview={(item) => {
          const approval = approvalsById.get(item.id);
          if (approval) onPreview(approval);
        }}
        onSelect={(item) => {
          const approval = approvalsById.get(item.id);
          if (approval) onSelect(approval);
        }}
        onTogglePin={onTogglePin}
      />
    </div>
  );
}

function TaskView({
  canEdit,
  tasks,
  onStatusChange,
  onDelete,
  onPreview,
  onSelect,
  onTogglePin,
}: {
  canEdit: boolean;
  tasks: Task[];
  onStatusChange: (id: string, status: Task["status"]) => void;
  onDelete: (id: string) => void;
  onPreview: (task: Task) => void;
  onSelect: (task: Task) => void;
  onTogglePin: (id: string) => void;
}) {
  const tasksById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const items = useMemo<WorkflowLineItem[]>(
    () => tasks.map((task) => ({
      id: task.id,
      title: task.title,
      originalText: task.originalText,
      meta: `${task.owner} / ${task.source}`,
      complete: task.status === "Completed" ? "success" : undefined,
      pinned: task.pinned,
      statusControl: task.status === "Completed" ? (
        canEdit ? (
          <Button type="button" variant="outline" size="sm" onClick={() => onStatusChange(task.id, "Open")}>
            <RotateCcw />
            Mark Open
          </Button>
        ) : (
          <Badge variant="success">Completed</Badge>
        )
      ) : canEdit ? (
        <Button type="button" variant="outline" size="sm" onClick={() => onStatusChange(task.id, "Completed")}>
          <CheckCircle2 />
          Complete
        </Button>
      ) : (
        <Badge variant="info">Open</Badge>
      ),
    })),
    [canEdit, onStatusChange, tasks],
  );

  return (
    <div className="space-y-4">
      <SectionHeader eyebrow="Workflow status" title="Tasks surfaced from chats" description={`${tasks.filter((task) => task.status !== "Completed").length} open follow-ups`} />
      <WorkflowLineList
        canEdit={canEdit}
        emptyLabel="No tasks in this scope."
        items={items}
        onDelete={onDelete}
        onPreview={(item) => {
          const task = tasksById.get(item.id);
          if (task) onPreview(task);
        }}
        onSelect={(item) => {
          const task = tasksById.get(item.id);
          if (task) onSelect(task);
        }}
        onTogglePin={onTogglePin}
      />
    </div>
  );
}

function workflowPreviewFromIdea(idea: Idea): NonNullable<WorkflowPreviewState> {
  return {
    kind: "Idea",
    title: idea.title,
    originalText: idea.originalText || idea.summary || idea.title,
    meta: `${idea.owner} / ${idea.category} / ${idea.status}`,
  };
}

function workflowPreviewFromDecision(decision: Decision): NonNullable<WorkflowPreviewState> {
  return {
    kind: "Decision",
    title: decision.title,
    originalText: decision.originalText || decision.title,
    meta: `${decision.owner} / ${decision.status} / ${decision.due}`,
  };
}

function workflowPreviewFromApproval(approval: Approval): NonNullable<WorkflowPreviewState> {
  return {
    kind: "Approval",
    title: approval.title,
    originalText: approval.originalText || approval.title,
    meta: `${approval.owner} / ${approval.status} / ${approval.due}`,
  };
}

function workflowPreviewFromTask(task: Task): NonNullable<WorkflowPreviewState> {
  return {
    kind: "Task",
    title: task.title,
    originalText: task.originalText || task.title,
    meta: `${task.owner} / ${task.status} / ${task.source}`,
  };
}

function PromptView({ canEdit, onUsePrompt, prompts }: { canEdit: boolean; onUsePrompt: (value: string) => void; prompts: string[] }) {
  return (
    <div className="space-y-4">
      <SectionHeader eyebrow="Prompts" title="Scoped prompts" />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {prompts.map((prompt) => (
          <button
            className="grid min-h-28 gap-3 rounded-lg border bg-card p-4 text-left text-sm leading-6 hover:bg-accent/35"
            key={prompt}
            type="button"
            onClick={() => onUsePrompt(prompt)}
          >
            <Sparkles className="size-5 text-primary" />
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}

type ChatTableRow = {
  id: string;
  title: string;
  scope: string;
  project: string;
  section: "Project" | "Standalone";
  messages: number;
  description: string;
};

type PromptTableRow = {
  id: string;
  scope: string;
  title: string;
  prompt: string;
};

function CategoryTablePage({
  activeMode,
  canEdit,
  rail,
  workspace,
  onUsePrompt,
}: {
  activeMode: WorkspaceMode;
  canEdit: boolean;
  rail: Exclude<RailName, "Workspaces">;
  workspace: ScopedWorkspaceState;
  onUsePrompt: (prompt: string) => void;
}) {
  const scopeLabel = workspaceModeLabel(activeMode);

  return (
    <section className="scrollbar-thin min-h-0 overflow-auto p-4 lg:p-6">
      <SectionHeader
        eyebrow={scopeLabel}
        title={rail}
        description={rail === "Chats" ? "Project chats and general chats for this scope." : `${rail} scoped to ${scopeLabel}.`}
      />
      {rail === "Chats" ? <ChatsTable workspace={workspace} scopeLabel={scopeLabel} /> : null}
      {rail === "Ideas" ? <IdeasTable ideas={workspace.ideas} /> : null}
      {rail === "Artifacts" ? <ArtifactsTable artifacts={workspace.artifacts} /> : null}
      {rail === "Decisions" ? <DecisionsTable decisions={workspace.decisions} /> : null}
      {rail === "Approvals" ? <ApprovalsTable approvals={workspace.approvals} /> : null}
      {rail === "Tasks" ? <TasksTable tasks={workspace.tasks} /> : null}
      {rail === "Prompts" ? <PromptsTable canEdit={canEdit} scopeLabel={scopeLabel} onUsePrompt={onUsePrompt} /> : null}
    </section>
  );
}

function ChatsTable({ scopeLabel, workspace }: { scopeLabel: string; workspace: ScopedWorkspaceState }) {
  const data = useMemo<ChatTableRow[]>(() => {
    const standaloneRows = workspace.workspaceChats.map((chat) => ({
      id: chat.id,
      title: chat.title,
      scope: scopeLabel,
      project: "None",
      section: "Standalone" as const,
      messages: workspace.conversations[getConversationKey(workspace.mode, null, chat.id)]?.length ?? 0,
      description: chat.description,
    }));
    const projectRows = workspace.projects.flatMap((project) =>
      project.projectChats.map((chat) => ({
        id: chat.id,
        title: chat.title,
        scope: scopeLabel,
        project: project.name,
        section: "Project" as const,
        messages: workspace.conversations[getConversationKey(workspace.mode, project.id, chat.id)]?.length ?? 0,
        description: chat.description,
      })),
    );
    return [...projectRows, ...standaloneRows];
  }, [scopeLabel, workspace]);

  const columns = useMemo<ColumnDef<ChatTableRow>[]>(
    () => [
      { accessorKey: "title", header: "Chat" },
      {
        accessorKey: "section",
        header: "Type",
        cell: ({ row }) => <Badge variant={row.original.section === "Project" ? "info" : "secondary"}>{row.original.section}</Badge>,
      },
      { accessorKey: "project", header: "Project" },
      { accessorKey: "messages", header: "Messages" },
      { accessorKey: "description", header: "Description" },
    ],
    [],
  );

  return <DataTable columns={columns} data={data} getRowId={(row) => row.id} />;
}

function IdeasTable({ ideas }: { ideas: Idea[] }) {
  const columns = useMemo<ColumnDef<Idea>[]>(
    () => [
      { accessorKey: "title", header: "Idea" },
      { accessorKey: "category", header: "Category" },
      { accessorKey: "owner", header: "Owner" },
      { accessorKey: "votes", header: "Votes" },
      { accessorKey: "impact", header: "Impact", cell: ({ row }) => <ScoreCell value={row.original.impact} /> },
      { accessorKey: "status", header: "Status", cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    ],
    [],
  );

  return <DataTable columns={columns} data={ideas} getRowId={(idea) => idea.id} />;
}

function ArtifactsTable({ artifacts }: { artifacts: Artifact[] }) {
  const columns = useMemo<ColumnDef<Artifact>[]>(
    () => [
      { accessorKey: "title", header: "Artifact" },
      { accessorKey: "type", header: "Type" },
      { accessorKey: "owner", header: "Owner" },
      { accessorKey: "date", header: "Date" },
      { accessorKey: "status", header: "Status" },
      { accessorKey: "r2Key", header: "R2 key" },
    ],
    [],
  );

  return <DataTable columns={columns} data={artifacts} getRowId={(artifact) => artifact.title} />;
}

function DecisionsTable({ decisions }: { decisions: Decision[] }) {
  const columns = useMemo<ColumnDef<Decision>[]>(
    () => [
      { accessorKey: "title", header: "Decision" },
      { accessorKey: "owner", header: "Owner" },
      { accessorKey: "due", header: "Due" },
      { accessorKey: "status", header: "Status" },
    ],
    [],
  );

  return <DataTable columns={columns} data={decisions} getRowId={(decision) => decision.id} />;
}

function ApprovalsTable({ approvals }: { approvals: Approval[] }) {
  const columns = useMemo<ColumnDef<Approval>[]>(
    () => [
      { accessorKey: "title", header: "Approval" },
      { accessorKey: "owner", header: "Approver" },
      { accessorKey: "due", header: "Due" },
      { accessorKey: "status", header: "Status" },
    ],
    [],
  );

  return <DataTable columns={columns} data={approvals} getRowId={(approval) => approval.id} />;
}

function TasksTable({ tasks }: { tasks: Task[] }) {
  const columns = useMemo<ColumnDef<Task>[]>(
    () => [
      { accessorKey: "title", header: "Task" },
      { accessorKey: "owner", header: "Owner" },
      { accessorKey: "source", header: "Source" },
      { accessorKey: "status", header: "Status" },
    ],
    [],
  );

  return <DataTable columns={columns} data={tasks} getRowId={(task) => task.id} />;
}

function PromptsTable({
  canEdit,
  onUsePrompt,
  scopeLabel,
}: {
  canEdit: boolean;
  onUsePrompt: (prompt: string) => void;
  scopeLabel: string;
}) {
  const data = useMemo<PromptTableRow[]>(
    () =>
      promptTemplates.map((prompt, index) => ({
        id: `${scopeLabel.toLowerCase()}-prompt-${index + 1}`,
        scope: scopeLabel,
        title: `Prompt ${index + 1}`,
        prompt,
      })),
    [scopeLabel],
  );
  const columns = useMemo<ColumnDef<PromptTableRow>[]>(
    () => [
      { accessorKey: "title", header: "Prompt" },
      { accessorKey: "scope", header: "Scope" },
      { accessorKey: "prompt", header: "Text" },
      {
        id: "action",
        header: "",
        cell: ({ row }) => (
          <Button type="button" variant="outline" size="sm" disabled={!canEdit} onClick={() => onUsePrompt(row.original.prompt)}>
            Use
          </Button>
        ),
      },
    ],
    [canEdit, onUsePrompt],
  );

  return <DataTable columns={columns} data={data} getRowId={(prompt) => prompt.id} />;
}

function DetailPanel({
  activeMode,
  activeTab,
  activeChat,
  approval,
  artifact,
  canEdit,
  decision,
  idea,
  isPinned,
  messages,
  metrics,
  prompts,
  scopeContextLabel,
  task,
  workspaceTitle,
  onClose,
  onPreviewArtifact,
  onPreviewWorkflow,
  onRestoreArtifactVersion,
  onShare,
  onStatusChange,
  onToggleArtifactPin,
  onToggleIdeaPin,
  onToggleWorkflowPin,
  onDeleteApproval,
  onDeleteDecision,
  onDeleteIdea,
  onDeleteTask,
  onUsePrompt,
  onVoteIdea,
}: {
  activeMode: WorkspaceMode;
  activeTab: TabName;
  activeChat?: ChatSummary;
  approval?: Approval;
  artifact?: Artifact;
  canEdit: boolean;
  decision?: Decision;
  idea?: Idea;
  isPinned: boolean;
  messages: ChatMessage[];
  metrics: DetailMetric[];
  prompts: string[];
  scopeContextLabel: string;
  task?: Task;
  workspaceTitle: string;
  onClose: () => void;
  onPreviewArtifact: (artifact: Artifact) => void;
  onPreviewWorkflow: (preview: NonNullable<WorkflowPreviewState>) => void;
  onRestoreArtifactVersion: (artifactId: string) => void;
  onShare: () => void;
  onStatusChange: (status: IdeaStatus) => void;
  onToggleArtifactPin: () => void;
  onToggleIdeaPin: () => void;
  onToggleWorkflowPin: (kind: "approval" | "decision" | "task", id: string) => void;
  onDeleteApproval: (id: string) => void;
  onDeleteDecision: (id: string) => void;
  onDeleteIdea: (id: string) => void;
  onDeleteTask: (id: string) => void;
  onUsePrompt: (prompt: string) => void;
  onVoteIdea: () => void;
}) {
  return (
    <aside className="scrollbar-thin hidden min-h-0 overflow-auto bg-muted/35 p-4 lg:block">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="text-xs font-semibold uppercase text-muted-foreground">Workspace detail</span>
          <p className="mt-1 truncate text-xs text-muted-foreground">Focused context for the active tab.</p>
        </div>
        <Button type="button" variant="outline" size="sm" aria-label="Close details flyout" onClick={onClose}>
          <PanelRightClose />
          Close
        </Button>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2">
        {metrics.map((metric) => (
          <MetricCard key={metric.label} {...metric} />
        ))}
      </div>

      {activeTab === "Chat" ? (
        <ChatMetadata activeChat={activeChat} messages={messages} scopeContextLabel={scopeContextLabel} workspaceTitle={workspaceTitle} />
      ) : null}

      {activeTab === "Ideas" && idea ? (
        <IdeaDetail
          canEdit={canEdit}
          idea={idea}
          isPinned={isPinned}
          onDelete={() => onDeleteIdea(idea.id)}
          onPreview={() => onPreviewWorkflow(workflowPreviewFromIdea(idea))}
          onShare={onShare}
          onStatusChange={onStatusChange}
          onToggleIdeaPin={onToggleIdeaPin}
          onVoteIdea={onVoteIdea}
        />
      ) : null}

      {activeTab === "Artifacts" && artifact ? (
        <ArtifactDetail
          activeMode={activeMode}
          artifact={artifact}
          canEdit={canEdit}
          onPreviewArtifact={onPreviewArtifact}
          onRestoreArtifactVersion={onRestoreArtifactVersion}
          onShare={onShare}
          onToggleArtifactPin={onToggleArtifactPin}
        />
      ) : null}

      {activeTab === "Decisions" && decision ? (
        <WorkflowMetadata
          icon={ClipboardList}
          label="Decision"
          title={decision.title}
          detail={`${decision.owner} / ${decision.status} / ${decision.due}`}
          originalText={decision.originalText}
          isPinned={Boolean(decision.pinned)}
          canEdit={canEdit}
          onDelete={() => onDeleteDecision(decision.id)}
          onPreview={() => onPreviewWorkflow(workflowPreviewFromDecision(decision))}
          onTogglePin={() => onToggleWorkflowPin("decision", decision.id)}
        />
      ) : null}
      {activeTab === "Approvals" && approval ? (
        <WorkflowMetadata
          icon={ShieldCheck}
          label="Approval"
          title={approval.title}
          detail={`${approval.owner} / ${approval.status} / ${approval.due}`}
          originalText={approval.originalText}
          isPinned={Boolean(approval.pinned)}
          canEdit={canEdit}
          onDelete={() => onDeleteApproval(approval.id)}
          onPreview={() => onPreviewWorkflow(workflowPreviewFromApproval(approval))}
          onTogglePin={() => onToggleWorkflowPin("approval", approval.id)}
        />
      ) : null}
      {activeTab === "Tasks" && task ? (
        <WorkflowMetadata
          icon={CheckCircle2}
          label="Task"
          title={task.title}
          detail={`${task.owner} / ${task.status} / ${task.source}`}
          originalText={task.originalText}
          isPinned={Boolean(task.pinned)}
          canEdit={canEdit}
          onDelete={() => onDeleteTask(task.id)}
          onPreview={() => onPreviewWorkflow(workflowPreviewFromTask(task))}
          onTogglePin={() => onToggleWorkflowPin("task", task.id)}
        />
      ) : null}
      {activeTab === "Prompts" ? <PromptMetadata canEdit={canEdit} prompts={prompts} scopeContextLabel={scopeContextLabel} onUsePrompt={onUsePrompt} /> : null}
    </aside>
  );
}

function ChatMetadata({
  activeChat,
  messages,
  scopeContextLabel,
  workspaceTitle,
}: {
  activeChat?: ChatSummary;
  messages: ChatMessage[];
  scopeContextLabel: string;
  workspaceTitle: string;
}) {
  return (
    <Card className="mb-3">
      <CardHeader>
        <CardTitle className="text-lg leading-6">{activeChat?.title ?? "No chat selected"}</CardTitle>
        <CardDescription>{workspaceTitle} / {scopeContextLabel}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 pt-4">
        <p className="text-sm leading-6 text-muted-foreground">{activeChat?.description ?? "Select a scoped chat to load its metadata."}</p>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-md border bg-background p-3">
            <strong className="block">{messages.length}</strong>
            <span className="text-xs text-muted-foreground">Messages</span>
          </div>
          <div className="rounded-md border bg-background p-3">
            <strong className="block">{scopeContextLabel}</strong>
            <span className="text-xs text-muted-foreground">Scope context</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function WorkflowMetadata({
  canEdit,
  detail,
  icon: Icon,
  isPinned,
  label,
  onDelete,
  onPreview,
  onTogglePin,
  originalText,
  title,
}: {
  canEdit: boolean;
  detail: string;
  icon: ComponentType<{ className?: string }>;
  isPinned: boolean;
  label: string;
  onDelete: () => void;
  onPreview: () => void;
  onTogglePin: () => void;
  originalText?: string;
  title: string;
}) {
  return (
    <Card className="mb-3">
      <CardHeader>
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
            <Icon className="size-5" />
          </span>
          <div className="min-w-0">
            <CardDescription>{label}</CardDescription>
            <CardTitle className="mt-1 text-lg leading-6">{title}</CardTitle>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        <p className="text-sm text-muted-foreground">{detail}</p>
        {originalText ? (
          <p className="rounded-md bg-muted/45 p-3 text-sm leading-6">{originalText}</p>
        ) : null}
        <Button type="button" variant="outline" onClick={onPreview}>
          <Eye />
          Preview
        </Button>
        {canEdit ? (
          <>
            <Button type="button" variant="outline" className="ml-2" onClick={onTogglePin}>
              <Star className={cn(isPinned && "fill-warning text-warning")} />
              {isPinned ? "Unpin" : "Pin"}
            </Button>
            <Button type="button" variant="outline" className="ml-2 text-destructive hover:text-destructive" onClick={onDelete}>
              <Trash2 />
              Delete
            </Button>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PromptMetadata({
  canEdit,
  onUsePrompt,
  prompts,
  scopeContextLabel,
}: {
  canEdit: boolean;
  onUsePrompt: (prompt: string) => void;
  prompts: string[];
  scopeContextLabel: string;
}) {
  return (
    <Card className="mb-3">
      <CardHeader>
        <CardTitle className="text-lg leading-6">Prompt metadata</CardTitle>
        <CardDescription>{scopeContextLabel}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 pt-4">
        {prompts.slice(0, 3).map((prompt) => (
          <button
            className="w-full rounded-md border bg-background p-3 text-left text-sm leading-5 hover:bg-accent"
            key={prompt}
            type="button"
            disabled={!canEdit}
            onClick={() => canEdit && onUsePrompt(prompt)}
          >
            {prompt}
          </button>
        ))}
      </CardContent>
    </Card>
  );
}

function IdeaDetail({
  canEdit,
  idea,
  isPinned,
  onDelete,
  onPreview,
  onShare,
  onStatusChange,
  onToggleIdeaPin,
  onVoteIdea,
}: {
  canEdit: boolean;
  idea: Idea;
  isPinned: boolean;
  onDelete: () => void;
  onPreview: () => void;
  onShare: () => void;
  onStatusChange: (status: IdeaStatus) => void;
  onToggleIdeaPin: () => void;
  onVoteIdea: () => void;
}) {
  return (
    <Card className="mb-3">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <StatusBadge status={idea.status} />
            <CardTitle className="mt-2 text-lg leading-6">{idea.title}</CardTitle>
            <CardDescription>{idea.category}</CardDescription>
          </div>
          {canEdit ? (
            <Button type="button" variant="ghost" size="icon" onClick={onToggleIdeaPin} aria-label={isPinned ? "Unpin idea" : "Pin idea"}>
              <Star className={cn(isPinned && "fill-warning text-warning")} />
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        <p className="text-sm leading-6 text-muted-foreground">{idea.summary}</p>
        <div className="flex items-center gap-2">
          <img alt={idea.owner} className="size-9 rounded-full object-cover" src={idea.avatar} />
          <div>
            <strong className="block text-sm">{idea.owner}</strong>
            <span className="text-xs text-muted-foreground">Owner / {idea.created}</span>
          </div>
        </div>
        <div className="space-y-3">
          <ProgressMetric label="Impact" value={idea.impact} />
          <ProgressMetric label="Effort" value={idea.effort} />
          <ProgressMetric label="Confidence" value={idea.confidence} />
        </div>
        <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">{idea.nextStep}</div>
        <div className="flex flex-wrap gap-2">
          {idea.tags.map((tag) => (
            <Badge key={tag} variant="outline">
              {tag}
            </Badge>
          ))}
        </div>
        <label className="grid gap-2">
          <span className="text-sm font-medium">Status</span>
          <select
            aria-label="Idea status"
            title="Idea status"
            className="h-9 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            value={idea.status}
            disabled={!canEdit}
            onChange={(event) => onStatusChange(event.target.value as IdeaStatus)}
          >
            {(Object.keys(statusMeta) as IdeaStatus[]).map((status) => (
              <option key={status} value={status}>
                {statusMeta[status].label}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" onClick={onPreview}>
            <Eye />
            Preview
          </Button>
          {canEdit ? (
            <Button type="button" variant="outline" className="text-destructive hover:text-destructive" onClick={onDelete}>
              <Trash2 />
              Delete
            </Button>
          ) : null}
        </div>
        {canEdit ? (
          <div className="grid grid-cols-3 gap-2">
            <Button type="button" variant="outline" onClick={onVoteIdea}>
              <Zap />
              Vote
            </Button>
            <Button type="button" variant="outline" onClick={onShare}>
              <Share2 />
              Share
            </Button>
            <Button type="button" variant="outline" onClick={onToggleIdeaPin}>
              <Star />
              {isPinned ? "Unpin" : "Pin"}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ArtifactDetail({
  activeMode,
  artifact,
  canEdit,
  onPreviewArtifact,
  onRestoreArtifactVersion,
  onShare,
  onToggleArtifactPin,
}: {
  activeMode: WorkspaceMode;
  artifact: Artifact;
  canEdit: boolean;
  onPreviewArtifact: (artifact: Artifact) => void;
  onRestoreArtifactVersion: (artifactId: string) => void;
  onShare: () => void;
  onToggleArtifactPin: () => void;
}) {
  const isPinned = artifact.pinnedTo.includes(activeMode);
  const isWorkbook = artifact.type === "XLSX";
  const versionHistory = artifact.versionHistory ?? [];

  return (
    <Card className="mb-3">
      <CardHeader>
        <CardTitle className="text-lg leading-6">{artifact.title}</CardTitle>
        <CardDescription>
          {artifact.type} / {artifact.status} / {artifact.owner} / v{artifact.version}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        <p className="text-sm leading-6 text-muted-foreground">{artifact.summary}</p>
        {!isWorkbook ? (
          <ArtifactRenderer
            fileType={artifact.type}
            previewJson={artifact.previewJson}
            fallbackPreview={artifact.preview}
          />
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          {canEdit ? (
            <Button type="button" variant="outline" onClick={onToggleArtifactPin}>
              <Star className={cn(isPinned && "fill-warning text-warning")} />
              {isPinned ? "Unpin" : "Pin"}
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={() => onPreviewArtifact(artifact)}>
            <Eye />
            Preview
          </Button>
          {canEdit ? (
            <Button type="button" variant="outline" onClick={onShare}>
              <Share2 />
              Share
            </Button>
          ) : null}
          <Button asChild>
            <a href={artifact.href} download>
              <Download />
              Download
            </a>
          </Button>
        </div>
        {versionHistory.length > 0 ? (
          <div className="space-y-2 rounded-md border bg-muted/25 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">Version history</span>
              <Badge variant="secondary">{versionHistory.length} versions</Badge>
            </div>
            <div className="space-y-2">
              {versionHistory.map((version) => {
                const isLatest = version.id === artifact.id;
                return (
                  <div key={version.id} className="rounded-md border bg-background p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <strong className="block text-sm">Version {version.version}{isLatest ? " current" : ""}</strong>
                        <span className="block text-xs text-muted-foreground">{version.date} / {version.commitMessage}</span>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-1">
                        <Button type="button" variant="outline" size="sm" title="Preview this version read-only" onClick={() => onPreviewArtifact(version)}>
                          <Eye />
                          Preview
                        </Button>
                        {canEdit && !isLatest ? (
                          <Button type="button" variant="outline" size="sm" title="Restore by creating a new latest version" onClick={() => onRestoreArtifactVersion(version.id)}>
                            Restore
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function AddIdeaDialog({
  open,
  pending,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (value: AddIdeaInput) => Promise<void>;
}) {
  const form = useForm({
    defaultValues: emptyIdeaForm,
    onSubmit: async ({ value }) => {
      await onSubmit(value);
      form.reset();
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Capture PMO improvement</DialogTitle>
          <DialogDescription>Add an idea to the SSR query-backed improvement queue.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            form.handleSubmit();
          }}
        >
          <form.Field
            name="title"
            validators={{
              onChange: ({ value }) => (value.trim().length > 0 ? undefined : "Title is required"),
            }}
            children={(field) => (
              <FieldBlock label="Idea title" error={field.state.meta.errors.map(String).join(", ")}>
                <Input
                  data-testid="idea-title"
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="Example: Meeting action item extractor"
                  autoFocus
                />
              </FieldBlock>
            )}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <form.Field
              name="category"
              children={(field) => (
                <FieldBlock label="Category">
                  <select
                    aria-label="Idea category"
                    title="Idea category"
                    className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    data-testid="idea-category"
                  >
                    <option>Governance</option>
                    <option>Risk and issue management</option>
                    <option>Intake</option>
                    <option>Planning</option>
                    <option>Artifacts</option>
                    <option>Change management</option>
                  </select>
                </FieldBlock>
              )}
            />
            <form.Field
              name="status"
              children={(field) => (
                <FieldBlock label="Status">
                  <select
                    aria-label="Idea status"
                    title="Idea status"
                    className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value as IdeaStatus)}
                    data-testid="idea-status"
                  >
                    {(Object.keys(statusMeta) as IdeaStatus[]).map((status) => (
                      <option key={status} value={status}>
                        {statusMeta[status].label}
                      </option>
                    ))}
                  </select>
                </FieldBlock>
              )}
            />
          </div>
          <form.Field
            name="impact"
            children={(field) => (
              <FieldBlock label="Expected impact">
                <select
                  aria-label="Expected impact"
                  title="Expected impact"
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value as AddIdeaInput["impact"])}
                  data-testid="idea-impact"
                >
                  <option>High</option>
                  <option>Medium</option>
                  <option>Low</option>
                </select>
              </FieldBlock>
            )}
          />
          <form.Field
            name="summary"
            children={(field) => (
              <FieldBlock label="Summary">
                <Textarea
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="What problem does this solve, and how would the assistant help?"
                />
              </FieldBlock>
            )}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending} data-testid="submit-idea">
              <Plus />
              Add to queue
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CreateTeamDialog({
  open,
  pending,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (value: CreateTeamInput) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;
    await onSubmit({ name: trimmedName, description: description.trim() });
    setName("");
    setDescription("");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New team</DialogTitle>
          <DialogDescription>Create a team workspace for shared projects and assigned users.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <FieldBlock label="Team name">
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Example: AI Operations" autoFocus />
          </FieldBlock>
          <FieldBlock label="Description">
            <Textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What this team owns." />
          </FieldBlock>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !name.trim()}>
              <Plus />
              Create team
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TutorialDialog({
  canAct,
  open,
  stepIndex,
  steps,
  onComplete,
  onOpenChange,
  onStepChange,
}: {
  canAct: boolean;
  open: boolean;
  stepIndex: number;
  steps: TutorialStep[];
  onComplete: () => void;
  onOpenChange: (open: boolean) => void;
  onStepChange: (index: number) => void;
}) {
  const activeStep = steps[stepIndex] ?? steps[0];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === steps.length - 1;

  function runStepAction() {
    if (!canAct && activeStep.actionLabel?.toLowerCase().includes("form")) return;
    activeStep.onAction?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
            <Badge variant="secondary">Step {stepIndex + 1} of {steps.length}</Badge>
            <div className="flex gap-1" aria-hidden="true">
              {steps.map((step, index) => (
                <span
                  key={step.title}
                  className={cn(
                    "h-1.5 w-8 rounded-full",
                    index <= stepIndex ? "bg-primary" : "bg-muted",
                  )}
                />
              ))}
            </div>
          </div>
          <DialogTitle>{activeStep.title}</DialogTitle>
          <DialogDescription>{activeStep.description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-[160px_minmax(0,1fr)]">
          <div className="grid min-h-36 place-items-center rounded-md border bg-primary/5 text-primary">
            <div className="grid size-20 place-items-center rounded-full bg-primary text-2xl font-semibold text-primary-foreground">
              {stepIndex + 1}
            </div>
          </div>
          <div className="space-y-3">
            <p className="text-sm leading-6 text-muted-foreground">{activeStep.detail}</p>
            {!canAct ? (
              <p className="rounded-md border border-warning/35 bg-warning/10 p-3 text-sm text-muted-foreground">
                Viewer access is read-only, so creation steps are shown as navigation only.
              </p>
            ) : null}
            {activeStep.actionLabel ? (
              <Button type="button" variant="outline" onClick={runStepAction}>
                <Sparkles className="size-4" />
                {activeStep.actionLabel}
              </Button>
            ) : null}
          </div>
        </div>
        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button type="button" variant="ghost" onClick={onComplete}>
            Skip tutorial
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" disabled={isFirst} onClick={() => onStepChange(Math.max(0, stepIndex - 1))}>
              Back
            </Button>
            {isLast ? (
              <Button type="button" onClick={onComplete}>
                Finish
              </Button>
            ) : (
              <Button type="button" onClick={() => onStepChange(Math.min(steps.length - 1, stepIndex + 1))}>
                Next
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateProjectDialog({
  mode,
  open,
  pending,
  teamName,
  onOpenChange,
  onSubmit,
}: {
  mode: WorkspaceMode;
  open: boolean;
  pending: boolean;
  teamName?: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (value: Omit<CreateProjectInput, "mode" | "teamId">) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const scopeLabel = mode === "Team" && teamName ? teamName : workspaceModeLabel(mode);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;
    await onSubmit({ name: trimmedName, description: description.trim(), status: "Planning" });
    setName("");
    setDescription("");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>Add a project to {scopeLabel}.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <FieldBlock label="Project name">
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Example: Enrollment Assistant" autoFocus />
          </FieldBlock>
          <FieldBlock label="Description">
            <Textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What this project is responsible for." />
          </FieldBlock>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !name.trim()}>
              <Plus />
              Create project
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CreateChatDialog({
  contextLabel,
  open,
  pending,
  section,
  onOpenChange,
  onSubmit,
}: {
  contextLabel: string;
  open: boolean;
  pending: boolean;
  section: ChatSection;
  onOpenChange: (open: boolean) => void;
  onSubmit: (value: Omit<CreateChatInput, "mode" | "teamId" | "projectId" | "section">) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const chatType = section === "project" ? "project AI chat" : "scoped AI chat";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;
    await onSubmit({ title: trimmedTitle, description: description.trim() });
    setTitle("");
    setDescription("");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New chat</DialogTitle>
          <DialogDescription>
            Create a fresh {chatType} for {contextLabel}.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <FieldBlock label="Chat name">
            <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Example: Launch planning assistant" autoFocus />
          </FieldBlock>
          <FieldBlock label="Description">
            <Textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What this AI chat should help with." />
          </FieldBlock>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !title.trim()}>
              <Plus />
              Create chat
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function BrandedConfirmDialog({
  state,
  onOpenChange,
}: {
  state: ConfirmDialogState;
  onOpenChange: (open: boolean) => void;
}) {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (state) setError("");
  }, [state]);

  async function handleConfirm() {
    if (!state) return;
    setIsPending(true);
    setError("");
    try {
      await state.onConfirm();
      onOpenChange(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : "The action could not be completed.");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Dialog open={Boolean(state)} onOpenChange={(open) => !isPending && onOpenChange(open)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{state?.title ?? "Confirm action"}</DialogTitle>
          <DialogDescription>{state?.description ?? "Confirm this action before continuing."}</DialogDescription>
        </DialogHeader>
        {error ? <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={isPending} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" variant={state?.destructive ? "destructive" : "default"} disabled={isPending} onClick={handleConfirm}>
            {isPending ? "Working..." : state?.actionLabel ?? "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BrandedInputDialog({
  state,
  onOpenChange,
}: {
  state: InputDialogState;
  onOpenChange: (open: boolean) => void;
}) {
  const [value, setValue] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!state) return;
    setValue(state.defaultValue ?? "");
    setError("");
  }, [state]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!state) return;
    const trimmedValue = value.trim();
    if (!trimmedValue) {
      setError(`${state.label} is required.`);
      return;
    }
    setIsPending(true);
    setError("");
    try {
      await state.onSubmit(trimmedValue);
      onOpenChange(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : "The action could not be completed.");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Dialog open={Boolean(state)} onOpenChange={(open) => !isPending && onOpenChange(open)}>
      <DialogContent>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{state?.title ?? "Enter value"}</DialogTitle>
            <DialogDescription>{state?.description ?? "Provide the details below."}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="branded-input-dialog-value">{state?.label ?? "Value"}</Label>
            <Input
              id="branded-input-dialog-value"
              autoFocus
              type={state?.inputType ?? "text"}
              value={value}
              placeholder={state?.placeholder}
              onChange={(event) => setValue(event.target.value)}
            />
          </div>
          {error ? <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={isPending} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Working..." : state?.actionLabel ?? "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ArtifactPreviewDialog({
  artifact,
  onOpenChange,
}: {
  artifact: Artifact | null;
  onOpenChange: (open: boolean) => void;
}) {
  const isWorkbook = artifact?.type === "XLSX";

  return (
    <Dialog open={Boolean(artifact)} onOpenChange={onOpenChange}>
      <DialogContent className={cn(isWorkbook ? "max-h-[92vh] max-w-[min(1120px,calc(100vw-32px))] overflow-hidden p-0" : "max-w-2xl")}>
        {artifact ? (
          <>
            <DialogHeader className={cn(isWorkbook && "border-b px-5 py-4")}>
              <DialogTitle>{artifact.title}</DialogTitle>
              <DialogDescription>
                {artifact.type} / {artifact.status} / {artifact.owner} / v{artifact.version}
                {artifact.sourceChatTitle ? ` / Chat: ${artifact.sourceChatTitle}` : ""}
              </DialogDescription>
            </DialogHeader>
            <div className={cn(
              "grid gap-4 sm:grid-cols-[150px_minmax(0,1fr)]",
              isWorkbook && "mx-5 mt-4 rounded-md border bg-muted/30 p-3 sm:grid-cols-[96px_minmax(0,1fr)]",
            )}>
              <div className="grid min-h-44 place-items-center content-center gap-2 rounded-lg border bg-muted text-primary">
                {artifactIcon(artifact.type)}
                <strong>{artifact.type}</strong>
                <span className="text-xs text-muted-foreground">{artifact.status} / v{artifact.version}</span>
              </div>
              <div className="space-y-3">
                <p className="text-sm leading-6 text-muted-foreground">{artifact.summary}</p>
                <div className="rounded-md border bg-background px-3 py-2 text-sm">
                  <span className="font-semibold text-foreground">Source chat</span>
                  <p className="mt-1 text-muted-foreground">{artifact.sourceChatTitle ?? "Not captured for this artifact"}</p>
                </div>
                <ArtifactRenderer
                  fileType={artifact.type}
                  previewJson={artifact.previewJson}
                  fallbackPreview={artifact.preview}
                />
              </div>
            </div>
            {isWorkbook && !hasStructuredTablePreview(artifact.previewJson) ? <XlsxArtifactPreview artifact={artifact} /> : null}
            <DialogFooter className={cn(isWorkbook && "border-t px-5 py-4")}>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button asChild>
                <a href={artifact.href} download>
                  <Download />
                  Download {artifact.type}
                </a>
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function WorkflowPreviewDialog({
  onOpenChange,
  preview,
}: {
  onOpenChange: (open: boolean) => void;
  preview: WorkflowPreviewState;
}) {
  return (
    <Dialog open={Boolean(preview)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        {preview ? (
          <>
            <DialogHeader>
              <DialogTitle>{preview.title}</DialogTitle>
              <DialogDescription>
                {preview.kind} / {preview.meta}
              </DialogDescription>
            </DialogHeader>
            <div className="rounded-md border bg-background p-4">
              <p className="whitespace-pre-wrap text-sm leading-6">{preview.originalText}</p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function parsePreviewRows(rowsJson: string) {
  try {
    const parsed = JSON.parse(rowsJson);
    if (!Array.isArray(parsed)) return { columns: [], rows: [] };
    if (parsed.every((row) => row && typeof row === "object" && !Array.isArray(row))) {
      const columns = Array.from(new Set(parsed.flatMap((row) => Object.keys(row as Record<string, unknown>))));
      return {
        columns,
        rows: parsed.slice(0, 100).map((row) => columns.map((column) => String((row as Record<string, unknown>)[column] ?? ""))),
      };
    }
    if (parsed.every((row) => Array.isArray(row))) {
      const rows = parsed.map((row) => (row as unknown[]).map((cell) => String(cell ?? "")));
      return { columns: rows[0] ?? [], rows: rows.slice(1, 101) };
    }
    return { columns: [], rows: [] };
  } catch {
    return { columns: [], rows: [] };
  }
}

function hasStructuredTablePreview(previewJson: unknown) {
  if (!previewJson || typeof previewJson !== "object" || Array.isArray(previewJson)) return false;
  const record = previewJson as { rows?: unknown };
  return Array.isArray(record.rows);
}

type XlsxPreviewSheet = {
  name: string;
  rows: string[][];
  rowCount: number;
  columnCount: number;
};

const xlsxPreviewMaxRows = 100;
const xlsxPreviewMaxColumns = 30;

function XlsxArtifactPreview({ artifact }: { artifact: Artifact }) {
  const [sheets, setSheets] = useState<XlsxPreviewSheet[]>([]);
  const [activeSheetName, setActiveSheetName] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");
    setError("");
    setSheets([]);
    setActiveSheetName("");

    async function loadWorkbookPreview() {
      try {
        const response = await fetch(artifact.href, { signal: controller.signal });
        if (!response.ok) throw new Error(`Could not load workbook preview (${response.status}).`);
        const buffer = await response.arrayBuffer();
        const { default: ExcelJS } = await import("exceljs");
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer);
        const nextSheets: XlsxPreviewSheet[] = [];
        workbook.eachSheet((worksheet) => {
          const rowCount = worksheet.actualRowCount;
          const columnCount = worksheet.actualColumnCount;
          const visibleRows = Math.min(rowCount, xlsxPreviewMaxRows);
          const visibleColumns = Math.min(columnCount, xlsxPreviewMaxColumns);
          const rows = Array.from({ length: visibleRows }, (_row, rowIndex) => {
            const worksheetRow = worksheet.getRow(rowIndex + 1);
            return Array.from({ length: visibleColumns }, (_column, columnIndex) =>
              previewCellValue(worksheetRow.getCell(columnIndex + 1).value),
            );
          });
          nextSheets.push({ name: worksheet.name, rows, rowCount, columnCount });
        });
        if (controller.signal.aborted) return;
        setSheets(nextSheets);
        setActiveSheetName(nextSheets[0]?.name ?? "");
        setStatus("ready");
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : "Could not load workbook preview.");
        setStatus("error");
      }
    }

    void loadWorkbookPreview();
    return () => controller.abort();
  }, [artifact.href]);

  const activeSheet = sheets.find((sheet) => sheet.name === activeSheetName) ?? sheets[0];
  const hasTruncation = activeSheet
    ? activeSheet.rowCount > xlsxPreviewMaxRows || activeSheet.columnCount > xlsxPreviewMaxColumns
    : false;

  return (
    <div className="mx-5 my-4 min-h-0 space-y-3 overflow-hidden rounded-md border bg-background p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Workbook preview</h3>
          <p className="text-xs text-muted-foreground">
            {status === "ready" && activeSheet
              ? `${activeSheet.rowCount} rows / ${activeSheet.columnCount} columns`
              : "Loading workbook data"}
          </p>
        </div>
        {sheets.length > 1 ? (
          <div className="flex max-w-full flex-wrap gap-1">
            {sheets.map((sheet) => (
              <Button
                key={sheet.name}
                type="button"
                size="sm"
                variant={sheet.name === activeSheet?.name ? "default" : "outline"}
                onClick={() => setActiveSheetName(sheet.name)}
              >
                {sheet.name}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
      {status === "loading" ? (
        <div className="grid min-h-40 place-items-center rounded-md border border-dashed text-sm text-muted-foreground">
          Loading workbook preview...
        </div>
      ) : null}
      {status === "error" ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      {status === "ready" && activeSheet ? (
        <>
          <div className="max-h-[52vh] max-w-full overflow-auto rounded-md border">
            <Table className="w-max min-w-full">
              <TableBody>
                {activeSheet.rows.map((row, rowIndex) => (
                  <TableRow key={`${activeSheet.name}-${rowIndex}`}>
                    {row.map((cell, columnIndex) => (
                      rowIndex === 0 ? (
                        <TableHead
                          key={`${activeSheet.name}-${rowIndex}-${columnIndex}`}
                          className="sticky top-0 z-10 min-w-28 max-w-56 bg-primary px-2 py-2 text-primary-foreground"
                        >
                          <span className="line-clamp-2 normal-case">{cell || columnLabel(columnIndex)}</span>
                        </TableHead>
                      ) : (
                        <TableCell
                          key={`${activeSheet.name}-${rowIndex}-${columnIndex}`}
                          className="min-w-28 max-w-56 truncate px-2 py-2 text-xs"
                          title={cell}
                        >
                          {cell}
                        </TableCell>
                      )
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {hasTruncation ? (
            <p className="text-xs text-muted-foreground">
              Preview is limited to the first {xlsxPreviewMaxRows} rows and {xlsxPreviewMaxColumns} columns.
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function previewCellValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toLocaleDateString();
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    const record = value as {
      text?: unknown;
      result?: unknown;
      formula?: unknown;
      richText?: Array<{ text?: unknown }>;
      hyperlink?: unknown;
    };
    if (record.result !== undefined) return previewCellValue(record.result);
    if (record.text !== undefined) return previewCellValue(record.text);
    if (Array.isArray(record.richText)) return record.richText.map((part) => previewCellValue(part.text)).join("");
    if (record.formula !== undefined) return `=${String(record.formula)}`;
    if (record.hyperlink !== undefined) return String(record.hyperlink);
  }
  return String(value);
}

function columnLabel(index: number) {
  let label = "";
  let current = index + 1;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    current = Math.floor((current - 1) / 26);
  }
  return label;
}

function DataTable<TData extends object>({
  columns,
  data,
  getRowId,
  onRowClick,
  selectedId,
}: {
  columns: ColumnDef<TData>[];
  data: TData[];
  getRowId: (row: TData) => string;
  onRowClick?: (row: TData) => void;
  selectedId?: string;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id}>
                  {header.isPlaceholder ? null : header.column.getCanSort() ? (
                    <button
                      className="inline-flex items-center gap-1"
                      type="button"
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      <ArrowUpDown className="size-3" />
                    </button>
                  ) : (
                    flexRender(header.column.columnDef.header, header.getContext())
                  )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow
                className={cn(onRowClick && "cursor-pointer", selectedId === getRowId(row.original) && "bg-accent/35")}
                data-state={selectedId === getRowId(row.original) ? "selected" : undefined}
                key={row.id}
                onClick={() => onRowClick?.(row.original)}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell className="h-24 text-center text-muted-foreground" colSpan={columns.length}>
                No results.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function StatusBadge({ status }: { status: IdeaStatus }) {
  const meta = statusMeta[status];
  return <Badge variant={meta.tone}>{meta.label}</Badge>;
}

function ScoreCell({ value }: { value: number }) {
  return (
    <div className="min-w-20 space-y-1">
      <div className="text-xs font-medium">{value}</div>
      <Progress value={value} />
    </div>
  );
}

function ProgressMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{label}</span>
        <span className="flex items-center gap-1">
          <strong className="text-foreground">{value}</strong>
          <ChartExportButtons
            rows={[{ metric: label, value }]}
            title={label}
          />
        </span>
      </div>
      <Progress value={value} />
    </div>
  );
}

function MetricCard({
  detail,
  icon: Icon,
  label,
  value,
}: {
  detail: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <Card>
      <CardContent className="space-y-1 p-3">
        <div className="flex items-center justify-between gap-2">
          <Icon className="size-4 text-primary" />
          <ChartExportButtons
            rows={[{ metric: label, value, detail }]}
            title={label}
          />
        </div>
        <span className="block text-xs text-muted-foreground">{label}</span>
        <strong className="block text-xl">{value}</strong>
        <em className="block truncate text-xs not-italic text-muted-foreground">{detail}</em>
      </CardContent>
    </Card>
  );
}

function ChartExportButtons({
  rows,
  title,
}: {
  rows: Array<Record<string, string | number | boolean | null>>;
  title: string;
}) {
  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7"
        aria-label={`Export ${title} chart as CSV`}
        title="Export CSV"
        onClick={() => downloadRows("csv", title, rows)}
      >
        <Download className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7"
        aria-label={`Export ${title} chart as XLSX`}
        title="Export XLSX"
        onClick={() => downloadRows("xlsx", title, rows)}
      >
        <ClipboardList className="size-3.5" />
      </Button>
    </div>
  );
}

function SidebarAction({
  action,
  detail,
  icon: Icon,
  label,
  onClick,
  title,
}: {
  action: string;
  detail: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  title: string;
}) {
  return (
    <Card className="mb-3">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start gap-3">
          <Icon className="mt-0.5 size-5 text-primary" />
          <div className="min-w-0">
            <span className="text-xs font-semibold uppercase text-muted-foreground">{label}</span>
            <strong className="line-clamp-2 text-sm">{title}</strong>
            <em className="mt-1 block text-xs not-italic text-muted-foreground">{detail}</em>
          </div>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onClick}>
          {action}
        </Button>
      </CardContent>
    </Card>
  );
}

function FieldBlock({
  children,
  error,
  label,
}: {
  children: ReactNode;
  error?: string;
  label: string;
}) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      {children}
      {error ? <em className="text-xs not-italic text-destructive">{error}</em> : null}
    </div>
  );
}

function artifactIcon(type: string) {
  if (type === "sheet" || type === "XLSX") return <ClipboardList className="size-4" />;
  if (type === "ppt" || type === "PPTX") return <BarChart3 className="size-4" />;
  return <FileText className="size-4" />;
}
