import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("local API keeps imports pending and omits non-shareable context", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pcs-api-"));
  const port = 18500 + Math.floor(Math.random() * 200);
  const child = spawn(process.execPath, ["--experimental-strip-types", "apps/api/src/server.ts"], { env: { ...process.env, PCS_PORT: String(port), PCS_DB: join(directory, "context.sqlite3") }, stdio: "ignore" });
  const url = (path: string) => `http://127.0.0.1:${port}${path}`;
  try {
    for (let attempt = 0; attempt < 30; attempt += 1) { try { if ((await fetch(url("/health"))).ok) break; } catch { /* wait */ } await new Promise((resolve) => setTimeout(resolve, 75)); }
    const template = await fetch(url("/v1/context-templates"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Coding", purpose: "coding_ai", fields: [{ fieldKey: "editor", label: "Editor", valueType: "text", required: true, displayOrder: 1, sharingDefault: "always", sensitivity: "normal", reason: "Editor preference" }, { fieldKey: "health_note", label: "Health note", valueType: "text", required: false, displayOrder: 2, sharingDefault: "private", sensitivity: "sensitive", reason: "Private note" }] }) });
    assert.equal(template.status, 201); const templateId = (await template.json() as any).item.id;
    assert.equal((await fetch(url(`/v1/context-templates/${templateId}/activate`), { method: "POST" })).status, 200);
    const entry = await fetch(url("/v1/context-entries"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ templateId, values: { editor: "VS Code", health_note: "private" } }) }); assert.equal(entry.status, 201);
    const profile = await fetch(url("/v1/context-profiles"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Codex", target: "codex", includedFields: [{ templateId, fieldKey: "editor" }, { templateId, fieldKey: "health_note" }] }) }); const profileId = (await profile.json() as any).id;
    const preview = await fetch(url("/v1/context-exports/preview"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ profileId, format: "markdown" }) }); const previewBody = await preview.json() as any; assert.match(previewBody.content, /VS Code/); assert.doesNotMatch(previewBody.content, /private/);
    const imported = await fetch(url("/v1/context-imports/metheory"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ schemaVersion: "personal-context-candidate-v1", id: "context_candidate_1", sourceSystem: "metheory", sourceHypothesisId: "hypothesis_1", statement: "Clear plans help me begin work.", construct: "task_initiation", tendencyScope: "state_dependent", reviewStatus: "fits", evidenceSummary: { supportingCount: 3, contradictingCount: 1, periodStartAt: "2026-01-01", periodEndAt: "2026-01-08" }, caution: [], createdAt: "2026-01-08" }) }); assert.equal((await imported.json() as any).decision, "pending");
  } finally { child.kill(); await new Promise((resolve) => setTimeout(resolve, 100)); rmSync(directory, { recursive: true, force: true }); }
});
