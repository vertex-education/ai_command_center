import { Fragment, useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { AlertTriangle, CalendarClock, CheckCircle2, Clock3, PauseCircle, Play, Plus, RefreshCw, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { isAdminRole } from "@/lib/auth-access-control";
import { getSession } from "@/lib/auth-workflow";
import {
  createScheduledTask,
  listScheduledTasks,
  queueScheduledTask,
  setScheduledTaskEnabled,
  updateScheduledTaskSettings,
} from "@/lib/scheduled-task-admin";
import {
  scheduledTaskAdminTypes,
  type CreateScheduledTaskAdminInput,
  type ScheduledTaskAdminHealth,
  type ScheduledTaskAdminRow,
  type ScheduledTaskAdminType,
  type UpdateScheduledTaskAdminInput,
} from "@/lib/scheduled-task-admin-shared";

export const Route = createFileRoute("/admin/scheduled-tasks")({
  loader: async () => {
    const session = await getSession();
    if (!session) throw redirect({ to: "/sign-in" });
    if (!isAdminRole(session.user.role)) throw redirect({ to: "/workspace" });
    return { session };
  },
  head: () => ({
    meta: [{ title: "Scheduled Tasks | VertexAI" }],
  }),
  component: AdminScheduledTasksPage,
});

type ScheduledTaskDraft = {
  enabled: boolean;
  priority: string;
  nextRunAtLocal: string;
  intervalMinutes: string;
  retryDelayMinutes: string;
  maxAttempts: string;
  payloadJson: string;
  scheduleJson: string;
};

type CreateTaskDraft = ScheduledTaskDraft & {
  type: ScheduledTaskAdminType;
  organizationId: string;
  workspaceId: string;
};

const scheduledTasksQueryKey = ["admin", "scheduled-tasks"] as const;

function AdminScheduledTasksPage() {
  const [drafts, setDrafts] = useState<Record<string, ScheduledTaskDraft>>({});
  const [createDraft, setCreateDraft] = useState<CreateTaskDraft>(() => defaultCreateTaskDraft());
  const [message, setMessage] = useState("");
  const queryClient = useQueryClient();

  const scheduledTasksQuery = useQuery({
    queryKey: scheduledTasksQueryKey,
    queryFn: () => listScheduledTasks(),
    refetchInterval: 15_000,
  });

  const tasks = scheduledTasksQuery.data?.tasks ?? [];
  const summary = scheduledTasksQuery.data?.summary;

  useEffect(() => {
    setDrafts((currentDrafts) => {
      const nextDrafts: Record<string, ScheduledTaskDraft> = {};
      for (const task of tasks) {
        nextDrafts[task.id] = currentDrafts[task.id] ?? draftFromTask(task);
      }
      return nextDrafts;
    });
  }, [tasks]);

  const createTaskMutation = useMutation({
    mutationFn: (data: CreateScheduledTaskAdminInput) => createScheduledTask({ data }),
    onSuccess: async (task) => {
      setMessage(`Created ${task.id}.`);
      setCreateDraft(defaultCreateTaskDraft());
      await queryClient.invalidateQueries({ queryKey: scheduledTasksQueryKey });
    },
    onError: (error) => setMessage(errorMessage(error, "Could not create scheduled task.")),
  });

  const updateTaskMutation = useMutation({
    mutationFn: (data: UpdateScheduledTaskAdminInput) => updateScheduledTaskSettings({ data }),
    onSuccess: async (task) => {
      setMessage(`Saved ${task.id}.`);
      setDrafts((currentDrafts) => ({ ...currentDrafts, [task.id]: draftFromTask(task) }));
      await queryClient.invalidateQueries({ queryKey: scheduledTasksQueryKey });
    },
    onError: (error) => setMessage(errorMessage(error, "Could not save scheduled task.")),
  });

  const enabledMutation = useMutation({
    mutationFn: (data: { taskId: string; enabled: boolean }) => setScheduledTaskEnabled({ data }),
    onSuccess: async (task) => {
      setMessage(`${task.enabled ? "Enabled" : "Disabled"} ${task.id}.`);
      setDrafts((currentDrafts) => ({ ...currentDrafts, [task.id]: draftFromTask(task) }));
      await queryClient.invalidateQueries({ queryKey: scheduledTasksQueryKey });
    },
    onError: (error) => setMessage(errorMessage(error, "Could not update scheduled task state.")),
  });

  const queueTaskMutation = useMutation({
    mutationFn: (taskId: string) => queueScheduledTask({ data: { taskId } }),
    onSuccess: async (task) => {
      setMessage(`Queued ${task.id} for the next scheduler tick.`);
      setDrafts((currentDrafts) => ({ ...currentDrafts, [task.id]: draftFromTask(task) }));
      await queryClient.invalidateQueries({ queryKey: scheduledTasksQueryKey });
    },
    onError: (error) => setMessage(errorMessage(error, "Could not queue scheduled task.")),
  });

  async function handleCreateTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    await createTaskMutation.mutateAsync(createInputFromDraft(createDraft));
  }

  async function handleSaveTask(task: ScheduledTaskAdminRow) {
    setMessage("");
    await updateTaskMutation.mutateAsync(updateInputFromDraft(task, drafts[task.id] ?? draftFromTask(task)));
  }

  function updateTaskDraft(taskId: string, patch: Partial<ScheduledTaskDraft>) {
    setDrafts((currentDrafts) => ({
      ...currentDrafts,
      [taskId]: {
        ...currentDrafts[taskId],
        ...patch,
      },
    }));
  }

  function updateCreateDraft(patch: Partial<CreateTaskDraft>) {
    setCreateDraft((currentDraft) => ({
      ...currentDraft,
      ...patch,
    }));
  }

  const isLoading = scheduledTasksQuery.isLoading && !scheduledTasksQuery.data;
  const isError = scheduledTasksQuery.isError;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Scheduled Tasks</h2>
          <p className="text-sm text-muted-foreground">Admin controls for D1-backed temporal jobs processed by the hourly Worker cron.</p>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={scheduledTasksQuery.isFetching}
          onClick={() => void scheduledTasksQuery.refetch()}
        >
          <RefreshCw className={`size-4 ${scheduledTasksQuery.isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {message ? <p className="rounded-md border bg-background p-3 text-sm text-muted-foreground">{message}</p> : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Total Tasks" value={summary?.total ?? 0} detail={`${summary?.enabled ?? 0} enabled`} icon={CalendarClock} />
        <SummaryCard label="Due Now" value={summary?.due ?? 0} detail={`${summary?.pending ?? 0} pending`} icon={Clock3} />
        <SummaryCard label="Running" value={summary?.running ?? 0} detail={`${summary?.completed ?? 0} completed`} icon={Play} />
        <SummaryCard
          label="Failed / Paused"
          value={(summary?.failed ?? 0) + (summary?.paused ?? 0)}
          detail={`${summary?.failed ?? 0} failed`}
          icon={AlertTriangle}
        />
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <span className="grid size-10 place-items-center rounded-md bg-primary text-primary-foreground">
              <Plus className="size-5" />
            </span>
            <div>
              <CardTitle>Create Task</CardTitle>
              <CardDescription>Add a scheduled task row for the central Worker scheduler.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={handleCreateTask}>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="space-y-2">
                <Label htmlFor="scheduled-task-type">Type</Label>
                <select
                  id="scheduled-task-type"
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  value={createDraft.type}
                  onChange={(event) => updateCreateDraft({ type: event.target.value as ScheduledTaskAdminType })}
                >
                  {scheduledTaskAdminTypes.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>
              <InputField
                id="scheduled-task-next-run"
                label="Next Run"
                type="datetime-local"
                value={createDraft.nextRunAtLocal}
                onChange={(value) => updateCreateDraft({ nextRunAtLocal: value })}
              />
              <InputField
                id="scheduled-task-interval"
                label="Interval Minutes"
                type="number"
                value={createDraft.intervalMinutes}
                onChange={(value) => updateCreateDraft({ intervalMinutes: value })}
              />
              <InputField
                id="scheduled-task-priority"
                label="Priority"
                type="number"
                value={createDraft.priority}
                onChange={(value) => updateCreateDraft({ priority: value })}
              />
              <InputField
                id="scheduled-task-retry-delay"
                label="Retry Delay"
                type="number"
                value={createDraft.retryDelayMinutes}
                onChange={(value) => updateCreateDraft({ retryDelayMinutes: value })}
              />
              <InputField
                id="scheduled-task-max-attempts"
                label="Max Attempts"
                type="number"
                value={createDraft.maxAttempts}
                onChange={(value) => updateCreateDraft({ maxAttempts: value })}
              />
              <InputField
                id="scheduled-task-org"
                label="Organization ID"
                value={createDraft.organizationId}
                onChange={(value) => updateCreateDraft({ organizationId: value })}
              />
              <InputField
                id="scheduled-task-workspace"
                label="Workspace ID"
                value={createDraft.workspaceId}
                onChange={(value) => updateCreateDraft({ workspaceId: value })}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 rounded border"
                checked={createDraft.enabled}
                onChange={(event) => updateCreateDraft({ enabled: event.target.checked })}
              />
              Enabled
            </label>
            <div className="grid gap-4 lg:grid-cols-2">
              <JsonEditor
                id="scheduled-task-payload"
                label="Payload JSON"
                value={createDraft.payloadJson}
                onChange={(value) => updateCreateDraft({ payloadJson: value })}
              />
              <JsonEditor
                id="scheduled-task-schedule"
                label="Schedule JSON"
                value={createDraft.scheduleJson}
                onChange={(value) => updateCreateDraft({ scheduleJson: value })}
              />
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={createTaskMutation.isPending}>
                <Plus className="size-4" />
                Create Task
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Task Queue</CardTitle>
          <CardDescription>Current scheduled_tasks rows and scheduler state.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? <p className="text-sm text-muted-foreground">Loading scheduled tasks...</p> : null}
          {isError ? <p className="text-sm text-destructive">Could not load scheduled tasks.</p> : null}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-72">Task</TableHead>
                  <TableHead className="min-w-32">Enabled</TableHead>
                  <TableHead className="min-w-64">Timing</TableHead>
                  <TableHead className="min-w-44">Retry</TableHead>
                  <TableHead className="min-w-64">Last Activity</TableHead>
                  <TableHead className="min-w-48 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.map((task) => {
                  const draft = drafts[task.id] ?? draftFromTask(task);
                  const isSaving = updateTaskMutation.isPending && updateTaskMutation.variables?.taskId === task.id;
                  const isToggling = enabledMutation.isPending && enabledMutation.variables?.taskId === task.id;
                  const isQueueing = queueTaskMutation.isPending && queueTaskMutation.variables === task.id;
                  return (
                    <Fragment key={task.id}>
                      <TableRow>
                        <TableCell className="align-top">
                          <div className="grid gap-2">
                            <span className="font-medium">{task.id}</span>
                            <div className="flex flex-wrap gap-2">
                              <TaskStatusBadge task={task} />
                              <Badge variant="outline">{task.type}</Badge>
                              <Badge variant={task.enabled ? "success" : "secondary"}>{task.enabled ? "Enabled" : "Disabled"}</Badge>
                            </div>
                            <span className="text-xs text-muted-foreground">
                              Priority {task.priority} / {task.intervalLabel}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="align-top">
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              className="size-4 rounded border"
                              checked={draft.enabled}
                              onChange={(event) => updateTaskDraft(task.id, { enabled: event.target.checked })}
                            />
                            {draft.enabled ? "Enabled" : "Disabled"}
                          </label>
                        </TableCell>
                        <TableCell className="align-top">
                          <div className="grid gap-3">
                            <Input
                              type="datetime-local"
                              value={draft.nextRunAtLocal}
                              onChange={(event) => updateTaskDraft(task.id, { nextRunAtLocal: event.target.value })}
                            />
                            <div className="grid grid-cols-2 gap-2">
                              <Input
                                aria-label={`${task.id} interval minutes`}
                                type="number"
                                value={draft.intervalMinutes}
                                onChange={(event) => updateTaskDraft(task.id, { intervalMinutes: event.target.value })}
                              />
                              <Input
                                aria-label={`${task.id} priority`}
                                type="number"
                                value={draft.priority}
                                onChange={(event) => updateTaskDraft(task.id, { priority: event.target.value })}
                              />
                            </div>
                            <p className="text-xs text-muted-foreground">Next: {task.nextRunAtLabel}</p>
                          </div>
                        </TableCell>
                        <TableCell className="align-top">
                          <div className="grid gap-2">
                            <Input
                              aria-label={`${task.id} retry delay minutes`}
                              type="number"
                              value={draft.retryDelayMinutes}
                              onChange={(event) => updateTaskDraft(task.id, { retryDelayMinutes: event.target.value })}
                            />
                            <Input
                              aria-label={`${task.id} max attempts`}
                              type="number"
                              value={draft.maxAttempts}
                              onChange={(event) => updateTaskDraft(task.id, { maxAttempts: event.target.value })}
                            />
                            <span className="text-xs text-muted-foreground">
                              Attempts {task.attemptCount}/{task.maxAttempts}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="align-top">
                          <div className="grid gap-1 text-sm">
                            <span>Last run: {task.lastRunAtLabel}</span>
                            <span>Completed: {task.lastCompletedAtLabel}</span>
                            <span>Locked: {task.lockedAtLabel}</span>
                            {task.lastError ? <span className="text-destructive">Error: {task.lastError}</span> : null}
                          </div>
                        </TableCell>
                        <TableCell className="align-top text-right">
                          <div className="flex flex-wrap justify-end gap-2">
                            <Button type="button" variant="outline" size="sm" disabled={isSaving} onClick={() => handleSaveTask(task)}>
                              <Save className="size-4" />
                              Save
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={isQueueing}
                              onClick={() => queueTaskMutation.mutate(task.id)}
                            >
                              <Play className="size-4" />
                              Queue
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={isToggling}
                              onClick={() => enabledMutation.mutate({ taskId: task.id, enabled: !task.enabled })}
                            >
                              {task.enabled ? <PauseCircle className="size-4" /> : <CheckCircle2 className="size-4" />}
                              {task.enabled ? "Disable" : "Enable"}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell colSpan={6} className="bg-muted/20">
                          <div className="grid gap-3 lg:grid-cols-2">
                            <JsonEditor
                              id={`${task.id}-payload`}
                              label="Payload JSON"
                              value={draft.payloadJson}
                              onChange={(value) => updateTaskDraft(task.id, { payloadJson: value })}
                            />
                            <JsonEditor
                              id={`${task.id}-schedule`}
                              label="Schedule JSON"
                              value={draft.scheduleJson}
                              onChange={(value) => updateTaskDraft(task.id, { scheduleJson: value })}
                            />
                          </div>
                          {task.resultJson ? (
                            <details className="mt-3 rounded-md border bg-background p-3">
                              <summary className="cursor-pointer text-sm font-medium">Last Result</summary>
                              <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words text-xs">
                                {formatJsonForEditing(task.resultJson)}
                              </pre>
                            </details>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {!isLoading && !tasks.length ? (
            <div className="rounded-md border bg-background p-8 text-center text-sm text-muted-foreground">
              No scheduled tasks have been created.
            </div>
          ) : null}
        </CardContent>
      </Card>
    </>
  );
}

function SummaryCard({ label, value, detail, icon: Icon }: { label: string; value: number; detail: string; icon: typeof CalendarClock }) {
  return (
    <Card>
      <CardHeader className="space-y-0 pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardDescription>{label}</CardDescription>
          <Icon className="size-4 text-muted-foreground" />
        </div>
        <CardTitle className="text-2xl">{value.toLocaleString()}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

function InputField({
  id,
  label,
  value,
  onChange,
  type = "text",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function JsonEditor({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Textarea id={id} className="min-h-32 font-mono text-xs" value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function TaskStatusBadge({ task }: { task: ScheduledTaskAdminRow }) {
  const variant = statusBadgeVariant(task);
  const label = task.isDue ? "Due" : task.statusLabel;
  return (
    <Badge variant={variant}>
      <TaskStatusIcon health={task.health} />
      {label}
    </Badge>
  );
}

function TaskStatusIcon({ health }: { health: ScheduledTaskAdminHealth }) {
  if (health === "failed") return <AlertTriangle className="size-3" />;
  if (health === "paused") return <PauseCircle className="size-3" />;
  if (health === "running" || health === "due") return <Clock3 className="size-3" />;
  return <CheckCircle2 className="size-3" />;
}

function statusBadgeVariant(task: ScheduledTaskAdminRow) {
  if (task.health === "failed") return "destructive";
  if (task.health === "due") return "warning";
  if (task.health === "running") return "info";
  if (task.health === "complete") return "success";
  if (task.health === "paused") return "secondary";
  return "outline";
}

function draftFromTask(task: ScheduledTaskAdminRow): ScheduledTaskDraft {
  return {
    enabled: task.enabled,
    priority: String(task.priority),
    nextRunAtLocal: task.nextRunAt > 0 ? datetimeLocalFromTimestamp(task.nextRunAt) : "",
    intervalMinutes: task.intervalMinutes ? String(task.intervalMinutes) : "",
    retryDelayMinutes: String(task.retryDelayMinutes),
    maxAttempts: String(task.maxAttempts),
    payloadJson: formatJsonForEditing(task.payloadJson),
    scheduleJson: formatJsonForEditing(task.scheduleJson),
  };
}

function defaultCreateTaskDraft(): CreateTaskDraft {
  return {
    type: "Artifact Validation",
    organizationId: "",
    workspaceId: "",
    enabled: true,
    priority: "0",
    nextRunAtLocal: datetimeLocalFromTimestamp(Date.now() + 60 * 60 * 1000),
    intervalMinutes: "60",
    retryDelayMinutes: "15",
    maxAttempts: "3",
    payloadJson: '{\n  "staleAfterHours": 24\n}',
    scheduleJson: '{\n  "cadence": "hourly"\n}',
  };
}

function createInputFromDraft(draft: CreateTaskDraft): CreateScheduledTaskAdminInput {
  return {
    type: draft.type,
    organizationId: draft.organizationId,
    workspaceId: draft.workspaceId,
    enabled: draft.enabled,
    priority: numericInput(draft.priority, "Priority"),
    payloadJson: draft.payloadJson,
    scheduleJson: draft.scheduleJson,
    nextRunAt: timestampFromDatetimeLocal(draft.nextRunAtLocal, "Next run"),
    intervalMinutes: nullableNumericInput(draft.intervalMinutes, "Interval minutes"),
    retryDelayMinutes: numericInput(draft.retryDelayMinutes, "Retry delay"),
    maxAttempts: numericInput(draft.maxAttempts, "Max attempts"),
  };
}

function updateInputFromDraft(task: ScheduledTaskAdminRow, draft: ScheduledTaskDraft): UpdateScheduledTaskAdminInput {
  return {
    taskId: task.id,
    enabled: draft.enabled,
    priority: numericInput(draft.priority, "Priority"),
    payloadJson: draft.payloadJson,
    scheduleJson: draft.scheduleJson,
    nextRunAt: draft.nextRunAtLocal ? timestampFromDatetimeLocal(draft.nextRunAtLocal, "Next run") : task.nextRunAt,
    intervalMinutes: nullableNumericInput(draft.intervalMinutes, "Interval minutes"),
    retryDelayMinutes: numericInput(draft.retryDelayMinutes, "Retry delay"),
    maxAttempts: numericInput(draft.maxAttempts, "Max attempts"),
  };
}

function datetimeLocalFromTimestamp(timestamp: number) {
  const date = new Date(timestamp);
  const localTimestamp = date.getTime() - date.getTimezoneOffset() * 60_000;
  return new Date(localTimestamp).toISOString().slice(0, 16);
}

function timestampFromDatetimeLocal(value: string, label: string) {
  if (!value.trim()) throw new Error(`${label} is required.`);
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) throw new Error(`${label} must be a valid date and time.`);
  return timestamp;
}

function numericInput(value: string, label: string) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new Error(`${label} must be a number.`);
  return Math.trunc(numeric);
}

function nullableNumericInput(value: string, label: string) {
  if (!value.trim()) return null;
  return numericInput(value, label);
}

function formatJsonForEditing(value: string | null | undefined) {
  if (!value) return "{}";
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
