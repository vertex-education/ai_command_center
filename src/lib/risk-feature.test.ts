import { describe, expect, it } from "vitest";
import {
  getRiskStats,
  getScopedRisks,
  riskManagementHref,
  riskSeverityRank,
  workspaceScopeFromId,
  type LightweightRisk,
} from "@/lib/risk-feature";

const risks: LightweightRisk[] = [
  {
    id: "workspace-risk",
    projectId: null,
    severity: "medium",
    mitigationStrategy: "",
  },
  {
    id: "project-a-critical",
    projectId: "project-a",
    severity: "critical",
    mitigationStrategy: "## Immediate controls\n- Assign owner.",
  },
  {
    id: "project-a-low",
    projectId: "project-a",
    severity: "low",
    mitigationStrategy: "   ",
  },
  {
    id: "project-b-high",
    projectId: "project-b",
    severity: "high",
    mitigationStrategy: "Monitor weekly.",
  },
];

describe("risk feature helpers", () => {
  it("returns only risks explicitly associated with the active project scope", () => {
    expect(getScopedRisks(risks, "project-a").map((risk) => risk.id)).toEqual(["project-a-critical", "project-a-low"]);
  });

  it("returns workspace-level risks when the active scope has no project", () => {
    expect(getScopedRisks(risks, null).map((risk) => risk.id)).toEqual(["workspace-risk"]);
  });

  it("counts critical and mitigated risks for lightweight workspace metrics", () => {
    expect(getRiskStats(getScopedRisks(risks, "project-a"))).toEqual({
      total: 2,
      critical: 1,
      mitigated: 1,
    });
  });

  it("orders severity from low through critical for table sorting", () => {
    const ordered = [...risks]
      .sort((left, right) => riskSeverityRank[right.severity] - riskSeverityRank[left.severity])
      .map((risk) => risk.severity);

    expect(ordered).toEqual(["critical", "high", "medium", "low"]);
  });

  it("builds command-center risk links scoped to mode and project", () => {
    expect(riskManagementHref("team", "project with spaces")).toBe("/?mode=Team&tab=Risks&projectId=project+with+spaces");
    expect(riskManagementHref("team", null)).toBe("/?mode=Team&tab=Risks");
  });

  it("resolves workspace ids back to workspace scope", () => {
    expect(workspaceScopeFromId("ws-personal")).toBe("personal");
    expect(workspaceScopeFromId("ws-team")).toBe("team");
    expect(workspaceScopeFromId("ws-org")).toBe("org");
    expect(workspaceScopeFromId("unknown")).toBeNull();
  });
});
