import type { WorkspaceScope } from "@/lib/pmo-data";

export type LightweightRisk = {
  id: string;
  projectId: string | null;
  severity: "low" | "medium" | "high" | "critical";
  mitigationStrategy: string;
};

export const riskSeverityRank: Record<LightweightRisk["severity"], number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export function getScopedRisks<TRisk extends { projectId: string | null }>(risks: TRisk[], projectId: string | null) {
  return risks.filter((risk) => risk.projectId === projectId);
}

export function getRiskStats(risks: LightweightRisk[]) {
  return {
    total: risks.length,
    critical: risks.filter((risk) => risk.severity === "critical").length,
    mitigated: risks.filter((risk) => risk.mitigationStrategy.trim().length > 0).length,
  };
}

export function riskManagementHref(scope: WorkspaceScope, projectId: string | null | undefined) {
  const params = new URLSearchParams({
    mode: modeForScope(scope),
    tab: "Risks",
  });
  if (projectId) params.set("projectId", projectId);
  return `/?${params.toString()}`;
}

export function workspaceScopeFromId(workspaceId: string): WorkspaceScope | null {
  const scope = workspaceId.replace(/^ws-/, "").toLowerCase();
  if (scope === "personal" || scope === "team" || scope === "org") return scope;
  return null;
}

function modeForScope(scope: WorkspaceScope) {
  if (scope === "team") return "Team";
  if (scope === "org") return "Org";
  return "Personal";
}
