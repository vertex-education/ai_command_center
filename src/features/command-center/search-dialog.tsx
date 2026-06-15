import { useEffect, useMemo, useRef, type ComponentType } from "react";
import {
  Archive,
  CheckCircle2,
  ClipboardList,
  FileText,
  Folder,
  Lightbulb,
  Loader2,
  MessageCircle,
  Search,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ScopedKnowledgeSearchResponse, ScopedKnowledgeSearchResult } from "@/lib/scoped-knowledge-search";

export type WorkspaceSearchLocalResultKind = "Project" | "Chat" | "Idea" | "Artifact" | "Decision" | "Approval" | "Task" | "Risk";

export type WorkspaceSearchLocalResult = {
  description: string;
  id: string;
  kind: WorkspaceSearchLocalResultKind;
  meta: string;
  score: number;
  title: string;
  onSelect: () => void;
};

const localKindIcons: Record<WorkspaceSearchLocalResultKind, ComponentType<{ className?: string }>> = {
  Approval: ShieldCheck,
  Artifact: Archive,
  Chat: MessageCircle,
  Decision: ClipboardList,
  Idea: Lightbulb,
  Project: Folder,
  Risk: TriangleAlert,
  Task: CheckCircle2,
};

type UnifiedSearchResult = {
  description: string;
  icon: ComponentType<{ className?: string }>;
  id: string;
  meta: string;
  restricted: boolean;
  score: number | null;
  sourceLabel: string;
  title: string;
  typeLabel: string;
  onSelect: () => void;
};

const semanticSourceLabels: Record<ScopedKnowledgeSearchResult["sourceType"], string> = {
  asana: "Asana",
  chat: "Chat",
  r2: "R2",
  rag: "RAG",
  upload: "Upload",
  workspace: "Workspace",
};

