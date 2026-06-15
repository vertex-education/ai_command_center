import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/start-server-core";
import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../db/schema";
import { runTrackedAiGateway } from "@/lib/ai-gateway";
import { roleHasEntityPermission } from "@/lib/auth-access-control";
import { getAuth } from "@/lib/auth";

export type RiskSeverity = "low" | "medium" | "high" | "critical";

export type RiskRecord = {
  id: string;
  workspaceId: string;
  projectId: string;
  title: string;
  description: string;
  severity: RiskSeverity;
  status: string;
  mitigationStrategy: string;
  clientStatus?: "pending";
};

export type RiskDashboard = {
  workspace: {
    id: string;
    name: string;
  };
  project: {
    id: string;
    name: string;
  };
  risks: RiskRecord[];
  canGenerateMitigations: boolean;
};

type AuthSession = {
  user: {
    id: string;
    role?: string | null;
  };
};

type RiskScopeInput = {
  workspaceId: string;
  projectId: string;
};

type GenerateMitigationInput = RiskScopeInput & {
  riskId: string;
};

const mitigationModelId = "@cf/google/gemma-4-26b-a4b-it";

function getDb() {
  const db = (env as Env).DB;
  if (!db) throw new Error("D1 binding DB is required for risk management.");
  return drizzle(db, { schema });
}

function getAi() {
  const ai = (env as Env & { AI?: Ai }).AI;
  if (!ai) throw new Error("Workers AI binding AI is required to generate mitigation strategies.");
  return ai;
}

async function currentSession() {
  const request = getRequest();
  const session = await getAuth(request).api.getSession({ headers: request.headers });
  if (!session) throw new Error("Sign in is required.");
  return session as AuthSession;
}

function canGenerateMitigations(session: AuthSession) {
  return roleHasEntityPermission(session.user.role, "risks", "update");
}

function normalizeScopeInput(data: RiskScopeInput) {
  const workspaceId = data.workspaceId.trim();
  const projectId = data.projectId.trim();
  if (!workspaceId || !projectId) throw new Error("Workspace and project are required.");
  return { workspaceId, projectId };
}

function normalizeRiskInput(data: GenerateMitigationInput) {
  const scope = normalizeScopeInput(data);
  const riskId = data.riskId.trim();
  if (!riskId) throw new Error("Risk is required.");
  return { ...scope, riskId };
}

function extractGeneratedText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;

  for (const key of ["response", "text", "output_text", "generated_text"]) {
    const nested = record[key];
    if (typeof nested === "string" && nested.trim()) return nested;
  }

  if (Array.isArray(record.choices)) {
    const choice = record.choices[0] as Record<string, unknown> | undefined;
    const message = choice?.message as Record<string, unknown> | undefined;
    if (typeof message?.content === "string") return message.content;
    if (typeof choice?.text === "string") return choice.text;
  }

  if (Array.isArray(record.result)) {
    return record.result.map(extractGeneratedText).filter(Boolean).join("\n").trim();
  }

  return "";
}

async function requireProjectScope(workspaceId: string, projectId: string) {
  const db = getDb();
  const [workspace] = await db
    .select({ id: schema.workspaces.id, name: schema.workspaces.name })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);
  if (!workspace) throw new Error("Workspace was not found.");

  const [project] = await db
    .select({ id: schema.projects.id, name: schema.projects.name })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.workspaceId, workspaceId)))
    .limit(1);
  if (!project) throw new Error("Project was not found in this workspace.");

  return { db, workspace, project };
}

export const listProjectRisks = createServerFn({ method: "GET" })
  .validator((data: RiskScopeInput) => normalizeScopeInput(data))
  .handler(async ({ data }): Promise<RiskDashboard> => {
    const session = await currentSession();
    const { db, workspace, project } = await requireProjectScope(data.workspaceId, data.projectId);
    const rows = await db
      .select()
      .from(schema.risks)
      .where(and(eq(schema.risks.workspaceId, data.workspaceId), eq(schema.risks.projectId, data.projectId)));

    return {
      workspace,
      project,
      risks: rows,
      canGenerateMitigations: canGenerateMitigations(session),
    };
  });

export const generateRiskMitigation = createServerFn({ method: "POST" })
  .validator((data: GenerateMitigationInput) => normalizeRiskInput(data))
  .handler(async ({ data }): Promise<RiskRecord> => {
    const session = await currentSession();
    if (!canGenerateMitigations(session)) throw new Error("Viewer accounts cannot generate mitigation strategies.");

    const { db, workspace, project } = await requireProjectScope(data.workspaceId, data.projectId);
    const [risk] = await db
      .select()
      .from(schema.risks)
      .where(
        and(eq(schema.risks.id, data.riskId), eq(schema.risks.workspaceId, data.workspaceId), eq(schema.risks.projectId, data.projectId)),
      )
      .limit(1);
    if (!risk) throw new Error("Risk was not found in this scope.");

    const result = await runTrackedAiGateway(
      getAi(),
      mitigationModelId,
      {
        messages: [
          {
            role: "system",
            content: [
              "You are an operational risk manager for an education technology PMO.",
              "Create detailed, practical mitigation plans in markdown.",
              "Use headings and bullets. Include owners, immediate controls, preventive controls, monitoring signals, escalation path, and residual risk.",
              "Do not invent facts beyond the supplied risk, workspace, project, severity, and status.",
            ].join(" "),
          },
          {
            role: "user",
            content: [
              `Workspace: ${workspace.name} (${workspace.id})`,
              `Project: ${project.name} (${project.id})`,
              `Risk title: ${risk.title}`,
              `Severity: ${risk.severity}`,
              `Status: ${risk.status}`,
              "Risk description:",
              risk.description,
            ].join("\n"),
          },
        ],
        max_completion_tokens: 900,
        temperature: 0.2,
      },
      {
        feature: "risk-mitigation-generation",
        model: mitigationModelId,
        projectId: project.id,
        identity: {
          userId: session.user.id,
          workspaceId: workspace.id,
          projectId: project.id,
          scopeType: "risk-mitigation",
        },
        metadata: {
          userId: session.user.id,
          workspaceId: workspace.id,
          riskId: risk.id,
          severity: risk.severity,
        },
      },
    );

    const mitigationStrategy = extractGeneratedText(result).trim();
    if (!mitigationStrategy) throw new Error("The mitigation model did not return a strategy.");

    const [updatedRisk] = await db
      .update(schema.risks)
      .set({ mitigationStrategy })
      .where(
        and(eq(schema.risks.id, data.riskId), eq(schema.risks.workspaceId, data.workspaceId), eq(schema.risks.projectId, data.projectId)),
      )
      .returning();
    if (!updatedRisk) throw new Error("Risk mitigation was generated but the row could not be updated.");

    return updatedRisk;
  });
