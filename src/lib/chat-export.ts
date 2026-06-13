import ExcelJS from "exceljs";

export type ChatExportFormat = "pdf" | "docx" | "xlsx" | "csv";

export type ExportTable = {
  name: string;
  rows: Array<Record<string, string | number | boolean | null>>;
};

const formatLabels: Record<ChatExportFormat, string> = {
  pdf: "PDF",
  docx: "DOCX",
  xlsx: "XLSX",
  csv: "CSV",
};

const xlsxMimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const vertexWorkbookBrand = {
  blue: "003865",
  gray: "707372",
  gold: "CBA052",
  darkGray: "404342",
  lightGray: "C0C3C2",
  white: "FFFFFF",
};

export function parseChatExportRequest(prompt: string): ChatExportFormat[] {
  const lower = prompt.toLowerCase();
  const wantsFile = /\b(export|download|generate|create|make|save|turn|convert)\b/.test(lower);
  if (!wantsFile) return [];

  const formats = new Set<ChatExportFormat>();
  if (/\bpdfs?\b|\.pdf\b/.test(lower)) formats.add("pdf");
  if (/\bdocx\b|\bword doc(?:ument)?\b|\.docx\b/.test(lower)) formats.add("docx");
  if (/\bxlsx\b|\bexcel\b|\bspreadsheet\b|\.xlsx\b/.test(lower)) formats.add("xlsx");
  if (/\bcsv\b|\.csv\b/.test(lower)) formats.add("csv");
  return [...formats];
}

export function exportFormatLabel(format: ChatExportFormat) {
  return formatLabels[format];
}

export async function downloadChatExport(format: ChatExportFormat, content: string, baseName: string) {
  const safeName = safeFileName(baseName || "vertex-ai-chat-export");
  if (format === "csv") {
    const table = extractTables(content)[0] ?? contentTable(content);
    return downloadBlob(`${safeName}.csv`, "text/csv;charset=utf-8", buildCsv(table.rows));
  }
  if (format === "xlsx") {
    const tables = extractTables(content);
    return downloadBlob(
      `${safeName}.xlsx`,
      xlsxMimeType,
      await buildXlsx(tables.length ? tables : [contentTable(content)]),
    );
  }
  if (format === "docx") {
    return downloadBlob(
      `${safeName}.docx`,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buildDocx(content),
    );
  }
  return downloadBlob(`${safeName}.pdf`, "application/pdf", buildPdf(content));
}

export async function downloadRows(format: "csv" | "xlsx", title: string, rows: ExportTable["rows"]) {
  const safeName = safeFileName(title || "chart-export");
  if (format === "csv") {
    return downloadBlob(`${safeName}.csv`, "text/csv;charset=utf-8", buildCsv(rows));
  }
  return downloadBlob(
    `${safeName}.xlsx`,
    xlsxMimeType,
    await buildXlsx([{ name: title || "Chart Data", rows }]),
  );
}

export async function downloadHtmlTable(format: "csv" | "xlsx", title: string, table: HTMLTableElement) {
  await downloadRows(format, title, htmlTableRows(table));
}

export async function xlsxFileFromHtmlTable(title: string, table: HTMLTableElement) {
  const safeName = safeFileName(title || "table-export");
  return new File(
    [await buildXlsx([{ name: title || "Table Export", rows: htmlTableRows(table) }])],
    `${safeName}.xlsx`,
    { type: xlsxMimeType },
  );
}

export function rowsFromHtmlTable(table: HTMLTableElement) {
  return htmlTableRows(table);
}

export function xlsxBlobFromRows(title: string, rows: ExportTable["rows"]) {
  return buildXlsx([{ name: title || "Table Export", rows }]);
}

function downloadBlob(fileName: string, type: string, data: BlobPart) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeFileName(value: string) {
  return value
    .trim()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 72) || "export";
}

function contentTable(content: string): ExportTable {
  const rows = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => ({ line: index + 1, content: line }));
  return { name: "Chat Export", rows: rows.length ? rows : [{ line: 1, content: content.trim() }] };
}

function extractTables(content: string): ExportTable[] {
  const jsonTable = extractJsonTable(content);
  if (jsonTable) return [jsonTable];

  const markdownTables = extractMarkdownTables(content);
  if (markdownTables.length) return markdownTables;

  const csvTable = extractCsvTable(content);
  return csvTable ? [csvTable] : [];
}

function extractJsonTable(content: string): ExportTable | null {
  const candidate = extractJsonCandidate(content.trim());
  if (!candidate) return null;
  try {
    const parsed = JSON.parse(candidate);
    const rows = normalizeRows(parsed);
    return rows.length ? { name: "Data", rows } : null;
  } catch {
    return null;
  }
}

function extractJsonCandidate(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) return fenced[1].trim();
  if ((text.startsWith("{") && text.endsWith("}")) || (text.startsWith("[") && text.endsWith("]"))) return text;
  return "";
}

