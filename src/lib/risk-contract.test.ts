import { describe, expect, it } from "vitest";
import type { ChatOperationalEntity } from "@/lib/chat-entities";
import {
  createRiskFlagJsonBlocks,
  formatRiskFlagBlocks,
  normalizeRiskEntities,
  riskFlagSchema,
  riskSeverityFromEntity,
} from "@/lib/risk-contract";

const riskEntity: ChatOperationalEntity = {
  id: "vendor-slip",
  type: "Risk",
  title: "Vendor approval may slip",
  description: "The launch could be blocked if vendor approval does not arrive.",
  priority: "High",
  severity: null,
  confidence: 0.85,
  status: "active",
};

describe("risk contract", () => {
  it("normalizes risk entities once for streaming chips and persistence", () => {
    const scope = {
      assistantMessageId: "msg-stream-assistant-abc_12345",
      workspaceId: "ws-team",
      projectId: "project-a",
    };

    const [risk] = normalizeRiskEntities([riskEntity], scope);
    const [block] = createRiskFlagJsonBlocks([riskEntity], scope);
    const parsed = JSON.parse(block);

    expect(risk).toMatchObject({
      id: "risk-stream-assistant-abc_12345-vendor-slip",
      workspaceId: "ws-team",
      projectId: "project-a",
      title: "Vendor approval may slip",
      severity: "high",
      status: "open",
      mitigationStrategy: "",
    });
    expect(parsed).toEqual({
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
    });
  });

  it("falls back to critical severity from blocking language", () => {
    expect(
      riskSeverityFromEntity({
        ...riskEntity,
        id: "blocked-launch",
        priority: null,
        title: "Launch cannot proceed",
      }),
    ).toBe("critical");
  });

  it("formats risk JSON as fenced markdown only when blocks exist", () => {
    expect(formatRiskFlagBlocks([])).toBe("");
    expect(formatRiskFlagBlocks(["{}"])).toBe("\n\n```json\n{}\n```");
  });
});
