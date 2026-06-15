import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "@tanstack/react-form";
import { Download, Plus, Settings, Sparkles } from "lucide-react";
import { ArtifactRenderer } from "@/components/ArtifactRenderer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { listAsanaTaskStatusCustomFields, type AsanaTaskStatusCustomFieldOption } from "@/lib/asana-integration";
import {
  applyArtifactPatches,
  parseArtifactPatchSequence,
  type ArtifactPatchAction,
  type ArtifactPatchAppliedChange,
} from "@/lib/artifact-diff";
import { cn } from "@/lib/utils";
import {
  type AddIdeaInput,
  type Artifact,
  type ArtifactPatchDraftResult,
  type CommitArtifactPatchInput,
  type ChatSection,
  type Idea,
  type IdeaStatus,
  type ProjectSummary,
  type Risk,
  type Task,
  type WorkspaceMode,
  statusMeta,
  workspaceModeLabel,
} from "@/lib/pmo-data";
import { type CreateChatInput, type CreateProjectInput } from "@/lib/team-workflow";
import {
  type ConfirmDialogState,
  type CreateTeamInput,
  type InputDialogState,
  type TutorialStep,
  type WorkflowPreviewState,
  emptyIdeaForm,
} from "./shared";
import { FieldBlock, artifactIcon } from "./common";