export function WorkspaceSearchDialog({
  localResults,
  open,
  projectNameById,
  query,
  semanticError,
  semanticPending,
  semanticSearch,
  scopeLabel,
  onOpenChange,
  onQueryChange,
  onSelectSemanticResult,
}: {
  localResults: WorkspaceSearchLocalResult[];
  open: boolean;
  projectNameById: Record<string, string>;
  query: string;
  semanticError?: string | null;
  semanticPending: boolean;
  semanticSearch?: ScopedKnowledgeSearchResponse;
  scopeLabel: string;
  onOpenChange: (open: boolean) => void;
  onQueryChange: (value: string) => void;
  onSelectSemanticResult: (result: ScopedKnowledgeSearchResult) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const normalizedQuery = query.trim();
  const semanticResults = semanticSearch?.results ?? [];
  const issues = semanticSearch?.diagnostics.issues ?? [];
  const hasSearchableQuery = normalizedQuery.length >= 2;
  const localCount = hasSearchableQuery ? localResults.length : 0;
  const semanticCount = hasSearchableQuery ? semanticResults.length : 0;
  const unifiedResults = useMemo<UnifiedSearchResult[]>(() => {
    if (!hasSearchableQuery) return [];

    const localMatches = localResults.map((result) => ({
      description: result.description,
      icon: localKindIcons[result.kind],
      id: `workspace-${result.kind}-${result.id}`,
      meta: result.meta,
      restricted: false,
      score: result.score,
      sourceLabel: "Workspace" as const,
      title: result.title,
      typeLabel: result.kind,
      onSelect: result.onSelect,
    }));
    const semanticMatches = semanticResults.map((result) => ({
      description: result.excerpt,
      icon: Sparkles,
      id: `rag-${result.id}`,
      meta: `${projectNameById[result.projectId] ?? "Project"} / ${result.r2Key}`,
      restricted: result.sensitivityLabel === "Confidential" || result.restricted,
      score: result.score === null ? null : Math.round(result.score * 100),
      sourceLabel: semanticSourceLabels[result.sourceType] ?? "RAG",
      title: result.documentName,
      typeLabel: result.itemType
        .split("_")
        .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
        .join(" "),
      onSelect: () => onSelectSemanticResult(result),
    }));

    return [...localMatches, ...semanticMatches]
      .sort((left, right) => {
        const leftScore = left.score ?? -1;
        const rightScore = right.score ?? -1;
        if (leftScore === rightScore) return left.title.localeCompare(right.title);
        return rightScore - leftScore;
      })
      .slice(0, 20);
  }, [hasSearchableQuery, localResults, onSelectSemanticResult, projectNameById, semanticResults]);
  const statusLabel = useMemo(() => {
    if (!hasSearchableQuery) return "Ready";
    if (semanticPending) return "Searching";
    if (semanticError) return "Needs attention";
    return `${localCount + semanticCount} results`;
  }, [hasSearchableQuery, localCount, semanticCount, semanticError, semanticPending]);

  useEffect(() => {
    if (!open) return;
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-[min(1120px,calc(100vw-32px))] overflow-hidden p-0">
        <DialogHeader className="border-b px-5 py-4">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 pr-8">
            <div className="min-w-0">
              <DialogTitle>Search Workspace</DialogTitle>
              <DialogDescription>{scopeLabel}</DialogDescription>
            </div>
            <Badge variant={semanticError ? "destructive" : semanticPending ? "secondary" : "outline"}>{statusLabel}</Badge>
          </div>
          <label className="mt-4 flex h-10 min-w-0 items-center gap-2 rounded-md border bg-background px-3 text-muted-foreground">
            <Search className="size-4" />
            <Input
              ref={inputRef}
              className="h-8 border-0 px-0 shadow-none focus-visible:ring-0"
              placeholder="Search projects, artifacts, risks, and indexed knowledge"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
            />
          </label>
        </DialogHeader>

        <div className="max-h-[72vh] min-h-[420px] overflow-hidden">
          <section className="min-h-0 max-h-[72vh] overflow-auto p-4">
            <SearchSectionHeader
              count={hasSearchableQuery ? unifiedResults.length : 0}
              title="Results"
              summary={hasSearchableQuery ? `${localCount} workspace / ${semanticCount} RAG` : undefined}
            />
            {!hasSearchableQuery ? <EmptySearchState /> : null}
            {hasSearchableQuery && semanticPending ? (
              <div className="mb-3 grid min-h-16 place-items-center rounded-md border border-dashed bg-background text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" />
                  Searching indexed knowledge
                </span>
              </div>
            ) : null}
            {hasSearchableQuery && semanticError ? (
              <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {semanticError}
              </div>
            ) : null}
            {hasSearchableQuery && !semanticPending && !semanticError && unifiedResults.length === 0 ? (
              <EmptyResults label="No matches in this scope." />
            ) : null}
            <div className="space-y-2">
              {unifiedResults.map((result) => (
                <UnifiedSearchResultButton key={result.id} result={result} />
              ))}
            </div>
            {issues.length ? (
              <div className="mt-3 space-y-1 rounded-md border bg-background p-3 text-xs leading-5 text-muted-foreground">
                {issues.map((issue) => (
                  <p key={issue}>{issue}</p>
                ))}
              </div>
            ) : null}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SearchSectionHeader({ count, summary, title }: { count: number; summary?: string; title: string }) {
  return (
    <div className="mb-3 flex min-w-0 items-center justify-between gap-2">
      <div className="min-w-0">
        <h3 className="truncate text-sm font-semibold">{title}</h3>
        {summary ? <p className="truncate text-xs text-muted-foreground">{summary}</p> : null}
      </div>
      <Badge variant="secondary">{count}</Badge>
    </div>
  );
}

function EmptySearchState() {
  return (
    <div className="grid min-h-44 place-items-center rounded-md border border-dashed bg-background text-center text-sm text-muted-foreground">
      Enter at least 2 characters.
    </div>
  );
}

function EmptyResults({ label }: { label: string }) {
  return (
    <div className="grid min-h-32 place-items-center rounded-md border border-dashed bg-background text-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}

function UnifiedSearchResultButton({ result }: { result: UnifiedSearchResult }) {
  const Icon = result.icon;
  return (
    <button
      type="button"
      className="grid w-full grid-cols-[34px_minmax(0,1fr)_auto] gap-3 rounded-md border bg-background p-3 text-left shadow-xs transition-colors hover:border-primary/40 hover:bg-accent/30"
      onClick={result.onSelect}
    >
      <span
        className={
          result.sourceLabel === "RAG"
            ? "grid size-8 place-items-center rounded-md bg-primary text-primary-foreground"
            : "grid size-8 place-items-center rounded-md bg-primary/10 text-primary"
        }
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <strong className="truncate text-sm">{result.title}</strong>
          <Badge variant="outline" className="rounded-md">
            {result.sourceLabel}
          </Badge>
          <Badge variant="outline" className="rounded-md">
            {result.typeLabel}
          </Badge>
          {result.restricted ? (
            <Badge variant="destructive" className="rounded-md">
              Restricted
            </Badge>
          ) : null}
        </span>
        <span className="mt-1 line-clamp-3 text-xs leading-5 text-muted-foreground">{result.description}</span>
        <span className="mt-2 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <FileText className="size-3.5 shrink-0" />
          <span className="truncate">{result.meta}</span>
        </span>
      </span>
      <span className="rounded-md border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
        {formatScore(result.score)}
      </span>
    </button>
  );
}

function formatScore(score: number | null) {
  if (score === null) return "n/a";
  return String(score);
}
