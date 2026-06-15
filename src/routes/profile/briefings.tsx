import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { ArrowLeft, CalendarClock, Eye, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { AuthenticatedAppRail } from "@/components/AuthenticatedAppRail";
import { ArtifactRenderer } from "@/components/ArtifactRenderer";
import { VertexAIBrand } from "@/components/VertexAIBrand";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  deleteBriefingSchedule,
  getBriefingSettingsSummary,
  saveBriefingSchedule,
  testBriefingSchedule,
  type BriefingPreviewResult,
  type BriefingRecurrence,
  type BriefingScheduleInput,
  type BriefingScheduleView,
} from "@/lib/briefing-schedules";
import { getSession } from "@/lib/auth-workflow";
import { weeklyBriefingsChatTitle } from "@/lib/briefing-thread";

type DraftSchedule = BriefingScheduleInput;

const weekdayOptions = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

const customInstructionPlaceholders = [
  { token: "{Project Name}", label: "Project Name", description: "Selected project name" },
  { token: "{Project}", label: "Project", description: "Selected project name" },
  { token: "{Workspace}", label: "Workspace", description: "Workspace name" },
  { token: "{Workspace Name}", label: "Workspace Name", description: "Workspace name" },
  { token: "{Project Status}", label: "Project Status", description: "Current project status" },
  { token: "{Status}", label: "Status", description: "Current project status" },
  { token: "{Date}", label: "Date", description: "Run date as YYYY-MM-DD" },
  { token: "{YYYY-MM-DD}", label: "YYYY-MM-DD", description: "Run date" },
  { token: "{MM/DD/YY}", label: "MM/DD/YY", description: "Run date" },
  { token: "{MM/DD/YYYY}", label: "MM/DD/YYYY", description: "Run date" },
  { token: "{Time}", label: "Time", description: "Run time in UTC" },
];

const customInstructionFormatHelpers = [
  {
    label: "Report Title",
    text: "Title: {Project Name} - Weekly Status Update - {MM/DD/YY}\n\n",
    description: "Adds the briefing title line",
  },
  {
    label: "Section",
    text: "\nSection Name\nDescribe what should go in this section.\n",
    description: "Adds a section with guidance",
  },
  {
    label: "Bullet List",
    text: "\nSection Name\n- First item\n- Second item\n",
    description: "Adds a section with bullets",
  },
  {
    label: "Status Block",
    text: "\nStatus (On Track, Off Track - choose based on analysis of the project)\n\nStatus Summary\nGive a summary of the week in 100 words or less.\n",
    description: "Adds status and summary sections",
  },
  {
    label: "Risks Section",
    text: "\nRisks\n- List elevated risks supported by source data.\n- Leave blank if no risks are supported.\n",
    description: "Adds a risk bullet section",
  },
  {
    label: "Decision Section",
    text: "\nDecisions Requiring Executive Input\n- List decisions that need executive input.\n\nDecisions Made Within Workstream Scope\n- List decisions made by the workstream.\n",
    description: "Adds executive and workstream decisions",
  },
];

export const Route = createFileRoute("/profile/briefings")({
  loader: async () => {
    const session = await getSession();
    if (!session) throw redirect({ to: "/sign-in" });
    return { session };
  },
  head: () => ({
    meta: [{ title: "Automated Briefings | VertexAI" }],
  }),
  component: BriefingSettingsPage,
});

function createDefaultDraft(projectId = ""): DraftSchedule {
  const timeZone = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "America/New_York";
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  tomorrow.setHours(8, 0, 0, 0);
  return {
    id: null,
    title: "Weekly Project Briefing",
    enabled: true,
    recurrence: "weekly",
    timeZone: timeZone || "America/New_York",
    localTime: "08:00",
    weekdays: [1],
    monthDay: 1,
    runOnceAt: toDatetimeLocalValue(tomorrow),
    reportingWindowHours: 168,
    promptInstructions: "",
    projectId,
    chatId: null,
    newChatTitle: null,
  };
}

