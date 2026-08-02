import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("JSON template import validates and stores a draft", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pcs-template-import-"));
  const port = 19900 + Math.floor(Math.random() * 100);
  const child = spawn(process.execPath, ["--experimental-strip-types", "apps/api/src/server.ts"], { env: { ...process.env, PCS_PORT: String(port), PCS_DB: join(directory, "context.sqlite3"), PCS_NOTES_DIR: join(directory, "notes") }, stdio: "ignore" });
  mkdirSync(join(directory, "notes"), { recursive: true });
  const url = (path: string) => `http://127.0.0.1:${port}${path}`;
  try {
    for (let attempt = 0; attempt < 40; attempt += 1) { try { if ((await fetch(url("/health"))).ok) break; } catch { /* wait */ } await new Promise((resolve) => setTimeout(resolve, 50)); }
    const response = await fetch(url("/v1/context-templates/import"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ template: { name: "設計レビュー", description: "設計判断を残す", purpose: "architecture", fields: [{ fieldKey: "decision", label: "判断", valueType: "text", required: true, displayOrder: 1, sharingDefault: "purpose_only", sensitivity: "normal", reason: "判断を記録する" }] } }) });
    assert.equal(response.status, 201);
    const body = await response.json() as any;
    assert.equal(body.imported, true);
    assert.equal(body.status, "draft");
    assert.equal(body.item.status, "draft");
    assert.equal(body.item.fields[0].field_key, "decision");
  } finally { child.kill(); await new Promise((resolve) => setTimeout(resolve, 100)); rmSync(directory, { recursive: true, force: true }); }
});
