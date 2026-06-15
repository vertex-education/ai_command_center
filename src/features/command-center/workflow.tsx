import { useMemo, useState, type ReactNode } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { CheckCircle2, Eye, UploadCloud, Plus, Search, Share2, Sparkles, Star, Trash2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArtifactUploader } from "@/components/ArtifactUploader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getTaskAsanaSyncControlState } from "@/lib/asana-task-sync-state";
import { cn } from "@/lib/utils";
import {
  type Approval,
  type Artifact,
  type Decision,
  type Idea,
  type IdeaStatus,
  type ProjectSummary,
  type Risk,
  type RiskSeverity,
  type Task,
  type WorkspaceMode,
  statusFilters,
  statusMeta,
  workspaceModeLabel,
} from "@/lib/pmo-data";
import { type WorkflowPreviewState } from "./shared";
import { SectionHeader } from "./layout";
import { DataTable, SeverityBadge, artifactIcon } from "./common";

export type WorkflowLineItem = {
  id: string;
  title: string;
  originalText?: string;
  meta: string;
  statusControl?: ReactNode;
  complete?: "success" | "destructive";
  pinned?: boolean;
};

export const approvalStatusOptions: Approval["status"][] = ["Not Reviewed", "Reviewing", "Approved", "Not Approved"];

export const decisionStatusOptions: Decision["status"][] = ["Not Completed", "Completed"];

export const ideaStatusOptions: IdeaStatus[] = ["Not Started", "Reviewing", "Convert to Project", "Dismiss"];

const riskSeverityOptions: Array<RiskSeverity | "All"> = ["All", "critical", "high", "medium", "low"];