export function AddIdeaDialog({
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

export function CreateTeamDialog({
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
          <DialogTitle>New Team</DialogTitle>
          <DialogDescription>Create a team workspace for shared projects and assigned users.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <FieldBlock label="Team Name">
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
              Create Team
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function TutorialDialog({
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
            <Badge variant="secondary">
              Step {stepIndex + 1} of {steps.length}
            </Badge>
            <div className="flex gap-1" aria-hidden="true">
              {steps.map((step, index) => (
                <span key={step.title} className={cn("h-1.5 w-8 rounded-full", index <= stepIndex ? "bg-primary" : "bg-muted")} />
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

export function CreateProjectDialog({
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
          <DialogTitle>New Project</DialogTitle>
          <DialogDescription>Add a project to {scopeLabel}.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <FieldBlock label="Project Name">
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Example: Enrollment Assistant" autoFocus />
          </FieldBlock>
          <FieldBlock label="Description">
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What this project is responsible for."
            />
          </FieldBlock>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !name.trim()}>
              <Plus />
              Create Project
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ProjectInstructionsDialog({
  open,
  pending,
  project,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  pending: boolean;
  project: ProjectSummary | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (value: {
    asanaTaskStatusCustomFieldGid: string | null;
    asanaTaskStatusCustomFieldName: string | null;
    asanaTaskStatusSource: ProjectSummary["asanaTaskStatusSource"];
    description: string;
    projectInstructions: string;
  }) => Promise<void>;
}) {
  const [description, setDescription] = useState("");
  const [projectInstructions, setProjectInstructions] = useState("");
  const [asanaTaskStatusSource, setAsanaTaskStatusSource] = useState<ProjectSummary["asanaTaskStatusSource"]>("native");
  const [asanaTaskStatusCustomFieldGid, setAsanaTaskStatusCustomFieldGid] = useState("");
  const customFieldsQuery = useQuery({
    enabled: open && Boolean(project?.id),
    queryKey: ["asana", "task-status-custom-fields", project?.id ?? ""],
    queryFn: () => listAsanaTaskStatusCustomFields({ data: { vertexProjectId: project?.id ?? "" } }),
    retry: false,
  });

  useEffect(() => {
    setDescription(project?.description ?? "");
    setProjectInstructions(project?.projectInstructions ?? "");
    setAsanaTaskStatusSource(project?.asanaTaskStatusSource ?? "native");
    setAsanaTaskStatusCustomFieldGid(project?.asanaTaskStatusCustomFieldGid ?? "");
  }, [project]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const selectedCustomField =
      (customFieldsQuery.data ?? []).find((field) => field.gid === asanaTaskStatusCustomFieldGid) ??
      (project?.asanaTaskStatusCustomFieldGid === asanaTaskStatusCustomFieldGid && project.asanaTaskStatusCustomFieldName
        ? ({
            gid: project.asanaTaskStatusCustomFieldGid,
            name: project.asanaTaskStatusCustomFieldName,
            type: null,
          } satisfies AsanaTaskStatusCustomFieldOption)
        : null);
    await onSubmit({
      asanaTaskStatusCustomFieldGid: asanaTaskStatusSource === "custom_field" ? (selectedCustomField?.gid ?? null) : null,
      asanaTaskStatusCustomFieldName: asanaTaskStatusSource === "custom_field" ? (selectedCustomField?.name ?? null) : null,
      asanaTaskStatusSource,
      description: description.trim(),
      projectInstructions: projectInstructions.trim(),
    });
  }

  const customFields = customFieldsQuery.data ?? [];
  const selectedFieldMissingFromOptions = Boolean(
    project?.asanaTaskStatusCustomFieldGid &&
    project.asanaTaskStatusCustomFieldName &&
    !customFields.some((field) => field.gid === project.asanaTaskStatusCustomFieldGid),
  );
  const customFieldOptions = selectedFieldMissingFromOptions
    ? [
        {
          gid: project?.asanaTaskStatusCustomFieldGid ?? "",
          name: project?.asanaTaskStatusCustomFieldName ?? "Saved custom field",
          type: null,
        },
        ...customFields,
      ]
    : customFields;
  const canUseCustomField = customFieldOptions.length > 0;
  const customFieldRequired = asanaTaskStatusSource === "custom_field" && !asanaTaskStatusCustomFieldGid;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Project Instructions</DialogTitle>
          <DialogDescription>Set chat guidance for {project?.name ?? "this project"}.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <FieldBlock label="Description">
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What this project is responsible for."
            />
          </FieldBlock>
          <FieldBlock label="Instructions">
            <Textarea
              className="min-h-36"
              value={projectInstructions}
              onChange={(event) => setProjectInstructions(event.target.value)}
              placeholder="Example: For Ramp status questions, use the Implementation Status field as the source of truth. Treat blank status as Not Started."
              autoFocus
            />
          </FieldBlock>
          <FieldBlock label="Asana Task Status Source">
            <div className="grid gap-3 rounded-md border bg-muted/30 p-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="flex cursor-pointer items-start gap-2 rounded-md border bg-background p-3 text-sm">
                  <input
                    className="mt-1"
                    type="radio"
                    checked={asanaTaskStatusSource === "native"}
                    onChange={() => setAsanaTaskStatusSource("native")}
                  />
                  <span>
                    <span className="block font-medium">Native Completion</span>
                    <span className="block text-xs text-muted-foreground">Use Asana completed/open state.</span>
                  </span>
                </label>
                <label
                  className={cn(
                    "flex cursor-pointer items-start gap-2 rounded-md border bg-background p-3 text-sm",
                    !canUseCustomField && "cursor-not-allowed opacity-60",
                  )}
                >
                  <input
                    className="mt-1"
                    type="radio"
                    checked={asanaTaskStatusSource === "custom_field"}
                    disabled={!canUseCustomField}
                    onChange={() => setAsanaTaskStatusSource("custom_field")}
                  />
                  <span>
                    <span className="block font-medium">Custom Field</span>
                    <span className="block text-xs text-muted-foreground">Use a selected Asana task custom field as status.</span>
                  </span>
                </label>
              </div>
              {asanaTaskStatusSource === "custom_field" ? (
                <>
                  <select
                    aria-label="Asana task status custom field"
                    title="Asana Task Status Custom Field"
                    className="h-10 rounded-md border bg-background px-3 text-sm"
                    disabled={!canUseCustomField}
                    value={asanaTaskStatusCustomFieldGid}
                    onChange={(event) => setAsanaTaskStatusCustomFieldGid(event.target.value)}
                  >
                    <option value="">
                      {customFieldsQuery.isLoading
                        ? "Loading Asana fields..."
                        : canUseCustomField
                          ? "Select Custom Field"
                          : "No Mapped Asana Fields Found"}
                    </option>
                    {customFieldOptions.map((field) => (
                      <option key={field.gid} value={field.gid}>
                        {field.name}
                        {field.type ? ` (${field.type})` : ""}
                      </option>
                    ))}
                  </select>
                  {customFieldsQuery.isError ? (
                    <p className="text-xs text-destructive">Could not load Asana custom fields for this project.</p>
                  ) : null}
                  {customFieldRequired ? (
                    <p className="text-xs text-destructive">Select a custom field or switch back to native completion.</p>
                  ) : null}
                </>
              ) : null}
            </div>
          </FieldBlock>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !project || customFieldRequired}>
              <Settings />
              Save Instructions
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CreateChatDialog({
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
          <DialogTitle>New Chat</DialogTitle>
          <DialogDescription>
            Create a fresh {chatType} for {contextLabel}.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <FieldBlock label="Chat Name">
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Example: Launch planning assistant"
              autoFocus
            />
          </FieldBlock>
          <FieldBlock label="Description">
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What this AI chat should help with."
            />
          </FieldBlock>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !title.trim()}>
              <Plus />
              Create Chat
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function BrandedConfirmDialog({ state, onOpenChange }: { state: ConfirmDialogState; onOpenChange: (open: boolean) => void }) {
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
          <DialogTitle>{state?.title ?? "Confirm Action"}</DialogTitle>
          <DialogDescription>{state?.description ?? "Confirm this action before continuing."}</DialogDescription>
        </DialogHeader>
        {error ? <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={isPending} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" variant={state?.destructive ? "destructive" : "default"} disabled={isPending} onClick={handleConfirm}>
            {isPending ? "Working..." : (state?.actionLabel ?? "Confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function BrandedInputDialog({ state, onOpenChange }: { state: InputDialogState; onOpenChange: (open: boolean) => void }) {
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
              {isPending ? "Working..." : (state?.actionLabel ?? "Save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ArtifactPreviewDialog({ artifact, onOpenChange }: { artifact: Artifact | null; onOpenChange: (open: boolean) => void }) {
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
            <div
              className={cn(
                "grid gap-4 sm:grid-cols-[150px_minmax(0,1fr)]",
                isWorkbook && "mx-5 mt-4 rounded-md border bg-muted/30 p-3 sm:grid-cols-[96px_minmax(0,1fr)]",
              )}
            >
              <div className="grid min-h-44 place-items-center content-center gap-2 rounded-lg border bg-muted text-primary">
                {artifactIcon(artifact.type)}
                <strong>{artifact.type}</strong>
                <span className="text-xs text-muted-foreground">
                  {artifact.status} / v{artifact.version}
                </span>
              </div>
              <div className="space-y-3">
                <p className="text-sm leading-6 text-muted-foreground">{artifact.summary}</p>
                <div className="rounded-md border bg-background px-3 py-2 text-sm">
                  <span className="font-semibold text-foreground">Source Chat</span>
                  <p className="mt-1 text-muted-foreground">{artifact.sourceChatTitle ?? "Not captured for this artifact"}</p>
                </div>
                <ArtifactRenderer fileType={artifact.type} previewJson={artifact.previewJson} fallbackPreview={artifact.preview} />
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

export function ArtifactPatchDialog({
  artifact,
  draft,
  mode,
  open,
  pendingApprove,
  pendingDraft,
  onApprove,
  onDraft,
  onOpenChange,
  onResetDraft,
}: {
  artifact: Artifact | null;
  draft: ArtifactPatchDraftResult | null;
  mode: WorkspaceMode;
  open: boolean;
  pendingApprove: boolean;
  pendingDraft: boolean;
  onApprove: (input: CommitArtifactPatchInput) => Promise<void>;
  onDraft: (instruction: string) => Promise<void>;
  onOpenChange: (open: boolean) => void;
  onResetDraft: () => void;
}) {
  const [instruction, setInstruction] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const parsedPatches = useMemo(() => (draft ? parseArtifactPatchSequence(draft.patchSequence) : []), [draft]);
  const patchPreview = useMemo(() => (draft ? applyArtifactPatches(draft.baseText, parsedPatches) : null), [draft, parsedPatches]);
  const warnings = [...(draft?.warnings ?? []), ...(patchPreview?.warnings ?? [])];
  const canApprove = Boolean(draft && parsedPatches.length > 0 && patchPreview?.changes.length && warnings.length === 0);

  useEffect(() => {
    if (!open) return;
    setCommitMessage(artifact ? `Approved AI diff patch for v${artifact.version}` : "");
  }, [artifact, open]);

  useEffect(() => {
    if (open) return;
    setInstruction("");
    setCommitMessage("");
  }, [open]);

  async function handleDraftSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!instruction.trim()) return;
    await onDraft(instruction);
  }

  async function handleApprove() {
    if (!draft || !canApprove) return;
    await onApprove({
      artifactId: draft.artifactId,
      baseR2Key: draft.baseR2Key,
      commitMessage,
      mode,
      patches: parsedPatches,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-[min(1040px,calc(100vw-32px))] overflow-hidden p-0">
        {artifact ? (
          <>
            <DialogHeader className="border-b px-5 py-4">
              <DialogTitle>AI diff patch</DialogTitle>
              <DialogDescription>
                {artifact.title} / {artifact.type} / v{artifact.version}
              </DialogDescription>
            </DialogHeader>
            <div className="grid max-h-[70vh] min-h-0 gap-0 overflow-hidden lg:grid-cols-[320px_minmax(0,1fr)]">
              <form className="space-y-4 border-r bg-muted/20 p-5" onSubmit={handleDraftSubmit}>
                <div className="space-y-2">
                  <Label htmlFor="artifact-patch-instruction">Requested change</Label>
                  <Textarea
                    id="artifact-patch-instruction"
                    value={instruction}
                    placeholder="Example: Update the launch date to July 15 and add one risk note about procurement timing."
                    className="min-h-36"
                    onChange={(event) => {
                      setInstruction(event.target.value);
                      if (draft) onResetDraft();
                    }}
                  />
                </div>
                <Button type="submit" disabled={pendingDraft || !instruction.trim()} className="w-full">
                  <Sparkles />
                  {pendingDraft ? "Drafting patch" : "Draft patch"}
                </Button>
                <div className="rounded-md border bg-background p-3 text-xs leading-5 text-muted-foreground">
                  <strong className="block text-foreground">Patch model</strong>
                  <span>{draft?.model ?? "Kimi K2.7 Code"}</span>
                  <strong className="mt-3 block text-foreground">Base state</strong>
                  <span>{draft ? `v${draft.baseVersion} / ${draft.baseText.length.toLocaleString()} characters` : "Not drafted"}</span>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="artifact-patch-commit-message">Commit message</Label>
                  <Input
                    id="artifact-patch-commit-message"
                    value={commitMessage}
                    placeholder="Approved AI diff patch"
                    onChange={(event) => setCommitMessage(event.target.value)}
                  />
                </div>
              </form>
              <div className="min-h-0 overflow-auto p-5">
                {draft && patchPreview ? (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={warnings.length ? "destructive" : "secondary"}>{parsedPatches.length} patches</Badge>
                      <Badge variant="outline">{patchPreview.changes.length} applicable</Badge>
                      <Badge variant="outline">Base v{draft.baseVersion}</Badge>
                    </div>
                    {warnings.length ? (
                      <div className="space-y-1 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                        {warnings.map((warning) => (
                          <p key={warning}>{warning}</p>
                        ))}
                      </div>
                    ) : null}
                    <div className="space-y-3">
                      {patchPreview.changes.map((change, index) => (
                        <ArtifactPatchChangePreview
                          change={change}
                          key={`${change.action}-${change.index}-${index}`}
                          patch={parsedPatches[index]}
                        />
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="grid min-h-72 place-items-center rounded-md border border-dashed bg-muted/20 p-6 text-center text-sm text-muted-foreground">
                    Draft a patch to review exact replacements, insertions, and deletions before approval.
                  </div>
                )}
              </div>
            </div>
            <DialogFooter className="border-t px-5 py-4">
              <Button type="button" variant="outline" disabled={pendingDraft || pendingApprove} onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button type="button" disabled={!canApprove || pendingDraft || pendingApprove} onClick={handleApprove}>
                {pendingApprove ? "Saving version" : "Approve patch"}
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ArtifactPatchChangePreview({ change, patch }: { change: ArtifactPatchAppliedChange; patch?: ArtifactPatchAction }) {
  return (
    <div className="rounded-md border bg-background">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2">
        <Badge variant="outline">{patchActionLabel(change.action)}</Badge>
        <span className="text-xs text-muted-foreground">Occurrence {change.occurrence}</span>
      </div>
      <div className="space-y-2 p-3">
        {change.rationale || patch?.rationale ? (
          <p className="text-sm text-muted-foreground">{change.rationale ?? patch?.rationale}</p>
        ) : null}
        <pre className="whitespace-pre-wrap break-words rounded-md bg-muted/25 p-3 font-mono text-xs leading-5">
          <span className="text-muted-foreground">{change.beforeContext}</span>
          {change.action === "insert_before" ? <InsertedPatchText>{change.newString}</InsertedPatchText> : null}
          <DeletedPatchText muted={change.action === "insert_before" || change.action === "insert_after"}>
            {change.targetString}
          </DeletedPatchText>
          {change.action === "replace" || change.action === "insert_after" ? (
            <InsertedPatchText>{change.newString}</InsertedPatchText>
          ) : null}
          <span className="text-muted-foreground">{change.afterContext}</span>
        </pre>
      </div>
    </div>
  );
}

function DeletedPatchText({ children, muted = false }: { children: string; muted?: boolean }) {
  return (
    <mark
      className={cn(
        "rounded-sm px-0.5 text-inherit",
        muted ? "bg-secondary text-secondary-foreground" : "bg-destructive/15 text-destructive line-through decoration-destructive",
      )}
    >
      {children}
    </mark>
  );
}

function InsertedPatchText({ children }: { children: string }) {
  if (!children) return null;
  return <mark className="rounded-sm bg-success/15 px-0.5 text-success">{children}</mark>;
}

function patchActionLabel(action: ArtifactPatchAction["action"]) {
  if (action === "insert_before") return "Insert before";
  if (action === "insert_after") return "Insert after";
  if (action === "delete") return "Delete";
  return "Replace";
}

export function WorkflowPreviewDialog({ onOpenChange, preview }: { onOpenChange: (open: boolean) => void; preview: WorkflowPreviewState }) {
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

export function parsePreviewRows(rowsJson: string) {
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

export function hasStructuredTablePreview(previewJson: unknown) {
  if (!previewJson || typeof previewJson !== "object" || Array.isArray(previewJson)) return false;
  const record = previewJson as { rows?: unknown };
  return Array.isArray(record.rows);
}

export type XlsxPreviewSheet = {
  name: string;
  rows: string[][];
  rowCount: number;
  columnCount: number;
};

export const xlsxPreviewMaxRows = 100;

export const xlsxPreviewMaxColumns = 30;

export function XlsxArtifactPreview({ artifact }: { artifact: Artifact }) {
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
  const hasTruncation = activeSheet ? activeSheet.rowCount > xlsxPreviewMaxRows || activeSheet.columnCount > xlsxPreviewMaxColumns : false;

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
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
      ) : null}
      {status === "ready" && activeSheet ? (
        <>
          <div className="max-h-[52vh] max-w-full overflow-auto rounded-md border">
            <Table className="w-max min-w-full">
              <TableBody>
                {activeSheet.rows.map((row, rowIndex) => (
                  <TableRow key={`${activeSheet.name}-${rowIndex}`}>
                    {row.map((cell, columnIndex) =>
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
                      ),
                    )}
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

export function previewCellValue(value: unknown): string {
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

export function columnLabel(index: number) {
  let label = "";
  let current = index + 1;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    current = Math.floor((current - 1) / 26);
  }
  return label;
}
