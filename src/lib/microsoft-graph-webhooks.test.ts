import { describe, expect, it } from "vitest";
import {
  assertMicrosoftGraphTeamsSubscriptionCapacity,
  getMicrosoftGraphTeamsSubscriptionUsage,
  inferMicrosoftGraphResourceKind,
  registerMicrosoftGraphSubscription,
} from "@/lib/microsoft-graph-webhooks";

function usageEnv(count: number) {
  const calls: string[] = [];
  return {
    calls,
    DB: {
      prepare(sql: string) {
        calls.push(sql);
        return {
          bind() {
            return this;
          },
          async first() {
            return { count };
          },
          async run() {
            return {};
          },
        };
      },
    },
  } as unknown as Parameters<typeof getMicrosoftGraphTeamsSubscriptionUsage>[0] & { calls: string[] };
}

function registrationEnv({ exists = false, count = 0 } = {}) {
  const statements: string[] = [];
  return {
    statements,
    DB: {
      prepare(sql: string) {
        statements.push(sql);
        return {
          bind() {
            return this;
          },
          async first() {
            if (sql.includes("WHERE subscription_id = ?")) {
              return exists ? { subscription_id: "sub-1" } : null;
            }
            return { count };
          },
          async run() {
            return {};
          },
        };
      },
    },
  } as unknown as Parameters<typeof registerMicrosoftGraphSubscription>[0] & { statements: string[] };
}

describe("Microsoft Graph webhook tracking", () => {
  it("classifies Teams, Outlook, and unknown resources", () => {
    expect(inferMicrosoftGraphResourceKind("/teams/team-id/channels/channel-id/messages")).toBe("teams");
    expect(inferMicrosoftGraphResourceKind("chats/chat-id/messages")).toBe("teams");
    expect(inferMicrosoftGraphResourceKind("/me/messages")).toBe("outlook");
    expect(inferMicrosoftGraphResourceKind("/users/user-id/messages")).toBe("outlook");
    expect(inferMicrosoftGraphResourceKind("/groups/group-id/events")).toBe("other");
  });

  it("reports Teams subscription usage with remaining capacity and warnings", async () => {
    await expect(getMicrosoftGraphTeamsSubscriptionUsage(usageEnv(8_999))).resolves.toMatchObject({
      activeTeamsSubscriptions: 8_999,
      remaining: 1_001,
      warning: false,
      exceeded: false,
    });

    await expect(getMicrosoftGraphTeamsSubscriptionUsage(usageEnv(10_000))).resolves.toMatchObject({
      activeTeamsSubscriptions: 10_000,
      remaining: 0,
      warning: true,
      exceeded: true,
    });
  });

  it("blocks new Teams subscriptions that would exceed the tenant limit", async () => {
    await expect(assertMicrosoftGraphTeamsSubscriptionCapacity(usageEnv(9_999), 2)).rejects.toThrow(
      "Teams subscription limit would be exceeded",
    );
  });

  it("checks capacity before registering a new Teams subscription and then upserts it", async () => {
    const env = registrationEnv({ exists: false, count: 8 });

    await registerMicrosoftGraphSubscription(env, {
      subscriptionId: "sub-1",
      resource: "/teams/team-id/channels/channel-id/messages",
      changeType: "created",
    });

    expect(env.statements.some((statement) => statement.includes("SELECT subscription_id"))).toBe(true);
    expect(env.statements.some((statement) => statement.includes("COUNT(*) AS count"))).toBe(true);
    expect(env.statements.some((statement) => statement.includes("INSERT INTO microsoft_graph_subscriptions"))).toBe(true);
  });
});
