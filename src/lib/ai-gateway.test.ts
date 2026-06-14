import { describe, expect, it } from "vitest";
import { getAiGatewayLogId, runAiGateway } from "@/lib/ai-gateway";

describe("AI Gateway wrapper", () => {
  it("runs Workers AI through the configured gateway with compact metadata", async () => {
    const calls: unknown[] = [];
    const ai = {
      aiGatewayLogId: "log-123",
      run(model: string, inputs: Record<string, unknown>, options: unknown) {
        calls.push({ model, inputs, options });
        return Promise.resolve({ response: "ok" });
      },
    } as unknown as Ai;

    await expect(runAiGateway(ai, "@cf/test/model", { prompt: "hello" }, {
      env: { CLOUDFLARE_AI_GATEWAY_ID: " vertex-gateway " },
      metadata: {
        feature: "test",
        one: 1,
        two: 2,
        three: 3,
        four: 4,
        five: 5,
      },
      cacheTtl: 60,
      skipCache: false,
    } as unknown as Parameters<typeof runAiGateway>[3])).resolves.toEqual({ response: "ok" });

    expect(getAiGatewayLogId(ai)).toBe("log-123");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      model: "@cf/test/model",
      inputs: { prompt: "hello" },
      options: {
        gateway: {
          id: "vertex-gateway",
          skipCache: false,
          cacheTtl: 60,
          metadata: {
            app: "ai-command-center",
            feature: "test",
            one: 1,
            two: 2,
            three: 3,
          },
        },
      },
    });
  });

  it("falls back to the default gateway id when none is configured", async () => {
    let gatewayId = "";
    const ai = {
      run(_model: string, _inputs: Record<string, unknown>, options: { gateway: { id: string } }) {
        gatewayId = options.gateway.id;
        return Promise.resolve("ok");
      },
    } as unknown as Ai;

    await runAiGateway(ai, "model", {});

    expect(gatewayId).toBe("default");
    expect(getAiGatewayLogId(null)).toBeNull();
  });
});
