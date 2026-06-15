import { describe, expect, it } from "vitest";
import {
  entityPermissionMatrix,
  normalizeVertexRole,
  roleCanAccessConfidentialArtifacts,
  roleCanModifyState,
  roleHasEntityPermission,
} from "@/lib/auth-access-control";

describe("auth access control", () => {
  it("normalizes legacy and Better Auth organization aliases to the four Vertex roles", () => {
    expect(normalizeVertexRole("user")).toBe("contributor");
    expect(normalizeVertexRole("owner")).toBe("admin");
    expect(normalizeVertexRole("member")).toBe("viewer");
    expect(normalizeVertexRole("manager")).toBe("manager");
    expect(normalizeVertexRole(undefined)).toBe("viewer");
  });

  it("enforces the expected CRUD boundaries for viewer, contributor, manager, and admin", () => {
    expect(roleCanModifyState("viewer")).toBe(false);
    expect(roleCanModifyState("contributor")).toBe(true);
    expect(roleCanAccessConfidentialArtifacts("viewer")).toBe(false);
    expect(roleCanAccessConfidentialArtifacts("manager")).toBe(true);

    expect(roleHasEntityPermission("viewer", "artifacts", "read")).toBe(true);
    expect(roleHasEntityPermission("viewer", "artifacts", "update")).toBe(false);
    expect(roleHasEntityPermission("contributor", "artifacts", "update")).toBe(true);
    expect(roleHasEntityPermission("contributor", "projects", "update")).toBe(false);
    expect(roleHasEntityPermission("manager", "projects", "delete")).toBe(true);
    expect(roleHasEntityPermission("admin", "workspaces", "delete")).toBe(true);
  });

  it("builds a complete entity permission matrix for RAG prompt injection", () => {
    expect(entityPermissionMatrix("contributor")).toEqual({
      workspaces: { create: false, read: true, update: false, delete: false },
      projects: { create: false, read: true, update: false, delete: false },
      artifacts: { create: true, read: true, update: true, delete: false },
      risks: { create: true, read: true, update: true, delete: false },
    });
  });
});
