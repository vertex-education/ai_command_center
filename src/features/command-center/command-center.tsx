import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { FileText, Paperclip, PanelRightOpen, Settings, Send, X, Zap } from "lucide-react";
import { type ExtractedChatAttachment } from "@/lib/attachment-extraction";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isAdminRole, roleCanModifyState } from "@/lib/auth-access-control";
import { authClient } from "@/lib/auth-client";
import { isAutomatedBriefingsChat } from "@/lib/briefing-thread";
import { type ChatMessageInsertEvent, type WorkspacePresenceUser } from "@/lib/chat-sync";
import { type ChatOperationalEntity } from "@/lib/chat-entities";
import { createOptimisticId, runServerMutation } from "@/lib/optimistic-mutations";
import { cn } from "@/lib/utils";
import { generateRiskMitigation } from "@/lib/risks";
import {
  type AddIdeaInput,
  type Approval,
  type Artifact,
  type ArtifactPatchDraftResult,
  type ChatAttachment,
  type ChatMessage,
  type ChatReasoningLevel,
  type ChatSection,
  type CommitArtifactPatchInput,
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
  type Risk,
  type TabName,
  type Task,
  type WorkspaceMode,
  addIdea,
  avatarAlex,
  chatReasoningLevels,
  chatReasoningProfiles,
  commitArtifactPatch,
  createApprovalFromSuggestion,
  createDecisionFromSuggestion,
  createIdeaFromSuggestion,
  createTaskFromSuggestion,
  draftArtifactPatch,
  getConversationKey,
  pmoWorkspaceQueryKey,
  pmoWorkspaceQueryOptions,
  promptTemplates,
  sendChatMessage,
  restoreArtifactVersion,
  refreshIdeaAssessment,
  removeSuggestedApproval,
  removeSuggestedDecision,
  removeSuggestedIdea,
  removeSuggestedTask,
  syncTaskToAsana,
  tabs,
  toggleArtifactPin,
  toggleIdeaPin,
  toggleWorkflowActionPin,
  updateApprovalStatus,
  updateDecisionStatus,
  updateIdeaStatus,
  workspaceModeLabel,
  workspaceModes,
} from "@/lib/pmo-data";
import { type ChatWithScopedRagCitation } from "@/lib/rag";
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
  persistScopedRagChatTurn,
  updateScopedProjectInstructions,
  type CreateChatInput,
  type CreateProjectInput,
  type BranchChatInput,
  type DeleteChatInput,
  type DeleteProjectInput,
  type PersistScopedRagChatInput,
  type RenameChatInput,
  type ScopedChatsResult,
  type TeamSummary,
  type UpdateProjectInstructionsInput,
  renameScopedChat,
} from "@/lib/team-workflow";
import {
  type CommandCenterSession,
  type ConfirmDialogState,
  type CreateChatDialogState,
  type CreateTeamInput,
  type InputDialogState,
  type PageScopeKind,
  type ToastLink,
  type TutorialStep,
  type WorkflowPreviewState,
  addTaskToWorkspaceCache,
  appendChatMessageToCache,
  appendChatMessageToScopedChats,
  emptyScopedChatsResult,
  getDetailMetrics,
  onboardingCompletedKey,
  onboardingRelaunchKey,
  removeOptimisticChatMessages,
  removeTaskFromWorkspaceCache,
  removeWorkflowItemFromWorkspaceCache,
  updateArtifactInWorkspaceCache,
  updateChatMessageInCache,
} from "./shared";
import { useWorkspaceEventSource } from "./use-workspace-events";
import { CategoryTablePageSkeleton, DetailPanelSkeleton, ProjectNavSkeleton, WorkspaceMainSkeleton } from "./skeletons";
import { LlmDevtools } from "./llm-devtools";
import { Contextbar, PinnedStrip, PrimaryRail, ProjectNav, ScopeTabs, Topbar } from "./layout";
import { ChatView, RenderedTableExportControls, consumeScopedRagEventSource, estimateTextTokens, formatScopedRagCitations } from "./chat";
import {
  ApprovalView,
  ArtifactsView,
  DecisionView,
  IdeasView,
  PromptView,
  RiskView,
  TaskView,
  workflowPreviewFromApproval,
  workflowPreviewFromDecision,
  workflowPreviewFromIdea,
  workflowPreviewFromRisk,
  workflowPreviewFromTask,
} from "./workflow";
import { CategoryTablePage } from "./category-tables";
import { DetailPanel } from "./detail-panel";
import {
  AddIdeaDialog,
  ArtifactPatchDialog,
  ArtifactPreviewDialog,
  BrandedConfirmDialog,
  BrandedInputDialog,
  CreateChatDialog,
  CreateProjectDialog,
  CreateTeamDialog,
  ProjectInstructionsDialog,
  TutorialDialog,
  WorkflowPreviewDialog,
} from "./dialogs";

