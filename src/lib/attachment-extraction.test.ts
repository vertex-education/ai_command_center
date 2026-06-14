import { describe, expect, it } from "vitest";
import {
  acceptedChatAttachmentTypes,
  allowedChatAttachmentExtensions,
  extractChatAttachment,
} from "@/lib/attachment-extraction";

describe("chat attachment extraction", () => {
  it("advertises the supported chat attachment extensions", () => {
    expect(allowedChatAttachmentExtensions).toEqual(["pdf", "xlsx", "pptx", "docx", "csv", "txt"]);
    expect(acceptedChatAttachmentTypes()).toBe(".pdf,.xlsx,.pptx,.docx,.csv,.txt");
  });

  it("extracts plain text files into ready attachment context", async () => {
    const attachment = await extractChatAttachment(new File([" Line one \n\n\n Line two "], "notes.txt", { type: "text/plain" }));

    expect(attachment).toMatchObject({
      name: "notes.txt",
      extension: "txt",
      mimeType: "text/plain",
      status: "ready",
      extractedText: "Line one\n\nLine two",
    });
    expect(attachment.id).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("uses extension mime defaults when the browser file type is blank", async () => {
    const attachment = await extractChatAttachment(new File(["name,status\nVertex,Active"], "tasks.csv"));

    expect(attachment.extension).toBe("csv");
    expect(attachment.mimeType).toBe("text/csv");
    expect(attachment.extractedText).toContain("name,status");
  });

  it("rejects unsupported file names before extraction work starts", async () => {
    await expect(extractChatAttachment(new File(["bad"], "image.png"))).rejects.toThrow(
      "Attach PDF, XLSX, PPTX, DOCX, CSV, or TXT files.",
    );
  });
});
