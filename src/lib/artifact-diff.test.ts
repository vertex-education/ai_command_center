import { describe, expect, it } from "vitest";
import {
  applyArtifactPatches,
  consumeArtifactPatchStream,
  parseArtifactPatchSequence,
  type ArtifactPatchAction,
} from "@/lib/artifact-diff";

describe("artifact diff patch utilities", () => {
  it("parses wrapped, array, single, and line-delimited patch payloads", () => {
    const replacePatch = { action: "replace", target_string: "old", new_string: "new" };
    const insertPatch = { action: "insert_after", target_string: "new", new_string: " value" };

    expect(parseArtifactPatchSequence(JSON.stringify({ patches: [replacePatch] }))).toEqual([{ ...replacePatch, occurrence: 1 }]);
    expect(parseArtifactPatchSequence(JSON.stringify([replacePatch]))).toEqual([{ ...replacePatch, occurrence: 1 }]);
    expect(parseArtifactPatchSequence(JSON.stringify(replacePatch))).toEqual([{ ...replacePatch, occurrence: 1 }]);
    expect(parseArtifactPatchSequence(`${JSON.stringify(replacePatch)}\n${JSON.stringify(insertPatch)}`)).toEqual([
      { ...replacePatch, occurrence: 1 },
      { ...insertPatch, occurrence: 1 },
    ]);
  });

  it("applies replace, insert, delete, and occurrence-specific patches in sequence", () => {
    const patches: ArtifactPatchAction[] = [
      { action: "replace", target_string: "Alpha", new_string: "Beta" },
      { action: "insert_after", target_string: "Beta", new_string: " launch" },
      { action: "delete", target_string: " third" },
      { action: "replace", target_string: "Alpha", new_string: "Gamma", occurrence: 2 },
    ];

    const result = applyArtifactPatches("Alpha first. Alpha second. Alpha third", patches);

    expect(result.text).toBe("Beta launch first. Alpha second. Gamma");
    expect(result.warnings).toEqual([]);
    expect(result.changes).toHaveLength(4);
    expect(result.changes[1]).toMatchObject({ action: "insert_after", newString: " launch" });
  });

  it("warns without mutating when a target string cannot be found", () => {
    const result = applyArtifactPatches("Current text", [{ action: "replace", target_string: "Missing text", new_string: "Replacement" }]);

    expect(result.text).toBe("Current text");
    expect(result.changes).toEqual([]);
    expect(result.warnings[0]).toContain("Target string not found");
  });

  it("consumes newline-delimited streamed JSON patch actions", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode('{"action":"replace","target_string":"A","new_string":"B"}\n{"action":"delete"'));
        controller.enqueue(encoder.encode(',"target_string":"C"}\n'));
        controller.close();
      },
    });
    const patches: ArtifactPatchAction[] = [];

    await consumeArtifactPatchStream(stream, (patch) => patches.push(patch));

    expect(patches).toEqual([
      { action: "replace", target_string: "A", new_string: "B", occurrence: 1 },
      { action: "delete", target_string: "C", occurrence: 1 },
    ]);
  });
});
