import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";

export const allowedChatAttachmentExtensions = ["pdf", "xlsx", "pptx", "docx", "csv", "txt"] as const;

export type AllowedChatAttachmentExtension = typeof allowedChatAttachmentExtensions[number];

export type ExtractedChatAttachment = {
  id: string;
  name: string;
  extension: AllowedChatAttachmentExtension;
  mimeType: string;
  size: number;
  extractedText: string;
  status: "ready" | "partial" | "error";
  error?: string;
};

const maxAttachmentChars = 20_000;

export function acceptedChatAttachmentTypes() {
  return allowedChatAttachmentExtensions.map((extension) => `.${extension}`).join(",");
}

export async function extractChatAttachment(file: File): Promise<ExtractedChatAttachment> {
  const extension = extensionFromName(file.name);
  if (!extension) {
    throw new Error(`${file.name} is not supported. Attach PDF, XLSX, PPTX, DOCX, CSV, or TXT files.`);
  }

  try {
    const extractedText = await extractTextByExtension(file, extension);
    const normalized = normalizeExtractedText(extractedText);
    return {
      id: crypto.randomUUID(),
      name: file.name,
      extension,
      mimeType: file.type || mimeTypeForExtension(extension),
      size: file.size,
      extractedText: truncateAttachmentText(normalized || "[No readable text was extracted from this file.]"),
      status: normalized ? "ready" : "partial",
      error: normalized ? undefined : "No readable text was extracted.",
    };
  } catch (error) {
    return {
      id: crypto.randomUUID(),
      name: file.name,
      extension,
      mimeType: file.type || mimeTypeForExtension(extension),
      size: file.size,
      extractedText: "",
      status: "error",
      error: error instanceof Error ? error.message : "Could not read this file.",
    };
  }
}

function extensionFromName(name: string): AllowedChatAttachmentExtension | null {
  const extension = name.split(".").pop()?.toLowerCase();
  return allowedChatAttachmentExtensions.includes(extension as AllowedChatAttachmentExtension)
    ? extension as AllowedChatAttachmentExtension
    : null;
}

async function extractTextByExtension(file: File, extension: AllowedChatAttachmentExtension) {
  if (extension === "txt" || extension === "csv") return file.text();
  if (extension === "pdf") return extractPdfText(file);
  if (extension === "xlsx") return extractXlsxText(file);
  if (extension === "docx") return extractDocxText(file);
  if (extension === "pptx") return extractPptxText(file);
  return "";
}

async function extractPdfText(file: File) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => "str" in item ? item.str : "")
      .filter(Boolean)
      .join(" ");
    pages.push(`Page ${pageNumber}\n${text}`);
  }
  return pages.join("\n\n");
}

async function extractXlsxText(file: File) {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const sheets: string[] = [];
  workbook.eachSheet((sheet) => {
    const rows: string[] = [];
    sheet.eachRow((row, rowNumber) => {
      const values = row.values;
      const cells = Array.isArray(values)
        ? values.slice(1).map((value) => cellValueToText(value)).filter(Boolean)
        : [];
      if (cells.length > 0) rows.push(`R${rowNumber}: ${cells.join(" | ")}`);
    });
    sheets.push(`Sheet: ${sheet.name}\n${rows.join("\n")}`);
  });
  return sheets.join("\n\n");
}

async function extractDocxText(file: File) {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const documentXml = await zip.file("word/document.xml")?.async("text");
  if (!documentXml) return "";
  return xmlTextRunsToText(documentXml);
}

async function extractPptxText(file: File) {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const slideFiles = Object.keys(zip.files)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/i.test(path))
    .sort((a, b) => slideNumber(a) - slideNumber(b));
  const slides = await Promise.all(slideFiles.map(async (path, index) => {
    const xml = await zip.file(path)?.async("text");
    return `Slide ${index + 1}\n${xml ? xmlTextRunsToText(xml) : ""}`;
  }));
  return slides.join("\n\n");
}

function xmlTextRunsToText(xml: string) {
  return Array.from(xml.matchAll(/<[^:>]*:?t\b[^>]*>([\s\S]*?)<\/[^:>]*:?t>/g))
    .map((match) => decodeXmlEntities(match[1] ?? ""))
    .join(" ");
}

function decodeXmlEntities(value: string) {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = value;
  return textarea.value;
}

function slideNumber(path: string) {
  return Number(path.match(/slide(\d+)\.xml$/i)?.[1] ?? 0);
}

function cellValueToText(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    const record = value as { text?: unknown; result?: unknown; formula?: unknown; richText?: Array<{ text?: unknown }> };
    if (typeof record.text === "string") return record.text;
    if (record.result != null) return cellValueToText(record.result);
    if (Array.isArray(record.richText)) return record.richText.map((part) => String(part.text ?? "")).join("");
    if (typeof record.formula === "string") return `=${record.formula}`;
  }
  return String(value);
}

function normalizeExtractedText(value: string) {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncateAttachmentText(value: string) {
  return value.length > maxAttachmentChars
    ? `${value.slice(0, maxAttachmentChars).trim()}\n[Attachment text truncated for chat context.]`
    : value;
}

function mimeTypeForExtension(extension: AllowedChatAttachmentExtension) {
  switch (extension) {
    case "csv":
      return "text/csv";
    case "txt":
      return "text/plain";
    case "pdf":
      return "application/pdf";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case "xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
}
