import { type ComponentType } from "react";
import {
  Activity,
  Archive,
  Bell,
  CheckCircle2,
  ClipboardList,
  FileText,
  Folder,
  Lightbulb,
  MessageCircle,
  UploadCloud,
  Paperclip,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Star,
} from "lucide-react";
import { type ChatMessageInsertEvent } from "@/lib/chat-sync";
import { type ChatOperationalEntity } from "@/lib/chat-entities";
import { getRiskStats } from "@/lib/risk-feature";
import {
  type AddIdeaInput,
  type Approval,
  type Artifact,
  type ChatMessage,
  type ChatSection,
  type Decision,
  type Idea,
  type PmoWorkspaceState,
  type Risk,
  type TabName,
  type Task,
  type WorkspaceMode,
  getConversationKey,
  promptTemplates,
} from "@/lib/pmo-data";
import { type ScopedChatsResult } from "@/lib/team-workflow";

export const emptyIdeaForm: AddIdeaInput = {
  title: "",
  category: "Governance",
  status: "Not Started",
  impact: "High",
  summary: "",
};

export type ToastLink = {
  href: string;
  label: string;
};

export type CommandCenterSession = {
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
  };
};

export type CreateTeamInput = {
  name: string;
  description: string;
};

export const emptyScopedChatsResult: ScopedChatsResult = {
  workspaceChats: [],
  projectChatsByProjectId: {},
  conversations: {},
};

export const emptyChatImageSrc =
  "data:image/svg+xml,%3Csvg width='192' height='144' viewBox='0 0 192 144' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Crect x='18' y='25' width='156' height='94' rx='20' fill='%23F8FAFC'/%3E%3Crect x='34' y='42' width='87' height='12' rx='6' fill='%23215A96' fill-opacity='.18'/%3E%3Crect x='34' y='64' width='124' height='10' rx='5' fill='%23215A96' fill-opacity='.12'/%3E%3Crect x='34' y='82' width='73' height='10' rx='5' fill='%23215A96' fill-opacity='.12'/%3E%3Ccircle cx='139' cy='51' r='17' fill='%23215A96'/%3E%3Cpath d='M139 41v20M129 51h20' stroke='white' stroke-width='4' stroke-linecap='round'/%3E%3Cpath d='M61 119l-13 17-3-22' fill='%23F8FAFC'/%3E%3Crect x='18' y='25' width='156' height='94' rx='20' stroke='%23215A96' stroke-opacity='.16' stroke-width='2'/%3E%3C/svg%3E";

export const onboardingCompletedKey = "vertex-onboarding-tutorial-completed";

export const onboardingRelaunchKey = "vertex-onboarding-tutorial-relaunch";

export const realtimeClientIdKey = "vertex-realtime-client-id";

export function getRealtimeClientId() {
  if (typeof window === "undefined") return "";
  const existing = window.sessionStorage.getItem(realtimeClientIdKey);
  if (existing) return existing;
  const nextId = crypto.randomUUID();
  window.sessionStorage.setItem(realtimeClientIdKey, nextId);
  return nextId;
}

export function realtimeLastEventKey(mode: WorkspaceMode, teamId: string | null, userId: string) {
  return `vertex-realtime-last-event:${mode}:${teamId ?? userId}`;
}

export type TutorialStep = {
  title: string;
  description: string;
  detail: string;
  actionLabel?: string;
  onAction?: () => void;
};

export function appendChatMessageToScopedChats(current: ScopedChatsResult | undefined, event: ChatMessageInsertEvent) {
  if (!current) return current;
  const conversationKey = getConversationKey(event.mode, event.projectId, event.chatId);
  const messages = current.conversations[conversationKey] ?? [];
  if (messages.some((message) => message.id === event.message.id)) return current;
  const reconciledMessages =
    event.message.role === "user"
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

export function appendChatMessageToCache(current: ScopedChatsResult | undefined, conversationKey: string, message: ChatMessage) {
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

export function updateChatMessageInCache(
  current: ScopedChatsResult | undefined,
  conversationKey: string,
  messageId: string,
  text: string,
  options?: { clientStatus?: ChatMessage["clientStatus"] | null; entities?: ChatOperationalEntity[] },
) {
  if (!current) return current;
  return {
    ...current,
    conversations: {
      ...current.conversations,
      [conversationKey]: (current.conversations[conversationKey] ?? []).map((message) =>
        message.id === messageId
          ? (() => {
              const nextMessage = { ...message, text };
              if (options?.clientStatus === null) {
                delete nextMessage.clientStatus;
              } else if (options?.clientStatus) {
                nextMessage.clientStatus = options.clientStatus;
              }
              if (options?.entities) {
                nextMessage.entities = options.entities;
              }
              return nextMessage;
            })()
          : message,
      ),
    },
  } satisfies ScopedChatsResult;
}

export function removeOptimisticChatMessages(current: ScopedChatsResult | undefined, conversationKey: string) {
  if (!current) return current;
  return {
    ...current,
    conversations: {
      ...current.conversations,
      [conversationKey]: (current.conversations[conversationKey] ?? []).filter((message) => message.clientStatus !== "sending"),
    },
  } satisfies ScopedChatsResult;
}

export function addArtifactToWorkspaceCache(current: PmoWorkspaceState | undefined, mode: WorkspaceMode, artifact: Artifact) {
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

export function updateArtifactInWorkspaceCache(
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
        artifacts: scopedWorkspace.artifacts.map((artifact) => (artifact.r2Key === r2Key ? updateArtifact(artifact) : artifact)),
      },
    },
  } satisfies PmoWorkspaceState;
}