function BriefingSettingsPage() {
  const { session } = Route.useLoaderData();
  const summaryQuery = useQuery({
    queryKey: ["briefing-settings"],
    queryFn: () => getBriefingSettingsSummary(),
    retry: false,
  });
  const firstProjectId = summaryQuery.data?.projects[0]?.id ?? "";
  const [draft, setDraft] = useState<DraftSchedule>(() => createDefaultDraft());
  const [preview, setPreview] = useState<BriefingPreviewResult | null>(null);
  const [message, setMessage] = useState("");
  const customInstructionsRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!draft.projectId && firstProjectId) setDraft((current) => ({ ...current, projectId: firstProjectId }));
  }, [draft.projectId, firstProjectId]);

  const selectedProject = summaryQuery.data?.projects.find((project) => project.id === draft.projectId);
  const schedules = summaryQuery.data?.schedules ?? [];
  const canSave = Boolean(draft.projectId);

  const saveMutation = useMutation({
    mutationFn: (input: DraftSchedule) => saveBriefingSchedule({ data: input }),
    onSuccess: (saved) => {
      setMessage("Schedule saved.");
      setDraft(fromSchedule(saved));
      void summaryQuery.refetch();
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Schedule could not be saved."),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteBriefingSchedule({ data: { id } }),
    onSuccess: () => {
      setMessage("Schedule deleted.");
      setDraft(createDefaultDraft(firstProjectId));
      setPreview(null);
      void summaryQuery.refetch();
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Schedule could not be deleted."),
  });
  const testMutation = useMutation({
    mutationFn: (input: DraftSchedule) => testBriefingSchedule({ data: input }),
    onSuccess: (result) => {
      setPreview(result);
      setMessage("Preview generated from current state.");
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Preview could not be generated."),
  });

  function updateDraft(update: Partial<DraftSchedule>) {
    setDraft((current) => ({ ...current, ...update }));
  }

  function insertCustomInstructionText(text: string, mode: "inline" | "block" = "inline") {
    const textarea = customInstructionsRef.current;
    const current = draft.promptInstructions ?? "";
    const selectionStart = textarea?.selectionStart ?? current.length;
    const selectionEnd = textarea?.selectionEnd ?? current.length;
    const prefix = current.slice(0, selectionStart);
    const suffix = current.slice(selectionEnd);
    const insertion =
      mode === "block"
        ? `${prefix && !prefix.endsWith("\n") ? "\n" : ""}${text}${suffix && !text.endsWith("\n") ? "\n" : ""}`
        : `${prefix.length > 0 && !/[\s([{]$/.test(prefix) ? " " : ""}${text}${suffix.length > 0 && !/^[\s.,;:!?)}\]]/.test(suffix) ? " " : ""}`;
    const nextValue = `${prefix}${insertion}${suffix}`;
    updateDraft({ promptInstructions: nextValue });
    window.requestAnimationFrame(() => {
      textarea?.focus();
      const cursor = prefix.length + insertion.length;
      textarea?.setSelectionRange(cursor, cursor);
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    saveMutation.mutate(prepareDraftForServer(draft));
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

            <div className="grid gap-4 xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <CalendarClock className="size-5" />
                    Automated Briefings
                  </CardTitle>
                  <CardDescription>
                    Schedules run from the Cloudflare cron tick and save Markdown briefings into each project's read-only Briefings thread.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3">
                  <Button type="button" variant="outline" disabled={summaryQuery.isFetching} onClick={() => void summaryQuery.refetch()}>
                    <RefreshCw className={`size-4 ${summaryQuery.isFetching ? "animate-spin" : ""}`} />
                    Refresh
                  </Button>
                  <Button
                    type="button"
                    onClick={() => {
                      setDraft(createDefaultDraft(firstProjectId));
                      setPreview(null);
                      setMessage("");
                    }}
                  >
                    New Schedule
                  </Button>
                  <div className="grid gap-2">
                    {summaryQuery.isLoading ? <p className="text-sm text-muted-foreground">Loading schedules...</p> : null}
                    {summaryQuery.isError ? (
                      <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                        {summaryQuery.error instanceof Error ? summaryQuery.error.message : "Briefing settings could not be loaded."}
                      </p>
                    ) : null}
                    {schedules.map((schedule) => (
                      <button
                        key={schedule.id}
                        className="rounded-md border bg-background p-3 text-left text-sm transition-colors hover:bg-muted"
                        type="button"
                        onClick={() => {
                          setDraft(fromSchedule(schedule));
                          setPreview(null);
                          setMessage("");
                        }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">{schedule.title}</span>
                          <Badge variant={schedule.enabled ? "default" : "secondary"}>{schedule.enabled ? "On" : "Off"}</Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {schedule.projectName ?? "No project"} / next {formatDateTime(schedule.nextRunAt)}
                        </p>
                        {schedule.lastStatus ? <p className="mt-1 text-xs text-muted-foreground">Last: {schedule.lastStatus}</p> : null}
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <form className="grid gap-4" onSubmit={handleSubmit}>
                <Card>
                  <CardHeader>
                    <CardTitle>Schedule Setup</CardTitle>
                    <CardDescription>
                      {draft.id ? "Edit this briefing schedule." : "Create a briefing schedule or one-off run."}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <Field label="Title">
                        <Input value={draft.title} onChange={(event) => updateDraft({ title: event.target.value })} />
                      </Field>
                      <Field label="Project">
                        <select
                          className="h-9 rounded-md border bg-background px-3 text-sm"
                          value={draft.projectId}
                          onChange={(event) => updateDraft({ projectId: event.target.value, chatId: null, newChatTitle: null })}
                        >
                          <option value="">{summaryQuery.isFetching ? "Loading projects..." : "Select Project"}</option>
                          {(summaryQuery.data?.projects ?? []).map((project) => (
                            <option key={project.id} value={project.id}>
                              {projectLabel(project)}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Destination Thread">
                        <Input
                          value={`${weeklyBriefingsChatTitle}${selectedProject ? ` / ${selectedProject.projectName}` : ""}`}
                          disabled
                          aria-label="Automated briefing destination"
                        />
                      </Field>
                      <Field label="Reporting Window">
                        <select
                          className="h-9 rounded-md border bg-background px-3 text-sm"
                          value={draft.reportingWindowHours}
                          onChange={(event) => updateDraft({ reportingWindowHours: Number(event.target.value) })}
                        >
                          <option value={24}>Last 24 hours</option>
                          <option value={48}>Last 48 hours</option>
                          <option value={168}>Last 7 days</option>
                          <option value={720}>Last 30 days</option>
                        </select>
                      </Field>
                    </div>

                    <div className="grid gap-4 md:grid-cols-4">
                      <Field label="Enabled">
                        <select
                          className="h-9 rounded-md border bg-background px-3 text-sm"
                          value={draft.enabled ? "1" : "0"}
                          onChange={(event) => updateDraft({ enabled: event.target.value === "1" })}
                        >
                          <option value="1">On</option>
                          <option value="0">Off</option>
                        </select>
                      </Field>
                      <Field label="Recurrence">
                        <select
                          className="h-9 rounded-md border bg-background px-3 text-sm"
                          value={draft.recurrence}
                          onChange={(event) => updateDraft({ recurrence: event.target.value as BriefingRecurrence })}
                        >
                          <option value="daily">Daily</option>
                          <option value="weekdays">Weekdays</option>
                          <option value="weekly">Weekly</option>
                          <option value="monthly">Monthly</option>
                          <option value="once">One-Off</option>
                        </select>
                      </Field>
                      <Field label="Time Zone">
                        <Input value={draft.timeZone} onChange={(event) => updateDraft({ timeZone: event.target.value })} />
                      </Field>
                      <Field label="Time">
                        <Input
                          type="time"
                          value={draft.localTime}
                          onChange={(event) => updateDraft({ localTime: event.target.value })}
                          disabled={draft.recurrence === "once"}
                        />
                      </Field>
                    </div>

                    {draft.recurrence === "weekly" ? (
                      <div className="flex flex-wrap gap-2">
                        {weekdayOptions.map((day) => (
                          <Button
                            key={day.value}
                            type="button"
                            variant={draft.weekdays.includes(day.value) ? "default" : "outline"}
                            onClick={() => updateDraft({ weekdays: toggleWeekday(draft.weekdays, day.value) })}
                          >
                            {day.label}
                          </Button>
                        ))}
                      </div>
                    ) : null}

                    {draft.recurrence === "monthly" ? (
                      <Field label="Day of Month">
                        <Input
                          type="number"
                          min={1}
                          max={31}
                          value={draft.monthDay ?? 1}
                          onChange={(event) => updateDraft({ monthDay: Number(event.target.value) })}
                        />
                      </Field>
                    ) : null}

                    {draft.recurrence === "once" ? (
                      <Field label="One-Off Date and Time">
                        <Input
                          type="datetime-local"
                          value={draft.runOnceAt ?? ""}
                          onChange={(event) => updateDraft({ runOnceAt: event.target.value })}
                        />
                      </Field>
                    ) : null}

                    <Field label="Custom Instructions">
                      <div className="grid gap-2">
                        <Textarea
                          ref={customInstructionsRef}
                          className="min-h-32"
                          value={draft.promptInstructions}
                          onChange={(event) => updateDraft({ promptInstructions: event.target.value })}
                        />
                        <Accordion type="single" collapsible className="rounded-md border bg-background">
                          <AccordionItem value="formatting">
                            <AccordionTrigger className="px-3 py-2 text-xs text-muted-foreground hover:no-underline">
                              Add Format
                            </AccordionTrigger>
                            <AccordionContent className="border-t p-3">
                              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                                {customInstructionFormatHelpers.map((helper) => (
                                  <button
                                    key={helper.label}
                                    type="button"
                                    className="grid rounded-md border bg-muted/30 px-3 py-2 text-left transition-colors hover:bg-muted"
                                    onClick={() => insertCustomInstructionText(helper.text, "block")}
                                  >
                                    <span className="flex items-center gap-2 text-xs font-semibold text-foreground">
                                      <Plus className="size-3.5" />
                                      {helper.label}
                                    </span>
                                    <span className="text-xs text-muted-foreground">{helper.description}</span>
                                  </button>
                                ))}
                              </div>
                            </AccordionContent>
                          </AccordionItem>
                          <AccordionItem value="placeholders" className="border-b-0">
                            <AccordionTrigger className="px-3 py-2 text-xs text-muted-foreground hover:no-underline">
                              Placeholder Library
                            </AccordionTrigger>
                            <AccordionContent className="border-t p-3">
                              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                                {customInstructionPlaceholders.map((placeholder) => (
                                  <button
                                    key={placeholder.token}
                                    type="button"
                                    className="grid rounded-md border bg-muted/30 px-3 py-2 text-left transition-colors hover:bg-muted"
                                    onClick={() => insertCustomInstructionText(placeholder.token)}
                                  >
                                    <span className="flex items-center gap-2 text-xs font-semibold text-foreground">
                                      <Plus className="size-3.5" />
                                      {placeholder.token}
                                    </span>
                                    <span className="text-xs text-muted-foreground">{placeholder.description}</span>
                                  </button>
                                ))}
                              </div>
                            </AccordionContent>
                          </AccordionItem>
                        </Accordion>
                      </div>
                    </Field>

                    <div className="flex flex-wrap gap-2">
                      <Button type="submit" disabled={saveMutation.isPending || !canSave}>
                        <Save className="size-4" />
                        {saveMutation.isPending ? "Saving..." : "Save Schedule"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={testMutation.isPending || !draft.projectId}
                        onClick={() => testMutation.mutate(prepareDraftForServer(draft))}
                      >
                        <Eye className="size-4" />
                        {testMutation.isPending ? "Generating..." : "Test Output"}
                      </Button>
                      {draft.id ? (
                        <Button
                          type="button"
                          variant="outline"
                          disabled={deleteMutation.isPending}
                          onClick={() => deleteMutation.mutate(draft.id!)}
                        >
                          <Trash2 className="size-4" />
                          Delete
                        </Button>
                      ) : null}
                    </div>
                    {message ? <p className="rounded-md border bg-background p-3 text-sm text-muted-foreground">{message}</p> : null}
                  </CardContent>
                </Card>

                <PreviewPanel preview={preview} />
              </form>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function Field({ children, label }: { children: ReactNode; label: string }) {
  return (
    <Label className="grid gap-2">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </Label>
  );
}

function PreviewPanel({ preview }: { preview: BriefingPreviewResult | null }) {
  const counts = preview?.counts;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Current-State Test Output</CardTitle>
        <CardDescription>
          {preview
            ? `${preview.project.workspaceName} / ${preview.project.name}`
            : "Generate a test to preview the Markdown before the schedule runs."}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {counts ? (
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">{counts.messages} messages</Badge>
            <Badge variant="secondary">{counts.tasks} tasks</Badge>
            <Badge variant="secondary">{counts.asanaTasks} Asana tasks</Badge>
            <Badge variant="secondary">{counts.riskSignals} risk signals</Badge>
            <Badge variant="secondary">{counts.risks} risks</Badge>
            <Badge variant="secondary">{counts.modifiedArtifacts} modified artifacts</Badge>
          </div>
        ) : null}
        <div className="max-h-[520px] overflow-auto rounded-md border bg-background p-4 text-sm">
          {preview?.markdown ? (
            <ArtifactRenderer fileType="md" previewJson={preview.markdown} />
          ) : (
            <p className="text-sm text-muted-foreground">No preview generated yet.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function fromSchedule(schedule: BriefingScheduleView): DraftSchedule {
  return {
    id: schedule.id,
    title: schedule.title,
    enabled: schedule.enabled,
    recurrence: schedule.recurrence,
    timeZone: schedule.timeZone,
    localTime: schedule.localTime,
    weekdays: schedule.weekdays,
    monthDay: schedule.monthDay,
    runOnceAt: schedule.runOnceAt ? toDatetimeLocalValue(new Date(schedule.runOnceAt)) : null,
    reportingWindowHours: schedule.reportingWindowHours,
    promptInstructions: schedule.promptInstructions,
    projectId: schedule.projectId ?? "",
    chatId: schedule.chatId,
    newChatTitle: null,
  };
}

function toggleWeekday(days: number[], day: number) {
  return days.includes(day) ? days.filter((item) => item !== day) : [...days, day].sort();
}

function projectLabel(project: {
  projectName?: string | null;
  name?: string | null;
  workspaceScope?: string | null;
  workspaceName?: string | null;
  teamName?: string | null;
  id: string;
}) {
  const scope = project.workspaceScope
    ? project.workspaceScope[0].toUpperCase() + project.workspaceScope.slice(1)
    : project.workspaceName || "Workspace";
  const name = project.projectName?.trim() || project.name?.trim() || project.id;
  if (project.workspaceScope === "team") return `${scope} / ${project.teamName?.trim() || "Unassigned team"} / ${name}`;
  return `${scope} / ${name}`;
}

function toDatetimeLocalValue(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function prepareDraftForServer(draft: DraftSchedule): DraftSchedule {
  const normalized = {
    ...draft,
    chatId: null,
    newChatTitle: null,
  };
  if (draft.recurrence !== "once" || !draft.runOnceAt) return normalized;
  return {
    ...normalized,
    runOnceAt: new Date(draft.runOnceAt).toISOString(),
  };
}

function formatDateTime(value: string | null) {
  if (!value) return "Not Scheduled";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
