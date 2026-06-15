import { type ComponentType, type ReactNode } from "react";
import {
  Bell,
  Bug,
  CheckCircle2,
  ClipboardList,
  Download,
  Eye,
  PanelRightClose,
  RotateCcw,
  Share2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
} from "lucide-react";
import { ArtifactRenderer } from "@/components/ArtifactRenderer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  type Approval,
  type Artifact,
  type ChatMessage,
  type ChatSummary,
  type Decision,
  type Idea,
  type IdeaStatus,
  type Risk,
  type TabName,
  type Task,
  type WorkspaceMode,
  initials,
  statusMeta,
} from "@/lib/pmo-data";
import { type DetailMetric, type WorkflowPreviewState } from "./shared";
import {
  workflowPreviewFromApproval,
  workflowPreviewFromDecision,
  workflowPreviewFromIdea,
  workflowPreviewFromRisk,
  workflowPreviewFromTask,
} from "./workflow";
import { MetricCard, ProgressMetric, StatusBadge } from "./common";

export function DetailPanel({
  activeMode,
  activeTab,
  activeChat,
  approval,
  artifact,
  canEdit,
  decision,
  idea,
  isPinned,
  isRefreshingIdeaAssessment,
  messages,
  metrics,
  prompts,
  risk,
  scopeContextLabel,
  task,
  workspaceTitle,
  onClose,
  onPatchArtifact,
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
  onManageRisks,
  onUsePrompt,
  onRefreshIdeaAssessment,
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
  isRefreshingIdeaAssessment: boolean;
  messages: ChatMessage[];
  metrics: DetailMetric[];
  prompts: string[];
  risk?: Risk;
  scopeContextLabel: string;
  task?: Task;
  workspaceTitle: string;
  onClose: () => void;
  onPatchArtifact: (artifact: Artifact) => void;
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
  onManageRisks: () => void;
  onUsePrompt: (prompt: string) => void;
  onRefreshIdeaAssessment: () => void;
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
          isRefreshingAssessment={isRefreshingIdeaAssessment}
          onShare={onShare}
          onStatusChange={onStatusChange}
          onToggleIdeaPin={onToggleIdeaPin}
          onRefreshAssessment={onRefreshIdeaAssessment}
        />
      ) : null}

      {activeTab === "Artifacts" && artifact ? (
        <ArtifactDetail
          activeMode={activeMode}
          artifact={artifact}
          canEdit={canEdit}
          onPatchArtifact={onPatchArtifact}
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
          detail={`${task.owner} / ${task.source}${task.clientStatus === "pending" ? " / Pending" : ""}${task.asanaTaskGid ? " / Synced to Asana" : ""}`}
          originalText={task.originalText}
          isPinned={Boolean(task.pinned)}
          canEdit={canEdit}
          onDelete={() => onDeleteTask(task.id)}
          onPreview={() => onPreviewWorkflow(workflowPreviewFromTask(task))}
          onTogglePin={() => onToggleWorkflowPin("task", task.id)}
        />
      ) : null}
      {activeTab === "Risks" && risk ? (
        <WorkflowMetadata
          icon={ShieldAlert}
          label="Risk"
          title={risk.title}
          detail={`${risk.severity.toUpperCase()} / ${risk.status}${risk.mitigationStrategy ? " / Mitigation drafted" : ""}`}
          originalText={risk.mitigationStrategy || risk.description}
          isPinned={false}
          canEdit={canEdit}
          onDelete={undefined}
          onPreview={() => onPreviewWorkflow(workflowPreviewFromRisk(risk))}
          onTogglePin={undefined}
          action={
            <Button type="button" variant="outline" size="sm" onClick={onManageRisks}>
              <ShieldAlert />
              Risk Grid
            </Button>
          }
        />
      ) : null}
      {activeTab === "Prompts" ? (
        <PromptMetadata canEdit={canEdit} prompts={prompts} scopeContextLabel={scopeContextLabel} onUsePrompt={onUsePrompt} />
      ) : null}
    </aside>
  );
}

