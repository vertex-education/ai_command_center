import { describe, expect, it } from "vitest";
import { defaultAiGatewayFallbackModelId, getAiGatewayLogId, getAiGatewayResponseMetadata, runAiGateway } from "@/lib/ai-gateway";

describe("AI Gateway wrapper", () => {
  it("runs Workers AI through the configured gateway with identity metadata headers", async () => {
    const calls: unknown[] = [];
    const ai = {
      aiGatewayLogId: "legacy-log",
      gateway(gatewayId: string) {
        return {
          run(payload: unknown, options: unknown) {
            calls.push({ gatewayId, payload, options });
            return Promise.resolve(
              new Response(JSON.stringify({ response: "ok" }), {
                headers: {
                  "content-type": "application/json",
                  "cf-aig-log-id": "log-123",
                  "cf-aig-step": "0",
                  "cf-aig-model": "@cf/test/model",
                  "cf-aig-provider": "workers-ai",
                },
              }),
            );
          },
        };
      },
    } as unknown as Ai;

    const result = await runAiGateway(
      ai,
      "@cf/test/model",
      { prompt: "hello" },
      {
        env: { CLOUDFLARE_AI_GATEWAY_ID: " vertex-gateway ", CLOUDFLARE_API_TOKEN: "token-123" },
        fallbackModel: null,
        identity: {
          organizationId: "vertex",
          projectId: "project-1",
          teamId: "team-1",
          userId: "user-1",
          workspaceId: "workspace-1",
        },
        metadata: {
          feature: "test",
        },
        cacheTtl: 60,
        skipCache: false,
      },
    );

    expect(result).toEqual({ response: "ok" });
    expect(getAiGatewayLogId(ai, result)).toBe("log-123");
    expect(getAiGatewayResponseMetadata(result)).toMatchObject({
      fallbackUsed: false,
      gatewayId: "vertex-gateway",
      model: "@cf/test/model",
      provider: "workers-ai",
      step: 0,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      gatewayId: "vertex-gateway",
      payload: {
        provider: "workers-ai",
        endpoint: "@cf/test/model",
        query: { prompt: "hello" },
      },
      options: {
        gateway: {
          skipCache: false,
          cacheTtl: 60,
        },
      },
    });
    const payload = calls[0] as { payload: { headers: Record<string, string> } };
    expect(JSON.parse(payload.payload.headers["cf-aig-metadata"])).toEqual({
      user_id: "user-1",
      org_id: "vertex",
      workspace_id: "workspace-1",
      team_id: "team-1",
      project_id: "project-1",
    });
    expect(payload.payload.headers["cf-aig-cache-ttl"]).toBe("60");
  });

  it("falls back to the default gateway id when none is configured", async () => {
    let gatewayId = "";
    const ai = {
      gateway(id: string) {
        gatewayId = id;
        return {
          run() {
            return Promise.resolve(new Response(JSON.stringify({ response: "ok" }), { headers: { "content-type": "application/json" } }));
          },
        };
      },
    } as unknown as Ai;

    await runAiGateway(ai, "model", {}, { env: { CLOUDFLARE_API_TOKEN: "token-123" }, fallbackModel: null });

    expect(gatewayId).toBe("default");
    expect(getAiGatewayLogId(null)).toBeNull();
  });

  it("accepts gateway fallback responses and records cf-aig-step metadata", async () => {
    let payload: unknown;
    const ai = {
      gateway() {
        return {
          run(data: unknown) {
            payload = data;
            return Promise.resolve(
              new Response(JSON.stringify({ response: "fallback ok" }), {
                headers: {
                  "content-type": "application/json",
                  "cf-aig-log-id": "log-fallback",
                  "cf-aig-model": defaultAiGatewayFallbackModelId,
                  "cf-aig-provider": "workers-ai",
                  "cf-aig-step": "1",
                },
              }),
            );
          },
        };
      },
    } as unknown as Ai;

    const result = await runAiGateway(
      ai,
      "@cf/primary/model",
      {
        messages: [{ role: "user", content: "hello" }],
      },
      { env: { CLOUDFLARE_API_TOKEN: "token-123" } },
    );

    expect(result).toEqual({ response: "fallback ok" });
    expect(payload).toMatchObject([
      { endpoint: "@cf/primary/model", provider: "workers-ai" },
      { endpoint: defaultAiGatewayFallbackModelId, provider: "workers-ai" },
    ]);
    expect(getAiGatewayResponseMetadata(result)).toMatchObject({
      fallbackUsed: true,
      logId: "log-fallback",
      model: defaultAiGatewayFallbackModelId,
      provider: "workers-ai",
      step: 1,
    });
  });

  it("uses the Workers AI binding gateway path when no provider token is configured", async () => {
    const calls: unknown[] = [];
    const ai = {
      aiGatewayLogId: "binding-log",
      run(model: string, inputs: Record<string, unknown>, options: unknown) {
        calls.push({ model, inputs, options });
        return Promise.resolve({ response: "binding ok" });
      },
    } as unknown as Ai;

    const result = await runAiGateway(
      ai,
      "@cf/test/model",
      { messages: [{ role: "user", content: "hello" }] },
      {
        env: { CLOUDFLARE_AI_GATEWAY_ID: "binding-gateway" },
        identity: {
          userId: "user-1",
          workspaceId: "workspace-1",
          projectId: "project-1",
        },
      },
    );

    expect(result).toEqual({ response: "binding ok" });
    expect(getAiGatewayLogId(ai, result)).toBe("binding-log");
    expect(getAiGatewayResponseMetadata(result)).toMatchObject({
      fallbackUsed: false,
      gatewayId: "binding-gateway",
      provider: "workers-ai",
      step: null,
    });
    expect(calls).toMatchObject([
      {
        model: "@cf/test/model",
        inputs: { messages: [{ role: "user", content: "hello" }] },
        options: {
          gateway: {
            id: "binding-gateway",
            skipCache: true,
          },
        },
      },
    ]);
  });
});
