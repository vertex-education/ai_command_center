import { describe, expect, it } from "vitest";
import { isAllowedAccountEmail } from "@/lib/auth-workflow";

describe("account invite email guardrails", () => {
  it("allows Vertex Education accounts regardless of case or whitespace", () => {
    expect(isAllowedAccountEmail(" Person@VertexEducation.com ")).toBe(true);
  });

  it("allows the configured test account and blocks outside domains", () => {
    expect(isAllowedAccountEmail("rogerleecormier@gmail.com")).toBe(true);
    expect(isAllowedAccountEmail("person@example.com")).toBe(false);
    expect(isAllowedAccountEmail("person@fakevertexeducation.com")).toBe(false);
  });
});