export function ChatMetadata({
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
        <CardTitle className="text-lg leading-6">{activeChat?.title ?? "No Chat Selected"}</CardTitle>
        <CardDescription>
          {workspaceTitle} / {scopeContextLabel}
        </CardDescription>
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

export function WorkflowMetadata({
  action,
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
  action?: ReactNode;
  canEdit: boolean;
  detail: string;
  icon: ComponentType<{ className?: string }>;
  isPinned: boolean;
  label: string;
  onDelete?: () => void;
  onPreview: () => void;
  onTogglePin?: () => void;
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
        {originalText ? <p className="rounded-md bg-muted/45 p-3 text-sm leading-6">{originalText}</p> : null}
        <Button type="button" variant="outline" onClick={onPreview}>
          <Eye />
          Preview
        </Button>
        {action}
        {canEdit ? (
          <>
            {onTogglePin ? (
              <Button type="button" variant="outline" className="ml-2" onClick={onTogglePin}>
                <Star className={cn(isPinned && "fill-warning text-warning")} />
                {isPinned ? "Unpin" : "Pin"}
              </Button>
            ) : null}
            {onDelete ? (
              <Button type="button" variant="outline" className="ml-2 text-destructive hover:text-destructive" onClick={onDelete}>
                <Trash2 />
                Delete
              </Button>
            ) : null}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function PromptMetadata({
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

export function ideaScoreReason(idea: Idea, label: "Impact" | "Effort" | "Confidence") {
  const llmEntry = idea.metrics.find((metric) => metric.toLowerCase().startsWith(`${label.toLowerCase()} llm:`));
  if (llmEntry) return llmEntry.replace(/^[^:]+:\s*/, "").trim();
  const fallbackEntry = idea.metrics.find((metric) => metric.toLowerCase().startsWith(`${label.toLowerCase()} fallback:`));
  if (fallbackEntry) return fallbackEntry.replace(/^[^:]+:\s*/, "").trim();
  return "Fallback/stale score. Refresh to ask Gemma 4 for a dynamic rationale.";
}

export function parseIdeaConsideration(value: string) {
  const match = value.match(/^(pro|gap|con)\s*:\s*(.+)$/i);
  const kind = (match?.[1]?.toLowerCase() ?? "gap") as "pro" | "gap" | "con";
  return {
    kind,
    text: match?.[2]?.trim() || value.replace(/^Consideration:\s*/i, "").trim(),
  };
}

export function IdeaConsideration({ value }: { value: string }) {
  const consideration = parseIdeaConsideration(value);
  const Icon = consideration.kind === "pro" ? CheckCircle2 : consideration.kind === "con" ? Bug : Bell;
  const classes =
    consideration.kind === "pro"
      ? "border-success/25 bg-success/10 text-success"
      : consideration.kind === "con"
        ? "border-destructive/25 bg-destructive/10 text-destructive"
        : "border-warning/30 bg-warning/10 text-warning";
  const label = consideration.kind === "pro" ? "Pro" : consideration.kind === "con" ? "Con" : "Gap";
  return (
    <div className={cn("flex gap-2 rounded-md border p-3 text-sm", classes)}>
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div>
        <strong className="block text-xs uppercase">{label}</strong>
        <span>{consideration.text}</span>
      </div>
    </div>
  );
}

export function IdeaDetail({
  canEdit,
  idea,
  isPinned,
  isRefreshingAssessment,
  onDelete,
  onPreview,
  onRefreshAssessment,
  onShare,
  onStatusChange,
  onToggleIdeaPin,
}: {
  canEdit: boolean;
  idea: Idea;
  isPinned: boolean;
  isRefreshingAssessment: boolean;
  onDelete: () => void;
  onPreview: () => void;
  onRefreshAssessment: () => void;
  onShare: () => void;
  onStatusChange: (status: IdeaStatus) => void;
  onToggleIdeaPin: () => void;
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
          <span
            className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground"
            aria-label={idea.owner}
          >
            {initials(idea.owner)}
          </span>
          <div>
            <strong className="block text-sm">{idea.owner}</strong>
            <span className="text-xs text-muted-foreground">Owner / {idea.created}</span>
          </div>
        </div>
        <div className="space-y-3">
          <div className="text-xs font-semibold uppercase text-muted-foreground">AI analysis</div>
          <ProgressMetric label="Impact" value={idea.impact} tooltip={ideaScoreReason(idea, "Impact")} />
          <ProgressMetric label="Effort" value={idea.effort} tooltip={ideaScoreReason(idea, "Effort")} />
          <ProgressMetric label="Confidence" value={idea.confidence} tooltip={ideaScoreReason(idea, "Confidence")} />
        </div>
        <IdeaConsideration value={idea.nextStep} />
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
            <Button type="button" variant="outline" disabled={isRefreshingAssessment} onClick={onRefreshAssessment}>
              <RotateCcw className={cn(isRefreshingAssessment && "animate-spin")} />
              {isRefreshingAssessment ? "Refreshing" : "Refresh"}
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

export function ArtifactDetail({
  activeMode,
  artifact,
  canEdit,
  onPatchArtifact,
  onPreviewArtifact,
  onRestoreArtifactVersion,
  onShare,
  onToggleArtifactPin,
}: {
  activeMode: WorkspaceMode;
  artifact: Artifact;
  canEdit: boolean;
  onPatchArtifact: (artifact: Artifact) => void;
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
          <ArtifactRenderer fileType={artifact.type} previewJson={artifact.previewJson} fallbackPreview={artifact.preview} />
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
          {canEdit ? (
            <Button type="button" variant="outline" onClick={() => onPatchArtifact(artifact)}>
              <Sparkles />
              AI diff
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
                        <strong className="block text-sm">
                          Version {version.version}
                          {isLatest ? " current" : ""}
                        </strong>
                        <span className="block text-xs text-muted-foreground">
                          {version.date} / {version.commitMessage}
                        </span>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          title="Preview this version read-only"
                          onClick={() => onPreviewArtifact(version)}
                        >
                          <Eye />
                          Preview
                        </Button>
                        {canEdit && !isLatest ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            title="Restore by creating a new latest version"
                            onClick={() => onRestoreArtifactVersion(version.id)}
                          >
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
