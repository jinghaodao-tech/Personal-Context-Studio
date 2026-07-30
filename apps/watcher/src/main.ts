import { listMarkdownFiles, readMarkdownSnapshot } from "../../../packages/documents/src/index.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { acquireWatcherLease, markdownSignature, nextRetry, type RetryState } from "../../../packages/watcher-core/src/index.ts";

const apiUrl = process.env.PCS_API_URL ?? "http://127.0.0.1:8300";
const notesRoot = resolve(process.env.PCS_NOTES_DIR ?? resolve(import.meta.dirname, "../../../notes"));
const intervalMs = Math.max(500, Number(process.env.PCS_WATCH_INTERVAL_MS ?? 2000));
const statePath = resolve(process.env.PCS_WATCH_STATE ?? resolve(import.meta.dirname, "../../../data/watcher-state.json"));
const observed = new Map<string, string>();
const stable = new Map<string, string>();
const failures = new Map<string, RetryState>();
let stopped = false;
let lastSuccessfulSync: string | undefined;
let releaseLease: (() => void) | undefined;

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${apiUrl}${path}`, { ...init, headers: { ...(process.env.PCS_ADMIN_TOKEN ? { "x-pcs-admin-token": process.env.PCS_ADMIN_TOKEN } : {}), ...(init?.headers ?? {}) } });
  const payload = await response.json() as any;
  if (!response.ok) throw new Error(payload.error ?? `api_${response.status}`);
  return payload;
}

function writeState(lastError?: string, running = !stopped) {
  try {
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(statePath, JSON.stringify({
      schemaVersion: 1,
      running,
      pid: process.pid,
      notesRoot,
      lastSuccessfulSync,
      lastHeartbeatAt: new Date().toISOString(),
      lastError,
      pendingRetries: failures.size,
      updatedAt: new Date().toISOString(),
    }, null, 2), "utf8");
  } catch (error) {
    console.error(`Unable to write watcher state: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function recordFailure(filePath: string, error: unknown) {
  const previous = failures.get(filePath);
  const retry = nextRetry(previous, intervalMs, error);
  failures.set(filePath, retry);
  console.error(`Will retry ${filePath} in ${retry.retryAt - Date.now()}ms: ${retry.error}`);
}

async function archiveMissing(documents: Array<{ id: string; file_path: string }>, current: Set<string>) {
  for (const document of documents) {
    if (current.has(document.file_path)) continue;
    try {
      await request(`/v1/documents/${encodeURIComponent(document.id)}`, { method: "DELETE" });
      stable.delete(document.file_path);
      failures.delete(document.file_path);
      console.log(`Archived ${document.file_path}`);
    } catch (error) {
      recordFailure(document.file_path, error);
    }
  }
}

async function indexStableFiles(paths: string[]) {
  for (const filePath of paths) {
    const failure = failures.get(filePath);
    if (failure && failure.retryAt > Date.now()) continue;
    try {
      const snapshot = readMarkdownSnapshot(notesRoot, filePath);
      const signature = markdownSignature(snapshot.size, snapshot.sourceUpdatedAt);
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
      failures.delete(filePath);
      console.log(`Indexed ${filePath}`);
    } catch (error) {
      recordFailure(filePath, error);
    }
  }
}

async function synchronize() {
  const paths = listMarkdownFiles(notesRoot);
  const current = new Set(paths);
  const documents = (await request("/v1/documents")).items as Array<{ id: string; file_path: string }>;
  await archiveMissing(documents, current);
  await indexStableFiles(paths);
  for (const filePath of observed.keys()) if (!current.has(filePath)) observed.delete(filePath);
  lastSuccessfulSync = new Date().toISOString();
  writeState();
}

async function main() {
  mkdirSync(dirname(statePath), { recursive: true });
  releaseLease = acquireWatcherLease(`${statePath}.lock`);
  console.log(`Watching Markdown files in ${notesRoot}`);
  try {
    while (!stopped) {
      try {
        await synchronize();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Watcher synchronization failed: ${message}`);
        writeState(message);
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  } finally {
    writeState(undefined, false);
    releaseLease?.();
  }
}

process.on("SIGINT", () => { stopped = true; });
process.on("SIGTERM", () => { stopped = true; });
await main();
