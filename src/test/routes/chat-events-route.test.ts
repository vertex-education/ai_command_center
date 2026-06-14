import { describe, expect, it } from "vitest";
import { normalizeMode, presenceScopeKey } from "@/routes/api/chat-events";

describe("chat event subscription helpers", () => {
  it("accepts only canonical workspace modes", () => {
    expect(normalizeMode("Personal")).toBe("Personal");
    expect(normalizeMode("Team")).toBe("Team");
    expect(normalizeMode("Org")).toBe("Org");
    expect(normalizeMode("Org ")).toBeNull();
  });

  it("builds Durable Object presence scope keys by workspace mode", () => {
    expect(presenceScopeKey({ mode: "Team", workspaceId: "ws-team", teamId: "team-1", userId: "user-1" })).toBe("ws-team:team:team-1");
    expect(presenceScopeKey({ mode: "Org", workspaceId: "ws-org", teamId: null, userId: "user-1" })).toBe("ws-org:org");
    expect(presenceScopeKey({ mode: "Personal", workspaceId: "ws-personal", teamId: null, userId: "user-1" })).toBe("ws-personal:user:user-1");
  });
});
