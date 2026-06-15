export type ArtifactPatchActionType = "replace" | "delete" | "insert_before" | "insert_after";

export type ArtifactPatchAction = {
  action: ArtifactPatchActionType;
  target_string: string;
  new_string?: string;
  occurrence?: number;
  rationale?: string;
};

export type ArtifactPatchAppliedChange = {
  action: ArtifactPatchActionType;
  targetString: string;
  newString: string;
  beforeContext: string;
  afterContext: string;
  occurrence: number;
  index: number;
  rationale?: string;
};

export type ArtifactPatchApplyResult = {
  text: string;
  changes: ArtifactPatchAppliedChange[];
  warnings: string[];
};

const contextCharacterCount = 180;

export function parseArtifactPatchSequence(value: string): ArtifactPatchAction[] {
  const trimmed = value.trim();
  if (!trimmed) return [];

  const parsed = parsePatchJsonValue(trimmed);
  if (parsed) return normalizeArtifactPatchActions(parsed);

  const patches: ArtifactPatchAction[] = [];
  for (const line of trimmed.split(/\r?\n/)) {
    const parsedLine = parsePatchJsonValue(line.trim());
    if (!parsedLine) continue;
    patches.push(...normalizeArtifactPatchActions(parsedLine));
  }
  return patches;
}

export function normalizeArtifactPatchActions(value: unknown): ArtifactPatchAction[] {
  const candidates = extractPatchCandidates(value);
  return candidates.map(normalizeArtifactPatchAction).filter((patch): patch is ArtifactPatchAction => Boolean(patch));
}

export function applyArtifactPatches(baseText: string, patches: ArtifactPatchAction[]): ArtifactPatchApplyResult {
  let text = baseText;
  const changes: ArtifactPatchAppliedChange[] = [];
  const warnings: string[] = [];

  for (const patch of patches) {
    const occurrence = normalizeOccurrence(patch.occurrence);
    const targetString = patch.target_string;
    const newString = patch.new_string ?? "";
    const index = findNthOccurrence(text, targetString, occurrence);
    if (index < 0) {
      warnings.push(`Target string not found for ${patch.action}: ${truncateForWarning(targetString)}`);
      continue;
    }

    const beforeContext = text.slice(Math.max(0, index - contextCharacterCount), index);
    const afterIndex = index + targetString.length;
    const afterContext = text.slice(afterIndex, afterIndex + contextCharacterCount);
    changes.push({
      action: patch.action,
      targetString,
      newString,
      beforeContext,
      afterContext,
      occurrence,
      index,
      rationale: patch.rationale,
    });

    if (patch.action === "replace") {
      text = `${text.slice(0, index)}${newString}${text.slice(afterIndex)}`;
    } else if (patch.action === "delete") {
      text = `${text.slice(0, index)}${text.slice(afterIndex)}`;
    } else if (patch.action === "insert_before") {
      text = `${text.slice(0, index)}${newString}${text.slice(index)}`;
    } else {
      text = `${text.slice(0, afterIndex)}${newString}${text.slice(afterIndex)}`;
    }
  }

  return { text, changes, warnings };
}

export function createArtifactPatchStreamParser(onPatch: (patch: ArtifactPatchAction) => void) {
  let buffer = "";

  function flushLine(line: string) {
    const patches = parseArtifactPatchSequence(line);
    patches.forEach(onPatch);
  }

  return {
    push(chunk: string) {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) flushLine(line);
      }
    },
    finish() {
      if (!buffer.trim()) return;
      flushLine(buffer);
      buffer = "";
    },
  };
}

export async function consumeArtifactPatchStream(stream: ReadableStream<Uint8Array>, onPatch: (patch: ArtifactPatchAction) => void) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const parser = createArtifactPatchStreamParser(onPatch);

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.push(decoder.decode(value, { stream: true }));
  }

  const finalChunk = decoder.decode();
  if (finalChunk) parser.push(finalChunk);
  parser.finish();
}

function parsePatchJsonValue(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function extractPatchCandidates(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  if (typeof value.action === "string") return [value];
  if (Array.isArray(value.patches)) return value.patches;
  if (Array.isArray(value.operations)) return value.operations;
  if (Array.isArray(value.delta)) return value.delta;
  return [];
}

function normalizeArtifactPatchAction(value: unknown): ArtifactPatchAction | null {
  if (!isRecord(value)) return null;
  const action = normalizePatchAction(value.action);
  const targetString = typeof value.target_string === "string" ? value.target_string : "";
  if (!action || !targetString) return null;
  const newString =
    typeof value.new_string === "string"
      ? value.new_string
      : typeof value.replacement === "string"
        ? value.replacement
        : typeof value.insert_text === "string"
          ? value.insert_text
          : undefined;

  if (action !== "delete" && newString === undefined) return null;

  return {
    action,
    target_string: targetString,
    ...(newString !== undefined ? { new_string: newString } : {}),
    occurrence: normalizeOccurrence(value.occurrence),
    ...(typeof value.rationale === "string" && value.rationale.trim() ? { rationale: value.rationale.trim().slice(0, 400) } : {}),
  };
}

function normalizePatchAction(value: unknown): ArtifactPatchActionType | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/-/g, "_");
  if (normalized === "replace" || normalized === "delete" || normalized === "insert_before" || normalized === "insert_after") {
    return normalized;
  }
  return null;
}

function normalizeOccurrence(value: unknown) {
  const numberValue = Number(value);
  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : 1;
}

function findNthOccurrence(text: string, target: string, occurrence: number) {
  let fromIndex = 0;
  for (let match = 1; match <= occurrence; match += 1) {
    const index = text.indexOf(target, fromIndex);
    if (index < 0) return -1;
    if (match === occurrence) return index;
    fromIndex = index + Math.max(target.length, 1);
  }
  return -1;
}

function truncateForWarning(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
