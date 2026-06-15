import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements as adminDefaultStatements } from "better-auth/plugins/admin/access";
import { defaultStatements as organizationDefaultStatements } from "better-auth/plugins/organization/access";

export const vertexAccessStatements = {
  ...adminDefaultStatements,
  ...organizationDefaultStatements,
  workspaces: ["create", "read", "update", "delete"],
  projects: ["create", "read", "update", "delete"],
  artifacts: ["create", "read", "update", "delete"],
  risks: ["create", "read", "update", "delete"],
} as const;

export const vertexAccessControl = createAccessControl(vertexAccessStatements);

const viewerRole = vertexAccessControl.newRole({
  user: [],
  session: [],
  organization: [],
  member: [],
  invitation: [],
  team: [],
  ac: ["read"],
  workspaces: ["read"],
  projects: ["read"],
  artifacts: ["read"],
  risks: ["read"],
});

const contributorRole = vertexAccessControl.newRole({
  user: [],
  session: [],
  organization: [],
  member: [],
  invitation: [],
  team: [],
  ac: ["read"],
  workspaces: ["read"],
  projects: ["read"],
  artifacts: ["create", "read", "update"],
  risks: ["create", "read", "update"],
});

const managerRole = vertexAccessControl.newRole({
  user: [],
  session: [],
  organization: ["update"],
  member: ["create", "update"],
  invitation: ["create", "cancel"],
  team: ["create", "update", "delete"],
  ac: ["read"],
  workspaces: ["read", "update"],
  projects: ["create", "read", "update", "delete"],
  artifacts: ["create", "read", "update", "delete"],
  risks: ["create", "read", "update", "delete"],
});

const adminRole = vertexAccessControl.newRole({
  user: ["create", "list", "set-role", "ban", "impersonate", "impersonate-admins", "delete", "set-password", "set-email", "get", "update"],
  session: ["list", "revoke", "delete"],
  organization: ["update", "delete"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  team: ["create", "update", "delete"],
  ac: ["create", "read", "update", "delete"],
  workspaces: ["create", "read", "update", "delete"],
  projects: ["create", "read", "update", "delete"],
  artifacts: ["create", "read", "update", "delete"],
  risks: ["create", "read", "update", "delete"],
});

export const vertexAuthRoles = {
  admin: adminRole,
  manager: managerRole,
  contributor: contributorRole,
  viewer: viewerRole,
  // Compatibility aliases for existing Better Auth/app records.
  owner: adminRole,
  user: contributorRole,
  member: viewerRole,
} as const;

export type VertexAuthRole = "viewer" | "contributor" | "manager" | "admin";
export type StoredAuthRole = VertexAuthRole | "user" | "owner" | "member";
export type AccessControlledEntity = "workspaces" | "projects" | "artifacts" | "risks";
export type CrudAction = "create" | "read" | "update" | "delete";

export const vertexAuthRoleLabels: Record<VertexAuthRole, string> = {
  viewer: "Viewer",
  contributor: "Contributor",
  manager: "Manager",
  admin: "Admin",
};

const roleRank: Record<VertexAuthRole, number> = {
  viewer: 0,
  contributor: 1,
  manager: 2,
  admin: 3,
};

export function normalizeVertexRole(role: string | null | undefined): VertexAuthRole {
  const normalized = role?.trim().toLowerCase();
  if (normalized === "admin" || normalized === "manager" || normalized === "contributor" || normalized === "viewer") return normalized;
  if (normalized === "owner") return "admin";
  if (normalized === "user") return "contributor";
  return "viewer";
}

export function roleDisplayName(role: string | null | undefined) {
  return vertexAuthRoleLabels[normalizeVertexRole(role)];
}

export function roleMeetsMinimum(role: string | null | undefined, minimumRole: VertexAuthRole) {
  return roleRank[normalizeVertexRole(role)] >= roleRank[minimumRole];
}

export function isAdminRole(role: string | null | undefined) {
  return normalizeVertexRole(role) === "admin";
}

export function roleCanModifyState(role: string | null | undefined) {
  const normalized = normalizeVertexRole(role);
  return normalized !== "viewer";
}

export function roleCanAccessConfidentialArtifacts(role: string | null | undefined) {
  return roleMeetsMinimum(role, "contributor");
}

export function roleHasEntityPermission(role: string | null | undefined, entity: AccessControlledEntity, action: CrudAction) {
  return vertexAuthRoles[normalizeVertexRole(role)].authorize({ [entity]: [action] }).success;
}

export function entityPermissionMatrix(role: string | null | undefined) {
  const entities = ["workspaces", "projects", "artifacts", "risks"] as const;
  const actions = ["create", "read", "update", "delete"] as const;
  return Object.fromEntries(
    entities.map((entity) => [
      entity,
      Object.fromEntries(actions.map((action) => [action, roleHasEntityPermission(role, entity, action)])),
    ]),
  ) as Record<AccessControlledEntity, Record<CrudAction, boolean>>;
}
