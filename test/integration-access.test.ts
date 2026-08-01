import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PcsIntegrationClient } from "../packages/integration-sdk/src/index.ts";

test("management and integration credentials stay within their own API boundary", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pcs-access-"));
  const port = 19550 + Math.floor(Math.random() * 200);
  const adminToken = "test-admin-token";
  const child = spawn(process.execPath, ["--experimental-strip-types", "apps/api/src/server.ts"], { env: { ...process.env, PCS_PORT: String(port), PCS_DB: join(directory, "context.sqlite3"), PCS_ADMIN_TOKEN: adminToken }, stdio: "ignore" });
  const api = async (path: string, method = "GET", value?: unknown, headers?: Record<string, string>) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { ...(value ? { "content-type": "application/json" } : {}), ...headers }, body: value ? JSON.stringify(value) : undefined });
    return { response, body: await response.json() as any };
  };
  try {
    for (let attempt = 0; attempt < 40; attempt += 1) { try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break; } catch { /* wait */ } await new Promise((resolve) => setTimeout(resolve, 75)); }
    assert.equal((await api("/v1/context-templates")).response.status, 401);
    const managementHeaders = { "x-pcs-admin-token": adminToken };
    assert.equal((await api("/v1/context-templates", "GET", undefined, managementHeaders)).response.status, 200);
    const template = await api("/v1/context-templates", "POST", { name: "SDK profile", purpose: "test", fields: [{ fieldKey: "context", label: "Context", valueType: "text", required: false, displayOrder: 1, sharingDefault: "always", sensitivity: "normal", reason: "SDK test" }] }, managementHeaders);
    await api(`/v1/context-templates/${template.body.item.id}/activate`, "POST", undefined, managementHeaders);
    const profile = await api("/v1/context-profiles", "POST", { name: "SDK profile", target: "json", includedFields: [{ templateId: template.body.item.id, fieldKey: "context" }] }, managementHeaders);
    const created = await api("/v1/integration-clients", "POST", { name: "SDK test", permissions: ["read_snapshot", "submit_import"], allowedProfileIds: [profile.body.id] }, managementHeaders);
    assert.equal(created.response.status, 201);
    const sdk = new PcsIntegrationClient({ baseUrl: `http://127.0.0.1:${port}`, clientId: created.body.id, token: created.body.token });
    assert.equal((await sdk.getAnalysisSnapshot(profile.body.id)).schemaVersion, "pcs-analysis-snapshot-v2");
    const unscopedProfile = await api("/v1/context-profiles", "POST", { name: "Unscoped profile", target: "json", includedFields: [{ templateId: template.body.item.id, fieldKey: "context" }] }, managementHeaders);
    await assert.rejects(() => sdk.getAnalysisSnapshot(unscopedProfile.body.id), /integration_profile_forbidden/);
    const imported = await sdk.submitImport({ id: "sdk_import", sourceSystem: "sdk_test", payload: { kind: "candidate" } });
    assert.equal((imported as any).decision, "pending");
    assert.equal((await api("/v1/context-templates", "GET", undefined, { "x-pcs-client-id": created.body.id, authorization: `Bearer ${created.body.token}` })).response.status, 401);
  } finally {
    if (!child.killed && child.exitCode === null) child.kill();
    if (child.exitCode === null) await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try { rmSync(directory, { recursive: true, force: true }); break; }
      catch (error) { if (attempt === 9) throw error; await new Promise((resolve) => setTimeout(resolve, 100)); }
    }
  }
});
