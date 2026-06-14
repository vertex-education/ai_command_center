import { describe, expect, it } from "vitest";
import {
  buildDynamicWorkspaceContextHeader,
  buildInferenceAuthorizationDirective,
  buildVertexAiSystemPrompt,
  prependDynamicWorkspaceContextHeader,
  prependInferenceAuthorizationDirective,
} from "@/lib/prompts";

describe("VertexAI prompt construction", () => {
  it("puts workspace and project context into a priority header with safe fallbacks", () => {
    const header = buildDynamicWorkspaceContextHeader({
      workspaceName: "Team Workspace",
      projectName: "  ",
      projectDescription: null,
      projectInstructions: "Use PMO terminology.",
      projectStatus: "Blocked",
    });

    expect(header).toMatch(/^=== PRIORITY WORKSPACE CONTEXT/);
    expect(header).toContain("Workspace name: Team Workspace");
    expect(header).toContain("Active project: No active project selected.");
    expect(header).toContain("Active project status: Blocked");
    expect(header).toContain("Detailed project description: No project description is recorded.");
    expect(header).toContain("Project-specific instructions: Use PMO terminology.");
  });

  it("prepends dynamic workspace context before the base system prompt", () => {
    const prompt = prependDynamicWorkspaceContextHeader("Base system prompt.", {
      workspaceName: "Org Workspace",
      projectName: "Vertex Hub",
      projectDescription: "Document management rollout.",
      projectInstructions: null,
      projectStatus: "In Progress",
    });

    expect(prompt.indexOf("=== PRIORITY WORKSPACE CONTEXT")).toBeLessThan(prompt.indexOf("Base system prompt."));
    expect(prompt).toContain("Active project: Vertex Hub");
  });

  it("builds a viewer-safe inference authorization directive", () => {
    const directive = buildInferenceAuthorizationDirective({
      role: "viewer",
      canModifyState: false,
      canAccessConfidentialArtifacts: false,
    });

    expect(directive).toContain("role of viewer");
    expect(directive).toContain("State modification allowed: no.");
    expect(directive).toContain("Confidential artifact access allowed: no.");
    expect(directive).toContain("this directive wins");
  });

  it("places authorization constraints before all other prompt content", () => {
    const prompt = prependInferenceAuthorizationDirective("Use retrieved project context.", {
      role: "admin",
      canModifyState: true,
      canAccessConfidentialArtifacts: true,
    });

    expect(prompt.startsWith("=== ABSOLUTE INFERENCE AUTHORIZATION CONSTRAINT ===")).toBe(true);
    expect(prompt).toContain("\n\nUse retrieved project context.");
  });

  it("keeps the base assistant prompt general-purpose but scope-aware", () => {
    const prompt = buildVertexAiSystemPrompt();

    expect(prompt).toContain("You are VertexAI");
    expect(prompt).toContain("Do not refuse or redirect a general request");
    expect(prompt).toContain("stay within the selected scope");
  });
});
