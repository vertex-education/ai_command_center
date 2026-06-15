import type { ChatOperationalEntity, ChatRiskSeverity } from "@/lib/chat-entities";

export const riskFlagSchema = "vertex.risk.v1" as const;

export type NormalizedRiskEntity = {
  id: string;
  workspaceId: string;
  projectId: string;
  title: string;
  description: string;
  severity: ChatRiskSeverity;
  status: "open";
  mitigationStrategy: string;
};

export type RiskFlagEnvelope = {
  schema: typeof riskFlagSchema;
  kind: "risk";
  risk: {
    id: string;
    workspace_id: string;
    project_id: string;
    title: string;
    description: string;
    severity: ChatRiskSeverity;
    status: "open";
    mitigation_strategy: string;
  };
};

export type RiskEntityScope = {
  assistantMessageId?: string | null;
  workspaceId: string;
  projectId: string;
};

export function normalizeRiskEntities(entities: ChatOperationalEntity[] | undefined, scope: RiskEntityScope) {
  return (entities ?? [])
    .map((entity, index) => normalizeRiskEntity(entity, scope, index))
    .filter((risk): risk is NormalizedRiskEntity => Boolean(risk));
}

export function normalizeRiskEntity(entity: ChatOperationalEntity, scope: RiskEntityScope, index = 0): NormalizedRiskEntity | null {
  if (entity.type !== "Risk") return null;
  const title = normalizeRiskText(entity.title, 160, "Untitled risk");
  const description = normalizeRiskText(entity.description, 1_000, title);
  return {
    id: riskIdFromEntity(entity, scope.assistantMessageId, index),
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    title,
    description,
    severity: riskSeverityFromEntity(entity),
    status: "open",
    mitigationStrategy: "",
  };
}

export function createRiskFlagJsonBlocks(entities: ChatOperationalEntity[] | undefined, scope: RiskEntityScope) {
  return normalizeRiskEntities(entities, scope).map((risk) => JSON.stringify(toRiskFlagEnvelope(risk), null, 2));
}

export function formatRiskFlagBlocks(blocks: string[]) {
  if (!blocks.length) return "";
  return `\n\n${blocks.map((block) => `\`\`\`json\n${block}\n\`\`\``).join("\n\n")}`;
}

export function toRiskFlagEnvelope(risk: NormalizedRiskEntity): RiskFlagEnvelope {
  return {
    schema: riskFlagSchema,
    kind: "risk",
    risk: {
      id: risk.id,
      workspace_id: risk.workspaceId,
      project_id: risk.projectId,
      title: risk.title,
      description: risk.description,
      severity: risk.severity,
      status: risk.status,
      mitigation_strategy: risk.mitigationStrategy,
    },
  };
}

export function riskIdFromEntity(entity: ChatOperationalEntity, assistantMessageId?: string | null, index = 0) {
  const entitySegment = idSegment(entity.id || entity.title, `risk-${index + 1}`);
  const messageSegment = assistantMessageId ? idSegment(assistantMessageId.replace(/^msg-/, ""), "message") : null;
  return (messageSegment ? `risk-${messageSegment}-${entitySegment}` : `risk-${entitySegment}`).slice(0, 120);
}

export function normalizeRiskText(value: string | null | undefined, maxLength: number, fallback: string) {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
  return normalized || fallback;
}

export function riskSeverityFromEntity(entity: ChatOperationalEntity): ChatRiskSeverity {
  if (entity.severity) return entity.severity;
  if (entity.priority === "High") return "high";
  if (entity.priority === "Low") return "low";
  if (
    /\b(critical|severe|blocked|blocker|halt|failed|failure|cannot launch|cannot proceed)\b/i.test(`${entity.title} ${entity.description}`)
  ) {
    return "critical";
  }
  return "medium";
}

function idSegment(value: string, fallback: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || fallback
  );
}
