export const chatEntityTypes = ["Task", "Approval", "Idea", "Risk"] as const;
export const chatRiskSeverities = ["low", "medium", "high", "critical"] as const;

export type ChatEntityType = (typeof chatEntityTypes)[number];
export type ChatRiskSeverity = (typeof chatRiskSeverities)[number];

export type ChatEntityStatus = "active" | "acknowledged" | "queued" | "rejected" | "synced";

export type ChatOperationalEntity = {
  id: string;
  type: ChatEntityType;
  title: string;
  description: string;
  owner?: string | null;
  dueDate?: string | null;
  priority?: "Low" | "Medium" | "High" | null;
  severity?: ChatRiskSeverity | null;
  sourceQuote?: string | null;
  confidence: number;
  status?: ChatEntityStatus;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeOptionalString(value: unknown, maxLength: number) {
  const normalized = normalizeString(value, maxLength);
  return normalized || null;
}

function normalizePriority(value: unknown): ChatOperationalEntity["priority"] {
  return value === "Low" || value === "Medium" || value === "High" ? value : null;
}

function normalizeSeverity(value: unknown): ChatRiskSeverity | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return chatRiskSeverities.includes(normalized as ChatRiskSeverity) ? (normalized as ChatRiskSeverity) : null;
}

function normalizeConfidence(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return 0.6;
  return Math.max(0, Math.min(1, numeric > 1 ? numeric / 100 : numeric));
}

function isChatEntityType(value: unknown): value is ChatEntityType {
  return chatEntityTypes.includes(value as ChatEntityType);
}

export function normalizeChatOperationalEntities(value: unknown): ChatOperationalEntity[] {
  if (!Array.isArray(value)) return [];

  const entities: ChatOperationalEntity[] = [];
  for (const [index, item] of value.entries()) {
    if (!isRecord(item) || !isChatEntityType(item.type)) continue;
    const title = normalizeString(item.title, 120);
    const description = normalizeString(item.description, 280);
    if (!title || !description) continue;

    entities.push({
      id: normalizeString(item.id, 80) || `entity-${index + 1}`,
      type: item.type,
      title,
      description,
      owner: normalizeOptionalString(item.owner, 80),
      dueDate: normalizeOptionalString(item.dueDate, 40),
      priority: normalizePriority(item.priority),
      severity: item.type === "Risk" ? normalizeSeverity(item.severity) : null,
      sourceQuote: normalizeOptionalString(item.sourceQuote, 180),
      confidence: normalizeConfidence(item.confidence),
      status: "active",
    });
  }

  return entities.slice(0, 8);
}

export function extractChatEntityJsonArrayCandidate(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) return fenced.trim();
  return text.match(/\[[\s\S]*\]/)?.[0]?.trim() ?? text.trim();
}

export function parseChatOperationalEntityJson(text: string) {
  if (!text.trim()) return [];
  return normalizeChatOperationalEntities(JSON.parse(extractChatEntityJsonArrayCandidate(text)));
}
