import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireWatcherLease, markdownSignature, nextRetry } from "../packages/watcher-core/src/index.ts";

test("watcher core produces bounded retries and prevents duplicate controllers", () => {
  assert.equal(markdownSignature(12, "2026-01-01T00:00:00.000Z"), "12:2026-01-01T00:00:00.000Z");
  const retry = nextRetry(undefined, 500, new Error("temporary"), 1000);
  assert.equal(retry.attempts, 1); assert.equal(retry.retryAt, 2000);
  const directory = mkdtempSync(join(tmpdir(), "pcs-watcher-core-"));
  const path = join(directory, "watcher.lock");
  const release = acquireWatcherLease(path);
  assert.throws(() => acquireWatcherLease(path), /watcher_already_running/);
  release();
  assert.doesNotThrow(() => { const second = acquireWatcherLease(path); second(); });
  rmSync(directory, { recursive: true, force: true });
});
