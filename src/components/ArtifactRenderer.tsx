import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
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
};

type NormalizedTable = {
  columns: string[];
  rows: string[][];
};

type CodePayload = {
  code: string;
  language: string;
};

export function ArtifactRenderer({
  className,
  fallbackPreview = [],
  fileType,
  previewJson,
}: ArtifactRendererProps) {
  const normalizedFileType = fileType.trim().toLowerCase();
  const parsedPreview = parsePreviewJson(previewJson);
  const table = normalizeTablePreview(parsedPreview);
  const code = normalizeCodePreview(parsedPreview, normalizedFileType);
  const markdown = normalizeMarkdownPreview(parsedPreview, normalizedFileType);
  const summaryItems = normalizeSummaryPreview(parsedPreview, fallbackPreview);

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
    return <MarkdownArtifact className={className} markdown={markdown} />;
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

function MarkdownArtifact({ className, markdown }: { className?: string; markdown: string }) {
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
          li: ({ children }) => <li className="pl-1">{children}</li>,
          ol: ({ children }) => <ol className="space-y-1 pl-5 list-decimal">{children}</ol>,
          p: ({ children }) => <p className="whitespace-pre-wrap">{children}</p>,
          pre: ({ children }) => <>{children}</>,
          table: ({ children }) => (
            <div className="max-w-full overflow-x-auto rounded-md border bg-background">
              <table className="min-w-max border-collapse text-xs">{children}</table>
            </div>
          ),
          td: ({ children }) => <td className="border-t px-3 py-2 align-top">{children}</td>,
          th: ({ children }) => <th className="whitespace-nowrap px-3 py-2 text-left font-semibold text-muted-foreground">{children}</th>,
          thead: ({ children }) => <thead className="bg-muted/70">{children}</thead>,
          ul: ({ children }) => <ul className="space-y-1 pl-5 list-disc">{children}</ul>,
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
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
