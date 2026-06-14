import { describe, expect, it } from "vitest";
import {
  normalizeCodePreview,
  normalizeMarkdownPreview,
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
    expect(normalizeTablePreview({
      columns: ["Name", "Status"],
      rows: [
        { Name: "Vertex Hub", Status: "In Progress", Extra: "ignored by explicit columns" },
      ],
    })).toEqual({
      columns: ["Name", "Status"],
      rows: [["Vertex Hub", "In Progress"]],
    });
  });

  it("normalizes array-row table previews by deriving headers from the first row", () => {
    expect(normalizeTablePreview([
      ["Project", "Status"],
      ["Vertex Hub", "Blocked"],
    ])).toEqual({
      columns: ["Project", "Status"],
      rows: [["Vertex Hub", "Blocked"]],
    });
  });

  it("detects markdown and code previews from content or file type", () => {
    expect(normalizeMarkdownPreview({ content: "## Status\n- On track" }, "md")).toBe("## Status\n- On track");
    expect(normalizeCodePreview({ code: "SELECT 1", language: "sql" }, "txt")).toEqual({
      code: "SELECT 1",
      language: "sql",
    });
    expect(normalizeCodePreview("const value = 1;", "ts")).toEqual({
      code: "const value = 1;",
      language: "ts",
    });
  });

  it("falls back to summary preview cards for simple values", () => {
    expect(normalizeSummaryPreview({ preview: ["One", 2, null] }, [])).toEqual(["One", "2"]);
    expect(normalizeSummaryPreview("Plain summary", ["Fallback"])).toEqual(["Plain summary"]);
  });

  it("normalizes structured workflow action previews", () => {
    expect(normalizeWorkflowActionPreview({
      pendingApprovals: [{ id: "approval-1", title: "Confirm launch readiness", owner: "Maya", due: "Friday" }],
      assignedTasks: [{ title: "Prepare steering update", owner: "Jordan" }],
      suggestedIdeas: [{ title: "Automate project health summaries" }],
    })).toMatchObject([
      { kind: "approval", id: "approval-1", title: "Confirm launch readiness", owner: "Maya", due: "Friday" },
      { kind: "task", title: "Prepare steering update", owner: "Jordan" },
      { kind: "idea", title: "Automate project health summaries" },
    ]);
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
