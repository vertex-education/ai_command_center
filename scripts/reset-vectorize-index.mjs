import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const defaultIndexName = "ai-command-center-rag";
const defaultConfig = "./wrangler.jsonc";
const indexName =
  process.argv.find((arg) => !arg.startsWith("--") && arg !== process.argv[0] && arg !== process.argv[1]) ?? defaultIndexName;
const configArg = process.argv.find((arg) => arg.startsWith("--config=")) ?? `--config=${defaultConfig}`;
const batchSize = 100;
const pageSize = 1000;
const wranglerBin = join(process.cwd(), "node_modules", "wrangler", "bin", "wrangler.js");

if (!existsSync(wranglerBin)) {
  console.error("Wrangler is not installed. Run npm install first.");
  process.exit(1);
}

function runWrangler(args) {
  const result = spawnSync(process.execPath, [wranglerBin, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: false,
  });
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    process.exit(result.status ?? 1);
  }
  return result.stdout ?? "";
}

function parseWranglerJson(stdout) {
  const trimmed = stdout.trim();
  const candidates = [trimmed.lastIndexOf("\n{"), trimmed.lastIndexOf("\n[")].filter((index) => index >= 0);
  const start = candidates.length ? Math.max(...candidates) + 1 : 0;
  return JSON.parse(trimmed.slice(start));
}

function vectorIdsFromPayload(payload) {
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.vectors)
      ? payload.vectors
      : Array.isArray(payload?.result?.vectors)
        ? payload.result.vectors
        : Array.isArray(payload?.ids)
          ? payload.ids
          : Array.isArray(payload?.result?.ids)
            ? payload.result.ids
            : [];
  return rows.map((row) => (typeof row === "string" ? row : typeof row?.id === "string" ? row.id : null)).filter(Boolean);
}

function cursorFromPayload(payload) {
  return payload?.cursor ?? payload?.nextCursor ?? payload?.result?.cursor ?? payload?.result?.nextCursor ?? null;
}

let cursor = null;
let deleted = 0;

do {
  const listArgs = ["vectorize", "list-vectors", indexName, configArg, "--json", "--count", String(pageSize)];
  if (cursor) listArgs.push("--cursor", cursor);
  const payload = parseWranglerJson(runWrangler(listArgs));
  const ids = vectorIdsFromPayload(payload);

  for (let index = 0; index < ids.length; index += batchSize) {
    const batch = ids.slice(index, index + batchSize);
    if (batch.length === 0) continue;
    runWrangler(["vectorize", "delete-vectors", indexName, configArg, "--ids", ...batch]);
    deleted += batch.length;
    console.log(`Deleted ${deleted} vectors from ${indexName}.`);
  }

  cursor = cursorFromPayload(payload);
} while (cursor);

console.log(`Vectorize reset complete for ${indexName}. Deleted ${deleted} vectors.`);
