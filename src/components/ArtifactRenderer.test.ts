import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ArtifactRenderer,
  extractRiskFlagBlocksFromMarkdown,
  hasRiskFlagSchema,
  normalizeCodePreview,
  normalizeMarkdownPreview,
  normalizeRiskFlagPreview,
  normalizeSummaryPreview,
  normalizeTablePreview,
  normalizeWorkflowActionPreview,
  parsePreviewJson,
  resolveMarkdownWorkflowAction,
} from "@/components/ArtifactRenderer";

describe("artifact preview normalization", () => {
  it("parses string preview JSON and leaves invalid strings untouched", () => {
    expect(parsePreviewJson('{"markdown":"# Summary"}')).toEqual({ markdown: "# Summary" });
    expect(parsePreviewJson("not-json")).toBe("not-json");
  });

  it("normalizes object-row table previews with explicit columns", () => {
    expect(
      normalizeTablePreview({
        columns: ["Name", "Status"],
        rows: [{ Name: "Vertex Hub", Status: "In Progress", Extra: "ignored by explicit columns" }],
      }),
    ).toEqual({
      columns: ["Name", "Status"],
      rows: [["Vertex Hub", "In Progress"]],
    });
  });

  it("normalizes array-row table previews by deriving headers from the first row", () => {
    expect(
      normalizeTablePreview([
        ["Project", "Status"],
        ["Vertex Hub", "Blocked"],
      ]),
    ).toEqual({
      columns: ["Project", "Status"],
      rows: [["Vertex Hub", "Blocked"]],
    });
  });

  it("detects markdown and code previews from content or file type", () => {
    expect(normalizeMarkdownPreview({ content: "## Status\n- On track" }, "md")).toBe("## Status\n- On track");
    expect(normalizeMarkdownPreview({ content: "Plain document text" }, "docx")).toBe("Plain document text");
    expect(normalizeMarkdownPreview({ markdown: "Nissan is a major automobile manufacturer." }, "markdown")).toBe(
      "Nissan is a major automobile manufacturer.",
    );
    expect(
      normalizeMarkdownPreview(
        {
          markdown: "Handoff Vulnerabilities: Vertex PMs $\\rightarrow$ Ramp CSMs $\\rightarrow$ BCMs $\\rightarrow$ AP Implementation",
        },
        "markdown",
      ),
    ).toBe("Handoff Vulnerabilities: Vertex PMs $\\rightarrow$ Ramp CSMs $\\rightarrow$ BCMs $\\rightarrow$ AP Implementation");
    expect(normalizeMarkdownPreview({ markdown: "Keep real math like $x^2$ intact." }, "markdown")).toBe(
      "Keep real math like $x^2$ intact.",
    );
    expect(
      normalizeMarkdownPreview(
        {
          markdown: "Status Progress Tracker: Uploaded \u2192 \\rightarrow \u2192 Validated \u2192 \\rightarrow \u2192 Internal Review",
        },
        "markdown",
      ),
    ).toBe("Status Progress Tracker: Uploaded \u2192 Validated \u2192 Internal Review");
    expect(
      normalizeMarkdownPreview(
        {
          markdown: `Status Progress Tracker: Uploaded \u2192 ${"\\".repeat(4)}rightarrow \u2192 Validated \u2192 ${"\\".repeat(4)}rightarrow \u2192 Internal Review`,
        },
        "markdown",
      ),
    ).toBe("Status Progress Tracker: Uploaded \u2192 Validated \u2192 Internal Review");
    expect(
      normalizeMarkdownPreview(
        {
          markdown: "Bare \\rightarrow is normalized, math $\\rightarrow$ and code `\\rightarrow` stay intact.",
        },
        "markdown",
      ),
    ).toBe("Bare \u2192 is normalized, math $\\rightarrow$ and code `\\rightarrow` stay intact.");
    expect(normalizeCodePreview({ markdown: "Nissan is a major automobile manufacturer." }, "markdown")).toBeNull();
    expect(normalizeCodePreview({ markdown: "Nissan is a major automobile manufacturer." }, "json")).toBeNull();
    expect(normalizeCodePreview({ code: "SELECT 1", language: "sql" }, "txt")).toEqual({
      code: "SELECT 1",
      language: "sql",
    });
    expect(normalizeCodePreview("const value = 1;", "ts")).toEqual({
      code: "const value = 1;",
      language: "typescript",
    });
    expect(normalizeCodePreview({ fileName: "worker.tsx", content: "export function Worker() {}" }, "txt")).toEqual({
      code: "export function Worker() {}",
      language: "tsx",
    });
  });

  it("renders inline LaTeX math inside markdown chat previews", () => {
    const html = renderToStaticMarkup(
      createElement(ArtifactRenderer, {
        fileType: "markdown",
        previewJson: {
          markdown: "Handoff Vulnerabilities: Vertex PMs $\\rightarrow$ Ramp CSMs and $$x^2$$",
        },
      }),
    );

    expect(html).toContain("katex");
    expect(html).toContain("Handoff Vulnerabilities");
    expect(html).not.toContain("$\\rightarrow$");
  });

  it("renders screenshot-style mixed arrow text without raw LaTeX commands", () => {
    const html = renderToStaticMarkup(
      createElement(ArtifactRenderer, {
        fileType: "markdown",
        previewJson: {
          markdown: `- Status Progress Tracker: A visual "stepper" (like a pizza tracker) for every batch: Uploaded \u2192 ${"\\".repeat(4)}rightarrow \u2192 Validated \u2192 ${"\\".repeat(4)}rightarrow \u2192 Internal Review \u2192 ${"\\".repeat(4)}rightarrow \u2192 Approved \u2192 ${"\\".repeat(4)}rightarrow \u2192 Synced to Asana .`,
        },
      }),
    );

    expect(html).toContain("Uploaded \u2192 Validated \u2192 Internal Review \u2192 Approved \u2192 Synced to Asana");
    expect(html).not.toContain("rightarrow");
  });

  it("normalizes nested vision table previews with object columns", () => {
    expect(
      normalizeTablePreview({
        extractedTables: [
          {
            name: "Invoice Lines",
            columns: [
              { key: "sku", label: "SKU" },
              { key: "quantity", label: "Qty" },
            ],
            rows: [{ sku: "A-100", quantity: 2 }],
          },
        ],
      }),
    ).toEqual({
      caption: "Invoice Lines",
      columns: ["SKU", "Qty"],
      rows: [["A-100", "2"]],
    });
  });

  it("normalizes OCR cell grids into headers and rows", () => {
    expect(
      normalizeTablePreview({
        cells: [
          { rowIndex: 0, columnIndex: 0, text: "Project" },
          { rowIndex: 0, columnIndex: 1, text: "Status" },
          { rowIndex: 1, columnIndex: 0, text: "Vertex Hub" },
          { rowIndex: 1, columnIndex: 1, text: "Ready" },
        ],
      }),
    ).toEqual({
      columns: ["Project", "Status"],
      rows: [["Vertex Hub", "Ready"]],
    });
  });

  it("normalizes extracted key-value fields as structural tables", () => {
    expect(normalizeTablePreview({ fields: { invoiceNumber: "INV-100", total: 42 } })).toEqual({
      columns: ["Field", "Value"],
      rows: [
        ["Invoice Number", "INV-100"],
        ["Total", "42"],
      ],
    });
  });

  it("falls back to summary preview cards for simple values", () => {
    expect(normalizeSummaryPreview({ preview: ["One", 2, null] }, [])).toEqual(["One", "2"]);
    expect(normalizeSummaryPreview("Plain summary", ["Fallback"])).toEqual(["Plain summary"]);
  });

  it("normalizes structured workflow action previews", () => {
    expect(
      normalizeWorkflowActionPreview({
        pendingApprovals: [{ id: "approval-1", title: "Confirm launch readiness", owner: "Maya", due: "Friday" }],
        assignedTasks: [{ title: "Prepare steering update", owner: "Jordan" }],
        suggestedIdeas: [{ title: "Automate project health summaries" }],
      }),
    ).toMatchObject([
      { kind: "approval", id: "approval-1", title: "Confirm launch readiness", owner: "Maya", due: "Friday" },
      { kind: "task", title: "Prepare steering update", owner: "Jordan" },
      { kind: "idea", title: "Automate project health summaries" },
    ]);
  });

  it("normalizes vertex risk flag JSON previews", () => {
    const riskBlock = {
      schema: "vertex.risk.v1",
      kind: "risk",
      risk: {
        id: "risk-1",
        workspace_id: "ws-team",
        project_id: "project-a",
        title: "Vendor dependency may slip",
        description: "The vendor approval dependency could delay launch.",
        severity: "high",
        status: "open",
        mitigation_strategy: "",
      },
    };

    expect(hasRiskFlagSchema(riskBlock)).toBe(true);
    expect(normalizeRiskFlagPreview(riskBlock)).toEqual([
      {
        id: "risk-1",
        workspaceId: "ws-team",
        projectId: "project-a",
        title: "Vendor dependency may slip",
        description: "The vendor approval dependency could delay launch.",
        severity: "high",
        status: "open",
        mitigationStrategy: "",
      },
    ]);
  });

  it("extracts risk flag blocks from markdown without removing ordinary code fences", () => {
    const markdown = [
      "Status update.",
      "```json",
      JSON.stringify({
        schema: "vertex.risk.v1",
        risk: {
          workspace_id: "ws-team",
          project_id: "project-a",
          title: "Launch dependency",
          description: "A launch dependency may slip.",
          severity: "critical",
          status: "open",
          mitigation_strategy: "",
        },
      }),
      "```",
      "```ts",
      "const value = 1;",
      "```",
    ].join("\n");

    const extracted = extractRiskFlagBlocksFromMarkdown(markdown);
    expect(extracted.riskFlags).toHaveLength(1);
    expect(extracted.riskFlags[0]).toMatchObject({ title: "Launch dependency", severity: "critical" });
    expect(extracted.markdown).toContain("Status update.");
    expect(extracted.markdown).toContain("```ts");
    expect(extracted.markdown).not.toContain("vertex.risk.v1");
  });

  it("filters vague task strings unless they imply follow-through", () => {
    expect(normalizeWorkflowActionPreview({ tasks: ["Project health"] })).toEqual([]);
    expect(normalizeWorkflowActionPreview({ tasks: ["Follow up with project owner"] })).toEqual([
      { kind: "task", title: "Follow up with project owner" },
    ]);
  });

  it("resolves explicit and heuristic markdown workflow actions", () => {
    expect(resolveMarkdownWorkflowAction("approval:team-approval-1 Confirm launch readiness", undefined)).toEqual({
      kind: "approval",
      id: "team-approval-1",
      title: "Confirm launch readiness",
    });
    expect(resolveMarkdownWorkflowAction("Pilot a cleaner status summary", { preferredSuggestionKind: "idea" })).toMatchObject({
      kind: "idea",
      title: "Pilot a cleaner status summary",
    });
    expect(resolveMarkdownWorkflowAction("Prepare the launch checklist by Friday", undefined)).toMatchObject({
      kind: "task",
      title: "Prepare the launch checklist by Friday",
    });
  });
});
