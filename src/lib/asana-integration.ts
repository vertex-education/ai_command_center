import { createServerFn } from "@tanstack/react-start";
import type { WorkspaceMode } from "@/lib/pmo-data";

export type AsanaConnectionSummary = {
  connected: boolean;
  configured: boolean;
  connection: {
    id: string;
    asanaUserGid: string;
    asanaUserName: string;
    asanaUserEmail: string | null;
    scopes: string[];
    connectedAt: number;
    updatedAt: number;
  } | null;
  requiredScopes: string[];
  missingScopes: string[];
  projectDiscoveryIssue: string | null;
  asanaProjects: AsanaProjectOption[];
  vertexProjects: VertexProjectOption[];
  mappings: AsanaProjectMappingView[];
  teams: VertexTeamOption[];
};

export type AsanaProjectOption = {
  gid: string;
  name: string;
  workspaceGid: string;
  workspaceName: string;
  teamGid: string | null;
  teamName: string | null;
  portfolioGid: string | null;
  portfolioName: string | null;
  canWriteTasks: boolean;
  permissionLevel: "write" | "read" | "unknown";
  permissionSource: string;
};

export type VertexProjectOption = {
  id: string;
  name: string;
  description: string;
  mode: WorkspaceMode;
  workspaceId: string;
  teamId: string | null;
  chatId: string | null;
};

export type VertexTeamOption = {
  id: string;
  name: string;
};

export type AsanaProjectMappingView = {
  id: string;
  asanaProjectGid: string;
  asanaProjectName: string;
  asanaWorkspaceName: string;
  vertexProjectId: string;
  vertexProjectName: string | null;
  vertexMode: WorkspaceMode;
  vertexTeamId: string | null;
  vertexChatId: string | null;
  canWriteTasks: boolean;
  permissionLevel: string;
  permissionSource: string;
  updatedAt: number;
};

export type AsanaMappingSelection = {
  asanaProjectGid: string;
  action: "ignore" | "map" | "scaffold";
  vertexProjectId?: string | null;
  targetMode?: WorkspaceMode;
  targetTeamId?: string | null;
};

export type AsanaTaskStatusCustomFieldOption = {
  gid: string;
  name: string;
  type: string | null;
};

export const startAsanaConnection = createServerFn({ method: "POST" }).handler(async () => {
  const { startAsanaConnectionForCurrentUser } = await import("@/lib/asana-integration.server");
  return startAsanaConnectionForCurrentUser();
});

export const disconnectAsanaConnection = createServerFn({ method: "POST" }).handler(async () => {
  const { disconnectAsanaConnectionForCurrentUser } = await import("@/lib/asana-integration.server");
  return disconnectAsanaConnectionForCurrentUser();
});

export const getAsanaConnectionSummary = createServerFn({ method: "GET" }).handler(async (): Promise<AsanaConnectionSummary> => {
  const { getAsanaConnectionSummaryForCurrentUser } = await import("@/lib/asana-integration.server");
  return getAsanaConnectionSummaryForCurrentUser();
});

export const saveAsanaProjectMappings = createServerFn({ method: "POST" })
  .validator((data: { selections: AsanaMappingSelection[] }) => data)
  .handler(async ({ data }) => {
    const { saveAsanaProjectMappingsForCurrentUser } = await import("@/lib/asana-integration.server");
    return saveAsanaProjectMappingsForCurrentUser(data);
  });

export const createAsanaTaskForMappedProject = createServerFn({ method: "POST" })
  .validator((data: { vertexProjectId: string; title: string; notes?: string }) => data)
  .handler(async ({ data }) => {
    const { createAsanaTaskForMappedProjectForCurrentUser } = await import("@/lib/asana-integration.server");
    return createAsanaTaskForMappedProjectForCurrentUser(data);
  });

export const listAsanaTaskStatusCustomFields = createServerFn({ method: "POST" })
  .validator((data: { vertexProjectId: string }) => data)
  .handler(async ({ data }): Promise<AsanaTaskStatusCustomFieldOption[]> => {
    const { listAsanaTaskStatusCustomFieldsForCurrentUser } = await import("@/lib/asana-integration.server");
    return listAsanaTaskStatusCustomFieldsForCurrentUser(data);
  });
