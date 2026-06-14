import { describe, expect, it } from "vitest";
import { isObjectRecord } from "@/routes/api/graph/webhooks";

describe("Microsoft Graph webhook route helpers", () => {
  it("accepts only plain JSON-object webhook payloads", () => {
    expect(isObjectRecord({ value: [] })).toBe(true);
    expect(isObjectRecord(null)).toBe(false);
    expect(isObjectRecord([])).toBe(false);
    expect(isObjectRecord("payload")).toBe(false);
  });
});
