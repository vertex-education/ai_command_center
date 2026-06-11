import { useEffect, useMemo, useState, type ComponentType, type FormEvent, type ReactNode } from "react";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
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
  Bot,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Download,
  Eye,
  FileText,
  Folder,
  FolderOpen,
  Lightbulb,
  Menu,
  MessageCircle,
  Paperclip,
  Plus,
  Search,
  Send,
  Share2,
  ShieldCheck,
  Sparkles,
  Star,
  Users,
  X,
  Zap,
} from "lucide-react";
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
import { cn } from "@/lib/utils";
import {
  type AddIdeaInput,
  type Approval,
  type Artifact,
  type ChatMessage,
  type Decision,
  type Idea,
  type IdeaStatus,
  type PmoWorkspaceState,
  type RailName,
  type TabName,
  type Task,
  type WorkspaceMode,
  addIdea,
  avatarAlex,
  getConversationKey,
  initials,
  modelOptions,
  pmoWorkspaceQueryKey,
  pmoWorkspaceQueryOptions,
  projectChats,
  promptTemplates,
  sendChatMessage,
  statusFilters,
  statusMeta,
  tabs,
  toggleApprovalStatus,
  toggleArtifactPin,
  toggleDecisionStatus,
  toggleIdeaPin,
  toggleTaskStatus,
  updateAccessLevel,
  updateIdeaStatus,
  voteIdea,
  workspaceChatSets,
  workspaceModeLabel,
  workspaceModes,
} from "@/lib/pmo-data";

export const Route = createFileRoute("/")({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(pmoWorkspaceQueryOptions());
  },
  head: () => ({
    meta: [{ title: "PMO Chatbot Command Center" }],
  }),
  component: PMOCommandCenter,
});

const emptyIdeaForm: AddIdeaInput = {
  title: "",
  category: "Governance",
  status: "New",
  impact: "High",
  summary: "",
};

