import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Bell,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Folder,
  FolderOpen,
  LogOut,
  Menu,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  Settings,
  Search,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import { AppRail } from "@/components/AppRail";
import { VertexAIBrand } from "@/components/VertexAIBrand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type WorkspacePresenceUser } from "@/lib/chat-sync";
import { isAutomatedBriefingsChat } from "@/lib/briefing-thread";
import { cn } from "@/lib/utils";
import {
  type Approval,
  type Artifact,
  type ChatSection,
  type ChatSummary,
  type Decision,
  type Idea,
  type ProjectSummary,
  type RailName,
  type ScopedWorkspaceState,
  type TabName,
  type Task,
  type WorkspaceMode,
  initials,
  tabs,
  workspaceModeLabel,
  workspaceModes,
} from "@/lib/pmo-data";
import { type TeamSummary } from "@/lib/team-workflow";
import { StatusBadge, artifactIcon } from "./common";

export function PrimaryRail({
  activeRail,
  canAdmin,
  userEmail,
  userName,
  onRailClick,
  onSignOut,
}: {
  activeRail: RailName;
  canAdmin: boolean;
  userEmail: string;
  userName: string;
  onRailClick: (rail: RailName) => void;
  onSignOut: () => void;
}) {
  return (
    <AppRail
      account={{
        canAdmin,
        userEmail,
        userName,
        onSignOut,
      }}
      activeItem={
        activeRail === "Workspaces" ||
        activeRail === "Chats" ||
        activeRail === "Ideas" ||
        activeRail === "Artifacts" ||
        activeRail === "Risks"
          ? activeRail
          : undefined
      }
      onRailClick={onRailClick}
    />
  );
}

export function Topbar({
  canAdmin,
  presenceUsers,
  searchTerm,
  userEmail,
  userName,
  onMobileMenu,
  onNotify,
  onSearchTerm,
  onSignOut,
}: {
  canAdmin: boolean;
  presenceUsers: WorkspacePresenceUser[];
  searchTerm: string;
  userEmail: string;
  userName: string;
  onMobileMenu: () => void;
  onNotify: () => void;
  onSearchTerm: (value: string) => void;
  onSignOut: () => void;
}) {
  return (
    <header className="grid min-h-16 shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b bg-card px-3 lg:min-h-19.5 lg:grid-cols-[minmax(200px,1fr)_minmax(340px,460px)_auto] lg:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <Button className="lg:hidden" type="button" variant="outline" size="icon" aria-label="Open menu" onClick={onMobileMenu}>
          <Menu />
        </Button>
        <VertexAIBrand className="hidden sm:flex" logoClassName="h-7 w-fit" aiClassName="text-xl" />
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
        <div className="lg:hidden">
          <AccountMenu align="topbar" canAdmin={canAdmin} userEmail={userEmail} userName={userName} onSignOut={onSignOut} />
        </div>
      </div>
    </header>
  );
}

export const presenceSwatches = [
  "border-primary/25 bg-primary text-primary-foreground",
  "border-success/25 bg-success text-success-foreground",
  "border-warning/25 bg-warning text-warning-foreground",
  "border-accent-foreground/15 bg-accent text-accent-foreground",
];

