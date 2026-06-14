import { describe, expect, it } from "vitest";
import { normalizeMode, parseLastEventId, sseEncode } from "@/routes/api/events";

describe("mutation event stream helpers", () => {
  it("accepts only known workspace modes", () => {
    expect(normalizeMode("Personal")).toBe("Personal");
    expect(normalizeMode("Team")).toBe("Team");
    expect(normalizeMode("Org")).toBe("Org");
    expect(normalizeMode("team")).toBeNull();
    expect(normalizeMode(null)).toBeNull();
  });

  it("parses safe positive last-event cursors", () => {
    expect(parseLastEventId("12")).toBe(12);
    expect(parseLastEventId("0")).toBe(0);
    expect(parseLastEventId("-1")).toBe(0);
    expect(parseLastEventId("1.5")).toBe(0);
    expect(parseLastEventId("not-a-number")).toBe(0);
  });

  it("encodes named SSE events with optional ids", () => {
    expect(sseEncode("mutation", 7, { ok: true })).toBe('id: 7\nevent: mutation\ndata: {"ok":true}\n\n');
    expect(sseEncode("stream-error", undefined, { message: "failed" })).toBe('event: stream-error\ndata: {"message":"failed"}\n\n');
  });
});
