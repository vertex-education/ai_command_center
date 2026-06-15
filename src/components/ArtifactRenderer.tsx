import { useEffect, useRef, useState, type ReactNode } from "react";
import "katex/dist/katex.min.css";
import Prism, { type Token, type TokenStream } from "prismjs";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-css";
import "prismjs/components/prism-json";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-python";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-yaml";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { Circle, ClipboardCheck, GitPullRequest, Lightbulb, MoreHorizontal, ShieldAlert, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { riskFlagSchema } from "@/lib/risk-contract";
import { riskManagementHref, workspaceScopeFromId } from "@/lib/risk-feature";
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
  caption?: string;
};

type CodePayload = {
  code: string;
  language: string;
};

type NormalizedColumn = {
  key: string;
  label: string;
};

type TableCandidate = {
  value: unknown;
  caption?: string;
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
  preferredSuggestionKind?: WorkflowActionKind;
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

export type WorkflowActionKind = "approval" | "decision" | "idea" | "task";

export type RiskFlagSeverity = "low" | "medium" | "high" | "critical";

export type RiskFlagPreview = {
  id?: string;
  workspaceId: string;
  projectId: string;
  title: string;
  description: string;
  severity: RiskFlagSeverity;
  status: string;
  mitigationStrategy: string;
};

export type ParsedWorkflowAction = {
  kind: WorkflowActionKind;
  id?: string;
  title: string;
  owner?: string;
  due?: string;
  source?: string;
  status?: string;
};

export function ArtifactRenderer({ className, fallbackPreview = [], fileType, previewJson, workflowActions }: ArtifactRendererProps) {
  const normalizedFileType = fileType.trim().toLowerCase();
  const parsedPreview = parsePreviewJson(previewJson);
  const riskFlags = normalizeRiskFlagPreview(parsedPreview);
  const structuredActions = normalizeWorkflowActionPreview(parsedPreview);
  const table = normalizeTablePreview(parsedPreview);
  const code = normalizeCodePreview(parsedPreview, normalizedFileType);
  const markdown = normalizeMarkdownPreview(parsedPreview, normalizedFileType);
  const summaryItems = normalizeSummaryPreview(parsedPreview, fallbackPreview);

  if (riskFlags.length > 0) {
    return <RiskFlagList className={className} riskFlags={riskFlags} />;
  }

  if (structuredActions.length > 0) {
    return <WorkflowActionList actions={structuredActions} className={className} workflowActions={workflowActions} />;
  }

  if (table) {
    return <StructuredTableArtifact className={className} table={table} />;
  }

  if (markdown) {
    return <MarkdownArtifact className={className} markdown={markdown} workflowActions={workflowActions} />;
  }

  if (code) {
    return <HighlightedCodeBlock className={className} code={code.code} language={code.language} />;
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
        <div className="rounded-md border border-dashed bg-background px-3 py-6 text-center">No inline preview is available.</div>
      )}
    </div>
  );
}

export function parsePreviewJson(previewJson: JsonValue | undefined): unknown {
  if (typeof previewJson !== "string") return previewJson;
  try {
    return JSON.parse(previewJson);
  } catch {
    return previewJson;
  }
}

export function hasRiskFlagSchema(value: unknown): boolean {
  return normalizeRiskFlagPreview(value).length > 0;
}

export function normalizeRiskFlagPreview(value: unknown): RiskFlagPreview[] {
  const parsed = typeof value === "string" ? safeParseJson(value) : value;
  if (!parsed) return [];
  return collectRiskFlagCandidates(parsed)
    .map(normalizeRiskFlag)
    .filter((riskFlag): riskFlag is RiskFlagPreview => Boolean(riskFlag));
}

