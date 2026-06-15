import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { ArrowLeft, CheckCircle2, ChevronDown, ChevronUp, ExternalLink, Plug, RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";
import { AuthenticatedAppRail } from "@/components/AuthenticatedAppRail";
import { VertexAIBrand } from "@/components/VertexAIBrand";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getSession } from "@/lib/auth-workflow";
import {
  disconnectAsanaConnection,
  getAsanaConnectionSummary,
  saveAsanaProjectMappings,
  startAsanaConnection,
  updateAsanaTaskSyncSettings,
  type AsanaConnectionSummary,
  type AsanaMappingSelection,
  type AsanaProjectOption,
  type AsanaProjectWebhookStatusView,
  type VertexProjectOption,
} from "@/lib/asana-integration";
import type { WorkspaceMode } from "@/lib/pmo-data";

type DraftSelection = {
  action: "ignore" | "map" | "scaffold";
  vertexProjectId: string;
};

type ScaffoldDialogState = {
  projectGid: string;
  projectName: string;
} | null;

const expandableListPageSize = 5;

export const Route = createFileRoute("/profile/asana")({
  loader: async () => {
    const session = await getSession();
    if (!session) throw redirect({ to: "/sign-in" });
    return { session };
  },
  head: () => ({
    meta: [{ title: "Asana Integration | VertexAI" }],
  }),
  component: AsanaIntegrationPage,
});