export function PMOCommandCenter({ session }: { session: CommandCenterSession }) {
  const queryClient = useQueryClient();
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
  const scopedChatsQueryKey = useMemo(() => ["scoped-chats", activeMode, selectedTeam?.id ?? ""] as const, [activeMode, selectedTeam?.id]);
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
  const [selectedRiskId, setSelectedRiskId] = useState(visibleWorkspace.risks[0]?.id ?? "");
  const [selectedArtifactTitle, setSelectedArtifactTitle] = useState(
    visibleWorkspace.artifacts[1]?.title ?? visibleWorkspace.artifacts[0]?.title ?? "",
  );
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
    return saved && saved in chatReasoningProfiles ? (saved as ChatReasoningLevel) : "low";
  });
  const [webSearchEnabled, setWebSearchEnabled] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("vertex-chat-web-search") === "1";
  });
  const [asanaSearchEnabled, setAsanaSearchEnabled] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem("vertex-chat-asana-search") !== "0";
  });
  const [presenceUsers, setPresenceUsers] = useState<WorkspacePresenceUser[]>(() => [
    {
      id: session.user.id,
      name: session.user.name || session.user.email || "You",
      email: session.user.email,
    },
  ]);
  const [transientChats, setTransientChats] = useState<Record<string, ChatSummary>>({});
  const [isScopedRagStreaming, setIsScopedRagStreaming] = useState(false);
  const chatFormRef = useRef<HTMLFormElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const chatFileInputRef = useRef<HTMLInputElement>(null);
  const composerHighlightTimeoutRef = useRef<number | null>(null);
  const shareLinkHandledRef = useRef(false);
  const [isComposerHighlighted, setIsComposerHighlighted] = useState(false);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isCreateTeamOpen, setIsCreateTeamOpen] = useState(false);
  const [isCreateProjectOpen, setIsCreateProjectOpen] = useState(false);
  const [projectInstructionsProject, setProjectInstructionsProject] = useState<ProjectSummary | null>(null);
  const [createChatState, setCreateChatState] = useState<CreateChatDialogState>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>(null);
  const [inputDialog, setInputDialog] = useState<InputDialogState>(null);
  const [previewArtifact, setPreviewArtifact] = useState<Artifact | null>(null);
  const [patchArtifact, setPatchArtifact] = useState<Artifact | null>(null);
  const [artifactPatchDraft, setArtifactPatchDraft] = useState<ArtifactPatchDraftResult | null>(null);
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
  const canEdit = roleCanModifyState(session.user.role);
  useWorkspaceEventSource({
    enabled: activeMode !== "Team" || Boolean(selectedTeam),
    mode: activeMode,
    teamId: activeMode === "Team" ? (selectedTeam?.id ?? null) : null,
    userId: session.user.id,
  });

  useEffect(() => {
    if (shareLinkHandledRef.current || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const requestedMode = params.get("mode") as WorkspaceMode | null;
    const requestedTab = params.get("tab") as TabName | null;
    const requestedIdeaId = params.get("idea");
    const requestedProjectId = params.get("projectId");
    const requestedRiskId = params.get("riskId");
    if (requestedMode && workspaceModes.includes(requestedMode)) setActiveMode(requestedMode);
    if (requestedTab && tabs.includes(requestedTab)) {
      setActiveRail(requestedTab === "Risks" ? "Risks" : "Workspaces");
      setActiveTab(requestedTab);
    }
    if (requestedIdeaId) {
      setSelectedIdeaId(requestedIdeaId);
      setRightOpen(true);
    }
    if (requestedProjectId) {
      window.sessionStorage.setItem("vertex-target-project-id", requestedProjectId);
      if (requestedTab) window.sessionStorage.setItem("vertex-target-tab", requestedTab);
    }
    if (requestedRiskId) {
      window.sessionStorage.setItem("vertex-target-risk-id", requestedRiskId);
      setSelectedRiskId(requestedRiskId);
      if (requestedTab !== "Risks") setRightOpen(true);
    }
    shareLinkHandledRef.current = Boolean(requestedMode || requestedTab || requestedIdeaId || requestedProjectId || requestedRiskId);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || isScopedWorkspaceLoading) return;
    const requestedProjectId = window.sessionStorage.getItem("vertex-target-project-id");
    if (!requestedProjectId) return;
    const project = visibleWorkspace.projects.find((item) => item.id === requestedProjectId);
    if (!project) {
      window.sessionStorage.removeItem("vertex-target-project-id");
      window.sessionStorage.removeItem("vertex-target-tab");
      window.sessionStorage.removeItem("vertex-target-risk-id");
      updateToast("The linked project is not available in this scope.");
      return;
    }
    const requestedTab = window.sessionStorage.getItem("vertex-target-tab") as TabName | null;
    const requestedRiskId = window.sessionStorage.getItem("vertex-target-risk-id");
    setActiveProjectId(project.id);
    setActiveChatSection("project");
    setActiveChatId(project.projectChats[0]?.id ?? "");
    if (requestedTab && tabs.includes(requestedTab)) {
      setActiveRail(requestedTab === "Risks" ? "Risks" : "Workspaces");
      setActiveTab(requestedTab);
    }
    if (requestedRiskId) setSelectedRiskId(requestedRiskId);
    setRightOpen(requestedTab !== "Risks");
    window.sessionStorage.removeItem("vertex-target-project-id");
    window.sessionStorage.removeItem("vertex-target-tab");
    window.sessionStorage.removeItem("vertex-target-risk-id");
  }, [isScopedWorkspaceLoading, visibleWorkspace.projects]);

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

  const invalidateWorkspace = () => queryClient.invalidateQueries({ queryKey: pmoWorkspaceQueryKey });
  const invalidateTeams = () => queryClient.invalidateQueries({ queryKey: ["my-teams"] });
  const invalidateProjects = () => queryClient.invalidateQueries({ queryKey: ["scoped-projects"] });
  const invalidateChats = () => queryClient.invalidateQueries({ queryKey: ["scoped-chats"] });

  const addIdeaMutation = useMutation({
    mutationFn: (input: AddIdeaInput) =>
      addIdea({
        data: { ...input, mode: activeMode, projectId: scopedProjectId, teamId: activeMode === "Team" ? (selectedTeam?.id ?? null) : null },
      }),
    onSuccess: invalidateWorkspace,
  });
  const sendMessageMutation = useMutation({
    mutationFn: (input: {
      mode: WorkspaceMode;
      teamId?: string | null;
      projectId: string | null;
      chatId: string;
      chatTitle: string;
      text: string;
      model: string;
      reasoningLevel: ChatReasoningLevel;
      webSearchEnabled?: boolean;
      asanaSearchEnabled?: boolean;
      attachments?: ChatAttachment[];
    }) => runServerMutation("Chat submission", () => sendChatMessage({ data: input })),
    onMutate: async (input) => {
      const queryKey = scopedChatsQueryKey;
      const conversationKey = getConversationKey(input.mode, input.projectId, input.chatId);
      const optimisticMessage: ChatMessage = {
        id: createOptimisticId("optimistic-user"),
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
      if (context) queryClient.setQueryData(context.queryKey, context.previousScopedChats ?? emptyScopedChatsResult);
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
  const syncTaskToAsanaMutation = useMutation({
    mutationFn: (id: string) => syncTaskToAsana({ data: { id, mode: activeMode } }),
    onSuccess: (result) => {
      queryClient.setQueryData(pmoWorkspaceQueryKey, result.workspace);
      updateToast("Task queued for Asana sync");
    },
    onError: (error) => {
      updateToast(error instanceof Error ? error.message : "Could not sync task to Asana.");
      void invalidateWorkspace();
    },
  });
  const generateRiskMitigationMutation = useMutation({
    mutationFn: (risk: Risk) => {
      const riskProjectId = risk.projectId;
      if (!riskProjectId) throw new Error("Select a project-scoped risk before generating mitigation.");
      return runServerMutation("Risk mitigation generation", () =>
        generateRiskMitigation({
          data: {
            workspaceId: `ws-${visibleWorkspace.scope}`,
            projectId: riskProjectId,
            riskId: risk.id,
          },
        }),
      );
    },
    onSuccess: async (risk) => {
      setSelectedRiskId(risk.id);
      updateToast("Mitigation strategy generated and saved.");
      await invalidateWorkspace();
    },
    onError: (error) => {
      updateToast(error instanceof Error ? error.message : "Could not generate mitigation strategy.");
      void invalidateWorkspace();
    },
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
  const refreshIdeaAssessmentMutation = useMutation({
    mutationFn: (id: string) => refreshIdeaAssessment({ data: { id, mode: activeMode } }),
    onSuccess: () => {
      updateToast("Gemma 4 assessment refreshed");
      void invalidateWorkspace();
    },
    onError: (error) => updateToast(error instanceof Error ? error.message : "Could not refresh idea assessment."),
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
            pinnedTo: isPinned ? artifact.pinnedTo.filter((mode) => mode !== input.mode) : [...artifact.pinnedTo, input.mode],
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
  const draftArtifactPatchMutation = useMutation({
    mutationFn: (input: { artifactId: string; instruction: string; mode: WorkspaceMode }) => draftArtifactPatch({ data: input }),
    onSuccess: (draft) => {
      setArtifactPatchDraft(draft);
      updateToast("AI diff patch drafted");
    },
    onError: (error) => {
      updateToast(error instanceof Error ? error.message : "Could not draft artifact patch.");
    },
  });
  const commitArtifactPatchMutation = useMutation({
    mutationFn: (input: CommitArtifactPatchInput) => commitArtifactPatch({ data: input }),
    onSuccess: async (result) => {
      queryClient.setQueryData(pmoWorkspaceQueryKey, result.workspace);
      setSelectedArtifactTitle(result.artifact.title);
      setPatchArtifact(null);
      setArtifactPatchDraft(null);
      updateToast("Artifact patch approved");
      await invalidateWorkspace();
    },
    onError: (error) => {
      updateToast(error instanceof Error ? error.message : "Could not approve artifact patch.");
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
    mutationFn: (input: CreateTaskInput) => runServerMutation("Create task", () => createTaskFromSuggestion({ data: input })),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: pmoWorkspaceQueryKey });
      const previousWorkspace = queryClient.getQueryData<PmoWorkspaceState>(pmoWorkspaceQueryKey);
      const optimisticTask: Task = {
        id: createOptimisticId("optimistic-task"),
        projectId: input.projectId ?? null,
        title: input.title.trim().slice(0, 140) || "New task",
        originalText: input.originalText?.trim().slice(0, 1000) || input.title.trim().slice(0, 1000),
        owner: input.owner?.trim().slice(0, 80) || "You",
        source: input.source?.trim().slice(0, 96) || "VertexAI suggestion",
        status: "Open",
        clientStatus: "pending",
      };
      queryClient.setQueryData<PmoWorkspaceState>(pmoWorkspaceQueryKey, (current) =>
        addTaskToWorkspaceCache(current, input.mode, optimisticTask),
      );
      setSelectedTaskId(optimisticTask.id);
      return { previousWorkspace };
    },
    onSuccess: (result) => {
      queryClient.setQueryData(pmoWorkspaceQueryKey, result.workspace);
      setSelectedTaskId(result.task.id);
      if (!result.workspace.workspaces[activeMode].tasks.some((task) => task.id === result.task.id)) {
        updateToast("Task was created but is outside the current scope.");
      }
    },
    onError: (error, _input, context) => {
      if (context?.previousWorkspace) queryClient.setQueryData(pmoWorkspaceQueryKey, context.previousWorkspace);
      updateToast(error instanceof Error ? error.message : "Could not create task.");
    },
    onSettled: async () => {
      await invalidateWorkspace();
    },
  });
  async function handleSyncEntityToAsana(entity: ChatOperationalEntity) {
    const titlePrefix = entity.type === "Task" ? "" : `${entity.type}: `;
    const result = await createTaskMutation.mutateAsync({
      mode: activeMode,
      projectId: scopedProjectId,
      title: `${titlePrefix}${entity.title}`,
      originalText: [entity.description, entity.sourceQuote ? `Source: ${entity.sourceQuote}` : ""].filter(Boolean).join("\n"),
      owner: entity.owner ?? "You",
      source: "Chat entity extraction",
      syncToAsana: true,
    });
    updateToast(
      result.task.asanaSyncError ? `Entity saved; Asana sync failed: ${result.task.asanaSyncError}` : "Entity queued for Asana sync",
    );
  }
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
      queryClient.setQueryData<PmoWorkspaceState>(pmoWorkspaceQueryKey, (current) => removeTaskFromWorkspaceCache(current, activeMode, id));
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
  const updateProjectInstructionsMutation = useMutation({
    mutationFn: (input: UpdateProjectInstructionsInput) => updateScopedProjectInstructions({ data: input }),
    onSuccess: async () => {
      await invalidateProjects();
      await invalidateWorkspace();
      await invalidateChats();
    },
    onError: (error) => updateToast(error instanceof Error ? error.message : "Could not update project instructions."),
  });
  const createChatMutation = useMutation({
    mutationFn: (input: CreateChatInput) => createScopedChat({ data: input }),
    onSuccess: () => {
      void invalidateChats();
      void invalidateProjects();
    },
  });
  const persistScopedRagTurnMutation = useMutation({
    mutationFn: (input: PersistScopedRagChatInput) => persistScopedRagChatTurn({ data: input }),
    onSettled: async () => {
      await invalidateChats();
      await invalidateProjects();
      await invalidateWorkspace();
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
      ? (projectChats.find((chat) => chat.id === activeChatId) ?? transientChats[activeChatId] ?? projectChats[0])
      : (visibleWorkspace.workspaceChats.find((chat) => chat.id === activeChatId) ??
        transientChats[activeChatId] ??
        visibleWorkspace.workspaceChats[0]);
  const activeChatReadOnly = isAutomatedBriefingsChat(activeChat);
  const canWriteActiveChat = canEdit && !activeChatReadOnly;
  const scopedProjectId = activeChatSection === "project" ? (activeProject?.id ?? null) : null;
  const conversationKey = activeChat ? getConversationKey(activeMode, scopedProjectId, activeChat.id) : "";
  const canUseAsanaSearch = Boolean(scopedProjectId);
  const visibleAsanaSearchEnabled = canUseAsanaSearch && asanaSearchEnabled;
  const asanaSearchTitle = !canUseAsanaSearch
    ? "Asana search is only available in project chats because Asana tasks, stories, and status updates are mapped to a VertexAI project."
    : asanaSearchEnabled
      ? "Asana search on: pull mapped project tasks, stories, and status updates into Gemma context"
      : "Asana search off: do not pull mapped Asana project context into Gemma";
  const workspaceTitle = `${workspaceModeLabel(activeMode)} workspace`;
  const isWorkspaceRail = activeRail === "Workspaces";
  const scopeContextLabel = activeProject && scopedProjectId ? activeProject.name : visibleWorkspace.unassignedProjectLabel;
  const pageScopeKind: PageScopeKind = scopedProjectId ? "project" : "workspace";
  const baseScopeName = activeMode === "Team" ? (selectedTeam?.name ?? "Team") : workspaceModeLabel(activeMode);
  const pageScopeDescription = pageScopeKind === "project" ? "Items tied to this project." : "Items not tied to a project.";
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
  const scopedPrompts = useMemo(() => promptTemplates.map((prompt) => `${scopeContextLabel}: ${prompt}`), [scopeContextLabel]);
  const currentMessages = activeChat ? (visibleWorkspace.conversations[conversationKey] ?? []) : [];

  const selectedIdea = scopedIdeas.find((idea) => idea.id === selectedIdeaId) ?? scopedIdeas[0];
  const selectedArtifact = scopedArtifacts.find((artifact) => artifact.title === selectedArtifactTitle) ?? scopedArtifacts[0];
  const selectedDecision =
    scopedDecisions.find((decision) => decision.id === selectedDecisionId) ??
    scopedDecisions.find((decision) => decision.status !== "Completed") ??
    scopedDecisions[0];
  const selectedApproval =
    scopedApprovals.find((approval) => approval.id === selectedApprovalId) ??
    scopedApprovals.find((approval) => !["Approved", "Not Approved"].includes(approval.status)) ??
    scopedApprovals[0];
  const selectedTask = scopedTasks.find((task) => task.id === selectedTaskId) ?? scopedTasks[0];
  const selectedRisk = visibleWorkspace.risks.find((risk) => risk.id === selectedRiskId) ?? visibleWorkspace.risks[0];

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
        [idea.title, idea.category, idea.owner, idea.summary, ...idea.tags].join(" ").toLowerCase().includes(normalizedSearch);
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
    risks: visibleWorkspace.risks,
    tasks: scopedTasks,
    updatedAt: visibleWorkspace.updatedAt,
  });

  useEffect(() => {
    setSelectedIdeaId((current) => (current && scopedIdeas.some((idea) => idea.id === current) ? current : (scopedIdeas[0]?.id ?? "")));
    setSelectedArtifactTitle((current) =>
      current && scopedArtifacts.some((artifact) => artifact.title === current) ? current : (scopedArtifacts[0]?.title ?? ""),
    );
    setSelectedDecisionId((current) =>
      current && scopedDecisions.some((decision) => decision.id === current)
        ? current
        : (scopedDecisions.find((decision) => decision.status !== "Completed")?.id ?? scopedDecisions[0]?.id ?? ""),
    );
    setSelectedApprovalId((current) =>
      current && scopedApprovals.some((approval) => approval.id === current)
        ? current
        : (scopedApprovals.find((approval) => !["Approved", "Not Approved"].includes(approval.status))?.id ?? scopedApprovals[0]?.id ?? ""),
    );
    setSelectedTaskId((current) => (current && scopedTasks.some((task) => task.id === current) ? current : (scopedTasks[0]?.id ?? "")));
    setSelectedRiskId((current) =>
      current && visibleWorkspace.risks.some((risk) => risk.id === current) ? current : (visibleWorkspace.risks[0]?.id ?? ""),
    );
  }, [scopedApprovals, scopedArtifacts, scopedDecisions, scopedIdeas, scopedTasks, visibleWorkspace.risks]);

  useEffect(() => {
    if (isScopedWorkspaceLoading) return;
    const activeProjectExists = activeProjectId ? visibleWorkspace.projects.some((project) => project.id === activeProjectId) : true;
    if (!activeProjectExists) {
      setActiveProjectId("");
      setActiveChatSection("workspace");
    }

    const workspaceChatExists = visibleWorkspace.workspaceChats.some((chat) => chat.id === activeChatId);
    const projectWithActiveChat = visibleWorkspace.projects.find((project) =>
      project.projectChats.some((chat) => chat.id === activeChatId),
    );
    const selectedProjectWithoutChat = activeChatSection === "project" && Boolean(activeProject) && !activeChatId;
    const activeChatExists =
      (activeChatSection === "workspace" && workspaceChatExists) ||
      (activeChatSection === "project" && Boolean(projectWithActiveChat)) ||
      selectedProjectWithoutChat ||
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
  }, [activeChatId, activeChatSection, activeProjectId, isScopedWorkspaceLoading, transientChats, visibleWorkspace]);

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
    window.localStorage.setItem("vertex-chat-asana-search", asanaSearchEnabled ? "1" : "0");
  }, [asanaSearchEnabled]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (activeMode === "Team" && !selectedTeam) return;

    setPresenceUsers([
      {
        id: session.user.id,
        name: session.user.name || session.user.email || "You",
        email: session.user.email,
      },
    ]);
    const params = new URLSearchParams({ mode: activeMode });
    if (activeMode === "Team" && selectedTeam?.id) params.set("teamId", selectedTeam.id);
    const events = new EventSource(`/api/chat-events?${params.toString()}`);

    events.addEventListener("chat-message", (messageEvent) => {
      try {
        const event = JSON.parse(messageEvent.data) as ChatMessageInsertEvent;
        queryClient.setQueryData<ScopedChatsResult>(scopedChatsQueryKey, (current) => appendChatMessageToScopedChats(current, event));
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
    if (canWriteActiveChat && activeTab === "Chat" && activeChatId) {
      focusChatComposer();
    }
  }, [activeChatId, activeTab, canWriteActiveChat]);

  function updateToast(message: string, link?: ToastLink) {
    setToast(message);
    setToastLink(link ?? null);
    window.setTimeout(() => {
      setToast(null);
      setToastLink(null);
    }, 4200);
  }

  function handleShareIdea(idea: Idea) {
    const params = new URLSearchParams({
      mode: activeMode,
      tab: "Ideas",
      idea: idea.id,
    });
    if (activeMode === "Team" && selectedTeam?.id) params.set("teamId", selectedTeam.id);
    const href = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
    void navigator.clipboard?.writeText(href).catch(() => undefined);
    updateToast("Authenticated share link copied", { href, label: "Open link" });
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
      Risks: "Risks",
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
      title: "Start in Your Workspace",
      description:
        "The blue rail stays with you as you move through the app. Use it to return to Workspaces, Chats, Ideas, Artifacts, Docs, and Settings.",
      detail: "The main workspace opens in Personal scope so new users can try the assistant without exposing work to a team.",
      actionLabel: "Show Workspace",
      onAction: () => {
        setActiveMode("Personal");
        handleRailClick("Workspaces");
      },
    },
    {
      title: "Create Your First Chat",
      description: "Chats keep AI conversations organized by personal, team, org, or project context.",
      detail: "Create separate chats for different workstreams so history, artifacts, and future branches stay easy to find.",
      actionLabel: "Open New Chat Form",
      onAction: () => {
        setActiveMode("Personal");
        handleRailClick("Workspaces");
        setCreateChatState({ section: "workspace", projectId: null });
      },
    },
    {
      title: "Create Your First Team",
      description: "Team workspaces let a group share projects, chats, artifacts, and scoped invites.",
      detail: "After a team exists, switch to Team scope and create shared project work inside that team.",
      actionLabel: "Open Team Form",
      onAction: () => {
        setActiveMode("Team");
        setIsCreateTeamOpen(true);
      },
    },
    {
      title: "Create Your First Project",
      description: "Projects collect focused chats, artifacts, decisions, approvals, tasks, and prompts under one delivery scope.",
      detail: "Use projects when work has a clear owner, timeline, or artifact set.",
      actionLabel: "Open Project Form",
      onAction: () => {
        handleRailClick("Workspaces");
        setIsCreateProjectOpen(true);
      },
    },
    {
      title: "Review Artifacts and Actions",
      description: "Artifacts, Ideas, Decisions, Approvals, and Tasks are available from the workspace tabs and the blue rail.",
      detail: "Pinned outputs appear at the top of the workspace so important files and ideas stay visible.",
      actionLabel: "Show Artifacts",
      onAction: () => handleRailClick("Artifacts"),
    },
    {
      title: "Use Prompts and Settings Later",
      description:
        "Prompt templates help start structured assistant requests. Settings lets you relaunch this tutorial whenever you need a reset.",
      detail: "The tutorial is skippable now and available again from User Settings.",
      actionLabel: "Open Settings",
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
    if (activeChatReadOnly) {
      updateToast("Briefings is read-only. Weekly briefings are posted automatically.");
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
      teamId: activeMode === "Team" ? (selectedTeam?.id ?? null) : null,
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
      teamId: activeMode === "Team" ? (selectedTeam?.id ?? null) : null,
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
        teamId: activeMode === "Team" ? (selectedTeam?.id ?? null) : null,
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
    chatId,
    chatTitle,
    key,
    mode,
    projectId,
    prompt,
    reasoningLevel,
    teamId,
    webSearchEnabled,
    workspaceId,
    asanaSearchEnabled,
  }: {
    chatId: string;
    chatTitle: string;
    key: string;
    mode: WorkspaceMode;
    projectId: string | null;
    prompt: string;
    reasoningLevel: ChatReasoningLevel;
    teamId: string;
    webSearchEnabled: boolean;
    workspaceId: string;
    asanaSearchEnabled: boolean;
  }) {
    const userMessageId = `msg-stream-user-${crypto.randomUUID()}`;
    const userMessage: ChatMessage = {
      id: userMessageId,
      author: "You",
      role: "user",
      avatar: avatarAlex,
      time: clientTimeLabel(),
      text: prompt,
    };
    const assistantMessageId = `msg-stream-assistant-${crypto.randomUUID()}`;
    const streamingPlaceholder = asanaSearchEnabled
      ? "Preparing project context..."
      : webSearchEnabled
        ? "Preparing web context..."
        : "Preparing response...";
    const assistantMessage: ChatMessage = {
      id: assistantMessageId,
      author: "VertexAI",
      role: "assistant",
      time: clientTimeLabel(),
      text: streamingPlaceholder,
      clientStatus: "sending",
    };
    let tokenText = "";
    let citations: ChatWithScopedRagCitation[] = [];
    let detectedEntities: ChatOperationalEntity[] = [];
    let thinkingText = "";
    let traceContext: LlmDevTrace["rawResponse"] | null = null;
    let traceMessages: LlmDevTrace["request"]["messages"] = [{ role: "user", content: prompt }];
    const startedAt = Date.now();
    const renderStreamingText = () => {
      const citationText = formatScopedRagCitations(citations);
      return `${tokenText}${citationText ? `\n\n${citationText}` : ""}`.trimStart();
    };
    const renderStreamingTextOrPlaceholder = () => renderStreamingText() || streamingPlaceholder;

    await queryClient.cancelQueries({ queryKey: scopedChatsQueryKey });
    const previousScopedChats = queryClient.getQueryData<ScopedChatsResult>(scopedChatsQueryKey);
    queryClient.setQueryData<ScopedChatsResult>(scopedChatsQueryKey, (current) => {
      const withUser = appendChatMessageToCache(current ?? emptyScopedChatsResult, key, userMessage);
      return appendChatMessageToCache(withUser, key, assistantMessage);
    });
    setIsScopedRagStreaming(true);
    try {
      await consumeScopedRagEventSource(
        { assistantMessageId, prompt, teamId, workspaceId, projectId, chatId, asanaSearchEnabled, reasoningLevel, webSearchEnabled },
        {
          onTrace: (trace) => {
            traceMessages = trace.messages;
            traceContext = trace.context;
          },
          onCitations: (nextCitations) => {
            citations = nextCitations;
            queryClient.setQueryData<ScopedChatsResult>(scopedChatsQueryKey, (current) =>
              updateChatMessageInCache(current, key, assistantMessageId, renderStreamingTextOrPlaceholder()),
            );
          },
          onThinking: (thinking) => {
            thinkingText += thinking;
          },
          onEntities: (entities) => {
            detectedEntities = entities;
            queryClient.setQueryData<ScopedChatsResult>(scopedChatsQueryKey, (current) =>
              updateChatMessageInCache(current, key, assistantMessageId, renderStreamingTextOrPlaceholder(), { entities }),
            );
          },
          onToken: (token) => {
            tokenText += token;
            queryClient.setQueryData<ScopedChatsResult>(scopedChatsQueryKey, (current) =>
              updateChatMessageInCache(current, key, assistantMessageId, renderStreamingTextOrPlaceholder(), { clientStatus: null }),
            );
          },
          onError: (message) => {
            throw new Error(message);
          },
        },
      );

      queryClient.setQueryData<ScopedChatsResult>(scopedChatsQueryKey, (current) =>
        updateChatMessageInCache(current, key, assistantMessageId, renderStreamingText() || "The model did not return a response.", {
          clientStatus: null,
          entities: detectedEntities,
        }),
      );
      const responseText = renderStreamingText() || "The model did not return a response.";
      const estimatedInputTokens = estimateTextTokens(prompt);
      const estimatedOutputTokens = estimateTextTokens(responseText);
      setLlmTraces((traces) =>
        [
          {
            id: `trace-stream-${crypto.randomUUID()}`,
            timestamp: new Date().toISOString(),
            durationMs: Date.now() - startedAt,
            model: "Scoped RAG stream",
            chatId,
            chatTitle,
            mode,
            projectId,
            asanaSearchEnabled,
            webSearch: webSearchEnabled
              ? {
                  enabled: true,
                  query: prompt,
                  provider: "scoped-rag-stream",
                  results: [],
                }
              : undefined,
            request: {
              messages: traceMessages,
              max_completion_tokens: chatReasoningProfiles[reasoningLevel].maxCompletionTokens,
              reasoningLevel,
              reasoning_effort: chatReasoningProfiles[reasoningLevel].reasoningEffort,
              timeoutMs: chatReasoningProfiles[reasoningLevel].timeoutMs,
              temperature: 0.2,
            },
            responseText,
            thinkingText,
            diagnostics: {
              finishReason: "stream-complete",
              usage: {
                streamed: true,
                estimated: true,
                citations: citations.length,
                context: traceContext,
                inputTokens: estimatedInputTokens,
                outputTokens: estimatedOutputTokens,
                totalTokens: estimatedInputTokens + estimatedOutputTokens,
              },
              tokenUsage: {
                inputTokens: estimatedInputTokens,
                outputTokens: estimatedOutputTokens,
                totalTokens: estimatedInputTokens + estimatedOutputTokens,
              },
              responseTextChars: responseText.length,
              thinkingTextChars: thinkingText.length,
            },
            rawResponse: {
              streamed: true,
              context: traceContext,
              estimatedTokenUsage: true,
              citations,
            },
          },
          ...traces,
        ].slice(0, 20),
      );
      await persistScopedRagTurnMutation.mutateAsync({
        mode,
        teamId,
        projectId,
        chatId,
        userMessageId,
        assistantMessageId,
        prompt,
        response: responseText,
        entities: detectedEntities,
      });
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
      actionLabel: "Delete Project",
      destructive: true,
      onConfirm: async () => {
        await deleteProjectMutation.mutateAsync({
          mode: activeMode,
          teamId: activeMode === "Team" ? (selectedTeam?.id ?? null) : null,
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

  function handleEditProjectInstructions(project: ProjectSummary) {
    if (!canEdit) {
      updateToast("Viewer access is read-only");
      return;
    }
    if (activeMode === "Team" && !selectedTeam) {
      updateToast("Select a team before editing project instructions.");
      return;
    }
    setProjectInstructionsProject(project);
  }

  async function handleProjectInstructionsSubmit(value: {
    asanaTaskStatusCustomFieldGid: string | null;
    asanaTaskStatusCustomFieldName: string | null;
    asanaTaskStatusSource: ProjectSummary["asanaTaskStatusSource"];
    description: string;
    projectInstructions: string;
  }) {
    if (!projectInstructionsProject) return;
    await updateProjectInstructionsMutation.mutateAsync({
      mode: activeMode,
      teamId: activeMode === "Team" ? (selectedTeam?.id ?? null) : null,
      projectId: projectInstructionsProject.id,
      asanaTaskStatusCustomFieldGid: value.asanaTaskStatusCustomFieldGid,
      asanaTaskStatusCustomFieldName: value.asanaTaskStatusCustomFieldName,
      asanaTaskStatusSource: value.asanaTaskStatusSource,
      description: value.description,
      projectInstructions: value.projectInstructions,
    });
    updateToast(`${projectInstructionsProject.name} instructions saved`);
    setProjectInstructionsProject(null);
  }

  function handleDeleteChat({ chat, project, section }: { chat: ChatSummary; project?: ProjectSummary; section: ChatSection }) {
    if (!canEdit) {
      updateToast("Viewer access is read-only");
      return;
    }
    if (isAutomatedBriefingsChat(chat)) {
      updateToast("Briefings is read-only. Weekly briefings are posted automatically.");
      return;
    }
    if (activeMode === "Team" && !selectedTeam) {
      updateToast("Select a team before deleting a team chat.");
      return;
    }
    setConfirmDialog({
      title: `Delete ${chat.title}`,
      description: "This removes the chat and all messages in it.",
      actionLabel: "Delete Chat",
      destructive: true,
      onConfirm: async () => {
        await deleteChatMutation.mutateAsync({
          mode: activeMode,
          teamId: activeMode === "Team" ? (selectedTeam?.id ?? null) : null,
          projectId: section === "project" ? (project?.id ?? null) : null,
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

  function handleRenameChat({ chat, project, section }: { chat: ChatSummary; project?: ProjectSummary; section: ChatSection }) {
    if (!canEdit) {
      updateToast("Viewer access is read-only");
      return;
    }
    if (isAutomatedBriefingsChat(chat)) {
      updateToast("Briefings is read-only. Weekly briefings are posted automatically.");
      return;
    }
    if (activeMode === "Team" && !selectedTeam) {
      updateToast("Select a team before renaming a team chat.");
      return;
    }
    setInputDialog({
      title: "Rename Chat",
      description: "Update the chat name shown in the sidebar.",
      label: "Chat Name",
      defaultValue: chat.title,
      placeholder: "Example: Launch planning assistant",
      actionLabel: "Rename Chat",
      onSubmit: async (value) => {
        const title = value.trim();
        if (!title || title === chat.title) return;
        const renamed = await renameChatMutation.mutateAsync({
          mode: activeMode,
          teamId: activeMode === "Team" ? (selectedTeam?.id ?? null) : null,
          projectId: section === "project" ? (project?.id ?? null) : null,
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
      teamId: activeMode === "Team" ? (selectedTeam?.id ?? null) : null,
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
    const projectId = section === "project" ? (activeProject?.id ?? null) : null;
    const contextLabel = section === "project" ? (activeProject?.name ?? "Project") : workspaceModeLabel(activeMode);
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
      title: `Invite User to ${team.name}`,
      description: "Send an invitation to this team workspace.",
      label: "Email Address",
      placeholder: "name@example.com",
      actionLabel: "Send Invite",
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
        updateToast(`Invited ${email} to ${team.name}.`, { href: "/profile/invites", label: "Manage Invites" });
      },
    });
  }

  function handleInviteProject(project: ProjectSummary) {
    if (!canEdit) {
      updateToast("Viewer access is read-only");
      return;
    }
    setInputDialog({
      title: `Invite User to ${project.name}`,
      description: "Send an invitation to this project workspace.",
      label: "Email Address",
      placeholder: "name@example.com",
      actionLabel: "Send Invite",
      inputType: "email",
      onSubmit: async (value) => {
        const email = value.trim();
        if (!email) return;
        await scopedInviteMutation.mutateAsync({
          scope: "project",
          targetId: project.id,
          targetTeamId: activeMode === "Team" ? (selectedTeam?.id ?? null) : null,
          targetName: project.name,
          email,
        });
        updateToast(`Invited ${email} to ${project.name}.`, { href: "/profile/invites", label: "Manage Invites" });
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
      const teamId = activeMode === "Team" ? (selectedTeam?.id ?? "") : "";
      if (readyAttachments.length > 0) {
        updateToast("Streaming file attachment context is not wired yet. Remove attachments and send again.");
        setChatInput(text);
        setChatAttachments(readyAttachments);
        return;
      }
      const targetAsanaSearchEnabled = Boolean(target.projectId) && asanaSearchEnabled;
      await runScopedRagStream({
        chatId: target.chat.id,
        chatTitle: target.chat.title,
        key: targetConversationKey,
        mode: activeMode,
        projectId: target.projectId,
        prompt: text,
        reasoningLevel: chatReasoningLevel,
        teamId,
        webSearchEnabled,
        workspaceId: `ws-${activeWorkspace.scope}`,
        asanaSearchEnabled: targetAsanaSearchEnabled,
      });
      updateToast("VertexAI response streamed");
      return;
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
        teamId: activeMode === "Team" ? (selectedTeam?.id ?? null) : null,
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
          canAdmin={isAdminRole(session.user.role)}
          userEmail={session.user.email}
          userName={session.user.name}
          onRailClick={handleRailClick}
          onSignOut={handleSignOut}
        />

        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-background">
          <Topbar
            canAdmin={isAdminRole(session.user.role)}
            presenceUsers={presenceUsers}
            searchTerm={searchTerm}
            userEmail={session.user.email}
            userName={session.user.name}
            onSearchTerm={setSearchTerm}
            onSignOut={handleSignOut}
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
                    onEditProjectInstructions={handleEditProjectInstructions}
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

                      <ScopeTabs activeTab={activeTab} onTabChange={setActiveTab} />

                      <section
                        className={cn(
                          "min-h-0 flex-1",
                          activeTab === "Chat" ? "flex flex-col overflow-hidden" : "scrollbar-thin overflow-auto p-4 pb-32",
                        )}
                      >
                        {activeTab === "Chat" ? (
                          <ChatView
                            approvals={scopedApprovals}
                            activeMode={activeMode}
                            activeProjectId={activeChatSection === "project" ? (activeProject?.id ?? null) : null}
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
                            pendingTaskRemovalId={removeTaskMutation.isPending ? (removeTaskMutation.variables ?? null) : null}
                            pendingTaskTitle={createTaskMutation.isPending ? (createTaskMutation.variables?.title ?? null) : null}
                            showTokenUsage={showTokenUsage}
                            tasks={scopedTasks}
                            onBranchContext={handleBranchMessage}
                            onCreateApproval={(input) => createApprovalMutation.mutate(input)}
                            onCreateDecision={(input) => createDecisionMutation.mutate(input)}
                            onCreateIdea={(input) => createIdeaMutation.mutate(input)}
                            onCreateTask={(input) => createTaskMutation.mutate(input)}
                            onSyncEntityToAsana={handleSyncEntityToAsana}
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
                            onSelectArtifact={(artifact) => {
                              setSelectedArtifactTitle(artifact.title);
                              setRightOpen(true);
                            }}
                            onShare={() => updateToast("Share options prepared")}
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
                            syncingTaskId={syncTaskToAsanaMutation.variables ?? null}
                            tasks={scopedTasks}
                            onDelete={(id) => removeTaskMutation.mutate(id)}
                            onPreview={(task) => setWorkflowPreview(workflowPreviewFromTask(task))}
                            onSelect={(task) => {
                              setSelectedTaskId(task.id);
                              setRightOpen(true);
                            }}
                            onSyncToAsana={(id) => syncTaskToAsanaMutation.mutate(id)}
                            onTogglePin={(id) => toggleWorkflowActionPinMutation.mutate({ kind: "task", id })}
                          />
                        ) : null}
                        {activeTab === "Risks" ? (
                          <RiskView
                            canEdit={canEdit}
                            generatingRiskId={generateRiskMitigationMutation.variables?.id ?? null}
                            projects={visibleWorkspace.projects}
                            risks={visibleWorkspace.risks}
                            scopeLabel={workspaceModeLabel(activeMode)}
                            searchTerm={searchTerm}
                            selectedRiskId={selectedRiskId}
                            onGenerateMitigation={(risk) => generateRiskMitigationMutation.mutate(risk)}
                            onPreview={(risk) => setWorkflowPreview(workflowPreviewFromRisk(risk))}
                            onSearchTerm={setSearchTerm}
                            onSelect={(risk) => {
                              setSelectedRiskId(risk.id);
                              setRightOpen(true);
                            }}
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

                  {isScopedWorkspaceLoading ? null : canWriteActiveChat ? (
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
                          title={
                            webSearchEnabled
                              ? "Web search on: fetch current web context before asking VertexAI"
                              : "Web search off: use workspace context and model knowledge only"
                          }
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
                        <button
                          type="button"
                          aria-disabled={!canUseAsanaSearch}
                          aria-pressed={visibleAsanaSearchEnabled}
                          className={cn(
                            "inline-flex h-7 items-center gap-1.5 rounded-full border px-2 text-xs font-semibold transition-colors",
                            visibleAsanaSearchEnabled
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-input bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
                            !canUseAsanaSearch && "cursor-not-allowed opacity-60 hover:bg-background hover:text-muted-foreground",
                          )}
                          title={asanaSearchTitle}
                          onClick={() => {
                            if (!canUseAsanaSearch) return;
                            setAsanaSearchEnabled((enabled) => !enabled);
                          }}
                        >
                          <span>Asana</span>
                          <span
                            aria-hidden="true"
                            className={cn(
                              "relative inline-flex h-4 w-7 items-center rounded-full transition-colors",
                              visibleAsanaSearchEnabled ? "bg-primary-foreground/25" : "bg-muted",
                            )}
                          >
                            <span
                              className={cn(
                                "block size-3 rounded-full bg-current transition-transform",
                                visibleAsanaSearchEnabled ? "translate-x-3.5" : "translate-x-0.5",
                              )}
                            />
                          </span>
                          <span className="w-5 text-left">{visibleAsanaSearchEnabled ? "On" : "Off"}</span>
                        </button>
                        {showTokenUsage ? (
                          <span className="ml-auto text-xs text-muted-foreground">
                            {chatReasoningProfiles[chatReasoningLevel].maxCompletionTokens.toLocaleString()} tokens /{" "}
                            {Math.round(chatReasoningProfiles[chatReasoningLevel].timeoutMs / 1000)}s
                          </span>
                        ) : null}
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
                      <Button
                        type="button"
                        size="icon"
                        aria-label="Send message"
                        disabled={
                          sendMessageMutation.isPending ||
                          isScopedRagStreaming ||
                          isExtractingAttachment ||
                          (!chatInput.trim() && chatAttachments.every((attachment) => attachment.status === "error"))
                        }
                        onClick={handleChatSubmitButton}
                      >
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
                      {activeChatReadOnly
                        ? "Briefings is read-only. Weekly briefings are posted automatically."
                        : "Viewer access is read-only."}
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
                      isRefreshingIdeaAssessment={refreshIdeaAssessmentMutation.isPending}
                      messages={currentMessages}
                      metrics={metrics}
                      prompts={scopedPrompts}
                      risk={selectedRisk}
                      scopeContextLabel={scopeContextLabel}
                      task={selectedTask}
                      workspaceTitle={workspaceTitle}
                      onClose={() => setRightOpen(false)}
                      onPatchArtifact={(artifact) => {
                        setPatchArtifact(artifact);
                        setArtifactPatchDraft(null);
                      }}
                      onPreviewArtifact={(artifact) => setPreviewArtifact(artifact)}
                      onRestoreArtifactVersion={(artifactId) => restoreArtifactMutation.mutate({ mode: activeMode, artifactId })}
                      onShare={() => {
                        if (activeTab === "Ideas") {
                          selectedIdea ? handleShareIdea(selectedIdea) : updateToast("Select an idea before sharing.");
                        } else {
                          updateToast("Share options prepared");
                        }
                      }}
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
                      onManageRisks={() => {
                        setActiveRail("Risks");
                        setActiveTab("Risks");
                        setRightOpen(false);
                      }}
                      onRefreshIdeaAssessment={() => selectedIdea && refreshIdeaAssessmentMutation.mutate(selectedIdea.id)}
                      onUsePrompt={(prompt) => {
                        setChatInput(prompt);
                        setActiveTab("Chat");
                      }}
                    />
                  )
                ) : (
                  <aside className="hidden min-h-0 border-l bg-muted/35 p-2 lg:flex lg:items-start lg:justify-center">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label="Open details flyout"
                      title="Open details"
                      onClick={() => setRightOpen(true)}
                    >
                      <PanelRightOpen />
                    </Button>
                  </aside>
                )}
              </>
            ) : isScopedWorkspaceLoading ? (
              <CategoryTablePageSkeleton />
            ) : (
              <CategoryTablePage
                activeMode={activeMode}
                canEdit={canEdit}
                generatingRiskId={generateRiskMitigationMutation.variables?.id ?? null}
                rail={activeRail}
                selectedRiskId={selectedRiskId}
                workspace={visibleWorkspace}
                onGenerateRiskMitigation={(risk) => generateRiskMitigationMutation.mutate(risk)}
                onPreviewRisk={(risk) => setWorkflowPreview(workflowPreviewFromRisk(risk))}
                onSelectRisk={(risk) => {
                  setSelectedRiskId(risk.id);
                }}
                onUsePrompt={(prompt) => {
                  setChatInput(prompt);
                  setActiveRail("Workspaces");
                  setActiveTab("Chat");
                }}
              />
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
          <AddIdeaDialog open={isAddOpen} pending={addIdeaMutation.isPending} onOpenChange={setIsAddOpen} onSubmit={handleAddIdea} />
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
          <ProjectInstructionsDialog
            open={Boolean(projectInstructionsProject)}
            pending={updateProjectInstructionsMutation.isPending}
            project={projectInstructionsProject}
            onOpenChange={(open) => !open && setProjectInstructionsProject(null)}
            onSubmit={handleProjectInstructionsSubmit}
          />
          <CreateChatDialog
            contextLabel={
              createChatState?.section === "project" ? (createChatState.projectName ?? "Project") : workspaceModeLabel(activeMode)
            }
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
      <ArtifactPatchDialog
        artifact={patchArtifact}
        draft={artifactPatchDraft}
        mode={activeMode}
        open={Boolean(patchArtifact)}
        pendingApprove={commitArtifactPatchMutation.isPending}
        pendingDraft={draftArtifactPatchMutation.isPending}
        onApprove={async (input) => {
          await commitArtifactPatchMutation.mutateAsync(input);
        }}
        onDraft={async (instruction) => {
          if (!patchArtifact) return;
          await draftArtifactPatchMutation.mutateAsync({ artifactId: patchArtifact.id, instruction, mode: activeMode });
        }}
        onOpenChange={(open) => {
          if (open) return;
          setPatchArtifact(null);
          setArtifactPatchDraft(null);
        }}
        onResetDraft={() => setArtifactPatchDraft(null)}
      />
      <ArtifactPreviewDialog artifact={previewArtifact} onOpenChange={(open) => !open && setPreviewArtifact(null)} />
      <WorkflowPreviewDialog preview={workflowPreview} onOpenChange={(open) => !open && setWorkflowPreview(null)} />
      {import.meta.env.DEV ? <LlmDevtools traces={llmTraces} /> : null}
    </main>
  );
}