export function addTaskToWorkspaceCache(current: PmoWorkspaceState | undefined, mode: WorkspaceMode, task: Task) {
  if (!current) return current;
  const scopedWorkspace = current.workspaces[mode];
  return {
    ...current,
    workspaces: {
      ...current.workspaces,
      [mode]: {
        ...scopedWorkspace,
        tasks: [task, ...scopedWorkspace.tasks.filter((item) => item.id !== task.id)],
      },
    },
  } satisfies PmoWorkspaceState;
}

export function updateTaskInWorkspaceCache(
  current: PmoWorkspaceState | undefined,
  mode: WorkspaceMode,
  id: string,
  updateTask: (task: Task) => Task,
) {
  if (!current) return current;
  const scopedWorkspace = current.workspaces[mode];
  return {
    ...current,
    workspaces: {
      ...current.workspaces,
      [mode]: {
        ...scopedWorkspace,
        tasks: scopedWorkspace.tasks.map((task) => (task.id === id ? updateTask(task) : task)),
      },
    },
  } satisfies PmoWorkspaceState;
}

export function removeTaskFromWorkspaceCache(current: PmoWorkspaceState | undefined, mode: WorkspaceMode, id: string) {
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

export function removeWorkflowItemFromWorkspaceCache(
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

export type CreateChatDialogState = {
  section: ChatSection;
  projectId: string | null;
  projectName?: string;
} | null;

export type ConfirmDialogState = {
  title: string;
  description: string;
  actionLabel: string;
  destructive?: boolean;
  onConfirm: () => Promise<void> | void;
} | null;

export type InputDialogState = {
  title: string;
  description: string;
  label: string;
  defaultValue?: string;
  placeholder?: string;
  actionLabel: string;
  inputType?: "text" | "email";
  onSubmit: (value: string) => Promise<void> | void;
} | null;

export type WorkflowPreviewState = {
  kind: "Approval" | "Decision" | "Idea" | "Task" | "Risk";
  title: string;
  originalText: string;
  meta: string;
} | null;

export type PageScopeKind = "workspace" | "project";

export type DetailMetric = {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  detail: string;
};

export function getDetailMetrics({
  activeTab,
  artifacts,
  approvals,
  decisions,
  ideas,
  messages,
  pinnedArtifacts,
  queryState,
  risks,
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
  risks: Risk[];
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
      {
        icon: CheckCircle2,
        label: "Open",
        value: String(decisions.filter((decision) => decision.status !== "Completed").length),
        detail: "Needs action",
      },
      {
        icon: Activity,
        label: "Completed",
        value: String(decisions.filter((decision) => decision.status === "Completed").length),
        detail: "Decided",
      },
      { icon: Activity, label: "Query state", value: queryState, detail: updatedAt },
    ];
  }
  if (activeTab === "Approvals") {
    return [
      { icon: ShieldCheck, label: "Approvals", value: String(approvals.length), detail: scopeContextLabel },
      {
        icon: Bell,
        label: "Pending",
        value: String(approvals.filter((approval) => approval.status !== "Approved").length),
        detail: "Needs response",
      },
      {
        icon: CheckCircle2,
        label: "Approved",
        value: String(approvals.filter((approval) => approval.status === "Approved").length),
        detail: "Complete",
      },
      { icon: Activity, label: "Query state", value: queryState, detail: updatedAt },
    ];
  }
  if (activeTab === "Tasks") {
    return [
      { icon: CheckCircle2, label: "Tasks", value: String(tasks.length), detail: scopeContextLabel },
      { icon: UploadCloud, label: "Synced", value: String(tasks.filter((task) => task.asanaTaskGid).length), detail: "In Asana" },
      { icon: Folder, label: "Sources", value: String(new Set(tasks.map((task) => task.source)).size), detail: "Distinct sources" },
      { icon: Activity, label: "Query state", value: queryState, detail: updatedAt },
    ];
  }
  if (activeTab === "Risks") {
    const riskStats = getRiskStats(risks);
    return [
      { icon: ShieldAlert, label: "Risks", value: String(riskStats.total), detail: scopeContextLabel },
      { icon: Bell, label: "Critical", value: String(riskStats.critical), detail: "Highest severity" },
      { icon: ShieldCheck, label: "Mitigated", value: String(riskStats.mitigated), detail: "Has plan" },
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
    {
      icon: Star,
      label: "Converted",
      value: String(ideas.filter((idea) => idea.status === "Convert to Project").length),
      detail: "Project",
    },
    { icon: Activity, label: "Query state", value: queryState, detail: updatedAt },
  ];
}
