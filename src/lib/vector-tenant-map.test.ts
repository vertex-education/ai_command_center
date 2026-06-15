import { describe, expect, it } from "vitest";
import { vectorTenantKey } from "@/lib/vector-tenant-map";

describe("Vector tenant mapping", () => {
  it("compresses long tenant identifiers behind a stable D1-mapped key", () => {
    expect(
      vectorTenantKey({
        workspaceId: "ws-team-with-a-long-nested-organization-uuid",
        teamId: "team-123",
        projectId: "project-456",
      }),
    ).toBe("workspace:ws-team-with-a-long-nested-organization-uuid:team:team-123:project:project-456");
  });

  it("uses empty key segments for workspace-level or non-team scopes", () => {
    expect(
      vectorTenantKey({
        workspaceId: "ws-org",
        teamId: null,
        projectId: "project-1",
      }),
    ).toBe("workspace:ws-org:team::project:project-1");
    expect(
      vectorTenantKey({
        workspaceId: "ws-personal",
        projectId: null,
      }),
    ).toBe("workspace:ws-personal:team::project:");
  });
});