const riskSeverityRank: Record<RiskSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export function WorkflowStatusSelect<TStatus extends string>({
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

export function WorkflowLineList({
  canEdit,
  emptyLabel,
  hideActions = false,
  items,
  onDelete,
  onPreview,
  onSelect,
  onTogglePin,
}: {
  canEdit: boolean;
  emptyLabel: string;
  hideActions?: boolean;
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
          {hideActions ? null : (
            <div
              className="flex shrink-0 items-center gap-2"
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
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
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => onDelete(item.id)}
                >
                  <Trash2 />
                  Delete
                </Button>
              ) : null}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function IdeasView({
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
    () =>
      ideas.map((idea) => ({
        id: idea.id,
        title: idea.title,
        originalText: idea.originalText,
        meta: `${idea.owner} / ${idea.category} / Impact ${idea.impact} / Effort ${idea.effort} / Confidence ${idea.confidence}${pinnedIdeaIds.includes(idea.id) ? " / Pinned" : ""}`,
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
        actions={
          canEdit ? (
            <Button type="button" onClick={onAddIdea} data-testid="open-add-idea">
              <Plus />
              Add idea
            </Button>
          ) : null
        }
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

export function ArtifactsView({
  activeMode,
  canEdit,
  artifacts,
  selectedArtifactTitle,
  onSelectArtifact,
  onShare,
}: {
  activeMode: WorkspaceMode;
  canEdit: boolean;
  artifacts: Artifact[];
  selectedArtifactTitle?: string;
  onSelectArtifact: (artifact: Artifact) => void;
  onShare: () => void;
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
    ],
    [],
  );

  return (
    <div className="space-y-4">
      <SectionHeader
        eyebrow="Artifacts"
        title={`Pin artifacts to ${workspaceModeLabel(activeMode)}`}
        actions={
          canEdit ? (
            <div className="flex shrink-0 items-center gap-2">
              <ArtifactUploader />
              <Button type="button" variant="outline" onClick={onShare}>
                <Share2 />
                Share
              </Button>
            </div>
          ) : null
        }
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

export function DecisionView({
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
    () =>
      decisions.map((decision) => ({
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
      <SectionHeader
        eyebrow="Workflow status"
        title="Open governance actions"
        description={`${decisions.filter((decision) => decision.status !== "Completed").length} decisions need PMO attention`}
      />
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

export function ApprovalView({
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
    () =>
      approvals.map((approval) => ({
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
      <SectionHeader
        eyebrow="Workflow status"
        title="Approval queue"
        description={`${approvals.filter((approval) => !["Approved", "Not Approved"].includes(approval.status)).length} approvals need attention`}
      />
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

export function TaskView({
  canEdit,
  syncingTaskId,
  tasks,
  onDelete,
  onPreview,
  onSelect,
  onSyncToAsana,
  onTogglePin,
}: {
  canEdit: boolean;
  syncingTaskId: string | null;
  tasks: Task[];
  onDelete: (id: string) => void;
  onPreview: (task: Task) => void;
  onSelect: (task: Task) => void;
  onSyncToAsana: (id: string) => void;
  onTogglePin: (id: string) => void;
}) {
  const tasksById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const items = useMemo<WorkflowLineItem[]>(
    () =>
      tasks.map((task) => {
        const syncControl = getTaskAsanaSyncControlState({
          asanaTaskGid: task.asanaTaskGid,
          asanaSyncError: task.asanaSyncError,
          asanaSyncQueuedAt: task.asanaSyncQueuedAt,
          canEdit,
          isSyncing: syncingTaskId === task.id || task.clientStatus === "pending",
        });
        const syncMeta = task.asanaTaskGid
          ? " / Synced to Asana"
          : task.asanaSyncQueuedAt && !task.asanaSyncError
            ? " / Queued for Asana"
            : task.asanaSyncError
              ? ` / Sync error: ${task.asanaSyncError}`
              : "";
        return {
          id: task.id,
          title: task.title,
          originalText: task.originalText,
          meta: `${task.owner} / ${task.source}${task.clientStatus === "pending" ? " / Pending" : ""}${syncMeta}`,
          pinned: task.pinned,
          statusControl:
            task.clientStatus === "pending" ? (
              <Badge variant="warning">Pending</Badge>
            ) : syncControl.visible ? (
              <Button type="button" variant="outline" size="sm" disabled={syncControl.disabled} onClick={() => onSyncToAsana(task.id)}>
                {task.asanaTaskGid ? <CheckCircle2 /> : <UploadCloud />}
                {syncControl.label}
              </Button>
            ) : null,
        };
      }),
    [canEdit, onSyncToAsana, syncingTaskId, tasks],
  );

  return (
    <div className="space-y-4">
      <SectionHeader
        eyebrow="Workflow status"
        title="Tasks surfaced from chats"
        description={`${tasks.length} follow-up${tasks.length === 1 ? "" : "s"}`}
      />
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

export function RiskView({
  canEdit,
  generatingRiskId,
  projects = [],
  risks,
  scopeLabel = "selected scope",
  searchTerm,
  selectedRiskId,
  onGenerateMitigation,
  onSearchTerm,
  onPreview,
  onSelect,
}: {
  canEdit: boolean;
  generatingRiskId?: string | null;
  projects?: ProjectSummary[];
  risks: Risk[];
  scopeLabel?: string;
  searchTerm: string;
  selectedRiskId?: string | null;
  onGenerateMitigation: (risk: Risk) => void;
  onSearchTerm: (value: string) => void;
  onPreview: (risk: Risk) => void;
  onSelect: (risk: Risk) => void;
}) {
  const [severityFilter, setSeverityFilter] = useState<RiskSeverity | "All">("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [projectFilter, setProjectFilter] = useState("All");
  const criticalCount = risks.filter((risk) => risk.severity === "critical").length;
  const mitigatedCount = risks.filter((risk) => risk.mitigationStrategy.trim()).length;
  const statuses = useMemo(() => Array.from(new Set(risks.map((risk) => risk.status))).sort((a, b) => a.localeCompare(b)), [risks]);
  const projectNameById = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects]);
  const projectOptions = useMemo(() => {
    const options = new Map<string, string>();
    for (const risk of risks) {
      const key = risk.projectId ?? "__workspace__";
      options.set(key, risk.projectId ? (projectNameById.get(risk.projectId) ?? risk.projectId) : "Workspace-level");
    }
    return Array.from(options, ([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [projectNameById, risks]);
  const projectCount = new Set(risks.map((risk) => risk.projectId).filter(Boolean)).size;
  const workspaceLevelCount = risks.filter((risk) => !risk.projectId).length;
  const filteredRisks = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    return risks
      .filter((risk) => {
        const severityMatches = severityFilter === "All" || risk.severity === severityFilter;
        const statusMatches = statusFilter === "All" || risk.status === statusFilter;
        const projectMatches =
          projectFilter === "All" || (projectFilter === "__workspace__" ? !risk.projectId : risk.projectId === projectFilter);
        const projectName = risk.projectId ? (projectNameById.get(risk.projectId) ?? risk.projectId) : "Workspace-level";
        const textMatches =
          !normalizedSearch ||
          [projectName, risk.title, risk.description, risk.severity, risk.status, risk.mitigationStrategy]
            .join(" ")
            .toLowerCase()
            .includes(normalizedSearch);
        return severityMatches && statusMatches && projectMatches && textMatches;
      })
      .sort(
        (a, b) =>
          riskSeverityRank[b.severity] - riskSeverityRank[a.severity] ||
          (projectNameById.get(a.projectId ?? "") ?? "").localeCompare(projectNameById.get(b.projectId ?? "") ?? "") ||
          a.title.localeCompare(b.title),
      );
  }, [projectFilter, projectNameById, risks, searchTerm, severityFilter, statusFilter]);
  const columns = useMemo<ColumnDef<Risk>[]>(
    () => [
      {
        accessorKey: "severity",
        header: "Severity",
        cell: ({ row }) => <SeverityBadge severity={row.original.severity} />,
        sortingFn: (a, b) => riskSeverityRank[a.original.severity] - riskSeverityRank[b.original.severity],
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <Badge variant="outline" className="capitalize">
            {row.original.status}
          </Badge>
        ),
      },
      {
        id: "project",
        accessorFn: (risk) => (risk.projectId ? (projectNameById.get(risk.projectId) ?? risk.projectId) : "Workspace-level"),
        header: "Project",
        cell: ({ row }) => (
          <Badge variant="secondary" className="max-w-48 truncate">
            {row.original.projectId ? (projectNameById.get(row.original.projectId) ?? row.original.projectId) : "Workspace-level"}
          </Badge>
        ),
      },
      {
        accessorKey: "title",
        header: "Risk",
        cell: ({ row }) => (
          <div className="max-w-[24rem]">
            <strong className="block leading-5">{row.original.title}</strong>
            <span className="mt-1 line-clamp-3 block text-xs leading-5 text-muted-foreground">{row.original.description}</span>
          </div>
        ),
      },
      {
        accessorKey: "mitigationStrategy",
        header: "Mitigation strategy",
        cell: ({ row }) => {
          const isGenerating = generatingRiskId === row.original.id;
          if (isGenerating) {
            return (
              <div className="space-y-2">
                <Badge variant="warning">Pending</Badge>
                <p className="text-sm text-muted-foreground">Generating mitigation strategy...</p>
              </div>
            );
          }
          if (!row.original.mitigationStrategy) return <span className="text-muted-foreground">No mitigation generated yet.</span>;
          return (
            <div className="prose prose-sm max-w-[38rem] text-foreground prose-headings:mb-2 prose-headings:mt-0 prose-p:my-1 prose-ul:my-1">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{row.original.mitigationStrategy}</ReactMarkdown>
            </div>
          );
        },
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex justify-end gap-2" onClick={(event) => event.stopPropagation()}>
            <Button type="button" size="sm" variant="outline" onClick={() => onPreview(row.original)}>
              <Eye />
              Preview
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="whitespace-nowrap"
              disabled={!canEdit || !row.original.projectId || Boolean(generatingRiskId)}
              title={row.original.projectId ? "Generate mitigation" : "Select a project-scoped risk to generate mitigation"}
              onClick={() => onGenerateMitigation(row.original)}
            >
              <Sparkles />
              {generatingRiskId === row.original.id ? "Generating" : "Generate"}
            </Button>
          </div>
        ),
      },
    ],
    [canEdit, generatingRiskId, onGenerateMitigation, onPreview, projectNameById],
  );
  const riskScopeDescription = `${risks.length} risks across ${projectCount} project${projectCount === 1 ? "" : "s"} in ${scopeLabel}${
    workspaceLevelCount ? `, plus ${workspaceLevelCount} workspace-level risk${workspaceLevelCount === 1 ? "" : "s"}` : ""
  }.`;

  return (
    <div className="space-y-4">
      <SectionHeader
        eyebrow="Risk status"
        title={`${filteredRisks.length} risks in view`}
        description={riskScopeDescription}
        actions={<RiskMetricSummary total={risks.length} critical={criticalCount} mitigated={mitigatedCount} />}
      />
      <div className="grid gap-2 xl:grid-cols-[280px_minmax(0,1fr)]">
        <label className="flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-muted-foreground">
          <Search className="size-4" />
          <Input
            className="h-7 border-0 px-0 shadow-none focus-visible:ring-0"
            placeholder="Search risks"
            value={searchTerm}
            onChange={(event) => onSearchTerm(event.target.value)}
          />
        </label>
        <div className="scrollbar-thin flex gap-2 overflow-x-auto">
          {riskSeverityOptions.map((severity) => (
            <Button
              key={severity}
              type="button"
              size="sm"
              variant={severity === severityFilter ? "default" : "outline"}
              onClick={() => setSeverityFilter(severity)}
            >
              {severity === "All" ? "All Severity" : titleCase(severity)}
            </Button>
          ))}
          <WorkflowStatusSelect
            label="Risk status filter"
            options={["All", ...statuses]}
            value={statusFilter}
            onChange={(status) => setStatusFilter(status)}
          />
          <select
            aria-label="Risk project filter"
            title="Risk project filter"
            className="h-8 rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            value={projectFilter}
            onChange={(event) => setProjectFilter(event.target.value)}
          >
            <option value="All">All Projects</option>
            {projectOptions.map((project) => (
              <option key={project.id} value={project.id}>
                {project.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {criticalCount > 0 ? (
        <div className="rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {criticalCount} critical risk{criticalCount === 1 ? "" : "s"} in this scope.
        </div>
      ) : null}
      <DataTable
        columns={columns}
        data={filteredRisks}
        getRowId={(risk) => risk.id}
        selectedId={selectedRiskId ?? undefined}
        onRowClick={onSelect}
      />
    </div>
  );
}

function RiskMetricSummary({ critical, mitigated, total }: { critical: number; mitigated: number; total: number }) {
  return (
    <div className="hidden items-center gap-2 text-xs text-muted-foreground md:flex">
      <span className="rounded-md border bg-background px-2 py-1">{total} total</span>
      <span className="rounded-md border bg-background px-2 py-1">{critical} critical</span>
      <span className="rounded-md border bg-background px-2 py-1">{mitigated} mitigated</span>
    </div>
  );
}

function titleCase(value: string) {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function workflowPreviewFromIdea(idea: Idea): NonNullable<WorkflowPreviewState> {
  return {
    kind: "Idea",
    title: idea.title,
    originalText: idea.originalText || idea.summary || idea.title,
    meta: `${idea.owner} / ${idea.category} / ${idea.status}`,
  };
}

export function workflowPreviewFromDecision(decision: Decision): NonNullable<WorkflowPreviewState> {
  return {
    kind: "Decision",
    title: decision.title,
    originalText: decision.originalText || decision.title,
    meta: `${decision.owner} / ${decision.status} / ${decision.due}`,
  };
}

export function workflowPreviewFromApproval(approval: Approval): NonNullable<WorkflowPreviewState> {
  return {
    kind: "Approval",
    title: approval.title,
    originalText: approval.originalText || approval.title,
    meta: `${approval.owner} / ${approval.status} / ${approval.due}`,
  };
}

export function workflowPreviewFromTask(task: Task): NonNullable<WorkflowPreviewState> {
  const syncMeta = task.asanaTaskGid ? " / Synced to Asana" : task.asanaSyncQueuedAt ? " / Queued for Asana" : "";
  return {
    kind: "Task",
    title: task.title,
    originalText: task.originalText || task.title,
    meta: `${task.owner} / ${task.source}${syncMeta}`,
  };
}

export function workflowPreviewFromRisk(risk: Risk): NonNullable<WorkflowPreviewState> {
  return {
    kind: "Risk",
    title: risk.title,
    originalText: risk.mitigationStrategy || risk.description,
    meta: `${risk.severity.toUpperCase()} / ${risk.status}${risk.mitigationStrategy ? " / Mitigation drafted" : ""}`,
  };
}

export function PromptView({
  canEdit,
  onUsePrompt,
  prompts,
}: {
  canEdit: boolean;
  onUsePrompt: (value: string) => void;
  prompts: string[];
}) {
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