function normalizeRows(value: unknown): ExportTable["rows"] {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeRow(item));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["rows", "data", "items", "records", "results"]) {
      if (Array.isArray(record[key])) return normalizeRows(record[key]);
    }
    return [normalizeRow(record)];
  }
  return [];
}

function normalizeRow(value: unknown): Record<string, string | number | boolean | null> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { value: scalarValue(value) };
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [key, scalarValue(nestedValue)]),
  );
}

function scalarValue(value: unknown): string | number | boolean | null {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (value === undefined) return "";
  return JSON.stringify(value);
}

function extractMarkdownTables(content: string): ExportTable[] {
  const lines = content.split(/\r?\n/);
  const tables: ExportTable[] = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    const header = splitMarkdownRow(lines[index]);
    const separator = lines[index + 1]?.trim();
    if (header.length < 2 || !/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(separator)) continue;
    const rows: ExportTable["rows"] = [];
    index += 2;
    while (index < lines.length) {
      const cells = splitMarkdownRow(lines[index]);
      if (cells.length < 2) break;
      rows.push(Object.fromEntries(header.map((column, columnIndex) => [column || `Column ${columnIndex + 1}`, cells[columnIndex] ?? ""])));
      index += 1;
    }
    tables.push({ name: `Table ${tables.length + 1}`, rows });
  }
  return tables;
}

function splitMarkdownRow(line: string) {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return [];
  return trimmed
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function extractCsvTable(content: string): ExportTable | null {
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2 || !lines[0].includes(",")) return null;
  const header = parseCsvLine(lines[0]);
  if (header.length < 2) return null;
  const rows = lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(header.map((column, index) => [column || `Column ${index + 1}`, cells[index] ?? ""]));
  });
  return { name: "CSV Data", rows };
}

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(cell);
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells.map((value) => value.trim());
}

function buildCsv(rows: ExportTable["rows"]) {
  const columns = collectColumns(rows);
  return [
    columns.map(csvCell).join(","),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(",")),
  ].join("\r\n");
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function collectColumns(rows: ExportTable["rows"]) {
  const columns = new Set<string>();
  rows.forEach((row) => Object.keys(row).forEach((key) => columns.add(key)));
  return [...columns];
}

function htmlTableRows(table: HTMLTableElement): ExportTable["rows"] {
  const explicitHeaders = Array.from(table.querySelectorAll("thead th"))
    .map((cell) => cell.textContent?.trim() ?? "")
    .filter(Boolean);
  const bodyRows = Array.from(table.querySelectorAll("tbody tr"));
  const rows = bodyRows.length ? bodyRows : Array.from(table.querySelectorAll("tr"));
  const firstRowCells = Array.from(rows[0]?.querySelectorAll("th,td") ?? []);
  const hasHeaderRow = explicitHeaders.length === 0 && firstRowCells.some((cell) => cell.tagName.toLowerCase() === "th");
  const headers = explicitHeaders.length
    ? explicitHeaders
    : hasHeaderRow
      ? firstRowCells.map((cell, index) => cell.textContent?.trim() || `Column ${index + 1}`)
      : firstRowCells.map((_, index) => `Column ${index + 1}`);
  const dataRows = hasHeaderRow && bodyRows.length === 0 ? rows.slice(1) : rows;

  return dataRows.map((row) => {
    const cells = Array.from(row.querySelectorAll("th,td"));
    return Object.fromEntries(headers.map((header, index) => [header || `Column ${index + 1}`, cells[index]?.textContent?.trim() ?? ""]));
  });
}

