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

test("local documents feed reviewed analysis snapshots and experiment template requests", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pcs-bridge-"));
  const port = 18750 + Math.floor(Math.random() * 200);
  const child = spawn(process.execPath, ["--experimental-strip-types", "apps/api/src/server.ts"], { env: { ...process.env, PCS_PORT: String(port), PCS_DB: join(directory, "context.sqlite3") }, stdio: "ignore" });
  const api = async (path: string, method = "GET", value?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: value ? { "content-type": "application/json" } : undefined, body: value ? JSON.stringify(value) : undefined });
    return { response, body: await response.json() as any };
  };
  try {
    for (let attempt = 0; attempt < 30; attempt += 1) { try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break; } catch { /* wait */ } await new Promise((resolve) => setTimeout(resolve, 75)); }
    const document = await api("/v1/documents", "POST", { externalSource: "obsidian", externalSourceId: "daily/2026-07-01.md", title: "Work day", body: "I had energy for focused work.", recordedAt: "2026-07-01T09:00:00.000Z", sourceUpdatedAt: "2026-07-01T10:00:00.000Z" });
    assert.equal(document.response.status, 201); assert.equal((await api("/v1/documents/search", "POST", { query: "energy" })).body.items.length, 1);
    const template = await api("/v1/context-templates", "POST", { name: "Daily signal", purpose: "self_understanding", fields: [{ fieldKey: "energy", label: "Energy", valueType: "number", required: true, displayOrder: 1, sharingDefault: "purpose_only", sensitivity: "normal", reason: "Compare energy" }] });
    const templateId = template.body.item.id; await api(`/v1/context-templates/${templateId}/activate`, "POST");
    const candidate = await api("/v1/context-entries/candidates", "POST", { templateId, sourceDocumentId: document.body.id, provider: "ollama", values: { energy: 4 } });
    assert.equal(candidate.response.status, 201); const detail = await api(`/v1/context-entries/${candidate.body.id}`); assert.equal(detail.body.values[0].user_confirmed, 0);
    assert.equal((await api(`/v1/context-entries/${candidate.body.id}`, "PATCH", { fieldKey: "energy", value: 4 })).response.status, 200);
    const snapshot = await api("/v1/metheory/analysis-snapshot"); assert.equal(snapshot.body.schemaVersion, "pcs-analysis-snapshot-v1"); assert.equal(snapshot.body.records[0].values[0].value, 4);
    const request = await api("/v1/experiment-template-requests", "POST", { schemaVersion: "pcs-experiment-template-request-v1", id: "request_focus_1", sourceSystem: "metheory", hypothesisId: "hypothesis_1", title: "Focus journal", purpose: "Check focus conditions", durationDays: 14, requestedFields: [{ fieldKey: "focus", label: "Focus", valueType: "number", required: true, reason: "Compare conditions" }], createdAt: "2026-07-01T00:00:00.000Z" });
    assert.equal(request.response.status, 201); const createdTemplate = await api("/v1/experiment-template-requests/request_focus_1/create-template", "POST"); assert.equal(createdTemplate.response.status, 201); assert.equal(createdTemplate.body.template.status, "draft");
  } finally { child.kill(); await new Promise((resolve) => setTimeout(resolve, 100)); rmSync(directory, { recursive: true, force: true }); }
});
