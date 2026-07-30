import { closeSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";

export type RetryState = { attempts: number; retryAt: number; error: string };

export function markdownSignature(size: number, sourceUpdatedAt: string) {
  return `${size}:${sourceUpdatedAt}`;
}

export function nextRetry(previous: RetryState | undefined, intervalMs: number, error: unknown, now = Date.now()): RetryState {
  const attempts = (previous?.attempts ?? 0) + 1;
  return { attempts, retryAt: now + Math.min(60_000, intervalMs * 2 ** Math.min(attempts, 6)), error: error instanceof Error ? error.message : String(error) };
}

export function acquireWatcherLease(path: string) {
  try {
    const descriptor = openSync(path, "wx");
    writeFileSync(descriptor, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), "utf8");
    closeSync(descriptor);
  } catch (error: any) {
    if (error?.code !== "EEXIST") throw error;
    let previousPid = 0;
    try { previousPid = Number(JSON.parse(readFileSync(path, "utf8")).pid); } catch { /* stale or malformed lock */ }
    try { if (previousPid > 0) process.kill(previousPid, 0); throw new Error("watcher_already_running"); } catch (probeError: any) { if (probeError?.message === "watcher_already_running") throw probeError; }
    rmSync(path, { force: true });
    return acquireWatcherLease(path);
  }
  return () => rmSync(path, { force: true });
}