function buildDocx(content: string) {
  const paragraphs = content
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .flatMap((block) => block.split("\n"))
    .map((line) => line.replace(/^#{1,6}\s+/, "").replace(/^[-*+]\s+/, ""))
    .filter((line) => line.trim().length > 0);
  const body = (paragraphs.length ? paragraphs : [content]).map((line) => `<w:p><w:r><w:t xml:space="preserve">${xmlEscape(line)}</w:t></w:r></w:p>`).join("");
  return zipFiles({
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`,
  });
}

async function buildXlsx(tables: ExportTable[]) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Vertex AI Command Center";
  workbook.company = "Vertex Education";
  workbook.created = new Date();
  workbook.modified = new Date();

  tables.forEach((table, index) => {
    const worksheet = workbook.addWorksheet(sanitizeSheetName(table.name || `Sheet ${index + 1}`), {
      properties: { tabColor: { argb: `FF${vertexWorkbookBrand.gold}` } },
      views: [{ state: "frozen", ySplit: 1 }],
    });
    brandWorksheet(worksheet, table.rows);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], { type: xlsxMimeType });
}

function sanitizeSheetName(name: string) {
  return name.replace(/[:\\/?*[\]]/g, " ").trim().slice(0, 31) || "Sheet";
}

function brandWorksheet(worksheet: ExcelJS.Worksheet, rows: ExportTable["rows"]) {
  const columns = collectColumns(rows);
  worksheet.columns = columns.map((column) => ({
    header: column,
    key: column,
    width: columnWidth(column, rows),
  }));

  rows.forEach((row) => {
    worksheet.addRow(Object.fromEntries(columns.map((column) => [column, row[column] ?? ""])));
  });

  worksheet.autoFilter = columns.length
    ? {
        from: { row: 1, column: 1 },
        to: { row: Math.max(rows.length + 1, 1), column: columns.length },
      }
    : undefined;

  const headerRow = worksheet.getRow(1);
  headerRow.height = 22;
  headerRow.eachCell((cell) => {
    cell.font = { name: "Arial", bold: true, color: { argb: `FF${vertexWorkbookBrand.white}` } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: `FF${vertexWorkbookBrand.blue}` },
    };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = brandedCellBorder();
  });

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    row.eachCell((cell) => {
      cell.font = { name: "Arial", color: { argb: `FF${vertexWorkbookBrand.darkGray}` } };
      cell.alignment = { vertical: "top", wrapText: true };
      cell.border = brandedCellBorder();
    });
  });
}

function brandedCellBorder(): Partial<ExcelJS.Borders> {
  const border: Partial<ExcelJS.Border> = { style: "thin", color: { argb: `FF${vertexWorkbookBrand.lightGray}` } };
  return { top: border, right: border, bottom: border, left: border };
}

function columnWidth(column: string, rows: ExportTable["rows"]) {
  const maxLength = rows.reduce((max, row) => Math.max(max, String(row[column] ?? "").length), column.length);
  return Math.min(Math.max(maxLength + 3, 12), 42);
}

function buildPdf(content: string) {
  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 54;
  const lineHeight = 14;
  const lines = wrapPdfLines(content.replace(/\r\n/g, "\n"), 92);
  const pages: string[] = [];
  for (let index = 0; index < lines.length; index += 48) pages.push(lines.slice(index, index + 48).join("\n"));
  const pageStreams = (pages.length ? pages : [""]).map((pageLines) => {
    let y = pageHeight - margin;
    const commands = pageLines.split("\n").map((line) => {
      const command = `BT /F1 10 Tf ${margin} ${y} Td (${pdfEscape(line)}) Tj ET`;
      y -= lineHeight;
      return command;
    });
    return commands.join("\n");
  });
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R >>`,
    `<< /Type /Pages /Kids [${pageStreams.map((_, index) => `${3 + index * 2} 0 R`).join(" ")}] /Count ${pageStreams.length} >>`,
  ];
  pageStreams.forEach((stream, index) => {
    const pageObject = 3 + index * 2;
    const streamObject = pageObject + 1;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents ${streamObject} 0 R >>`);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  return pdfDocument(objects);
}

function wrapPdfLines(content: string, width: number) {
  return content.split("\n").flatMap((line) => {
    const words = line.trim().split(/\s+/).filter(Boolean);
    if (!words.length) return [""];
    const lines: string[] = [];
    let current = "";
    words.forEach((word) => {
      const next = current ? `${current} ${word}` : word;
      if (next.length > width) {
        if (current) lines.push(current);
        current = word;
      } else {
        current = next;
      }
    });
    if (current) lines.push(current);
    return lines;
  });
}

function pdfDocument(objects: string[]) {
  const parts = ["%PDF-1.4\n"];
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(parts.join("").length);
    parts.push(`${index + 1} 0 obj\n${object}\nendobj\n`);
  });
  const xrefOffset = parts.join("").length;
  parts.push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  offsets.slice(1).forEach((offset) => parts.push(`${String(offset).padStart(10, "0")} 00000 n \n`));
  parts.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
  return parts.join("");
}

function xmlEscape(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function pdfEscape(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function zipFiles(files: Record<string, string | Uint8Array>) {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  Object.entries(files).forEach(([name, value]) => {
    const nameBytes = encoder.encode(name);
    const data = typeof value === "string" ? encoder.encode(value) : value;
    const crc = crc32(data);
    const local = concat([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0), nameBytes, data,
    ]);
    const central = concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBytes,
    ]);
    localParts.push(local);
    centralParts.push(central);
    offset += local.length;
  });

  const centralDirectory = concat(centralParts);
  const end = concat([
    u32(0x06054b50), u16(0), u16(0), u16(centralParts.length), u16(centralParts.length), u32(centralDirectory.length), u32(offset), u16(0),
  ]);
  return new Blob([concat([...localParts, centralDirectory, end])]);
}

function u16(value: number) {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

function u32(value: number) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
  return bytes;
}

function concat(parts: Uint8Array[]) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  parts.forEach((part) => {
    out.set(part, offset);
    offset += part.length;
  });
  return out;
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  data.forEach((byte) => {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  });
  return (crc ^ 0xffffffff) >>> 0;
}