function AsanaIntegrationPage() {
  const { session } = Route.useLoaderData();
  const summaryQuery = useQuery({
    queryKey: ["asana", "connection-summary"],
    queryFn: () => getAsanaConnectionSummary(),
    retry: false,
  });
  const [targetMode, setTargetMode] = useState<WorkspaceMode>("Team");
  const [targetTeamId, setTargetTeamId] = useState("");
  const [scaffoldDialog, setScaffoldDialog] = useState<ScaffoldDialogState>(null);
  const [savingProjectGid, setSavingProjectGid] = useState<string | null>(null);
  const [draftSelections, setDraftSelections] = useState<Record<string, DraftSelection>>({});

  const summary = summaryQuery.data;
  const mappingByAsanaProject = useMemo(
    () => new Map((summary?.mappings ?? []).map((mapping) => [mapping.asanaProjectGid, mapping])),
    [summary?.mappings],
  );
  const vertexProjectById = useMemo(
    () => new Map((summary?.vertexProjects ?? []).map((project) => [project.id, project])),
    [summary?.vertexProjects],
  );

  useEffect(() => {
    if (!summary) return;
    setDraftSelections((current) => {
      const next = { ...current };
      for (const project of summary.asanaProjects) {
        if (next[project.gid]) continue;
        const existing = mappingByAsanaProject.get(project.gid);
        next[project.gid] = existing
          ? { action: "map", vertexProjectId: existing.vertexProjectId }
          : { action: "ignore", vertexProjectId: "" };
      }
      return next;
    });
  }, [mappingByAsanaProject, summary]);

  useEffect(() => {
    if (summary?.teams[0] && !targetTeamId) setTargetTeamId(summary.teams[0].id);
  }, [summary?.teams, targetTeamId]);

  const connectMutation = useMutation({
    mutationFn: () => startAsanaConnection(),
    onSuccess: (result) => {
      window.location.href = result.url;
    },
  });
  const disconnectMutation = useMutation({
    mutationFn: () => disconnectAsanaConnection(),
    onSuccess: () => {
      setDraftSelections({});
      void summaryQuery.refetch();
    },
  });
  const saveMutation = useMutation({
    mutationFn: (selections: AsanaMappingSelection[]) => saveAsanaProjectMappings({ data: { selections } }),
    onSuccess: () => {
      setScaffoldDialog(null);
      void summaryQuery.refetch();
    },
    onSettled: () => {
      setSavingProjectGid(null);
    },
  });
  const taskSyncSettingsMutation = useMutation({
    mutationFn: (autoSyncTasksEnabled: boolean) => updateAsanaTaskSyncSettings({ data: { autoSyncTasksEnabled } }),
    onSuccess: () => {
      void summaryQuery.refetch();
    },
  });

  const canConfirmScaffold = targetMode !== "Team" || Boolean(targetTeamId);

  function updateSelection(projectGid: string, selection: Partial<DraftSelection>) {
    setDraftSelections((current) => ({
      ...current,
      [projectGid]: {
        ...(current[projectGid] ?? { action: "ignore", vertexProjectId: "" }),
        ...selection,
      },
    }));
  }

  function saveSelection(selection: AsanaMappingSelection) {
    setSavingProjectGid(selection.asanaProjectGid);
    saveMutation.mutate([selection]);
  }

  function handleActionChange(project: AsanaProjectOption, action: DraftSelection["action"]) {
    const existingVertexProjectId = draftSelections[project.gid]?.vertexProjectId ?? "";
    updateSelection(project.gid, { action, vertexProjectId: action === "map" ? existingVertexProjectId : "" });
    if (action === "scaffold") setScaffoldDialog({ projectGid: project.gid, projectName: project.name });
    if (action === "map" && existingVertexProjectId) {
      saveSelection({
        asanaProjectGid: project.gid,
        action: "map",
        vertexProjectId: existingVertexProjectId,
      });
    }
  }

  function handleMapProject(projectGid: string, vertexProjectId: string) {
    updateSelection(projectGid, { action: "map", vertexProjectId });
    if (!vertexProjectId) return;
    saveSelection({
      asanaProjectGid: projectGid,
      action: "map",
      vertexProjectId,
    });
  }

  function confirmScaffoldTarget() {
    if (!canConfirmScaffold || !scaffoldDialog) return;
    saveSelection({
      asanaProjectGid: scaffoldDialog.projectGid,
      action: "scaffold",
      vertexProjectId: null,
      targetMode,
      targetTeamId: targetMode === "Team" ? targetTeamId : null,
    });
  }

  return (
    <main className="h-svh overflow-hidden bg-[linear-gradient(135deg,oklch(0.985_0.006_247),oklch(0.955_0.015_240))] p-0 text-foreground lg:p-5">
      <div className="workspace-shadow grid h-full overflow-hidden border bg-card lg:grid-cols-[72px_minmax(0,1fr)] lg:rounded-xl">
        <AuthenticatedAppRail session={session} />
        <section className="scrollbar-thin min-h-0 overflow-auto bg-muted/30 p-4 lg:p-6">
          <div className="mx-auto grid w-full max-w-6xl gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Button type="button" variant="outline" onClick={() => (window.location.href = "/profile")}>
                <ArrowLeft className="size-4" />
                Profile
              </Button>
              <VertexAIBrand />
            </div>

            <Card>
              <CardHeader className="gap-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Plug className="size-5" />
                      Asana Integration
                    </CardTitle>
                    <CardDescription>
                      Connect Asana, choose project mappings, and capture task-write permissions before any task can be sent back.
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" variant="outline" disabled={summaryQuery.isFetching} onClick={() => void summaryQuery.refetch()}>
                      <RefreshCw className={`size-4 ${summaryQuery.isFetching ? "animate-spin" : ""}`} />
                      Refresh
                    </Button>
                    {summary?.connected ? (
                      <Button
                        type="button"
                        variant="outline"
                        disabled={disconnectMutation.isPending}
                        onClick={() => disconnectMutation.mutate()}
                      >
                        Disconnect
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        disabled={connectMutation.isPending || summary?.configured === false}
                        onClick={() => connectMutation.mutate()}
                      >
                        <ExternalLink className="size-4" />
                        Connect Asana
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4">
                {summaryQuery.isLoading ? (
                  <div className="rounded-md border bg-background p-4 text-sm text-muted-foreground">Loading Asana connection...</div>
                ) : summaryQuery.isError || !summary ? (
                  <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
                    Could not load the Asana Integration.
                  </div>
                ) : (
                  <>
                    <ConnectionState summary={summary} />
                    {summary.connected ? (
                      <>
                        <ScopeState requiredScopes={summary.requiredScopes} missingScopes={summary.missingScopes} />
                        <TaskSyncSettings
                          autoSyncTasksEnabled={summary.connection?.autoSyncTasksEnabled ?? false}
                          disabled={taskSyncSettingsMutation.isPending}
                          error={taskSyncSettingsMutation.error}
                          onChange={(checked) => taskSyncSettingsMutation.mutate(checked)}
                        />
                        {summary.projectDiscoveryIssue ? (
                          <div className="rounded-md border border-warning/30 bg-warning/10 p-4 text-sm text-warning-foreground">
                            <p className="font-medium">Asana Project Permission Check Is Blocked</p>
                            <p className="mt-1">{summary.projectDiscoveryIssue}</p>
                            <p className="mt-1 text-muted-foreground">
                              If this is a rate limit, wait a few minutes and refresh. If this is a permission error, confirm Full
                              permissions are enabled in the Asana developer app and reconnect Asana.
                            </p>
                          </div>
                        ) : null}
                        <WebhookStatusPanel webhookStatuses={summary.webhookStatuses} />
                        <ProjectMappingTable
                          asanaProjects={summary.asanaProjects}
                          draftSelections={draftSelections}
                          onActionChange={handleActionChange}
                          onMapProject={handleMapProject}
                          vertexProjects={summary.vertexProjects}
                          vertexProjectById={vertexProjectById}
                          savingProjectGid={savingProjectGid}
                        />
                        <div className="rounded-md border bg-background p-3 text-sm text-muted-foreground">
                          Mapping changes save one Asana project at a time.
                        </div>
                      </>
                    ) : (
                      <div className="rounded-md border bg-background p-4 text-sm text-muted-foreground">
                        Connect Asana to load only the projects available to your Asana account.
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
            <ScaffoldTargetDialog
              projectName={scaffoldDialog?.projectName ?? ""}
              isPending={saveMutation.isPending}
              onConfirm={confirmScaffoldTarget}
              onOpenChange={(open) => {
                if (!open) setScaffoldDialog(null);
              }}
              onTargetModeChange={setTargetMode}
              onTargetTeamIdChange={setTargetTeamId}
              open={Boolean(scaffoldDialog)}
              targetMode={targetMode}
              targetTeamId={targetTeamId}
              teams={summary?.teams ?? []}
            />
          </div>
        </section>
      </div>
    </main>
  );
}

function ConnectionState({ summary }: { summary: AsanaConnectionSummary }) {
  if (!summary.configured) {
    return (
      <div className="flex items-start gap-3 rounded-md border bg-background p-4 text-sm text-muted-foreground">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" />
        <div>
          <p className="font-medium text-foreground">Asana app setup required</p>
          <p>
            Connect is disabled until ASANA_CLIENT_ID, ASANA_CLIENT_SECRET, and TOKEN_VAULT_KEY are available in the Worker environment.
          </p>
        </div>
      </div>
    );
  }

  if (!summary.connected || !summary.connection) {
    return (
      <div className="flex items-start gap-3 rounded-md border bg-background p-4 text-sm text-muted-foreground">
        <Plug className="mt-0.5 size-4 shrink-0" />
        <div>
          <p className="font-medium text-foreground">No Asana Account Connected</p>
          <p>Start OAuth to read your Asana projects and capture permissions.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-3 rounded-md border bg-background p-4 md:grid-cols-[minmax(0,1fr)_auto]">
      <div>
        <p className="font-medium">{summary.connection.asanaUserName}</p>
        <p className="text-sm text-muted-foreground">{summary.connection.asanaUserEmail ?? summary.connection.asanaUserGid}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 md:justify-end">
        <Badge variant="default">
          <CheckCircle2 className="mr-1 size-3" />
          Connected
        </Badge>
        <Badge variant="secondary">{summary.asanaProjects.length} member projects</Badge>
        <Badge variant="secondary">{summary.mappings.length} mapped</Badge>
        <Badge
          variant={
            summary.webhookStatuses.some((webhook) => webhook.status === "failed" || webhook.status === "missing") ? "warning" : "secondary"
          }
        >
          {summary.webhookStatuses.filter((webhook) => webhook.status === "active").length} active webhooks
        </Badge>
      </div>
    </div>
  );
}

function ScopeState({ missingScopes, requiredScopes }: { requiredScopes: string[]; missingScopes: string[] }) {
  return (
    <div className="grid gap-3 rounded-md border bg-background p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">Asana Scopes</p>
          <p className="text-sm text-muted-foreground">
            Task submission requires both task-write scope and project-level write permission.
          </p>
        </div>
        <Badge variant={missingScopes.length ? "secondary" : "default"}>
          {missingScopes.length ? `${missingScopes.length} missing` : "Scopes ready"}
        </Badge>
      </div>
      <div className="flex flex-wrap gap-2">
        {requiredScopes.map((scope) => {
          const missing = missingScopes.includes(scope);
          return (
            <Badge key={scope} variant={missing ? "secondary" : "default"}>
              {scope}
            </Badge>
          );
        })}
      </div>
    </div>
  );
}

function TaskSyncSettings({
  autoSyncTasksEnabled,
  disabled,
  error,
  onChange,
}: {
  autoSyncTasksEnabled: boolean;
  disabled: boolean;
  error: unknown;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="grid gap-3 rounded-md border bg-background p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium">Task Sync</p>
          <p className="text-sm text-muted-foreground">By default, tasks stay local until you click Sync to Asana.</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={autoSyncTasksEnabled}
            disabled={disabled}
            onChange={(event) => onChange(event.currentTarget.checked)}
          />
          Auto-Sync New Tasks
        </label>
      </div>
      <p className="text-sm text-muted-foreground">
        When enabled, new VertexAI tasks are pushed to Asana during creation and display as synced immediately.
      </p>
      {error ? <p className="text-sm text-destructive">{errorMessage(error)}</p> : null}
    </div>
  );
}

function WebhookStatusPanel({ webhookStatuses }: { webhookStatuses: AsanaProjectWebhookStatusView[] }) {
  const activeCount = webhookStatuses.filter((webhook) => webhook.status === "active").length;
  const needsAttentionCount = webhookStatuses.filter((webhook) => webhook.status === "failed" || webhook.status === "missing").length;
  const [visibleCount, setVisibleCount] = useState(expandableListPageSize);
  const visibleWebhookStatuses = webhookStatuses.slice(0, visibleCount);
  const hasMoreWebhookStatuses = visibleCount < webhookStatuses.length;
  const canShowFewerWebhookStatuses = visibleCount > expandableListPageSize;

  return (
    <div className="grid gap-3 rounded-md border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium">Webhook Status</p>
          <p className="text-sm text-muted-foreground">Mapped Asana projects should each have one active project webhook.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant={activeCount ? "success" : "secondary"}>{activeCount} active</Badge>
          <Badge variant={needsAttentionCount ? "warning" : "secondary"}>{needsAttentionCount} need attention</Badge>
        </div>
      </div>

      {webhookStatuses.length ? (
        <div className="overflow-hidden rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Webhook</TableHead>
                <TableHead>Last Checked</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleWebhookStatuses.map((webhook) => (
                <TableRow key={webhook.asanaProjectGid}>
                  <TableCell>
                    <div className="grid gap-1">
                      <span className="font-medium">{webhook.asanaProjectName}</span>
                      <span className="text-xs text-muted-foreground">
                        {webhook.asanaWorkspaceName} / {webhook.vertexProjectName ?? "Mapped Project"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={webhookStatusVariant(webhook.status)}>{webhookStatusLabel(webhook.status)}</Badge>
                    {webhook.lastError ? <p className="mt-2 max-w-80 text-xs text-destructive">{webhook.lastError}</p> : null}
                  </TableCell>
                  <TableCell>
                    {webhook.webhookGid ? (
                      <p className="font-mono text-xs">{webhook.webhookGid}</p>
                    ) : (
                      <span className="text-sm text-muted-foreground">No webhook gid recorded</span>
                    )}
                    {webhook.targetUrl ? (
                      <p className="mt-1 max-w-96 break-all font-mono text-xs text-muted-foreground">{webhook.targetUrl}</p>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatWebhookTimestamp(webhook.updatedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {webhookStatuses.length > expandableListPageSize ? (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              <span>
                Showing {visibleWebhookStatuses.length} of {webhookStatuses.length}
              </span>
              <div className="flex items-center gap-2">
                {canShowFewerWebhookStatuses ? (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setVisibleCount(expandableListPageSize)}>
                    <ChevronUp className="size-4" />
                    Show Fewer
                  </Button>
                ) : null}
                {hasMoreWebhookStatuses ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setVisibleCount((count) => Math.min(count + expandableListPageSize, webhookStatuses.length))}
                  >
                    <ChevronDown className="size-4" />
                    Show {Math.min(expandableListPageSize, webhookStatuses.length - visibleWebhookStatuses.length)} more
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="rounded-md border bg-muted/40 p-4 text-sm text-muted-foreground">
          No mapped projects yet. Webhooks are created after an Asana project is mapped or scaffolded.
        </div>
      )}
    </div>
  );
}

function ScaffoldTargetDialog({
  isPending,
  onConfirm,
  onOpenChange,
  onTargetModeChange,
  onTargetTeamIdChange,
  open,
  projectName,
  targetMode,
  targetTeamId,
  teams,
}: {
  isPending: boolean;
  open: boolean;
  projectName: string;
  targetMode: WorkspaceMode;
  targetTeamId: string;
  teams: Array<{ id: string; name: string }>;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  onTargetModeChange: (mode: WorkspaceMode) => void;
  onTargetTeamIdChange: (teamId: string) => void;
}) {
  const requiresTeam = targetMode === "Team";
  const canConfirm = !isPending && (!requiresTeam || Boolean(targetTeamId));

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !isPending && onOpenChange(nextOpen)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Place Scaffolded Projects</DialogTitle>
          <DialogDescription>Choose where to create {projectName || "this Asana project"} in VertexAI.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <label className="grid gap-1 text-sm">
            <span className="text-xs font-medium text-muted-foreground">Workspace</span>
            <select
              className="h-9 rounded-md border bg-background px-3"
              value={targetMode}
              onChange={(event) => onTargetModeChange(event.target.value as WorkspaceMode)}
            >
              <option value="Personal">Personal</option>
              <option value="Team">Team</option>
              <option value="Org">Org</option>
            </select>
          </label>

          {requiresTeam ? (
            <label className="grid gap-1 text-sm">
              <span className="text-xs font-medium text-muted-foreground">Team</span>
              <select
                className="h-9 rounded-md border bg-background px-3"
                value={targetTeamId}
                onChange={(event) => onTargetTeamIdChange(event.target.value)}
              >
                <option value="">Select Team</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={isPending} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={!canConfirm} onClick={onConfirm}>
            {isPending ? "Saving..." : "Create Projects"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function webhookStatusVariant(status: AsanaProjectWebhookStatusView["status"]) {
  if (status === "active") return "success";
  if (status === "failed") return "destructive";
  if (status === "missing") return "warning";
  return "secondary";
}

function webhookStatusLabel(status: AsanaProjectWebhookStatusView["status"]) {
  if (status === "active") return "Active";
  if (status === "creating") return "Creating";
  if (status === "failed") return "Failed";
  if (status === "deleted") return "Deleted";
  return "Missing";
}

function formatWebhookTimestamp(value: number | null) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

function ProjectMappingTable({
  asanaProjects,
  draftSelections,
  onActionChange,
  onMapProject,
  savingProjectGid,
  vertexProjectById,
  vertexProjects,
}: {
  asanaProjects: AsanaProjectOption[];
  draftSelections: Record<string, DraftSelection>;
  vertexProjects: VertexProjectOption[];
  vertexProjectById: Map<string, VertexProjectOption>;
  savingProjectGid: string | null;
  onActionChange: (project: AsanaProjectOption, action: DraftSelection["action"]) => void;
  onMapProject: (projectGid: string, vertexProjectId: string) => void;
}) {
  const [visibleCount, setVisibleCount] = useState(expandableListPageSize);
  const visibleAsanaProjects = asanaProjects.slice(0, visibleCount);
  const hasMoreAsanaProjects = visibleCount < asanaProjects.length;
  const canShowFewerAsanaProjects = visibleCount > expandableListPageSize;

  if (!asanaProjects.length) {
    return (
      <div className="rounded-md border bg-background p-8 text-center text-sm text-muted-foreground">
        No Asana projects were returned for this connected account.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border bg-background">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Asana Project</TableHead>
            <TableHead>Permission</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>VertexAI Project</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleAsanaProjects.map((project) => {
            const selection = draftSelections[project.gid] ?? { action: "ignore", vertexProjectId: "" };
            const selectedVertexProject = vertexProjectById.get(selection.vertexProjectId);
            const sourceLabel = project.portfolioName
              ? `${project.workspaceName} / Portfolio: ${project.portfolioName}`
              : `${project.workspaceName}${project.teamName ? ` / ${project.teamName}` : ""}`;
            const permissionLabel = project.canWriteTasks
              ? "Task Write"
              : project.permissionLevel === "unknown"
                ? "Verify on Save"
                : "Read Only";
            const isSaving = savingProjectGid === project.gid;
            return (
              <TableRow key={project.gid}>
                <TableCell>
                  <div className="grid gap-1">
                    <span className="font-medium">{project.name}</span>
                    <span className="text-xs text-muted-foreground">{sourceLabel}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={project.canWriteTasks ? "default" : "secondary"}>
                    {project.canWriteTasks ? <ShieldCheck className="mr-1 size-3" /> : <ShieldAlert className="mr-1 size-3" />}
                    {permissionLabel}
                  </Badge>
                  <p className="mt-1 max-w-64 text-xs text-muted-foreground">{project.permissionSource}</p>
                </TableCell>
                <TableCell>
                  <select
                    className="h-9 rounded-md border bg-background px-3 text-sm"
                    disabled={isSaving}
                    value={selection.action}
                    onChange={(event) => onActionChange(project, event.target.value as DraftSelection["action"])}
                  >
                    <option value="ignore">Ignore</option>
                    <option value="map">Map Existing</option>
                    <option value="scaffold">Scaffold New</option>
                  </select>
                </TableCell>
                <TableCell>
                  {selection.action === "map" ? (
                    <select
                      className="h-9 w-full min-w-56 rounded-md border bg-background px-3 text-sm"
                      disabled={isSaving}
                      value={selection.vertexProjectId}
                      onChange={(event) => onMapProject(project.gid, event.target.value)}
                    >
                      <option value="">Select Project</option>
                      {vertexProjects.map((vertexProject) => (
                        <option key={vertexProject.id} value={vertexProject.id}>
                          {vertexProject.name} / {vertexProject.mode}
                        </option>
                      ))}
                    </select>
                  ) : selection.action === "scaffold" ? (
                    <Button type="button" variant="outline" disabled={isSaving} onClick={() => onActionChange(project, "scaffold")}>
                      {isSaving ? "Creating..." : "Choose Destination"}
                    </Button>
                  ) : selectedVertexProject ? (
                    <span className="text-sm text-muted-foreground">Currently mapped to {selectedVertexProject.name}</span>
                  ) : (
                    <span className="text-sm text-muted-foreground">No Action</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {asanaProjects.length > expandableListPageSize ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          <span>
            Showing {visibleAsanaProjects.length} of {asanaProjects.length}
          </span>
          <div className="flex items-center gap-2">
            {canShowFewerAsanaProjects ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => setVisibleCount(expandableListPageSize)}>
                <ChevronUp className="size-4" />
                Show Fewer
              </Button>
            ) : null}
            {hasMoreAsanaProjects ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setVisibleCount((count) => Math.min(count + expandableListPageSize, asanaProjects.length))}
              >
                <ChevronDown className="size-4" />
                Show {Math.min(expandableListPageSize, asanaProjects.length - visibleAsanaProjects.length)} more
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