export function extractRiskFlagBlocksFromMarkdown(markdown: string) {
  const riskFlags: RiskFlagPreview[] = [];
  const cleanedMarkdown = markdown
    .replace(/```(?:json)?\s*([\s\S]*?)```/gi, (match, body: string) => {
      const blockRiskFlags = normalizeRiskFlagPreview(body.trim());
      if (!blockRiskFlags.length) return match;
      riskFlags.push(...blockRiskFlags);
      return "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { markdown: cleanedMarkdown, riskFlags };
}

function collectRiskFlagCandidates(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(collectRiskFlagCandidates);
  if (!isRecord(value)) return [];
  if (isRiskFlagEnvelope(value)) return [value];
  return Object.values(value).flatMap(collectRiskFlagCandidates);
}

function isRiskFlagEnvelope(value: Record<string, unknown>) {
  return extractStringField(value, ["schema", "$schema"]).toLowerCase() === riskFlagSchema;
}

function normalizeRiskFlag(value: unknown): RiskFlagPreview | null {
  if (!isRecord(value) || !isRiskFlagEnvelope(value)) return null;
  const record = isRecord(value.risk) ? value.risk : value;
  const title = extractStringField(record, ["title", "name", "label"]);
  const description = extractStringField(record, ["description", "summary", "body"]);
  if (!title || !description) return null;

  return {
    id: extractStringField(record, ["id", "risk_id", "riskId"]) || undefined,
    workspaceId: extractStringField(record, ["workspace_id", "workspaceId"]),
    projectId: extractStringField(record, ["project_id", "projectId"]),
    title,
    description,
    severity: normalizeRiskFlagSeverity(record.severity),
    status: extractStringField(record, ["status", "state"]) || "open",
    mitigationStrategy: extractStringField(record, ["mitigation_strategy", "mitigationStrategy", "mitigation"]) || "",
  };
}

function normalizeRiskFlagSeverity(value: unknown): RiskFlagSeverity {
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    if (normalized === "low" || normalized === "medium" || normalized === "high" || normalized === "critical") return normalized;
  }
  return "medium";
}

export function normalizeMarkdownPreview(value: unknown, fileType: string) {
  const markdown = extractStringField(value, ["markdown", "previewMarkdown"]);
  if (markdown) return normalizeMarkdownText(markdown);
  const documentText = extractStringField(value, ["content", "text", "body", "documentText", "extractedText"]);
  if (documentText && (isDocumentFileType(fileType) || looksLikeMarkdown(documentText))) return normalizeMarkdownText(documentText);
  if (typeof value === "string" && (isDocumentFileType(fileType) || looksLikeMarkdown(value))) return normalizeMarkdownText(value);
  return "";
}

function normalizeMarkdownText(markdown: string) {
  return transformUnprotectedMarkdownSegments(markdown, normalizeLooseLatexSymbols);
}

function transformUnprotectedMarkdownSegments(markdown: string, transform: (segment: string) => string) {
  const protectedRanges = collectProtectedMarkdownRanges(markdown);
  if (!protectedRanges.length) return transform(markdown);

  let cursor = 0;
  let output = "";
  for (const range of protectedRanges) {
    output += transform(markdown.slice(cursor, range.start));
    output += markdown.slice(range.start, range.end);
    cursor = range.end;
  }
  output += transform(markdown.slice(cursor));
  return output;
}

function collectProtectedMarkdownRanges(markdown: string) {
  const ranges: Array<{ start: number; end: number }> = [];
  addProtectedRanges(ranges, markdown, /(^|\n)(```|~~~)[^\n]*(?:\n[\s\S]*?\n\2(?=\n|$)|[\s\S]*$)/g);
  addProtectedRanges(ranges, markdown, /`+[^`\n]*`+/g);
  addProtectedRanges(ranges, markdown, /\$\$[\s\S]*?\$\$|\$[^$\n]+\$/g);
  return mergeRanges(ranges);
}

function addProtectedRanges(ranges: Array<{ start: number; end: number }>, markdown: string, pattern: RegExp) {
  for (const match of markdown.matchAll(pattern)) {
    if (match.index === undefined) continue;
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }
}

function mergeRanges(ranges: Array<{ start: number; end: number }>) {
  const sortedRanges = [...ranges].sort((left, right) => left.start - right.start || left.end - right.end);
  const mergedRanges: Array<{ start: number; end: number }> = [];
  for (const range of sortedRanges) {
    const previous = mergedRanges.at(-1);
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
      continue;
    }
    mergedRanges.push({ ...range });
  }
  return mergedRanges;
}

function normalizeLooseLatexSymbols(markdown: string) {
  return normalizeArrowSpacing(
    collapseRepeatedArrows(
      markdown.replace(
        /(?:\s*[\u2190\u2192\u2194\u21d0\u21d2\u21d4\u27f5\u27f6\u27f7]\s*)?\\+([A-Za-z]+)(?![A-Za-z])(?:\s*[\u2190\u2192\u2194\u21d0\u21d2\u21d4\u27f5\u27f6\u27f7]\s*)?/g,
        (match, token: string) => {
          const replacement = looseLatexSymbolReplacements[token];
          return replacement ? ` ${replacement} ` : match;
        },
      ),
    ),
  );
}

function collapseRepeatedArrows(markdown: string) {
  return markdown.replace(
    /\s*([\u2190\u2192\u2194\u21d0\u21d2\u21d4\u27f5\u27f6\u27f7])(?:\s*[\u2190\u2192\u2194\u21d0\u21d2\u21d4\u27f5\u27f6\u27f7])+\s*/g,
    " $1 ",
  );
}

function normalizeArrowSpacing(markdown: string) {
  return markdown.replace(/[^\S\r\n]*([\u2190\u2192\u2194\u21d0\u21d2\u21d4\u27f5\u27f6\u27f7])[^\S\r\n]*/g, " $1 ");
}

const looseLatexSymbolReplacements: Record<string, string> = {
  Leftarrow: "\u21D0",
  Leftrightarrow: "\u21D4",
  Rightarrow: "\u21D2",
  leftarrow: "\u2190",
  leftrightarrow: "\u2194",
  longleftarrow: "\u27F5",
  longleftrightarrow: "\u27F7",
  longrightarrow: "\u27F6",
  rightarrow: "\u2192",
  to: "\u2192",
};

function hasMarkdownPayload(value: Record<string, unknown>) {
  return Boolean(extractStringField(value, ["markdown", "previewMarkdown"]));
}

export function normalizeCodePreview(value: unknown, fileType: string): CodePayload | null {
  const languageFromFileType = codeLanguageFromFileType(fileType);
  if (typeof value === "string" && languageFromFileType) {
    return { code: value, language: languageFromFileType };
  }
  if (languageFromFileType && Array.isArray(value)) {
    return { code: JSON.stringify(value, null, 2), language: languageFromFileType };
  }
  if (!isRecord(value)) return null;
  if (hasMarkdownPayload(value)) return null;
  const fileName = extractStringField(value, ["fileName", "filename", "path", "name"]);
  const languageFromFileName = codeLanguageFromFileType(fileExtension(fileName));
  const language = normalizeCodeLanguage(
    extractStringField(value, ["language", "lang", "syntax"]) || languageFromFileName || languageFromFileType,
  );
  const code =
    extractStringField(value, ["code", "source", "snippet"]) || (language ? extractStringField(value, ["content", "text", "body"]) : "");
  if (code) return { code, language: language || "text" };
  if (languageFromFileType) {
    return { code: JSON.stringify(value, null, 2), language: languageFromFileType };
  }
  return null;
}

export function normalizeTablePreview(value: unknown): NormalizedTable | null {
  for (const candidate of collectTableCandidates(value)) {
    const normalized = normalizeTableCandidate(candidate);
    if (normalized) return normalized;
  }
  return null;
}

export function normalizeSummaryPreview(value: unknown, fallbackPreview: string[]) {
  if (isRecord(value) && Array.isArray(value.preview)) return value.preview.map((item) => stringifyCell(item)).filter(Boolean);
  if (Array.isArray(value) && value.every((item) => !Array.isArray(item) && !isRecord(item))) {
    return value.map((item) => stringifyCell(item)).filter(Boolean);
  }
  if (typeof value === "string" && !looksLikeMarkdown(value)) return [value];
  return fallbackPreview;
}

function collectTableCandidates(value: unknown): TableCandidate[] {
  const candidates: TableCandidate[] = [{ value }];
  if (!isRecord(value)) return candidates;

  for (const key of ["table", "dataTable", "tabularData", "extractedTable", "structuredTable", "spreadsheet"]) {
    if (value[key] !== undefined) candidates.push({ value: value[key], caption: titleCase(key) });
  }

  for (const key of ["tables", "extractedTables", "visionTables", "sheets", "worksheets"]) {
    const nested = value[key];
    if (!Array.isArray(nested)) continue;
    candidates.push(
      ...nested.map((item, index) => ({
        value: item,
        caption: tableCaptionFromValue(item) || `${titleCase(key.replace(/s$/, ""))} ${index + 1}`,
      })),
    );
  }

  return candidates;
}

function normalizeTableCandidate(candidate: TableCandidate): NormalizedTable | null {
  const value = candidate.value;
  const caption = tableCaptionFromValue(value) || candidate.caption;
  if (Array.isArray(value)) return normalizeRowsTable(value, [], caption);
  if (!isRecord(value)) return null;

  const cellTable = normalizeCellGridTable(value, caption);
  if (cellTable) return cellTable;

  const fieldTable = normalizeFieldTable(value, caption);
  if (fieldTable) return fieldTable;

  const explicitColumns = normalizeExplicitColumns(value.columns ?? value.headers);
  const rowsValue = firstArrayField(value, ["rows", "data", "records", "items", "results", "values"]);
  if (rowsValue) return normalizeRowsTable(rowsValue, explicitColumns, caption);
  if (explicitColumns.length) return { columns: explicitColumns.map((column) => column.label), rows: [], ...(caption ? { caption } : {}) };
  return null;
}

function normalizeRowsTable(rowsValue: unknown[], explicitColumns: NormalizedColumn[], caption?: string): NormalizedTable | null {
  if (rowsValue.length === 0) {
    return explicitColumns.length
      ? { columns: explicitColumns.map((column) => column.label), rows: [], ...(caption ? { caption } : {}) }
      : null;
  }

  if (rowsValue.every((row) => isRecord(row))) {
    const derivedColumns = Array.from(new Set(rowsValue.flatMap((row) => Object.keys(row as Record<string, unknown>))));
    const columns = explicitColumns.length ? explicitColumns : derivedColumns.map((column) => ({ key: column, label: column }));
    if (!columns.length) return null;
    return {
      columns: columns.map((column) => column.label),
      rows: rowsValue.map((row) => columns.map((column) => stringifyCell((row as Record<string, unknown>)[column.key]))),
      ...(caption ? { caption } : {}),
    };
  }

  if (rowsValue.every((row) => Array.isArray(row))) {
    const rawRows = rowsValue as unknown[][];
    const header = explicitColumns.length
      ? explicitColumns.map((column) => column.label)
      : (rawRows[0]?.map((cell, index) => stringifyCell(cell) || columnLabel(index)) ?? []);
    const bodyRows = explicitColumns.length ? rawRows : rawRows.slice(1);
    if (!header.length) return null;
    return {
      columns: header,
      rows: bodyRows.map((row) => header.map((_column, index) => stringifyCell(row[index]))),
      ...(caption ? { caption } : {}),
    };
  }

  return null;
}

function normalizeCellGridTable(value: Record<string, unknown>, caption?: string): NormalizedTable | null {
  const cells = firstArrayField(value, ["cells", "tableCells", "ocrCells"]);
  if (!cells || !cells.every((cell) => isRecord(cell))) return null;

  const rowIndexes = cells.map((cell) => numericField(cell as Record<string, unknown>, ["rowIndex", "row", "r"])).filter(isFiniteNumber);
  const columnIndexes = cells
    .map((cell) => numericField(cell as Record<string, unknown>, ["columnIndex", "column", "colIndex", "col", "c"]))
    .filter(isFiniteNumber);
  if (!rowIndexes.length || !columnIndexes.length) return null;

  const rowOffset = Math.min(...rowIndexes) === 1 ? 1 : 0;
  const columnOffset = Math.min(...columnIndexes) === 1 ? 1 : 0;
  const explicitColumns = normalizeExplicitColumns(value.columns ?? value.headers);
  const rowCount = Math.max(numericField(value, ["rowCount", "rows"]) ?? 0, ...rowIndexes.map((index) => index - rowOffset + 1));
  const columnCount = Math.max(
    numericField(value, ["columnCount", "columns"]) ?? explicitColumns.length,
    ...columnIndexes.map((index) => index - columnOffset + 1),
  );
  if (rowCount <= 0 || columnCount <= 0) return null;

  const grid = Array.from({ length: rowCount }, () => Array.from({ length: columnCount }, () => ""));
  for (const cell of cells) {
    const record = cell as Record<string, unknown>;
    const rowIndex = numericField(record, ["rowIndex", "row", "r"]);
    const columnIndex = numericField(record, ["columnIndex", "column", "colIndex", "col", "c"]);
    if (!isFiniteNumber(rowIndex) || !isFiniteNumber(columnIndex)) continue;
    const normalizedRow = rowIndex - rowOffset;
    const normalizedColumn = columnIndex - columnOffset;
    if (!grid[normalizedRow] || grid[normalizedRow][normalizedColumn] === undefined) continue;
    grid[normalizedRow][normalizedColumn] = stringifyCell(record.text ?? record.value ?? record.content ?? record.rawText ?? "");
  }

  const columns = explicitColumns.length
    ? explicitColumns.map((column) => column.label)
    : (grid[0]?.map((cell, index) => cell || columnLabel(index)) ?? []);
  const rows = explicitColumns.length ? grid : grid.slice(1);
  return { columns, rows: rows.map((row) => columns.map((_column, index) => row[index] ?? "")), ...(caption ? { caption } : {}) };
}

function normalizeFieldTable(value: Record<string, unknown>, caption?: string): NormalizedTable | null {
  const fieldsValue = value.fields ?? value.keyValues ?? value.keyValuePairs ?? value.extractedFields;
  if (Array.isArray(fieldsValue)) return normalizeRowsTable(fieldsValue, [], caption);
  if (!fieldsValue) return null;
  if (!isRecord(fieldsValue)) return null;
  const rows = Object.entries(fieldsValue).map(([key, fieldValue]) => [titleCase(key), stringifyCell(fieldValue)]);
  return rows.length ? { columns: ["Field", "Value"], rows, ...(caption ? { caption } : {}) } : null;
}

function normalizeExplicitColumns(value: unknown): NormalizedColumn[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((column, index) => normalizeExplicitColumn(column, index))
    .filter((column): column is NormalizedColumn => Boolean(column));
}

function normalizeExplicitColumn(value: unknown, index: number): NormalizedColumn | null {
  if (typeof value === "string" || typeof value === "number") {
    const label = String(value);
    return { key: label, label };
  }
  if (!isRecord(value)) return null;
  const key = extractStringField(value, ["key", "field", "id", "accessorKey", "name", "label", "header"]) || columnLabel(index);
  const label = extractStringField(value, ["label", "header", "title", "name", "key", "field", "id"]) || key;
  return { key, label };
}

function firstArrayField(value: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (Array.isArray(value[key])) return value[key] as unknown[];
  }
  return null;
}

function tableCaptionFromValue(value: unknown) {
  if (!isRecord(value)) return "";
  return extractStringField(value, ["caption", "title", "name", "sheetName", "label"]);
}

export function normalizeWorkflowActionPreview(value: unknown): ParsedWorkflowAction[] {
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

export function resolveMarkdownWorkflowAction(
  text: string,
  workflowActions: WorkflowActionContext | undefined,
): ParsedWorkflowAction | null {
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
  if (workflowActions?.preferredSuggestionKind === "idea" && isSuggestionSizedText(normalizedText)) {
    return { kind: "idea", title: normalizedText };
  }
  return null;
}

function resolveWorkflowAction(action: ParsedWorkflowAction, workflowActions: WorkflowActionContext | undefined) {
  const collection =
    action.kind === "approval"
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
    due: action.kind === "approval" ? ((matched as WorkflowApprovalAction | undefined)?.due ?? action.due) : action.due,
    source: action.kind === "task" ? ((matched as WorkflowTaskAction | undefined)?.source ?? action.source) : action.source,
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
  const riskBlockPreview = extractRiskFlagBlocksFromMarkdown(normalizeMarkdownText(markdown));
  return (
    <div className={cn("space-y-3 text-sm leading-6", className)} data-rendered-markdown="true">
      {riskBlockPreview.riskFlags.length ? <RiskFlagList riskFlags={riskBlockPreview.riskFlags} /> : null}
      {riskBlockPreview.markdown ? (
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeSanitize, rehypeKatex]}
          components={{
            a: ({ children, href }) => (
              <a className="font-medium text-primary underline-offset-4 hover:underline" href={href} rel="noreferrer" target="_blank">
                {children}
              </a>
            ),
            blockquote: ({ children }) => (
              <blockquote className="border-l-2 border-border pl-3 text-muted-foreground">{children}</blockquote>
            ),
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
                <li className="pl-1">{action ? <InlineWorkflowAction action={action} workflowActions={workflowActions} /> : children}</li>
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
          {riskBlockPreview.markdown}
        </ReactMarkdown>
      ) : null}
    </div>
  );
}

function StructuredTableArtifact({ className, table }: { className?: string; table: NormalizedTable }) {
  return (
    <div className={cn("max-w-full overflow-hidden rounded-md border bg-background", className)} data-rendered-structured-table="true">
      {table.caption ? (
        <div className="border-b bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground">{table.caption}</div>
      ) : null}
      <Table className="w-max min-w-full table-fixed text-xs">
        <TableHeader>
          <TableRow>
            {table.columns.map((column, index) => (
              <TableHead key={`${column}-${index}`} className="w-44 min-w-32 bg-muted/70">
                {column || columnLabel(index)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {table.rows.length ? (
            table.rows.map((row, rowIndex) => (
              <TableRow key={`artifact-row-${rowIndex}`}>
                {table.columns.map((_column, columnIndex) => {
                  const value = row[columnIndex] ?? "";
                  return (
                    <TableCell key={`artifact-cell-${rowIndex}-${columnIndex}`} className="max-w-72 truncate" title={value}>
                      {value}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell className="h-20 text-center text-muted-foreground" colSpan={Math.max(table.columns.length, 1)}>
                No preview rows.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function RiskFlagList({ className, riskFlags }: { className?: string; riskFlags: RiskFlagPreview[] }) {
  return (
    <div className={cn("flex max-w-full flex-wrap gap-2", className)} data-rendered-risk-flags="true">
      {riskFlags.map((riskFlag, index) => (
        <RiskFlagChip key={`${riskFlag.id ?? riskFlag.title}-${index}`} riskFlag={riskFlag} />
      ))}
    </div>
  );
}

function RiskFlagChip({ riskFlag }: { riskFlag: RiskFlagPreview }) {
  const href = riskFlagHref(riskFlag);
  const className = cn(
    "inline-flex h-8 max-w-full items-center gap-1.5 rounded-md border px-2 text-xs font-semibold shadow-xs transition-colors",
    riskFlagTone(riskFlag.severity),
    href && "hover:bg-rose-100",
  );
  const content = (
    <>
      <ShieldAlert className="size-3.5 shrink-0" />
      <span className="shrink-0">Risk Flag</span>
      <span className="min-w-0 truncate font-medium">{riskFlag.title}</span>
      <span className="shrink-0 rounded-sm bg-background/70 px-1 py-0.5 text-[10px] uppercase tracking-normal">{riskFlag.severity}</span>
    </>
  );

  if (href) {
    return (
      <a className={className} href={href} title={`${riskFlag.description} Open risk management.`}>
        {content}
      </a>
    );
  }

  return (
    <span className={className} title={riskFlag.description}>
      {content}
    </span>
  );
}

function riskFlagHref(riskFlag: RiskFlagPreview) {
  if (!riskFlag.workspaceId || !riskFlag.projectId) return "";
  const scope = workspaceScopeFromId(riskFlag.workspaceId);
  if (!scope) return "";
  const href = new URLSearchParams(riskManagementHref(scope, riskFlag.projectId).slice(2));
  if (riskFlag.id) href.set("riskId", riskFlag.id);
  return `/?${href.toString()}`;
}

function riskFlagTone(severity: RiskFlagSeverity) {
  if (severity === "critical") return "border-red-300 bg-red-50 text-red-900";
  if (severity === "high") return "border-rose-200 bg-rose-50 text-rose-900";
  if (severity === "medium") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-sky-200 bg-sky-50 text-sky-900";
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

function InlineWorkflowAction({ action, workflowActions }: { action: ParsedWorkflowAction; workflowActions?: WorkflowActionContext }) {
  const resolved = resolveWorkflowAction(action, workflowActions);
  const isTask = resolved.kind === "task";
  const isPending = Boolean(
    resolved.clientStatus === "pending" ||
    (isTask && workflowActions?.pendingTaskTitle && titleMatches(workflowActions.pendingTaskTitle, resolved.title)) ||
    (isTask && resolved.id && workflowActions?.pendingTaskRemovalId === resolved.id),
  );
  const canCreate = Boolean(
    workflowActions?.canEdit && !resolved.id && workflowActions?.activeMode && createHandlerForKind(resolved.kind, workflowActions),
  );
  const CreatedIcon = iconForWorkflowKind(resolved.kind);

  return (
    <>
      <span>{resolved.title}</span>{" "}
      {resolved.id ? (
        isPending ? (
          <span className="inline-flex items-center rounded-md border border-warning/35 bg-warning/10 px-1.5 py-0.5 text-[11px] font-medium text-warning">
            Pending
          </span>
        ) : (
          <CreatedIcon className="inline size-3.5 align-[-2px] text-primary" aria-label={`${workflowKindLabel(resolved.kind)} created`} />
        )
      ) : (
        <InlineActionMenu action={resolved} canCreate={canCreate} isPending={isPending} workflowActions={workflowActions} />
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
                createHandlerForKind(
                  action.kind,
                  workflowActions,
                )?.({
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
  const normalizedLanguage = normalizeCodeLanguage(language) || "text";
  return (
    <div className={cn("overflow-hidden rounded-md border bg-foreground text-background", className)}>
      <div className="border-b border-background/10 px-3 py-2 text-xs font-medium uppercase text-background/70">{normalizedLanguage}</div>
      <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed">
        <code className={`language-${normalizedLanguage}`}>{highlightCode(code, normalizedLanguage)}</code>
      </pre>
    </div>
  );
}

function highlightCode(code: string, language: string) {
  const grammar = Prism.languages[normalizeCodeLanguage(language)];
  if (!grammar) return code;
  return renderPrismTokenStream(Prism.tokenize(code, grammar));
}

function renderPrismTokenStream(stream: TokenStream, keyPrefix = "token"): ReactNode {
  if (typeof stream === "string") return stream;
  if (Array.isArray(stream)) {
    return stream.map((token, index) => renderPrismTokenStreamItem(token, `${keyPrefix}-${index}`));
  }
  return renderPrismToken(stream, keyPrefix);
}

function renderPrismTokenStreamItem(stream: string | Token, key: string): ReactNode {
  if (typeof stream === "string") return <span key={key}>{stream}</span>;
  return renderPrismToken(stream, key);
}

function renderPrismToken(token: Token, key: string): ReactNode {
  return (
    <span className={prismTokenClassName(token)} key={key}>
      {renderPrismTokenStream(token.content, key)}
    </span>
  );
}

function prismTokenClassName(token: Token) {
  const aliases = Array.isArray(token.alias) ? token.alias : token.alias ? [token.alias] : [];
  return cn(...[token.type, ...aliases].map((name) => prismTokenClassNames[name]));
}

const prismTokenClassNames: Record<string, string> = {
  atrule: "text-violet-200",
  "attr-name": "text-emerald-200",
  "attr-value": "text-amber-200",
  boolean: "text-amber-200",
  builtin: "text-cyan-200",
  char: "text-emerald-200",
  "class-name": "text-cyan-200",
  comment: "text-background/45 italic",
  constant: "text-amber-200",
  deleted: "text-red-200",
  entity: "text-sky-200",
  function: "text-cyan-200",
  important: "font-semibold text-rose-200",
  inserted: "text-emerald-200",
  keyword: "font-semibold text-violet-200",
  number: "text-amber-200",
  operator: "text-sky-200",
  prolog: "text-background/45 italic",
  property: "text-sky-200",
  punctuation: "text-background/70",
  regex: "text-rose-200",
  selector: "text-emerald-200",
  string: "text-emerald-200",
  symbol: "text-amber-200",
  tag: "text-violet-200",
  url: "text-sky-200",
  variable: "text-rose-200",
};

function codeLanguageFromFileType(fileType: string) {
  const normalized = normalizeCodeLanguage(fileType);
  if (normalized && codeFileTypes.has(normalized)) return normalized;
  return codeLanguageAliases[fileExtension(fileType)] ?? "";
}

function normalizeCodeLanguage(language: string) {
  const normalized = language.trim().toLowerCase().replace(/^\./, "");
  return codeLanguageAliases[normalized] ?? normalized;
}

function fileExtension(fileName: string) {
  const normalized = fileName.trim().toLowerCase().split(/[?#]/)[0] ?? "";
  const extension = normalized.includes(".") ? normalized.split(".").pop() : normalized;
  return extension?.replace(/^\./, "") ?? "";
}

const codeLanguageAliases: Record<string, string> = {
  cjs: "javascript",
  htm: "markup",
  html: "markup",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  py: "python",
  sh: "bash",
  ts: "typescript",
  tsx: "tsx",
  xhtml: "markup",
  xml: "markup",
  yaml: "yaml",
  yml: "yaml",
};

const codeFileTypes = new Set(["bash", "css", "javascript", "json", "jsx", "markup", "python", "sql", "tsx", "typescript", "yaml"]);

function isDocumentFileType(fileType: string) {
  return ["doc", "docx", "document", "md", "markdown", "pdf", "rtf", "text", "txt"].includes(fileExtension(fileType));
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
  if (
    [
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
    ].includes(normalized)
  )
    return "idea";
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
    .replace(/^\s*(?:approval|decision|idea|task|opportunity|suggestion|improvement|enhancement)\s*:\s*/i, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s:;-]+|[\s:;-]+$/g, "")
    .trim();
}

function hasIdeaLanguage(value: string) {
  return /\b(idea|opportunit(?:y|ies)|proposal|concept|pilot|experiment|suggestion|improvement|enhancement|innovation|streamline|automate|optimi[sz]e)\b/i.test(
    value,
  );
}

function hasFollowThroughLanguage(value: string) {
  return /\b(task|todo|to do|follow[- ]?up|action item|next step|assign(?:ed)? to|owner\s*:|due\s*:|deadline|needs follow[- ]?up|requires follow[- ]?through|send|schedule|update|prepare|confirm|publish|deliver|resolve)\b/i.test(
    value,
  );
}

function isSuggestionSizedText(value: string) {
  const words = value.split(/\s+/).filter(Boolean);
  return words.length >= 3 && words.length <= 40 && value.length <= 260;
}

function normalizeActionText(value: string) {
  return cleanActionTitle(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function textFromReactNode(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textFromReactNode).join(" ");
  if (isRecord(node) && isRecord(node.props)) return textFromReactNode(node.props.children);
  return "";
}

function numericField(value: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const rawValue = value[key];
    if (typeof rawValue === "number" && Number.isFinite(rawValue)) return rawValue;
    if (typeof rawValue === "string" && rawValue.trim()) {
      const parsed = Number(rawValue);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
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

function titleCase(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
