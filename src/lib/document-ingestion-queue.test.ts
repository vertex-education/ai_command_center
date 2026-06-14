import { describe, expect, it } from "vitest";
import {
  chunkText,
  customTagsIndexValue,
  inferSensitivityLabel,
  isConfidentialTag,
} from "@/lib/document-ingestion-queue";

describe("document ingestion utilities", () => {
  it("chunks markdown on top-level headings while preserving section text", () => {
    const chunks = chunkText([
      "# Launch Plan",
      "Intro paragraph.",
      "",
      "## Workstream A",
      "Detailed notes.",
      "",
      "### Evidence",
      "Source-backed evidence.",
    ].join("\n"));

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toContain("# Launch Plan");
    expect(chunks[1]).toContain("## Workstream A");
    expect(chunks[2]).toContain("### Evidence");
  });

  it("does not split fenced code blocks as blank-line text sections", () => {
    const chunks = chunkText([
      "# Query",
      "```sql",
      "SELECT *",
      "FROM projects;",
      "```",
      "",
      "Explanation after the query.",
    ].join("\n"));

    expect(chunks.join("\n\n")).toContain("```sql\nSELECT *\nFROM projects;\n```");
    expect(chunks.join("\n\n")).toContain("Explanation after the query.");
  });

  it("indexes custom tags in a lowercase comma-separated form", () => {
    expect(customTagsIndexValue([" PMO ", "", "Confidential", "Launch"])).toBe("pmo,confidential,launch");
  });

  it("detects confidential and restricted sensitivity markers", () => {
    expect(isConfidentialTag(" confidential ")).toBe(true);
    expect(isConfidentialTag("restricted")).toBe(true);
    expect(isConfidentialTag("internal")).toBe(false);
  });

  it("infers sensitivity from tags, metadata, or document name", () => {
    expect(inferSensitivityLabel({ customTags: ["Confidential"], documentName: "plan.md" })).toBe("Confidential");
    expect(inferSensitivityLabel({
      documentName: "brief.md",
      metadata: { restricted: "restricted" },
    })).toBe("Confidential");
    expect(inferSensitivityLabel({ documentName: "restricted-roadmap.md" })).toBe("Confidential");
    expect(inferSensitivityLabel({ customTags: ["PMO"], documentName: "roadmap.md" })).toBe("Standard");
  });
});