function PMOCommandCenter() {
  const queryClient = useQueryClient();
  const workspaceQuery = useSuspenseQuery(pmoWorkspaceQueryOptions());
  const workspace = workspaceQuery.data;

  const [activeRail, setActiveRail] = useState<RailName>("Workspaces");
  const [activeTab, setActiveTab] = useState<TabName>("Ideas");
  const [activeProject, setActiveProject] = useState("Vertex Hub");
  const [activeChat, setActiveChat] = useState("Shared Chat");
  const [activeMode, setActiveMode] = useState<WorkspaceMode>("Team Project");
  const [selectedIdeaId, setSelectedIdeaId] = useState(workspace.ideas[0]?.id ?? "");
  const [selectedArtifactTitle, setSelectedArtifactTitle] = useState(workspace.artifacts[1]?.title ?? workspace.artifacts[0]?.title ?? "");
  const [statusFilter, setStatusFilter] = useState<IdeaStatus | "All">("All");
  const [searchTerm, setSearchTerm] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [model, setModel] = useState(modelOptions[0]);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isAccessOpen, setIsAccessOpen] = useState(false);
  const [previewArtifact, setPreviewArtifact] = useState<Artifact | null>(null);
  const [rightOpen, setRightOpen] = useState(true);
  const [toast, setToast] = useState("SSR workspace hydrated");

  const invalidateWorkspace = () =>
    queryClient.invalidateQueries({ queryKey: pmoWorkspaceQueryKey });

  const addIdeaMutation = useMutation({
    mutationFn: (input: AddIdeaInput) => addIdea({ data: input }),
    onSuccess: invalidateWorkspace,
  });
  const sendMessageMutation = useMutation({
    mutationFn: (input: { project: string; chat: string; text: string; model: string }) =>
      sendChatMessage({ data: input }),
    onSuccess: invalidateWorkspace,
  });
  const updateStatusMutation = useMutation({
    mutationFn: (input: { id: string; status: IdeaStatus }) => updateIdeaStatus({ data: input }),
    onSuccess: invalidateWorkspace,
  });
  const voteIdeaMutation = useMutation({
    mutationFn: (id: string) => voteIdea({ data: { id } }),
    onSuccess: invalidateWorkspace,
  });
  const toggleIdeaPinMutation = useMutation({
    mutationFn: (id: string) => toggleIdeaPin({ data: { id } }),
    onSuccess: invalidateWorkspace,
  });
  const toggleArtifactPinMutation = useMutation({
    mutationFn: (input: { title: string; mode: WorkspaceMode }) => toggleArtifactPin({ data: input }),
    onSuccess: invalidateWorkspace,
  });
  const toggleDecisionMutation = useMutation({
    mutationFn: (id: string) => toggleDecisionStatus({ data: { id } }),
    onSuccess: invalidateWorkspace,
  });
  const toggleApprovalMutation = useMutation({
    mutationFn: (id: string) => toggleApprovalStatus({ data: { id } }),
    onSuccess: invalidateWorkspace,
  });
  const toggleTaskMutation = useMutation({
    mutationFn: (id: string) => toggleTaskStatus({ data: { id } }),
    onSuccess: invalidateWorkspace,
  });
  const updateAccessMutation = useMutation({
    mutationFn: (accessLevel: PmoWorkspaceState["accessLevel"]) => updateAccessLevel({ data: { accessLevel } }),
    onSuccess: invalidateWorkspace,
  });

  const workspaceTitle =
    activeMode === "Personal"
      ? "Personal workspace"
      : activeMode === "Team"
        ? "PMO Team workspace"
        : activeMode === "Project"
          ? `${activeProject} personal project`
          : `${activeProject} team project`;

  const chatSet =
    activeMode === "Team Project"
      ? { ...workspaceChatSets[activeMode], chats: projectChats[activeProject] ?? workspaceChatSets[activeMode].chats }
      : workspaceChatSets[activeMode];

  const conversationKey = getConversationKey(activeProject, activeChat);
  const currentMessages = workspace.conversations[conversationKey] ?? [
    {
      id: `${conversationKey}-empty`,
      author: "PMO Assistant",
      role: "system" as const,
      time: "Now",
      text: "No messages in this scoped workspace yet. Ask the PMO assistant to summarize decisions, risks, or artifacts.",
    },
  ];

  const selectedIdea = workspace.ideas.find((idea) => idea.id === selectedIdeaId) ?? workspace.ideas[0];
  const selectedArtifact =
    workspace.artifacts.find((artifact) => artifact.title === selectedArtifactTitle) ?? workspace.artifacts[0];

  const pinnedIdeas = workspace.pinnedIdeaIds
    .map((id) => workspace.ideas.find((idea) => idea.id === id))
    .filter((idea): idea is Idea => Boolean(idea));
  const pinnedArtifacts = workspace.artifacts.filter((artifact) => artifact.pinnedTo.includes(activeMode));

  const filteredIdeas = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    return workspace.ideas.filter((idea) => {
      const statusMatches = statusFilter === "All" || idea.status === statusFilter;
      const textMatches =
        !normalizedSearch ||
        [idea.title, idea.category, idea.owner, idea.summary, ...idea.tags]
          .join(" ")
          .toLowerCase()
          .includes(normalizedSearch);
      return statusMatches && textMatches;
    });
  }, [workspace.ideas, searchTerm, statusFilter]);

  const metrics = [
    {
      icon: Lightbulb,
      label: "Active ideas",
      value: String(workspace.ideas.length),
      detail: `${workspace.ideas.filter((idea) => idea.status === "Pilot").length} pilots`,
    },
    {
      icon: ClipboardList,
      label: "Open decisions",
      value: String(workspace.decisions.filter((decision) => decision.status !== "Done").length),
      detail: "Governance actions",
    },
    {
      icon: Archive,
      label: "Pinned artifacts",
      value: String(pinnedArtifacts.length),
      detail: workspaceModeLabel(activeMode),
    },
    {
      icon: Activity,
      label: "Query state",
      value: workspaceQuery.isFetching ? "Syncing" : "Fresh",
      detail: workspace.updatedAt,
    },
  ];

  useEffect(() => {
    if (!selectedIdea && workspace.ideas[0]) {
      setSelectedIdeaId(workspace.ideas[0].id);
    }
  }, [selectedIdea, workspace.ideas]);

  function updateToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast("SSR workspace hydrated"), 2600);
  }

  function handleRailClick(label: RailName) {
    setActiveRail(label);
    const nextTab: Partial<Record<RailName, TabName>> = {
      Workspaces: "Ideas",
      Chats: "Chat",
      Ideas: "Ideas",
      Artifacts: "Artifacts",
      Decisions: "Decisions",
      Approvals: "Approvals",
      Tasks: "Tasks",
      Prompts: "Prompt Templates",
    };
    setActiveTab(nextTab[label] ?? "Ideas");
  }

  function handleWorkspaceMode(mode: WorkspaceMode) {
    setActiveMode(mode);
    setRightOpen(true);
    setActiveChat(
      mode === "Team Project"
        ? projectChats[activeProject]?.[0] ?? workspaceChatSets[mode].chats[0]
        : workspaceChatSets[mode].chats[0],
    );
  }

  function handleProjectSelect(project: string) {
    setActiveProject(project);
    setActiveChat(projectChats[project]?.[0] ?? "Shared Chat");
    setActiveTab("Ideas");
    setRightOpen(true);
  }

  async function handleSendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = chatInput.trim();
    if (!text) return;
    await sendMessageMutation.mutateAsync({ project: activeProject, chat: activeChat, text, model });
    setChatInput("");
    setActiveTab("Chat");
    updateToast("Query invalidated after assistant response");
  }

  async function handleAddIdea(value: AddIdeaInput) {
    await addIdeaMutation.mutateAsync(value);
    setIsAddOpen(false);
    setActiveTab("Ideas");
    setRightOpen(true);
    updateToast("Idea added through TanStack Form");
  }

  return (
    <main className="min-h-svh bg-[linear-gradient(135deg,oklch(0.985_0.006_247),oklch(0.955_0.015_240))] p-0 text-foreground lg:p-5">
      <div className="workspace-shadow relative grid min-h-svh overflow-hidden border bg-card lg:min-h-[calc(100vh-40px)] lg:grid-cols-[72px_minmax(0,1fr)] lg:rounded-xl">
        <PrimaryRail activeRail={activeRail} onRailClick={handleRailClick} />

        <section className="flex min-w-0 flex-col overflow-hidden bg-background">
          <Topbar
            activeMode={activeMode}
            activeProject={activeProject}
            model={model}
            searchTerm={searchTerm}
            workspaceTitle={workspaceTitle}
            onModelChange={(value) => {
              setModel(value);
              updateToast(`${value} selected`);
            }}
            onSearchTerm={setSearchTerm}
            onMobileMenu={() => handleRailClick("Workspaces")}
            onNotify={() => updateToast("Decision taxonomy is still blocked")}
          />

          <Contextbar
            activeMode={activeMode}
            accessLevel={workspace.accessLevel}
            workspaceTitle={workspaceTitle}
            onAccessOpen={() => setIsAccessOpen(true)}
            onModeChange={handleWorkspaceMode}
          />

          <div className="grid min-h-0 flex-1 bg-card lg:grid-cols-[260px_minmax(430px,1fr)_minmax(320px,380px)] xl:grid-cols-[280px_minmax(520px,1fr)_390px]">
            <ProjectNav
              activeChat={activeChat}
              activeMode={activeMode}
              activeProject={activeProject}
              chatSet={chatSet}
              onChatSelect={(chat) => {
                setActiveChat(chat);
                setActiveTab(chat.includes("Decision") ? "Decisions" : "Chat");
              }}
              onProjectSelect={handleProjectSelect}
            />

            <section className="flex min-w-0 flex-col border-r">
              <PinnedStrip
                activeMode={activeMode}
                artifacts={pinnedArtifacts}
                ideas={pinnedIdeas}
                onOpenPins={() => setActiveTab("Artifacts")}
                onSelectArtifact={(artifact) => {
                  setSelectedArtifactTitle(artifact.title);
                  setActiveTab("Artifacts");
                  setRightOpen(true);
                }}
                onSelectIdea={(idea) => {
                  setSelectedIdeaId(idea.id);
                  setActiveTab("Ideas");
                  setRightOpen(true);
                }}
              />

              <div className="scrollbar-thin flex h-12 shrink-0 items-end gap-4 overflow-x-auto border-b px-4">
                {tabs.map((tab) => (
                  <button
                    className={cn(
                      "h-12 whitespace-nowrap border-b-2 border-transparent text-sm font-medium text-muted-foreground",
                      tab === activeTab && "border-primary text-primary",
                    )}
                    key={tab}
                    type="button"
                    onClick={() => setActiveTab(tab)}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              <section className="scrollbar-thin min-h-0 flex-1 overflow-auto p-4">
                {activeTab === "Chat" ? <ChatView messages={currentMessages} /> : null}
                {activeTab === "Ideas" ? (
                  <IdeasView
                    ideas={filteredIdeas}
                    selectedIdeaId={selectedIdea?.id}
                    searchTerm={searchTerm}
                    statusFilter={statusFilter}
                    pinnedIdeaIds={workspace.pinnedIdeaIds}
                    onAddIdea={() => setIsAddOpen(true)}
                    onSearchTerm={setSearchTerm}
                    onSelectIdea={(idea) => {
                      setSelectedIdeaId(idea.id);
                      setRightOpen(true);
                    }}
                    onStatusFilter={setStatusFilter}
                    onTogglePin={(id) => toggleIdeaPinMutation.mutate(id)}
                  />
                ) : null}
                {activeTab === "Artifacts" ? (
                  <ArtifactsView
                    activeMode={activeMode}
                    artifacts={workspace.artifacts}
                    selectedArtifactTitle={selectedArtifact?.title}
                    onPreview={setPreviewArtifact}
                    onSelectArtifact={(artifact) => {
                      setSelectedArtifactTitle(artifact.title);
                      setRightOpen(true);
                    }}
                    onShare={() => updateToast("Share options prepared")}
                    onTogglePin={(artifact) =>
                      toggleArtifactPinMutation.mutate({ title: artifact.title, mode: activeMode })
                    }
                  />
                ) : null}
                {activeTab === "Decisions" ? (
                  <DecisionView decisions={workspace.decisions} onToggle={(id) => toggleDecisionMutation.mutate(id)} />
                ) : null}
                {activeTab === "Approvals" ? (
                  <ApprovalView approvals={workspace.approvals} onToggle={(id) => toggleApprovalMutation.mutate(id)} />
                ) : null}
                {activeTab === "Tasks" ? (
                  <TaskView tasks={workspace.tasks} onToggle={(id) => toggleTaskMutation.mutate(id)} />
                ) : null}
                {activeTab === "Prompt Templates" ? (
                  <PromptView
                    onUsePrompt={(prompt) => {
                      setChatInput(prompt);
                      setActiveTab("Chat");
                    }}
                  />
                ) : null}
              </section>

              <form className="grid grid-cols-[minmax(0,1fr)_38px_38px_auto_44px] gap-2 border-t bg-card p-3 max-sm:grid-cols-[minmax(0,1fr)_38px_44px]" onSubmit={handleSendMessage}>
                <Input
                  aria-label="Ask the PMO assistant"
                  placeholder={`Ask about ${activeProject} / ${activeChat}`}
                  value={chatInput}
                  onChange={(event) => setChatInput(event.target.value)}
                />
                <Button type="button" variant="outline" size="icon" aria-label="Attach file" onClick={() => updateToast("Attachment queued")}>
                  <Paperclip />
                </Button>
                <Button type="button" variant="outline" size="icon" aria-label="Add workspace context" onClick={() => updateToast("Workspace context added")}>
                  <Folder />
                </Button>
                <Button type="button" variant="outline" className="max-sm:hidden" onClick={() => updateToast(`${model} ready`)}>
                  <Bot />
                  {model}
                  <ChevronDown />
                </Button>
                <Button type="submit" size="icon" aria-label="Send message" disabled={sendMessageMutation.isPending}>
                  <Send />
                </Button>
              </form>
            </section>

            {rightOpen ? (
              <DetailPanel
                activeMode={activeMode}
                activeTab={activeTab}
                artifact={selectedArtifact}
                decisions={workspace.decisions}
                idea={selectedIdea}
                isPinned={selectedIdea ? workspace.pinnedIdeaIds.includes(selectedIdea.id) : false}
                metrics={metrics}
                prompts={promptTemplates}
                tasks={workspace.tasks}
                approvals={workspace.approvals}
                workspaceTitle={workspaceTitle}
                onClose={() => setRightOpen(false)}
                onPreviewArtifact={() => selectedArtifact && setPreviewArtifact(selectedArtifact)}
                onShare={() => updateToast("Share link options ready")}
                onStatusChange={(status) => selectedIdea && updateStatusMutation.mutate({ id: selectedIdea.id, status })}
                onToggleArtifactPin={() =>
                  selectedArtifact && toggleArtifactPinMutation.mutate({ title: selectedArtifact.title, mode: activeMode })
                }
                onToggleIdeaPin={() => selectedIdea && toggleIdeaPinMutation.mutate(selectedIdea.id)}
                onUsePrompt={(prompt) => {
                  setChatInput(prompt);
                  setActiveTab("Chat");
                }}
                onVoteIdea={() => selectedIdea && voteIdeaMutation.mutate(selectedIdea.id)}
                onToggleDecision={(id) => toggleDecisionMutation.mutate(id)}
                onToggleApproval={(id) => toggleApprovalMutation.mutate(id)}
                onToggleTask={(id) => toggleTaskMutation.mutate(id)}
              />
            ) : (
              <Button className="m-4 hidden self-start lg:inline-flex" type="button" variant="outline" onClick={() => setRightOpen(true)}>
                <Eye />
                Open details
              </Button>
            )}
          </div>
        </section>

        <div className="absolute right-4 bottom-4 z-40 flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-xs font-medium shadow-lg">
          <span className="size-2 rounded-full bg-success" />
          {toast}
        </div>
      </div>

      <AddIdeaDialog
        open={isAddOpen}
        pending={addIdeaMutation.isPending}
        onOpenChange={setIsAddOpen}
        onSubmit={handleAddIdea}
      />
      <AccessDialog
        accessLevel={workspace.accessLevel}
        open={isAccessOpen}
        pending={updateAccessMutation.isPending}
        onOpenChange={setIsAccessOpen}
        onSave={(accessLevel) => {
          updateAccessMutation.mutate(accessLevel);
          setIsAccessOpen(false);
          updateToast("Access query updated");
        }}
      />
      <ArtifactPreviewDialog artifact={previewArtifact} onOpenChange={(open) => !open && setPreviewArtifact(null)} />
    </main>
  );
}

function PrimaryRail({
  activeRail,
  onRailClick,
}: {
  activeRail: RailName;
  onRailClick: (rail: RailName) => void;
}) {
  const items: Array<{ label: RailName; icon: ComponentType<{ className?: string }> }> = [
    { label: "Workspaces", icon: FolderOpen },
    { label: "Chats", icon: MessageCircle },
    { label: "Ideas", icon: Lightbulb },
    { label: "Artifacts", icon: Archive },
    { label: "Decisions", icon: ClipboardList },
    { label: "Approvals", icon: ShieldCheck },
    { label: "Tasks", icon: CheckCircle2 },
    { label: "Prompts", icon: Sparkles },
  ];

  return (
    <aside className="hidden flex-col items-center gap-2 bg-sidebar px-2 py-5 text-sidebar-foreground lg:flex">
      <div className="mb-4 grid size-10 place-items-center rounded-md bg-white">
        <img alt="Vertex" className="size-7" src="/vertex-mountain-blue.svg" />
      </div>
      {items.map(({ label, icon: Icon }) => (
        <button
          aria-label={label}
          className={cn(
            "group relative grid size-12 place-items-center rounded-md text-white/75 transition-colors hover:bg-white/15 hover:text-white",
            activeRail === label && "bg-white/15 text-white",
          )}
          key={label}
          type="button"
          onClick={() => onRailClick(label)}
        >
          <Icon className="size-5" />
          <span className="pointer-events-none absolute left-[calc(100%+10px)] z-50 rounded-md border border-white/15 bg-sidebar px-2 py-1 text-xs font-semibold opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
            {label}
          </span>
        </button>
      ))}
      <div className="flex-1" />
      <img alt="Alex Morgan" className="size-9 rounded-full border-2 border-white/30 object-cover" src={avatarAlex} />
    </aside>
  );
}

function Topbar({
  activeMode,
  activeProject,
  model,
  searchTerm,
  workspaceTitle,
  onMobileMenu,
  onModelChange,
  onNotify,
  onSearchTerm,
}: {
  activeMode: WorkspaceMode;
  activeProject: string;
  model: string;
  searchTerm: string;
  workspaceTitle: string;
  onMobileMenu: () => void;
  onModelChange: (model: string) => void;
  onNotify: () => void;
  onSearchTerm: (value: string) => void;
}) {
  return (
    <header className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b bg-card px-3 lg:min-h-[78px] lg:grid-cols-[minmax(220px,1fr)_minmax(260px,360px)_auto] lg:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <Button className="lg:hidden" type="button" variant="outline" size="icon" aria-label="Open menu" onClick={onMobileMenu}>
          <Menu />
        </Button>
        <img alt="Vertex Education" className="hidden h-7 w-auto sm:block" src="/vertex-horizontal.svg" />
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold lg:text-xl">PMO Chatbot</h1>
          <p className="truncate text-xs text-muted-foreground">
            {workspaceTitle} / {activeMode === "Team Project" ? activeProject : workspaceModeLabel(activeMode)}
          </p>
        </div>
      </div>
      <label className="hidden h-9 items-center gap-2 rounded-md border bg-background px-3 text-muted-foreground lg:flex">
        <Search className="size-4" />
        <Input
          className="h-7 border-0 px-0 shadow-none focus-visible:ring-0"
          placeholder="Search ideas, artifacts, owners"
          value={searchTerm}
          onChange={(event) => onSearchTerm(event.target.value)}
        />
      </label>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="icon" aria-label="Notifications" onClick={onNotify}>
          <Bell />
        </Button>
        <select
          aria-label="Model"
          className="hidden h-9 rounded-md border bg-background px-2 text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 md:block"
          value={model}
          onChange={(event) => onModelChange(event.target.value)}
        >
          {modelOptions.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
        <Button type="button" variant="outline" className="hidden md:inline-flex">
          <Users />
          PMO Team
        </Button>
      </div>
    </header>
  );
}

function Contextbar({
  accessLevel,
  activeMode,
  workspaceTitle,
  onAccessOpen,
  onModeChange,
}: {
  accessLevel: PmoWorkspaceState["accessLevel"];
  activeMode: WorkspaceMode;
  workspaceTitle: string;
  onAccessOpen: () => void;
  onModeChange: (mode: WorkspaceMode) => void;
}) {
  return (
    <section className="grid gap-3 border-b bg-card px-3 py-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:px-5">
      <div className="min-w-0 space-y-2">
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
        <div className="flex min-w-0 items-center gap-2 overflow-x-auto text-sm text-muted-foreground">
          <Folder className="size-4 shrink-0" />
          <strong className="shrink-0 text-foreground">{workspaceTitle}</strong>
          <span>/</span>
          <span className="truncate">Pinned knowledge, decisions, artifacts, and prompts</span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <ShieldCheck className="size-5 text-success" />
        <div className="min-w-0">
          <strong className="block text-sm">Team access</strong>
          <span className="text-xs text-muted-foreground">{accessLevel}</span>
        </div>
        <Button type="button" variant="outline" onClick={onAccessOpen}>
          Manage
        </Button>
      </div>
    </section>
  );
}

function ProjectNav({
  activeChat,
  activeMode,
  activeProject,
  chatSet,
  onChatSelect,
  onProjectSelect,
}: {
  activeChat: string;
  activeMode: WorkspaceMode;
  activeProject: string;
  chatSet: { heading: string; chats: string[]; savedHeading: string; saved: string[] };
  onChatSelect: (chat: string) => void;
  onProjectSelect: (project: string) => void;
}) {
  const projects = Object.keys(projectChats);

  return (
    <aside className="scrollbar-thin hidden min-h-0 overflow-auto border-r bg-muted/40 p-3 lg:block">
      <div className="mb-2 flex items-center justify-between px-2 text-xs font-semibold uppercase text-muted-foreground">
        <span>{activeMode === "Team" ? "Team workspace" : activeMode === "Personal" ? "Personal workspace" : activeProject}</span>
        <Plus className="size-4" />
      </div>
      {projects.map((project) => (
        <button
          className={cn(
            "mb-1 flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            project === activeProject && "bg-accent text-accent-foreground font-medium",
          )}
          key={project}
          type="button"
          onClick={() => onProjectSelect(project)}
        >
          <Folder className="size-4" />
          <span className="min-w-0 flex-1 truncate">{project}</span>
        </button>
      ))}

      <div className="mt-5 px-2 text-xs font-semibold uppercase text-muted-foreground">{chatSet.heading}</div>
      <div className="mt-2 space-y-1">
        {chatSet.chats.map((chat) => (
          <button
            className={cn(
              "flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              chat === activeChat && "bg-card text-primary shadow-xs",
            )}
            key={chat}
            type="button"
            onClick={() => onChatSelect(chat)}
          >
            <MessageCircle className="size-4" />
            <span className="min-w-0 flex-1 truncate">{chat}</span>
          </button>
        ))}
      </div>

      <div className="mt-5 px-2 text-xs font-semibold uppercase text-muted-foreground">{chatSet.savedHeading}</div>
      <div className="mt-2 space-y-1">
        {chatSet.saved.map((chat) => (
          <button
            className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            key={chat}
            type="button"
            onClick={() => onChatSelect(chat)}
          >
            <Archive className="size-4" />
            <span className="min-w-0 flex-1 truncate">{chat}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}

function PinnedStrip({
  activeMode,
  artifacts,
  ideas,
  onOpenPins,
  onSelectArtifact,
  onSelectIdea,
}: {
  activeMode: WorkspaceMode;
  artifacts: Artifact[];
  ideas: Idea[];
  onOpenPins: () => void;
  onSelectArtifact: (artifact: Artifact) => void;
  onSelectIdea: (idea: Idea) => void;
}) {
  return (
    <section className="shrink-0 border-b bg-card px-4 py-3">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <span className="text-xs font-semibold uppercase text-muted-foreground">Pinned workspace items</span>
          <h2 className="text-base font-semibold">{workspaceModeLabel(activeMode)} context</h2>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onOpenPins}>
          <Star />
          Pins
        </Button>
      </div>
      <div className="scrollbar-thin flex gap-2 overflow-x-auto pb-1">
        {ideas.slice(0, 3).map((idea) => (
          <button
            className="grid min-h-28 w-56 shrink-0 gap-2 rounded-lg border bg-background p-3 text-left hover:border-primary/40 hover:bg-accent/30"
            key={idea.id}
            type="button"
            onClick={() => onSelectIdea(idea)}
          >
            <StatusBadge status={idea.status} />
            <strong className="line-clamp-1 text-sm">{idea.title}</strong>
            <span className="line-clamp-2 text-xs text-muted-foreground">{idea.summary}</span>
          </button>
        ))}
        {artifacts.slice(0, 2).map((artifact) => (
          <button
            className="grid min-h-28 w-56 shrink-0 grid-cols-[32px_minmax(0,1fr)] gap-2 rounded-lg border bg-background p-3 text-left hover:border-primary/40 hover:bg-accent/30"
            key={artifact.title}
            type="button"
            onClick={() => onSelectArtifact(artifact)}
          >
            <span className="grid size-8 place-items-center rounded-md bg-primary text-primary-foreground">
              {artifactIcon(artifact.type)}
            </span>
            <span className="min-w-0">
              <strong className="block truncate text-sm">{artifact.title}</strong>
              <em className="mt-1 block text-xs not-italic text-muted-foreground">
                {artifact.type} / {artifact.status}
              </em>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function ChatView({ messages }: { messages: ChatMessage[] }) {
  return (
    <div className="space-y-4">
      {messages.map((message) => (
        <article className="grid grid-cols-[36px_minmax(0,1fr)] gap-3" key={message.id}>
          {message.role === "assistant" || message.role === "system" ? (
            <div className="grid size-9 place-items-center rounded-full bg-primary text-xl font-semibold text-primary-foreground">V</div>
          ) : (
            <img alt={message.author} className="size-9 rounded-full object-cover" src={message.avatar} />
          )}
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <strong className="text-sm text-foreground">{message.author}</strong>
              <span>{message.time}</span>
              {message.role === "assistant" ? <Badge variant="secondary">assistant</Badge> : null}
            </div>
            <p className="text-sm leading-6 text-foreground/85">{message.text}</p>
            {message.artifact ? (
              <button className="mt-2 grid min-h-14 max-w-lg grid-cols-[34px_minmax(0,1fr)_24px] items-center gap-2 rounded-md border bg-muted/40 p-2 text-left">
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
        </article>
      ))}
    </div>
  );
}

function IdeasView({
  ideas,
  pinnedIdeaIds,
  searchTerm,
  selectedIdeaId,
  statusFilter,
  onAddIdea,
  onSearchTerm,
  onSelectIdea,
  onStatusFilter,
  onTogglePin,
}: {
  ideas: Idea[];
  pinnedIdeaIds: string[];
  searchTerm: string;
  selectedIdeaId?: string;
  statusFilter: IdeaStatus | "All";
  onAddIdea: () => void;
  onSearchTerm: (value: string) => void;
  onSelectIdea: (idea: Idea) => void;
  onStatusFilter: (value: IdeaStatus | "All") => void;
  onTogglePin: (id: string) => void;
}) {
  const columns = useMemo<ColumnDef<Idea>[]>(
    () => [
      {
        accessorKey: "title",
        header: "Idea",
        cell: ({ row }) => (
          <div className="max-w-[360px]">
            <strong className="block truncate">{row.original.title}</strong>
            <span className="line-clamp-2 text-xs text-muted-foreground">{row.original.summary}</span>
          </div>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        accessorKey: "owner",
        header: "Owner",
        cell: ({ row }) => (
          <span className="flex items-center gap-2 whitespace-nowrap">
            <img alt={row.original.owner} className="size-6 rounded-full object-cover" src={row.original.avatar} />
            {row.original.owner}
          </span>
        ),
      },
      {
        accessorKey: "impact",
        header: "Impact",
        cell: ({ row }) => <ScoreCell value={row.original.impact} />,
      },
      {
        accessorKey: "effort",
        header: "Effort",
        cell: ({ row }) => <ScoreCell value={row.original.effort} />,
      },
      {
        accessorKey: "votes",
        header: "Votes",
      },
      {
        id: "pin",
        header: "",
        cell: ({ row }) => (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={pinnedIdeaIds.includes(row.original.id) ? "Unpin idea" : "Pin idea"}
            onClick={(event) => {
              event.stopPropagation();
              onTogglePin(row.original.id);
            }}
          >
            <Star className={cn(pinnedIdeaIds.includes(row.original.id) && "fill-warning text-warning")} />
          </Button>
        ),
      },
    ],
    [onTogglePin, pinnedIdeaIds],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <span className="text-xs font-semibold uppercase text-muted-foreground">Improvement queue</span>
          <h2 className="text-xl font-semibold">{ideas.length} PMO ideas in view</h2>
        </div>
        <Button type="button" onClick={onAddIdea} data-testid="open-add-idea">
          <Plus />
          Add idea
        </Button>
      </div>
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
      <DataTable
        columns={columns}
        data={ideas}
        selectedId={selectedIdeaId}
        getRowId={(idea) => idea.id}
        onRowClick={onSelectIdea}
      />
    </div>
  );
}

function ArtifactsView({
  activeMode,
  artifacts,
  selectedArtifactTitle,
  onPreview,
  onSelectArtifact,
  onShare,
  onTogglePin,
}: {
  activeMode: WorkspaceMode;
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
              <em className="block text-xs not-italic text-muted-foreground">{row.original.summary}</em>
            </span>
          </div>
        ),
      },
      { accessorKey: "type", header: "Type" },
      { accessorKey: "owner", header: "Owner" },
      { accessorKey: "status", header: "Status" },
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
              onClick={(event) => {
                event.stopPropagation();
                onPreview(row.original);
              }}
            >
              <Eye />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Pin ${row.original.title}`}
              onClick={(event) => {
                event.stopPropagation();
                onTogglePin(row.original);
              }}
            >
              <Star className={cn(row.original.pinnedTo.includes(activeMode) && "fill-warning text-warning")} />
            </Button>
            <Button asChild variant="ghost" size="icon" aria-label={`Download ${row.original.title}`}>
              <a href={row.original.href} download onClick={(event) => event.stopPropagation()}>
                <Download />
              </a>
            </Button>
          </div>
        ),
      },
    ],
    [activeMode, onPreview, onTogglePin],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="text-xs font-semibold uppercase text-muted-foreground">Artifacts</span>
          <h2 className="text-xl font-semibold">Pin artifacts to {workspaceModeLabel(activeMode)}</h2>
        </div>
        <Button type="button" variant="outline" onClick={onShare}>
          <Share2 />
          Share
        </Button>
      </div>
      <DataTable
        columns={columns}
        data={artifacts}
        selectedId={selectedArtifactTitle}
        getRowId={(artifact) => artifact.title}
        onRowClick={onSelectArtifact}
      />
    </div>
  );
}

function DecisionView({ decisions, onToggle }: { decisions: Decision[]; onToggle: (id: string) => void }) {
  const columns = useMemo<ColumnDef<Decision>[]>(
    () => [
      { accessorKey: "title", header: "Decision" },
      { accessorKey: "owner", header: "Owner" },
      { accessorKey: "due", header: "Due" },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => <Badge variant={row.original.status === "Done" ? "success" : row.original.status === "Blocked" ? "destructive" : "warning"}>{row.original.status}</Badge>,
      },
      {
        id: "action",
        header: "",
        cell: ({ row }) => (
          <Button type="button" variant="outline" size="sm" onClick={(event) => {
            event.stopPropagation();
            onToggle(row.original.id);
          }}>
            Toggle
          </Button>
        ),
      },
    ],
    [onToggle],
  );

  return <ActionTable title="Open governance actions" subtitle={`${decisions.filter((decision) => decision.status !== "Done").length} decisions need PMO attention`} data={decisions} columns={columns} getRowId={(decision) => decision.id} />;
}

function ApprovalView({ approvals, onToggle }: { approvals: Approval[]; onToggle: (id: string) => void }) {
  const columns = useMemo<ColumnDef<Approval>[]>(
    () => [
      { accessorKey: "title", header: "Approval" },
      { accessorKey: "owner", header: "Approver" },
      { accessorKey: "due", header: "Due" },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => <Badge variant={row.original.status === "Approved" ? "success" : row.original.status === "Requested" ? "warning" : "info"}>{row.original.status}</Badge>,
      },
      {
        id: "action",
        header: "",
        cell: ({ row }) => (
          <Button type="button" variant="outline" size="sm" onClick={(event) => {
            event.stopPropagation();
            onToggle(row.original.id);
          }}>
            Toggle
          </Button>
        ),
      },
    ],
    [onToggle],
  );

  return <ActionTable title="Approval queue" subtitle={`${approvals.filter((approval) => approval.status !== "Approved").length} approvals need attention`} data={approvals} columns={columns} getRowId={(approval) => approval.id} />;
}

function TaskView({ tasks, onToggle }: { tasks: Task[]; onToggle: (id: string) => void }) {
  const columns = useMemo<ColumnDef<Task>[]>(
    () => [
      { accessorKey: "title", header: "Task" },
      { accessorKey: "owner", header: "Owner" },
      { accessorKey: "source", header: "Source" },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => <Badge variant={row.original.status === "Done" ? "success" : row.original.status === "In progress" ? "warning" : "info"}>{row.original.status}</Badge>,
      },
      {
        id: "action",
        header: "",
        cell: ({ row }) => (
          <Button type="button" variant="outline" size="sm" onClick={(event) => {
            event.stopPropagation();
            onToggle(row.original.id);
          }}>
            Toggle
          </Button>
        ),
      },
    ],
    [onToggle],
  );

  return <ActionTable title="Tasks surfaced from chats" subtitle={`${tasks.filter((task) => task.status !== "Done").length} open follow-ups`} data={tasks} columns={columns} getRowId={(task) => task.id} />;
}

function ActionTable<TData extends object>({
  columns,
  data,
  getRowId,
  subtitle,
  title,
}: {
  columns: ColumnDef<TData>[];
  data: TData[];
  getRowId: (row: TData) => string;
  subtitle: string;
  title: string;
}) {
  return (
    <div className="space-y-4">
      <div>
        <span className="text-xs font-semibold uppercase text-muted-foreground">Workflow status</span>
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
      <DataTable columns={columns} data={data} getRowId={getRowId} />
    </div>
  );
}

function PromptView({ onUsePrompt }: { onUsePrompt: (value: string) => void }) {
  return (
    <div className="space-y-4">
      <div>
        <span className="text-xs font-semibold uppercase text-muted-foreground">Prompt templates</span>
        <h2 className="text-xl font-semibold">Reusable PMO prompts</h2>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {promptTemplates.map((prompt) => (
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

function DetailPanel({
  activeMode,
  activeTab,
  approvals,
  artifact,
  decisions,
  idea,
  isPinned,
  metrics,
  prompts,
  tasks,
  workspaceTitle,
  onClose,
  onPreviewArtifact,
  onShare,
  onStatusChange,
  onToggleApproval,
  onToggleArtifactPin,
  onToggleDecision,
  onToggleIdeaPin,
  onToggleTask,
  onUsePrompt,
  onVoteIdea,
}: {
  activeMode: WorkspaceMode;
  activeTab: TabName;
  approvals: Approval[];
  artifact?: Artifact;
  decisions: Decision[];
  idea?: Idea;
  isPinned: boolean;
  metrics: Array<{ icon: ComponentType<{ className?: string }>; label: string; value: string; detail: string }>;
  prompts: string[];
  tasks: Task[];
  workspaceTitle: string;
  onClose: () => void;
  onPreviewArtifact: () => void;
  onShare: () => void;
  onStatusChange: (status: IdeaStatus) => void;
  onToggleApproval: (id: string) => void;
  onToggleArtifactPin: () => void;
  onToggleDecision: (id: string) => void;
  onToggleIdeaPin: () => void;
  onToggleTask: (id: string) => void;
  onUsePrompt: (prompt: string) => void;
  onVoteIdea: () => void;
}) {
  const openDecision = decisions.find((decision) => decision.status !== "Done") ?? decisions[0];
  const openApproval = approvals.find((approval) => approval.status !== "Approved") ?? approvals[0];
  const openTask = tasks.find((task) => task.status !== "Done") ?? tasks[0];

  return (
    <aside className="scrollbar-thin hidden min-h-0 overflow-auto bg-muted/35 p-4 lg:block">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="text-xs font-semibold uppercase text-muted-foreground">Workspace detail</span>
          <h2 className="truncate text-lg font-semibold">{workspaceTitle}</h2>
        </div>
        <Button type="button" variant="ghost" size="icon" aria-label="Collapse details" onClick={onClose}>
          <X />
        </Button>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2">
        {metrics.map((metric) => (
          <MetricCard key={metric.label} {...metric} />
        ))}
      </div>

      {activeTab === "Artifacts" && artifact ? (
        <ArtifactDetail
          activeMode={activeMode}
          artifact={artifact}
          onPreviewArtifact={onPreviewArtifact}
          onShare={onShare}
          onToggleArtifactPin={onToggleArtifactPin}
        />
      ) : idea ? (
        <IdeaDetail
          idea={idea}
          isPinned={isPinned}
          onShare={onShare}
          onStatusChange={onStatusChange}
          onToggleIdeaPin={onToggleIdeaPin}
          onVoteIdea={onVoteIdea}
        />
      ) : null}

      {openDecision ? (
        <SidebarAction
          icon={ClipboardList}
          label="Decision"
          title={openDecision.title}
          detail={`${openDecision.owner} / ${openDecision.status}`}
          action="Advance"
          onClick={() => onToggleDecision(openDecision.id)}
        />
      ) : null}
      {openApproval ? (
        <SidebarAction
          icon={ShieldCheck}
          label="Approval"
          title={openApproval.title}
          detail={`${openApproval.owner} / ${openApproval.status}`}
          action="Advance"
          onClick={() => onToggleApproval(openApproval.id)}
        />
      ) : null}
      {openTask ? (
        <SidebarAction
          icon={CheckCircle2}
          label="Task"
          title={openTask.title}
          detail={`${openTask.owner} / ${openTask.status}`}
          action="Advance"
          onClick={() => onToggleTask(openTask.id)}
        />
      ) : null}
      <SidebarAction
        icon={Sparkles}
        label="Prompt"
        title={prompts[0]}
        detail="Reusable Steering Committee prep"
        action="Use"
        onClick={() => onUsePrompt(prompts[0])}
      />
    </aside>
  );
}

function IdeaDetail({
  idea,
  isPinned,
  onShare,
  onStatusChange,
  onToggleIdeaPin,
  onVoteIdea,
}: {
  idea: Idea;
  isPinned: boolean;
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
          <Button type="button" variant="ghost" size="icon" onClick={onToggleIdeaPin} aria-label={isPinned ? "Unpin idea" : "Pin idea"}>
            <Star className={cn(isPinned && "fill-warning text-warning")} />
          </Button>
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
            className="h-9 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            value={idea.status}
            onChange={(event) => onStatusChange(event.target.value as IdeaStatus)}
          >
            {(Object.keys(statusMeta) as IdeaStatus[]).map((status) => (
              <option key={status} value={status}>
                {statusMeta[status].label}
              </option>
            ))}
          </select>
        </label>
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
      </CardContent>
    </Card>
  );
}

function ArtifactDetail({
  activeMode,
  artifact,
  onPreviewArtifact,
  onShare,
  onToggleArtifactPin,
}: {
  activeMode: WorkspaceMode;
  artifact: Artifact;
  onPreviewArtifact: () => void;
  onShare: () => void;
  onToggleArtifactPin: () => void;
}) {
  const isPinned = artifact.pinnedTo.includes(activeMode);

  return (
    <Card className="mb-3">
      <CardHeader>
        <CardTitle className="text-lg leading-6">{artifact.title}</CardTitle>
        <CardDescription>
          {artifact.type} / {artifact.status} / {artifact.owner}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        <p className="text-sm leading-6 text-muted-foreground">{artifact.summary}</p>
        <div className="space-y-2">
          {artifact.preview.map((item) => (
            <div className="flex gap-2 text-sm text-muted-foreground" key={item}>
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
              {item}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" onClick={onToggleArtifactPin}>
            <Star className={cn(isPinned && "fill-warning text-warning")} />
            {isPinned ? "Unpin" : "Pin"}
          </Button>
          <Button type="button" variant="outline" onClick={onPreviewArtifact}>
            <Eye />
            Preview
          </Button>
          <Button type="button" variant="outline" onClick={onShare}>
            <Share2 />
            Share
          </Button>
          <Button asChild>
            <a href={artifact.href} download>
              <Download />
              Download
            </a>
          </Button>
        </div>
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

function AccessDialog({
  accessLevel,
  open,
  pending,
  onOpenChange,
  onSave,
}: {
  accessLevel: PmoWorkspaceState["accessLevel"];
  open: boolean;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (accessLevel: PmoWorkspaceState["accessLevel"]) => void;
}) {
  const [draft, setDraft] = useState(accessLevel);

  useEffect(() => {
    setDraft(accessLevel);
  }, [accessLevel, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Manage PMO workspace access</DialogTitle>
          <DialogDescription>Access changes are written through a TanStack Start server function.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {(["Read / Write", "View only"] as const).map((level) => (
            <button
              className={cn(
                "grid min-h-24 grid-cols-[28px_minmax(0,1fr)] gap-3 rounded-lg border bg-card p-3 text-left",
                draft === level && "border-primary bg-accent/35",
              )}
              key={level}
              type="button"
              onClick={() => setDraft(level)}
            >
              {level === "Read / Write" ? <ShieldCheck className="size-5 text-primary" /> : <Eye className="size-5 text-primary" />}
              <span>
                <strong className="block text-sm">{level}</strong>
                <em className="mt-1 block text-xs not-italic text-muted-foreground">
                  {level === "Read / Write"
                    ? "Team can chat, add ideas, and update statuses."
                    : "Team can view the prototype without editing state."}
                </em>
              </span>
            </button>
          ))}
        </div>
        <div className="rounded-lg border bg-muted/35 p-3">
          {["Alex Morgan", "Jordan Lee", "Taylor Kim", "Maya Chen"].map((name) => (
            <div className="flex items-center gap-2 py-1" key={name}>
              <span className="grid size-7 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                {initials(name)}
              </span>
              <span className="text-sm">{name}</span>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={pending} onClick={() => onSave(draft)}>
            Save access
          </Button>
        </DialogFooter>
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
  return (
    <Dialog open={Boolean(artifact)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        {artifact ? (
          <>
            <DialogHeader>
              <DialogTitle>{artifact.title}</DialogTitle>
              <DialogDescription>
                {artifact.type} / {artifact.status} / {artifact.owner}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 sm:grid-cols-[150px_minmax(0,1fr)]">
              <div className="grid min-h-44 place-items-center content-center gap-2 rounded-lg border bg-muted text-primary">
                {artifactIcon(artifact.type)}
                <strong>{artifact.type}</strong>
                <span className="text-xs text-muted-foreground">{artifact.status}</span>
              </div>
              <div className="space-y-3">
                <p className="text-sm leading-6 text-muted-foreground">{artifact.summary}</p>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  {artifact.preview.map((item) => (
                    <li className="flex gap-2" key={item}>
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <DialogFooter>
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
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <strong className="text-foreground">{value}</strong>
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
        <Icon className="size-4 text-primary" />
        <span className="block text-xs text-muted-foreground">{label}</span>
        <strong className="block text-xl">{value}</strong>
        <em className="block truncate text-xs not-italic text-muted-foreground">{detail}</em>
      </CardContent>
    </Card>
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
