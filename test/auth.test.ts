import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("admin token can be exchanged for an expiring local session", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pcs-auth-")); const port = 21007; const adminToken = "test-admin-token-123456";
  const child = spawn(process.execPath, ["--experimental-strip-types", "apps/api/src/server.ts"], { env: { ...process.env, PCS_PORT: String(port), PCS_DB: join(directory, "context.sqlite3"), PCS_ADMIN_TOKEN: adminToken }, stdio: "ignore" });
  const url = (path: string) => `http://127.0.0.1:${port}${path}`;
  try {
    for (let attempt = 0; attempt < 40; attempt += 1) { try { if ((await fetch(url("/health"))).ok) break; } catch { /* wait */ } await new Promise((resolve) => setTimeout(resolve, 50)); }
    assert.equal((await fetch(url("/v1/documents"))).status, 401);
    const session = await fetch(url("/v1/auth/session"), { method: "POST", headers: { "x-pcs-admin-token": adminToken } }); const sessionBody = await session.json() as any;
    assert.equal(session.status, 201); assert.ok(sessionBody.token); assert.ok(sessionBody.expiresAt);
    assert.equal((await fetch(url("/v1/documents"), { headers: { "x-pcs-session-token": sessionBody.token } })).status, 200);
    assert.equal((await fetch(url("/v1/auth/session/revoke"), { method: "POST", headers: { "x-pcs-session-token": sessionBody.token } })).status, 200);
    assert.equal((await fetch(url("/v1/documents"), { headers: { "x-pcs-session-token": sessionBody.token } })).status, 401);
  } finally { child.kill(); await new Promise((resolve) => setTimeout(resolve, 100)); rmSync(directory, { recursive: true, force: true }); }
});