export function WorkspacePresence({ users }: { users: WorkspacePresenceUser[] }) {
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
    <div
      className="relative flex h-9 shrink-0 items-center gap-1.5"
      aria-label={`${users.length} active workspace user${users.length === 1 ? "" : "s"}`}
    >
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
            <div
              className="absolute right-0 top-[calc(100%+8px)] z-50 w-64 rounded-md border bg-popover p-2 text-popover-foreground shadow-lg"
              role="menu"
            >
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

export function WorkspacePresenceAvatar({ user, swatch }: { user: WorkspacePresenceUser; swatch: string }) {
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

export function AccountMenu({
  align,
  canAdmin,
  userEmail,
  userName,
  onSignOut,
}: {
  align: "rail" | "topbar";
  canAdmin: boolean;
  userEmail: string;
  userName: string;
  onSignOut: () => void;
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
            User Settings
          </button>
          {canAdmin ? (
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent"
              role="menuitem"
              onClick={() => runMenuAction(() => (window.location.href = "/admin/users"))}
            >
              <ShieldCheck className="size-4" />
              Admin Settings
            </button>
          ) : null}
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

export function Contextbar({
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
          <div className="min-w-0 truncate text-xs font-medium text-muted-foreground">Location / {breadcrumbLabel}</div>
        </div>
        {activeMode === "Team" ? (
          <div className="flex min-w-0 flex-wrap items-center gap-2 md:justify-end">
            <Label className="text-xs font-semibold uppercase text-muted-foreground" htmlFor="team-select">
              Team
            </Label>
            <select
              id="team-select"
              aria-label="Select Team"
              title="Select Team"
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
                  New Team
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!selectedTeam}
                  onClick={() => selectedTeam && onInviteTeam(selectedTeam)}
                >
                  <Users />
                  Invite User
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function ProjectNav({
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
  onEditProjectInstructions,
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
  onEditProjectInstructions: (project: ProjectSummary) => void;
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
                  <button
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                    type="button"
                    onClick={() => onAddProjectChat(project)}
                  >
                    <MessageCircle className="size-4" />
                    New Chat
                  </button>
                  <button
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                    type="button"
                    onClick={() => onEditProjectInstructions(project)}
                  >
                    <Settings className="size-4" />
                    Project Instructions
                  </button>
                  {showProjectInvite ? (
                    <button
                      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                      type="button"
                      onClick={() => onInviteProject(project)}
                    >
                      <Users className="size-4" />
                      Invite User
                    </button>
                  ) : null}
                  <button
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10"
                    type="button"
                    onClick={() => onDeleteProject(project)}
                  >
                    <Trash2 className="size-4" />
                    Delete Project
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
                  <span className="min-w-0 flex-1 truncate" title={chat.title}>
                    {chat.title}
                  </span>
                </button>
                {canEdit && !isAutomatedBriefingsChat(chat) ? (
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
                        Rename Chat
                      </button>
                      <button
                        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10"
                        type="button"
                        onClick={() => onDeleteChat({ chat, project, section: "project" })}
                      >
                        <Trash2 className="size-4" />
                        Delete Chat
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
        <div className="rounded-md border border-dashed bg-card px-3 py-4 text-sm text-muted-foreground">No assigned projects yet.</div>
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
              <span className="min-w-0 flex-1 truncate" title={chat.title}>
                {chat.title}
              </span>
            </button>
            {canEdit && !isAutomatedBriefingsChat(chat) ? (
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
                    Rename Chat
                  </button>
                  <button
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10"
                    type="button"
                    onClick={() => onDeleteChat({ chat, section: "workspace" })}
                  >
                    <Trash2 className="size-4" />
                    Delete Chat
                  </button>
                </div>
              </details>
            ) : null}
          </div>
        ))}
        {workspace.workspaceChats.length === 0 ? (
          <div className="rounded-md border border-dashed bg-card px-3 py-3 text-sm text-muted-foreground">No workspace chats yet.</div>
        ) : null}
      </div>
    </aside>
  );
}

export function PinnedStrip({
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
      <SectionHeader eyebrow="Pinned Items" description="Quick access for the current view." size="sm" />
      <div className="flex items-stretch gap-2">
        {hasPinnedItems && scrollControls.canScrollLeft ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-auto min-h-20 shrink-0 self-stretch"
            aria-label="Previous pinned items"
            title="Previous pinned items"
            onClick={() => scrollPinnedItems(-1)}
          >
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
                <em className="mt-0.5 block text-xs not-italic text-muted-foreground">
                  Task / {task.clientStatus === "pending" ? "Pending" : task.asanaTaskGid ? "Synced" : "Not synced"}
                </em>
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

export function ScopeTabs({ activeTab, onTabChange }: { activeTab: TabName; onTabChange: (tab: TabName) => void }) {
  return (
    <section className="shrink-0 border-b bg-background px-4">
      <SectionHeader eyebrow="Your Workspace" description="Work across chats, ideas, artifacts, and actions in the selected scope." />
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

export function SectionHeader({
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
        {description ? (
          <p className={cn("mt-1 truncate text-muted-foreground", size === "sm" ? "text-xs" : "text-sm")}>{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
