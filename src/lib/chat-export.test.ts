import { describe, expect, it } from "vitest";
import {
  exportFormatLabel,
  parseChatExportRequest,
  xlsxBlobFromRows,
} from "@/lib/chat-export";

describe("chat export helpers", () => {
  it("detects requested export formats only when the user asks for a file action", () => {
    expect(parseChatExportRequest("Export this as PDF, Word doc, Excel, and CSV")).toEqual(["pdf", "docx", "xlsx", "csv"]);
    expect(parseChatExportRequest("Can you discuss PDF and CSV tradeoffs?")).toEqual([]);
  });

  it("recognizes file extensions and product names", () => {
    expect(parseChatExportRequest("Please save a .docx and .xlsx copy")).toEqual(["docx", "xlsx"]);
    expect(parseChatExportRequest("Turn this table into a spreadsheet")).toEqual(["xlsx"]);
  });

  it("returns stable user-facing format labels", () => {
    expect(exportFormatLabel("pdf")).toBe("PDF");
    expect(exportFormatLabel("docx")).toBe("DOCX");
    expect(exportFormatLabel("xlsx")).toBe("XLSX");
    expect(exportFormatLabel("csv")).toBe("CSV");
  });

  it("builds a branded xlsx blob from row data", async () => {
    const blob = await xlsxBlobFromRows("2026 Status Export", [
      { Project: "Vertex Hub", Status: "In Progress", Count: 2 },
    ]);

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(blob.size).toBeGreaterThan(1000);
  }, 20_000);
});
