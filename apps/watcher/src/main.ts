import { listMarkdownFiles, readMarkdownSnapshot } from "../../../packages/documents/src/index.ts";
import { resolve } from "node:path";

const apiUrl = process.env.PCS_API_URL ?? "http://127.0.0.1:8300";
const notesRoot = resolve(process.env.PCS_NOTES_DIR ?? resolve(import.meta.dirname, "../../../notes"));
const intervalMs = Math.max(500, Number(process.env.PCS_WATCH_INTERVAL_MS ?? 2000));
const observed = new Map<string, string>();
const stable = new Map<string, string>();
let stopped = false;

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${apiUrl}${path}`, init);
  const payload = await response.json() as any;
  if (!response.ok) throw new Error(payload.error ?? `api_${response.status}`);
  return payload;
}

async function synchronize() {
  const paths = listMarkdownFiles(notesRoot);
  const current = new Set(paths);
  const documents = (await request("/v1/documents")).items as Array<{ id: string; file_path: string }>;

  for (const document of documents) {
    if (!current.has(document.file_path)) {
      await request(`/v1/documents/${encodeURIComponent(document.id)}`, { method: "DELETE" });
      stable.delete(document.file_path);
      console.log(`Archived ${document.file_path}`);
    }
  }

  for (const filePath of paths) {
    const snapshot = readMarkdownSnapshot(notesRoot, filePath);
    const signature = `${snapshot.size}:${snapshot.sourceUpdatedAt}`;
    if (observed.get(filePath) !== signature) {
      observed.set(filePath, signature);
      continue;
    }
    if (stable.get(filePath) === signature) continue;
    await request("/v1/documents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filePath }),
    });
    stable.set(filePath, signature);
    console.log(`Indexed ${filePath}`);
  }

  for (const filePath of observed.keys()) if (!current.has(filePath)) observed.delete(filePath);
}

async function main() {
  console.log(`Watching Markdown files in ${notesRoot}`);
  while (!stopped) {
    try {
      await synchronize();
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

process.on("SIGINT", () => { stopped = true; });
process.on("SIGTERM", () => { stopped = true; });
await main();
