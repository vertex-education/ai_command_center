import { describe, expect, it } from "vitest";
import { isAsanaOutboundJob, type AsanaOutboundJob } from "@/lib/asana-outbound-queue";

const job: AsanaOutboundJob = {
  kind: "asana-outbound-request",
  body: JSON.stringify({ data: { name: "Task" } }),
  headers: { Authorization: "Bearer token" },
  method: "POST",
  requestId: "asana-outbound-1",
  requestedAt: 123,
  url: "https://app.asana.com/api/1.0/webhooks",
  workspaceActionId: "task-1",
  workspaceId: "ws-team",
};

describe("Asana outbound queue", () => {
  it("accepts only bounded outbound request payloads", () => {
    expect(isAsanaOutboundJob(job)).toBe(true);
    expect(isAsanaOutboundJob({ ...job, method: "GET" })).toBe(false);
    expect(isAsanaOutboundJob({ ...job, headers: { Authorization: 123 } })).toBe(false);
    expect(isAsanaOutboundJob({ ...job, workspaceActionId: null, workspaceId: null })).toBe(true);
  });
});
