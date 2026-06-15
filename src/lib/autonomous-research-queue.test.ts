import { describe, expect, it, vi } from "vitest";
import {
  autonomousResearchMetadataSource,
  buildAutonomousResearchJob,
  buildAutonomousResearchVectorMetadata,
  firecrawlDocumentsFromPayload,
  formulateAutonomousResearchQueries,
  isAutonomousResearchJob,
  publishAutonomousResearchTrigger,
  type AutonomousResearchJob,
  type AutonomousResearchProducerEnv,
} from "@/lib/autonomous-research-queue";

const job: AutonomousResearchJob = {
  kind: "autonomous-research-index",
  description: "Build a Microsoft Graph webhook monitoring workflow for project planning events and downstream PMO reporting.",
  entityId: "project-1",
  entityType: "project",
  projectId: "project-1",
  requestId: "research-1",
  requestedAt: 123,
  sourceUserId: "user-1",
  tags: ["Planning", "Microsoft Graph", "PMO"],
  teamId: "team-1",
  title: "Graph Webhook Monitoring",
  workspaceId: "ws-team",
  workspaceMode: "Team",
};

describe("autonomous research queue", () => {
  it("validates autonomous research queue payloads", () => {
    expect(isAutonomousResearchJob(job)).toBe(true);
    expect(isAutonomousResearchJob({ ...job, kind: "asana-task-create" })).toBe(false);
    expect(isAutonomousResearchJob({ ...job, workspaceMode: "Invalid" })).toBe(false);
    expect(isAutonomousResearchJob({ ...job, tags: ["ok", 42] })).toBe(false);
  });

  it("builds and publishes a JSON queue payload", async () => {
    const send = vi.fn(async () => ({ metadata: { metrics: { backlogBytes: 0, backlogCount: 1 } } }));
    const env = { AUTONOMOUS_RESEARCH_QUEUE: { send } } as unknown as AutonomousResearchProducerEnv;

    await expect(
      publishAutonomousResearchTrigger(env, {
        description: "Research stakeholder mapping automation for launch planning.",
        entityId: "idea-1",
        entityType: "idea",
        projectId: null,
        requestId: "research-idea-1",
        requestedAt: 456,
        sourceUserId: "user-1",
        tags: ["Workflow"],
        teamId: null,
        title: "Stakeholder Mapping Automation",
        workspaceId: "ws-org",
        workspaceMode: "Org",
      }),
    ).resolves.toBe(true);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: "idea-1",
        kind: "autonomous-research-index",
        requestId: "research-idea-1",
      }),
      { contentType: "json" },
    );
  });

  it("does not fail the caller when the queue binding is absent", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(publishAutonomousResearchTrigger({}, job)).resolves.toBe(false);
    warn.mockRestore();
  });

  it("formulates bounded search queries from entity context", () => {
    const queries = formulateAutonomousResearchQueries(job);

    expect(queries).toHaveLength(3);
    expect(queries[0]).toContain("Graph Webhook Monitoring");
    expect(queries.join(" ")).toContain("microsoft");
    expect(queries.every((query) => query.length <= 220)).toBe(true);
  });

  it("extracts Firecrawl markdown results from v2 and legacy payload shapes", () => {
    expect(
      firecrawlDocumentsFromPayload(
        [
          {
            markdown: "# Webhooks\nDeep content",
            title: "Webhook guide",
            url: "https://example.com/webhooks",
          },
        ],
        "webhook query",
      ),
    ).toEqual([
      {
        markdown: "# Webhooks\nDeep content",
        query: "webhook query",
        title: "Webhook guide",
        url: "https://example.com/webhooks",
      },
    ]);

    expect(
      firecrawlDocumentsFromPayload(
        {
          data: [
            {
              content: "Fallback markdown",
              metadata: { title: "Metadata title", url: "https://example.com/research" },
            },
          ],
        },
        "legacy query",
      )[0],
    ).toMatchObject({
      markdown: "Fallback markdown",
      query: "legacy query",
      title: "Metadata title",
      url: "https://example.com/research",
    });
  });

  it("marks Vectorize metadata as autonomous research", () => {
    const metadata = buildAutonomousResearchVectorMetadata(job, {
      markdown: "# Content",
      query: "webhook query",
      title: "Webhook guide",
      url: "https://docs.example.com/webhooks",
    });

    expect(metadata.source).toBe(autonomousResearchMetadataSource);
    expect(metadata.source).toBe("autonomous_research");
    expect(metadata.entity_type).toBe("project");
    expect(metadata.source_domain).toBe("docs.example.com");
  });

  it("normalizes trigger input into a queue job", () => {
    expect(
      buildAutonomousResearchJob({
        ...job,
        description: "  Multiple\n\nspaces  ",
        requestId: "fixed",
        tags: ["  One  ", "", "Two"],
      }),
    ).toMatchObject({
      description: "Multiple spaces",
      requestId: "fixed",
      tags: ["One", "Two"],
    });
  });
});
