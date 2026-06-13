import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { Circle, ClipboardCheck, GitPullRequest, Lightbulb, MoreHorizontal, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

type ArtifactRendererProps = {
  fileType: string;
  previewJson?: JsonValue;
  fallbackPreview?: string[];
  className?: string;
  workflowActions?: WorkflowActionContext;
};

type NormalizedTable = {
  columns: string[];
  rows: string[][];
};

type CodePayload = {
  code: string;
  language: string;
};

export type WorkflowApprovalAction = {
  id: string;
  title: string;
  originalText?: string;
  owner: string;
  due: string;
  status: string;
  clientStatus?: "pending";
};

export type WorkflowTaskAction = {
  id: string;
  title: string;
  originalText?: string;
  owner: string;
  source: string;
  status: string;
  clientStatus?: "pending";
};

export type WorkflowIdeaAction = {
  id: string;
  title: string;
  originalText?: string;
  status: string;
  category: string;
  owner: string;
  clientStatus?: "pending";
};

export type WorkflowDecisionAction = {
  id: string;
  title: string;
  originalText?: string;
  owner: string;
  due: string;
  status: string;
  clientStatus?: "pending";
};

export type WorkflowActionContext = {
  approvals?: WorkflowApprovalAction[];
  decisions?: WorkflowDecisionAction[];
  ideas?: WorkflowIdeaAction[];
  tasks?: WorkflowTaskAction[];
  canEdit?: boolean;
  pendingApproval?: boolean;
  pendingTask?: boolean;
  pendingTaskTitle?: string;
  pendingTaskRemovalId?: string;
  activeMode?: "Personal" | "Team" | "Org";
  activeProjectId?: string | null;
  sourceTitle?: string;
  onCreateTask?: (input: {
    mode: "Personal" | "Team" | "Org";
    projectId?: string | null;
    title: string;
    originalText?: string;
    owner?: string;
    source?: string;
  }) => void;
  onCreateApproval?: (input: WorkflowSuggestionInput) => void;
  onCreateDecision?: (input: WorkflowSuggestionInput) => void;
  onCreateIdea?: (input: WorkflowSuggestionInput) => void;
  onToggleApproval?: (id: string) => void;
  onToggleTask?: (id: string) => void;
};

export type WorkflowSuggestionInput = {
  mode: "Personal" | "Team" | "Org";
  projectId?: string | null;
  title: string;
  originalText?: string;
  owner?: string;
  source?: string;
};

type WorkflowActionKind = "approval" | "decision" | "idea" | "task";

type ParsedWorkflowAction = {
  kind: WorkflowActionKind;
  id?: string;
  title: string;
  owner?: string;
  due?: string;
  source?: string;
  status?: string;
};

export function ArtifactRenderer({
  className,
  fallbackPreview = [],
  fileType,
  previewJson,
  workflowActions,
}: ArtifactRendererProps) {
  const normalizedFileType = fileType.trim().toLowerCase();
  const parsedPreview = parsePreviewJson(previewJson);
  const structuredActions = normalizeWorkflowActionPreview(parsedPreview);
  const table = normalizeTablePreview(parsedPreview);
  const code = normalizeCodePreview(parsedPreview, normalizedFileType);
  const markdown = normalizeMarkdownPreview(parsedPreview, normalizedFileType);
  const summaryItems = normalizeSummaryPreview(parsedPreview, fallbackPreview);

  if (structuredActions.length > 0) {
    return <WorkflowActionList actions={structuredActions} className={className} workflowActions={workflowActions} />;
  }

  if (table) {
    return (
      <div className={cn("max-w-full overflow-hidden rounded-md border bg-background", className)}>
        <Table className="w-max min-w-full">
          <TableHeader>
            <TableRow>
              {table.columns.map((column, index) => (
                <TableHead key={`${column}-${index}`} className="min-w-32 bg-muted/70">
                  {column || columnLabel(index)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {table.rows.length ? (
              table.rows.map((row, rowIndex) => (
                <TableRow key={`artifact-row-${rowIndex}`}>
                  {table.columns.map((_column, columnIndex) => (
                    <TableCell key={`artifact-cell-${rowIndex}-${columnIndex}`} className="max-w-72 truncate" title={row[columnIndex] ?? ""}>
                      {row[columnIndex] ?? ""}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell className="h-20 text-center text-muted-foreground" colSpan={table.columns.length}>
                  No preview rows.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    );
  }

  if (code) {
    return <HighlightedCodeBlock className={className} code={code.code} language={code.language} />;
  }

  if (markdown) {
    return <MarkdownArtifact className={className} markdown={markdown} workflowActions={workflowActions} />;
  }

  return (
    <div className={cn("space-y-2 text-sm text-muted-foreground", className)}>
      {summaryItems.length ? (
        summaryItems.map((item) => (
          <div className="rounded-md border bg-background px-3 py-2" key={item}>
            {item}
          </div>
        ))
      ) : (
        <div className="rounded-md border border-dashed bg-background px-3 py-6 text-center">
          No inline preview is available.
        </div>
      )}
    </div>
  );
}

function parsePreviewJson(previewJson: JsonValue | undefined): unknown {
  if (typeof previewJson !== "string") return previewJson;
  try {
    return JSON.parse(previewJson);
  } catch {
    return previewJson;
  }
}

function normalizeMarkdownPreview(value: unknown, fileType: string) {
  const markdown = extractStringField(value, ["markdown", "content", "text", "body"]);
  if (markdown && (fileType === "md" || fileType === "markdown" || looksLikeMarkdown(markdown))) return markdown;
  if (typeof value === "string" && (fileType === "md" || fileType === "markdown" || looksLikeMarkdown(value))) return value;
  return "";
}

function normalizeCodePreview(value: unknown, fileType: string): CodePayload | null {
  const languageFromFileType = codeLanguageFromFileType(fileType);
  if (typeof value === "string" && languageFromFileType) {
    return { code: value, language: languageFromFileType };
  }
  if (!isRecord(value)) return null;
  const code = extractStringField(value, ["code", "source", "snippet"]);
  if (!code) return null;
  const language = extractStringField(value, ["language", "lang"]) || languageFromFileType || "text";
  return { code, language };
}

function normalizeTablePreview(value: unknown): NormalizedTable | null {
  const rowsValue = isRecord(value) ? value.rows ?? value.data : Array.isArray(value) ? value : undefined;
  if (!Array.isArray(rowsValue) || rowsValue.length === 0) return null;

  if (rowsValue.every((row) => isRecord(row))) {
    const explicitColumns = isRecord(value) && Array.isArray(value.columns)
      ? value.columns.map((column) => String(column))
      : [];
    const derivedColumns = Array.from(new Set(rowsValue.flatMap((row) => Object.keys(row as Record<string, unknown>))));
    const columns = explicitColumns.length ? explicitColumns : derivedColumns;
    if (!columns.length) return null;
    return {
      columns,
      rows: rowsValue.map((row) => columns.map((column) => stringifyCell((row as Record<string, unknown>)[column]))),
    };
  }

  if (rowsValue.every((row) => Array.isArray(row))) {
    const rawRows = rowsValue as unknown[][];
    const explicitColumns = isRecord(value) && Array.isArray(value.columns)
      ? value.columns.map((column) => String(column))
      : [];
    const header = explicitColumns.length ? explicitColumns : rawRows[0]?.map((cell, index) => stringifyCell(cell) || columnLabel(index)) ?? [];
    const bodyRows = explicitColumns.length ? rawRows : rawRows.slice(1);
    if (!header.length) return null;
    return {
      columns: header,
      rows: bodyRows.map((row) => header.map((_column, index) => stringifyCell(row[index]))),
    };
  }

  return null;
}

function normalizeSummaryPreview(value: unknown, fallbackPreview: string[]) {
  if (isRecord(value) && Array.isArray(value.preview)) return value.preview.map((item) => stringifyCell(item)).filter(Boolean);
  if (Array.isArray(value) && value.every((item) => !Array.isArray(item) && !isRecord(item))) {
    return value.map((item) => stringifyCell(item)).filter(Boolean);
  }
  if (typeof value === "string" && !looksLikeMarkdown(value)) return [value];
  return fallbackPreview;
}

function normalizeWorkflowActionPreview(value: unknown): ParsedWorkflowAction[] {
  const parsed = typeof value === "string" ? safeParseJson(value) : value;
  if (!parsed) return [];
  return collectWorkflowActionCandidates(parsed)
    .map(normalizeWorkflowAction)
    .filter((action): action is ParsedWorkflowAction => Boolean(action));
}

function collectWorkflowActionCandidates(value: unknown): Array<{ kind: WorkflowActionKind; value: unknown }> {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const itemKind = isRecord(item) ? normalizeWorkflowKind(item.kind ?? item.type ?? item.category ?? item.actionType) : null;
      return itemKind ? [{ kind: itemKind, value: item }] : collectWorkflowActionCandidates(item);
    });
  }
  if (!isRecord(value)) return [];

  const candidates: Array<{ kind: WorkflowActionKind; value: unknown }> = [];
  for (const [key, nestedValue] of Object.entries(value)) {
    const keyKind = normalizeWorkflowKind(key);
    if (keyKind && Array.isArray(nestedValue)) {
      candidates.push(...nestedValue.map((item) => ({ kind: keyKind, value: item })));
      continue;
    }
    if (keyKind && isRecord(nestedValue)) {
      candidates.push({ kind: keyKind, value: nestedValue });
      continue;
    }
    candidates.push(...collectWorkflowActionCandidates(nestedValue));
  }
  return candidates;
}

function normalizeWorkflowAction(candidate: { kind: WorkflowActionKind; value: unknown }): ParsedWorkflowAction | null {
  if (typeof candidate.value === "string") {
    const title = cleanActionTitle(candidate.value);
    if (candidate.kind === "task" && !hasFollowThroughLanguage(title)) return null;
    return title ? { kind: candidate.kind, title } : null;
  }
  if (!isRecord(candidate.value)) return null;
  const title = extractStringField(candidate.value, ["title", "name", "label", "summary", "task", "approval", "decision", "idea"]);
  if (!title) return null;
  const owner = extractStringField(candidate.value, ["owner", "assignee", "assignedTo", "requester"]) || undefined;
  const due = extractStringField(candidate.value, ["due", "dueDate", "deadline"]) || undefined;
  const source = extractStringField(candidate.value, ["source", "sourceChat", "artifact"]) || undefined;
  const status = extractStringField(candidate.value, ["status", "state"]) || undefined;
  if (candidate.kind === "task" && !hasFollowThroughLanguage(title) && !owner && !due && !source && !status) return null;
  return {
    kind: candidate.kind,
    id: extractStringField(candidate.value, ["id", "actionId", "approvalId", "taskId"]) || undefined,
    title,
    owner,
    due,
    source,
    status,
  };
}

function resolveMarkdownWorkflowAction(text: string, workflowActions: WorkflowActionContext | undefined): ParsedWorkflowAction | null {
  const rawText = text.replace(/\s+/g, " ").trim();
  const explicit = rawText.match(/\b(approval|decision|idea|task)\s*[:#]\s*([a-z0-9][\w:-]*)/i);
  if (explicit) {
    const kind = explicit[1].toLowerCase() as WorkflowActionKind;
    return {
      kind,
      id: explicit[2],
      title: cleanActionTitle(rawText.replace(explicit[0], "")) || explicit[2],
    };
  }
  const normalizedText = cleanActionTitle(rawText);
  if (!normalizedText) return null;

  const approval = workflowActions?.approvals?.find((item) => titleMatches(normalizedText, item.originalText ?? item.title));
  if (approval) return { kind: "approval", id: approval.id, title: normalizedText };
  const decision = workflowActions?.decisions?.find((item) => titleMatches(normalizedText, item.originalText ?? item.title));
  if (decision) return { kind: "decision", id: decision.id, title: normalizedText };
  const idea = workflowActions?.ideas?.find((item) => titleMatches(normalizedText, item.originalText ?? item.title));
  if (idea) return { kind: "idea", id: idea.id, title: normalizedText };
  const task = workflowActions?.tasks?.find((item) => titleMatches(normalizedText, item.originalText ?? item.title));
  if (task) return { kind: "task", id: task.id, title: normalizedText };

  if (/\b(approval|approve|sign[- ]?off)\b/i.test(normalizedText)) return { kind: "approval", title: normalizedText };
  if (/\b(decision|decide|choice|blocked row|trade[- ]?off)\b/i.test(normalizedText)) return { kind: "decision", title: normalizedText };
  if (hasIdeaLanguage(normalizedText)) return { kind: "idea", title: normalizedText };
  if (hasFollowThroughLanguage(normalizedText)) return { kind: "task", title: normalizedText };
  return null;
}

function resolveWorkflowAction(action: ParsedWorkflowAction, workflowActions: WorkflowActionContext | undefined) {
  const collection = action.kind === "approval"
    ? workflowActions?.approvals
    : action.kind === "decision"
      ? workflowActions?.decisions
      : action.kind === "idea"
        ? workflowActions?.ideas
        : workflowActions?.tasks;
  const exact = action.id ? collection?.find((item) => item.id === action.id) : undefined;
  const titleMatch = collection?.find((item) => titleMatches(action.title, item.originalText ?? item.title));
  const matched = exact ?? titleMatch;
  return {
    ...action,
    id: matched?.id ?? action.id,
    title: action.title,
    owner: matched?.owner ?? action.owner,
    due: action.kind === "approval" ? (matched as WorkflowApprovalAction | undefined)?.due ?? action.due : action.due,
    source: action.kind === "task" ? (matched as WorkflowTaskAction | undefined)?.source ?? action.source : action.source,
    status: matched?.status ?? action.status,
    clientStatus: matched?.clientStatus,
  };
}

function MarkdownArtifact({
  className,
  markdown,
  workflowActions,
}: {
  className?: string;
  markdown: string;
  workflowActions?: WorkflowActionContext;
}) {
  return (
    <div className={cn("space-y-3 text-sm leading-6", className)} data-rendered-markdown="true">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          a: ({ children, href }) => (
            <a className="font-medium text-primary underline-offset-4 hover:underline" href={href} rel="noreferrer" target="_blank">
              {children}
            </a>
          ),
          blockquote: ({ children }) => <blockquote className="border-l-2 border-border pl-3 text-muted-foreground">{children}</blockquote>,
          code: ({ children, className }) => {
            const language = className?.replace("language-", "") ?? "";
            return language ? (
              <HighlightedCodeBlock code={String(children).replace(/\n$/, "")} language={language} />
            ) : (
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{children}</code>
            );
          },
          h1: ({ children }) => <h3 className="text-base font-semibold text-foreground">{children}</h3>,
          h2: ({ children }) => <h3 className="text-base font-semibold text-foreground">{children}</h3>,
          h3: ({ children }) => <h4 className="text-sm font-semibold text-foreground">{children}</h4>,
          hr: () => <hr className="my-3 border-border" />,
          li: ({ children }) => {
            const action = resolveMarkdownWorkflowAction(textFromReactNode(children), workflowActions);
            return (
              <li className="pl-1">
                {action ? (
                  <InlineWorkflowAction action={action} workflowActions={workflowActions} />
                ) : children}
              </li>
            );
          },
          ol: ({ children }) => <ol className="space-y-1 pl-5 list-decimal">{children}</ol>,
          p: ({ children }) => <p className="whitespace-pre-wrap">{children}</p>,
          pre: ({ children }) => <>{children}</>,
          table: ({ children }) => (
            <div className="max-w-full overflow-x-auto rounded-md border bg-background">
              <Table className="w-max min-w-full text-xs">{children}</Table>
            </div>
          ),
          tbody: ({ children }) => <TableBody>{children}</TableBody>,
          td: ({ children }) => <TableCell className="max-w-80 align-top">{children}</TableCell>,
          th: ({ children }) => <TableHead className="whitespace-nowrap bg-muted/70">{children}</TableHead>,
          thead: ({ children }) => <TableHeader>{children}</TableHeader>,
          tr: ({ children }) => <TableRow>{children}</TableRow>,
          ul: ({ children }) => <ul className="space-y-1 pl-5 list-disc">{children}</ul>,
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

function WorkflowActionList({
  actions,
  className,
  workflowActions,
}: {
  actions: ParsedWorkflowAction[];
  className?: string;
  workflowActions?: WorkflowActionContext;
}) {
  return (
    <div className={cn("space-y-2", className)} data-rendered-workflow-actions="true">
      {actions.map((action, index) => (
        <InlineWorkflowAction
          action={action}
          key={`${action.kind}-${action.id ?? action.title}-${index}`}
          workflowActions={workflowActions}
        />
      ))}
    </div>
  );
}

function InlineWorkflowAction({
  action,
  workflowActions,
}: {
  action: ParsedWorkflowAction;
  workflowActions?: WorkflowActionContext;
}) {
  const resolved = resolveWorkflowAction(action, workflowActions);
  const isTask = resolved.kind === "task";
  const isPending = Boolean(
    resolved.clientStatus === "pending"
    || (isTask && workflowActions?.pendingTaskTitle && titleMatches(workflowActions.pendingTaskTitle, resolved.title))
    || (isTask && resolved.id && workflowActions?.pendingTaskRemovalId === resolved.id),
  );
  const canCreate = Boolean(workflowActions?.canEdit && !resolved.id && workflowActions?.activeMode && createHandlerForKind(resolved.kind, workflowActions));
  const CreatedIcon = iconForWorkflowKind(resolved.kind);

  return (
    <>
      <span>{resolved.title}</span>{" "}
      {resolved.id ? (
        <CreatedIcon className="inline size-3.5 align-[-2px] text-primary" aria-label={`${workflowKindLabel(resolved.kind)} created`} />
      ) : (
        <InlineActionMenu
          action={resolved}
          canCreate={canCreate}
          isPending={isPending}
          workflowActions={workflowActions}
        />
      )}
    </>
  );
}

function InlineActionMenu({
  action,
  canCreate,
  isPending,
  workflowActions,
}: {
  action: ParsedWorkflowAction;
  canCreate: boolean;
  isPending: boolean;
  workflowActions?: WorkflowActionContext;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (menuRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  if (!canCreate) return null;

  const Icon = iconForWorkflowKind(action.kind);
  const label = workflowKindLabel(action.kind);

  return (
    <span className="relative inline-block align-[-3px]" ref={menuRef}>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
        disabled={isPending}
        title="Actions"
        aria-label={`Actions for ${action.title}`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreHorizontal className="size-3.5" />
      </Button>
      {open ? (
        <span className="absolute left-0 top-6 z-[9999] min-w-40 rounded-md border bg-popover p-1 text-popover-foreground shadow-xl">
          {canCreate ? (
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground"
              onClick={() => {
                setOpen(false);
                createHandlerForKind(action.kind, workflowActions)?.({
                  mode: workflowActions?.activeMode ?? "Personal",
                  projectId: workflowActions?.activeProjectId ?? null,
                  title: action.title,
                  originalText: action.title,
                  owner: action.owner,
                  source: action.source ?? workflowActions?.sourceTitle ?? "VertexAI suggestion",
                });
              }}
            >
              <Icon className="size-3.5" />
              Add {label}
            </button>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

function createHandlerForKind(kind: WorkflowActionKind, workflowActions: WorkflowActionContext | undefined) {
  if (kind === "approval") return workflowActions?.onCreateApproval;
  if (kind === "decision") return workflowActions?.onCreateDecision;
  if (kind === "idea") return workflowActions?.onCreateIdea;
  return workflowActions?.onCreateTask;
}

function iconForWorkflowKind(kind: WorkflowActionKind) {
  if (kind === "approval") return ShieldCheck;
  if (kind === "decision") return GitPullRequest;
  if (kind === "idea") return Lightbulb;
  return Circle;
}

function workflowKindLabel(kind: WorkflowActionKind) {
  if (kind === "approval") return "Approval";
  if (kind === "decision") return "Decision";
  if (kind === "idea") return "Idea";
  return "Task";
}

function HighlightedCodeBlock({ className, code, language }: { className?: string; code: string; language: string }) {
  return (
    <div className={cn("overflow-hidden rounded-md border bg-foreground text-background", className)}>
      <div className="border-b border-background/10 px-3 py-2 text-xs font-medium uppercase text-background/70">
        {language || "text"}
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed">
        <code>{highlightCode(code, language)}</code>
      </pre>
    </div>
  );
}

function highlightCode(code: string, language: string) {
  const pattern = keywordPattern(language);
  if (!pattern) return code;
  const parts = code.split(pattern);
  return parts.map((part, index) =>
    part.match(pattern)
      ? <span className="font-semibold text-accent" key={`${part}-${index}`}>{part}</span>
      : part,
  );
}

function keywordPattern(language: string) {
  if (/^(ts|tsx|js|jsx|javascript|typescript)$/.test(language)) {
    return /\b(const|let|var|function|return|if|else|for|while|import|export|from|type|interface|async|await|class|extends|new)\b/g;
  }
  if (/^(json)$/.test(language)) return /"[^"]+"\s*:/g;
  if (/^(sql)$/.test(language)) return /\b(SELECT|FROM|WHERE|INSERT|UPDATE|DELETE|CREATE|TABLE|JOIN|LEFT|RIGHT|ORDER|GROUP|BY|VALUES)\b/gi;
  if (/^(css)$/.test(language)) return /[.#]?[a-zA-Z-]+(?=\s*\{)|[a-zA-Z-]+(?=\s*:)/g;
  return null;
}

function codeLanguageFromFileType(fileType: string) {
  const normalized = fileType.replace(/^\./, "");
  if (["js", "jsx", "ts", "tsx", "json", "sql", "css", "html", "py", "mdx"].includes(normalized)) return normalized;
  return "";
}

function looksLikeMarkdown(text: string) {
  return [
    /^#{1,6}\s+/m,
    /^\s*[-*+]\s+/m,
    /^\s*\d+\.\s+/m,
    /```[\s\S]*?```/,
    /`[^`]+`/,
    /\*\*[^*]+\*\*/,
    /\[[^\]]+\]\([^)]+\)/,
    /^\|.+\|$/m,
  ].some((pattern) => pattern.test(text));
}

function extractStringField(value: unknown, keys: string[]) {
  if (!isRecord(value)) return "";
  for (const key of keys) {
    if (typeof value[key] === "string" && value[key].trim()) return value[key].trim();
  }
  return "";
}

function normalizeWorkflowKind(value: unknown): WorkflowActionKind | null {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase().replace(/[^a-z]/g, "");
  if (["approval", "approvals", "pendingapproval", "pendingapprovals"].includes(normalized)) return "approval";
  if (["decision", "decisions"].includes(normalized)) return "decision";
  if ([
    "idea",
    "ideas",
    "suggestedidea",
    "suggestedideas",
    "potentialidea",
    "potentialideas",
    "opportunity",
    "opportunities",
    "proposal",
    "proposals",
    "concept",
    "concepts",
    "pilot",
    "pilots",
    "experiment",
    "experiments",
    "suggestion",
    "suggestions",
    "improvement",
    "improvements",
    "enhancement",
    "enhancements",
    "innovation",
    "innovations",
  ].includes(normalized)) return "idea";
  if (["task", "tasks", "assignedtask", "assignedtasks", "todo", "todos"].includes(normalized)) return "task";
  return null;
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function titleMatches(left: string, right: string) {
  const normalizedLeft = normalizeActionText(left);
  const normalizedRight = normalizeActionText(right);
  return normalizedLeft === normalizedRight || normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft);
}

function cleanActionTitle(value: string) {
  return value
    .replace(/\b(?:approval|decision|idea|task)\s*[:#]\s*[a-z0-9][\w:-]*/gi, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s:;-]+|[\s:;-]+$/g, "")
    .trim();
}

function hasIdeaLanguage(value: string) {
  return /\b(idea|opportunit(?:y|ies)|proposal|concept|pilot|experiment|suggestion|improvement|enhancement|innovation|streamline|automate|optimi[sz]e)\b/i.test(value);
}

function hasFollowThroughLanguage(value: string) {
  return /\b(task|todo|to do|follow[- ]?up|action item|next step|assign(?:ed)? to|owner\s*:|due\s*:|deadline|needs follow[- ]?up|requires follow[- ]?through|send|schedule|update|prepare|confirm|publish|deliver|resolve)\b/i.test(value);
}

function normalizeActionText(value: string) {
  return cleanActionTitle(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function textFromReactNode(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textFromReactNode).join(" ");
  if (isRecord(node) && isRecord(node.props)) return textFromReactNode(node.props.children);
  return "";
}

function stringifyCell(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function columnLabel(index: number) {
  let label = "";
  let current = index + 1;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    current = Math.floor((current - 1) / 26);
  }
  return label;
}
