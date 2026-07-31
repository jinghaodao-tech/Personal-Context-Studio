import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

test("local API keeps imports pending and omits non-shareable context", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pcs-api-"));
  const port = 18500 + Math.floor(Math.random() * 200);
  const databasePath = join(directory, "context.sqlite3");
  const child = spawn(process.execPath, ["--experimental-strip-types", "apps/api/src/server.ts"], { env: { ...process.env, PCS_PORT: String(port), PCS_DB: databasePath, PCS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") }, stdio: "ignore" });
  const url = (path: string) => `http://127.0.0.1:${port}${path}`;
  try {
    for (let attempt = 0; attempt < 30; attempt += 1) { try { if ((await fetch(url("/health"))).ok) break; } catch { /* wait */ } await new Promise((resolve) => setTimeout(resolve, 75)); }
    const template = await fetch(url("/v1/context-templates"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Coding", purpose: "coding_ai", fields: [{ fieldKey: "editor", label: "Editor", valueType: "text", required: true, displayOrder: 1, sharingDefault: "always", sensitivity: "normal", reason: "Editor preference" }, { fieldKey: "health_note", label: "Health note", valueType: "text", required: false, displayOrder: 2, sharingDefault: "private", sensitivity: "sensitive", reason: "Private note" }] }) });
    assert.equal(template.status, 201); const templateId = (await template.json() as any).item.id;
    assert.equal((await fetch(url(`/v1/context-templates/${templateId}/activate`), { method: "POST" })).status, 200);
    const entry = await fetch(url("/v1/context-entries"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ templateId, values: { editor: "VS Code", energy: 4, health_note: "private" } }) }); assert.equal(entry.status, 201); const entryBody = await entry.json() as any;
    const encryptedDb = new DatabaseSync(databasePath); const storedSensitive = encryptedDb.prepare("SELECT value_json,encrypted FROM context_values WHERE entry_id=? AND field_key='health_note'").get(entryBody.id) as any; encryptedDb.close(); assert.equal(storedSensitive.encrypted, 1); assert.doesNotMatch(storedSensitive.value_json, /private/);
    const readableEntry = await fetch(url(`/v1/context-entries/${entryBody.id}`)); assert.equal((await readableEntry.json() as any).values.find((value: any) => value.field_key === "health_note").value_json, '"private"');
    const profile = await fetch(url("/v1/context-profiles"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Codex", target: "codex", includedFields: [{ templateId, fieldKey: "editor" }, { templateId, fieldKey: "health_note" }] }) }); const profileId = (await profile.json() as any).id;
    const preview = await fetch(url("/v1/context-exports/preview"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ profileId, format: "markdown" }) }); const previewBody = await preview.json() as any; assert.match(previewBody.content, /VS Code/); assert.doesNotMatch(previewBody.content, /private/); assert.equal(previewBody.schemaVersion, "pcs-context-export-v1"); assert.equal(previewBody.omitted.privateOrNever, 1);
    assert.equal((await fetch(url("/v1/integration-imports"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "context_candidate_1", sourceSystem: "workbench", payload: {}, createdAt: "2026-01-08T00:00:00.000Z" }) })).status, 401);
    const client = await fetch(url("/v1/integration-clients"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Test workbench", permissions: ["submit_import"] }) }); const clientBody = await client.json() as any;
    const imported = await fetch(url("/v1/integration-imports"), { method: "POST", headers: { "content-type": "application/json", "x-pcs-client-id": clientBody.id, authorization: `Bearer ${clientBody.token}` }, body: JSON.stringify({ id: "context_candidate_1", sourceSystem: "workbench", sourceReferenceId: "candidate_1", payload: { statement: "Clear plans help me begin work." }, createdAt: "2026-01-08T00:00:00.000Z" }) }); assert.equal((await imported.json() as any).decision, "pending");
    const firstAudit = await fetch(url("/v1/dashboard/audit?limit=1")); const firstAuditBody = await firstAudit.json() as any; assert.equal(firstAudit.status, 200); assert.equal(firstAuditBody.items.length, 1); assert.ok(firstAuditBody.nextCursor);
    const nextAudit = await fetch(url(`/v1/dashboard/audit?limit=1&before=${encodeURIComponent(firstAuditBody.nextCursor)}`)); const nextAuditBody = await nextAudit.json() as any; assert.equal(nextAudit.status, 200); assert.equal(nextAuditBody.items.length, 1); assert.notEqual(nextAuditBody.items[0].id, firstAuditBody.items[0].id);
  } finally { child.kill(); await new Promise((resolve) => setTimeout(resolve, 100)); rmSync(directory, { recursive: true, force: true }); }
});

test("local documents feed reviewed analysis snapshots and generic integration template requests", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pcs-bridge-"));
  const notesDirectory = join(directory, "notes");
  mkdirSync(join(notesDirectory, "daily"), { recursive: true });
  const notePath = join(notesDirectory, "daily", "2026-07-01.md");
  writeFileSync(notePath, "---\nrecorded_at: 2026-07-01T09:00:00.000Z\ntitle: Work day\n---\nI had energy for focused work.", "utf8");
  const port = 18750 + Math.floor(Math.random() * 200);
  const child = spawn(process.execPath, ["--experimental-strip-types", "apps/api/src/server.ts"], { env: { ...process.env, PCS_PORT: String(port), PCS_DB: join(directory, "context.sqlite3"), PCS_NOTES_DIR: notesDirectory }, stdio: "ignore" });
  const api = async (path: string, method = "GET", value?: unknown, extraHeaders?: Record<string, string>) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { ...(value ? { "content-type": "application/json" } : {}), ...extraHeaders }, body: value ? JSON.stringify(value) : undefined });
    return { response, body: await response.json() as any };
  };
  try {
    for (let attempt = 0; attempt < 30; attempt += 1) { try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break; } catch { /* wait */ } await new Promise((resolve) => setTimeout(resolve, 75)); }
    const document = await api("/v1/documents", "POST", { filePath: "daily/2026-07-01.md" });
    assert.equal(document.response.status, 201); assert.equal((await api("/v1/documents/search", "POST", { query: "energy" })).body.items.length, 1); const hybridSearch = await api("/v1/documents/search", "POST", { query: "energy", mode: "hybrid", limit: 10 }); assert.equal(hybridSearch.body.mode, "hybrid"); assert.equal(hybridSearch.body.items.length, 1);
    const storedDocument = await api(`/v1/documents/${document.body.id}`);
    assert.equal("body" in storedDocument.body.item, false);
    assert.match((await api(`/v1/documents/${document.body.id}/excerpt?maxCharacters=200`)).body.excerpt, /energy/);
    const template = await api("/v1/context-templates", "POST", { name: "Daily signal", purpose: "self_understanding", fields: [{ fieldKey: "energy", label: "Energy", valueType: "number", required: true, displayOrder: 1, analysisRole: "outcome", analysisRoleConfirmed: true, analysisUsage: "outcome", sharingDefault: "purpose_only", sensitivity: "normal", reason: "Compare energy" }] });
    const templateId = template.body.item.id; await api(`/v1/context-templates/${templateId}/activate`, "POST");
    const authorizationBefore = await api("/v1/privacy/external-ai/authorize-extraction", "POST", { documentId: document.body.id, templateId, providerId: "manual", destinationHost: "chatgpt.com" });
    assert.equal(authorizationBefore.body.allowed, false);
    assert.deepEqual(authorizationBefore.body.missing.sort(), ["document", "field:energy"]);
    const documentConsent = await api("/v1/privacy/external-ai-consents", "POST", { scope: "document", providerId: "manual", destinationHost: "chatgpt.com", documentId: document.body.id });
    const fieldConsent = await api("/v1/privacy/external-ai-consents", "POST", { scope: "field", providerId: "manual", destinationHost: "chatgpt.com", templateId, fieldKey: "energy" });
    assert.equal((await api("/v1/privacy/external-ai/authorize-extraction", "POST", { documentId: document.body.id, templateId, providerId: "manual", destinationHost: "chatgpt.com" })).body.allowed, true);
    assert.equal((await api(`/v1/privacy/external-ai-consents/${fieldConsent.body.id}/revoke`, "POST")).body.revoked, true);
    assert.equal((await api("/v1/privacy/external-ai/authorize-extraction", "POST", { documentId: document.body.id, templateId, providerId: "manual", destinationHost: "chatgpt.com" })).body.allowed, false);
    assert.equal(documentConsent.body.granted, true);
    const candidate = await api("/v1/context-entries/candidates", "POST", { templateId, sourceDocumentId: document.body.id, provider: "ollama", values: { energy: 4 } });
    assert.equal(candidate.response.status, 201); const detail = await api(`/v1/context-entries/${candidate.body.id}`); assert.equal(detail.body.values[0].user_confirmed, 0);
    assert.equal((await api(`/v1/context-entries/${candidate.body.id}`, "PATCH", { fieldKey: "energy", value: 4 })).response.status, 200);
    assert.equal((await api("/v1/context/analysis-snapshot")).response.status, 401);
    const integrationClient = await api("/v1/integration-clients", "POST", { name: "Snapshot consumer", permissions: ["read_snapshot", "submit_template_request"] });
    const integrationHeaders = { "x-pcs-client-id": integrationClient.body.id, authorization: `Bearer ${integrationClient.body.token}` };
    assert.equal((await api("/v1/context/analysis-snapshot", "GET", undefined, integrationHeaders)).response.status, 400);
    const purpose = await api("/v1/sharing-purposes", "POST", { name: "self-understanding" });
    await api(`/v1/context-entries/${candidate.body.id}/values/energy/purposes`, "PUT", { purposeIds: [purpose.body.id] });
    const snapshotProfile = await api("/v1/context-profiles", "POST", { name: "Snapshot profile", target: "json", purposeId: purpose.body.id, includedFields: [{ templateId, fieldKey: "energy" }] });
    const unscopedSnapshot = await api(`/v1/context/analysis-snapshot?profileId=${snapshotProfile.body.id}&from=2026-07-01T00:00:00.000Z&to=2026-08-01T00:00:00.000Z`, "GET", undefined, integrationHeaders); assert.equal(unscopedSnapshot.response.status, 403); assert.equal(unscopedSnapshot.body.error, "integration_profile_scope_required");
    const scopedClient = await api("/v1/integration-clients", "POST", { name: "Scoped snapshot consumer", permissions: ["read_snapshot"], allowedProfileIds: [snapshotProfile.body.id] });
    const scopedHeaders = { "x-pcs-client-id": scopedClient.body.id, authorization: `Bearer ${scopedClient.body.token}` };
    const snapshot = await api(`/v1/context/analysis-snapshot?profileId=${snapshotProfile.body.id}&from=2026-07-01T00:00:00.000Z&to=2026-08-01T00:00:00.000Z`, "GET", undefined, scopedHeaders); assert.equal(snapshot.body.schemaVersion, "pcs-analysis-snapshot-v2"); assert.equal(snapshot.body.contractRevision, "pcs-analysis-snapshot-v2.1"); assert.equal(snapshot.body.records[0].values[0].value, 4);
    const staleCandidate = await api("/v1/context-entries/candidates", "POST", { templateId, sourceDocumentId: document.body.id, provider: "ollama", values: { energy: 2 } });
    writeFileSync(notePath, "---\nrecorded_at: 2026-07-01T09:00:00.000Z\ntitle: Work day\n---\nThe note changed after extraction.", "utf8");
    await api("/v1/documents", "POST", { filePath: "daily/2026-07-01.md" });
    assert.equal((await api(`/v1/context-entries/${staleCandidate.body.id}`, "PATCH", { fieldKey: "energy", value: 2 })).response.status, 409);
    assert.equal((await api("/v1/reviews/pending")).body.items.some((item: any) => item.entry_id === staleCandidate.body.id && item.stale), true);
    const requestPayload = { schemaVersion: "pcs-integration-template-request-v1", id: "request_focus_1", sourceSystem: "workbench", sourceReferenceId: "focus_1", title: "Focus journal", purpose: "Check focus conditions", durationDays: 14, requestedFields: [{ fieldKey: "focus", label: "Focus", valueType: "number", required: true, reason: "Compare conditions" }], createdAt: "2026-07-01T00:00:00.000Z" };
    assert.equal((await api("/v1/integration-template-requests", "POST", requestPayload)).response.status, 401);
    const request = await api("/v1/integration-template-requests", "POST", requestPayload, integrationHeaders);
    assert.equal(request.response.status, 201); const createdTemplate = await api(`/v1/integration-template-requests/${request.body.id}/create-template`, "POST"); assert.equal(createdTemplate.response.status, 201); assert.equal(createdTemplate.body.template.status, "draft");
    assert.equal((await api(`/v1/context-templates/${createdTemplate.body.template.id}/archive`, "POST")).body.archived, true);
  } finally { child.kill(); await new Promise((resolve) => setTimeout(resolve, 100)); rmSync(directory, { recursive: true, force: true }); }
});

test("watcher indexes stable Markdown files and archives deleted files", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pcs-watcher-"));
  const notesDirectory = join(directory, "notes");
  mkdirSync(notesDirectory, { recursive: true });
  writeFileSync(join(notesDirectory, "watched.md"), "# Watched\nstable content", "utf8");
  const port = 18950 + Math.floor(Math.random() * 200);
  const environment = { ...process.env, PCS_PORT: String(port), PCS_DB: join(directory, "context.sqlite3"), PCS_NOTES_DIR: notesDirectory, PCS_API_URL: `http://127.0.0.1:${port}`, PCS_WATCH_INTERVAL_MS: "500", PCS_WATCH_STATE: join(directory, "watcher-state.json") };
  const apiProcess = spawn(process.execPath, ["--experimental-strip-types", "apps/api/src/server.ts"], { env: environment, stdio: "ignore" });
  let watcher: ReturnType<typeof spawn> | undefined;
  try {
    for (let attempt = 0; attempt < 30; attempt += 1) { try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break; } catch { /* wait */ } await new Promise((resolve) => setTimeout(resolve, 75)); }
    watcher = spawn(process.execPath, ["--experimental-strip-types", "apps/watcher/src/main.ts"], { env: environment, stdio: "ignore" });
    let items: any[] = [];
    for (let attempt = 0; attempt < 30; attempt += 1) {
      items = (await (await fetch(`http://127.0.0.1:${port}/v1/documents`)).json() as any).items;
      if (items.length === 1) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(items[0].file_path, "watched.md");
    assert.equal((await (await fetch(`http://127.0.0.1:${port}/v1/watcher/status`)).json() as any).running, true);
    const originalId = items[0].id;
    renameSync(join(notesDirectory, "watched.md"), join(notesDirectory, "moved.md"));
    for (let attempt = 0; attempt < 30; attempt += 1) {
      items = (await (await fetch(`http://127.0.0.1:${port}/v1/documents`)).json() as any).items;
      if (items.length === 1 && items[0].file_path === "moved.md") break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(items[0].id, originalId);
    assert.equal(items[0].file_path, "moved.md");
    rmSync(join(notesDirectory, "moved.md"));
    for (let attempt = 0; attempt < 20; attempt += 1) {
      items = (await (await fetch(`http://127.0.0.1:${port}/v1/documents`)).json() as any).items;
      if (items.length === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(items.length, 0);
  } finally {
    watcher?.kill();
    apiProcess.kill();
    await new Promise((resolve) => setTimeout(resolve, 100));
    rmSync(directory, { recursive: true, force: true });
  }
});

test("confirmed values retain append-only revisions and safe deletion is planned", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pcs-revisions-"));
  const port = 19150 + Math.floor(Math.random() * 200);
  const child = spawn(process.execPath, ["--experimental-strip-types", "apps/api/src/server.ts"], { env: { ...process.env, PCS_PORT: String(port), PCS_DB: join(directory, "context.sqlite3") }, stdio: "ignore" });
  const api = async (path: string, method = "GET", value?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: value ? { "content-type": "application/json" } : undefined, body: value ? JSON.stringify(value) : undefined });
    return { response, body: await response.json() as any };
  };
  try {
    for (let attempt = 0; attempt < 30; attempt += 1) { try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break; } catch { /* wait */ } await new Promise((resolve) => setTimeout(resolve, 75)); }
    const template = await api("/v1/context-templates", "POST", { name: "Daily state", purpose: "self_understanding", fields: [{ fieldKey: "energy", label: "Energy", valueType: "number", required: true, displayOrder: 1, sharingDefault: "always", sensitivity: "normal", reason: "Track energy" }] });
    await api(`/v1/context-templates/${template.body.item.id}/activate`, "POST");
    const entry = await api("/v1/context-entries", "POST", { templateId: template.body.item.id, values: { energy: 2 } });
    const history = await api(`/v1/context-entries/${entry.body.id}/values/energy/revisions`);
    assert.equal(history.body.items.length, 1); assert.equal(history.body.items[0].change_type, "initial");
    assert.equal((await api(`/v1/context-entries/${entry.body.id}`, "PATCH", { fieldKey: "energy", value: 4, changeType: "correction", reason: "Corrected after checking the note", sharing: "purpose_only" })).response.status, 200);
    const corrected = await api(`/v1/context-entries/${entry.body.id}/values/energy/revisions`);
    assert.equal(corrected.body.items.length, 2); assert.equal(corrected.body.items[0].change_type, "correction");
    assert.equal((await api("/v1/dashboard/overview")).body.confirmedValues, 1);
    const retracted = await api(`/v1/context-entries/${entry.body.id}`, "PATCH", { fieldKey: "energy", value: 4, changeType: "retraction", reason: "No longer applicable" });
    assert.equal(retracted.body.lifecycleState, "retracted");
    const snapshotClient = await api("/v1/integration-clients", "POST", { name: "Revision test", permissions: ["read_snapshot"] });
    const snapshotProfile = await api("/v1/context-profiles", "POST", { name: "Revision profile", target: "json", includedFields: [{ templateId: template.body.item.id, fieldKey: "energy" }] });
    const authorizedSnapshot = await fetch(`http://127.0.0.1:${port}/v1/context/analysis-snapshot?profileId=${snapshotProfile.body.id}`, { headers: { "x-pcs-client-id": snapshotClient.body.id, authorization: `Bearer ${snapshotClient.body.token}` } });
    const deniedSnapshot = await authorizedSnapshot.json() as any;
    assert.equal(authorizedSnapshot.status, 403);
    assert.equal(deniedSnapshot.error, "integration_profile_scope_required");
    const plan = await api("/v1/privacy/safe-delete/plan", "POST", { entryId: entry.body.id });
    assert.equal(plan.body.summary.revisions, 3);
    assert.equal((await api("/v1/privacy/safe-delete/execute", "POST", { entryId: entry.body.id, planId: plan.body.planId, confirmation: "wrong" })).response.status, 400);
    assert.equal((await api("/v1/privacy/safe-delete/execute", "POST", { entryId: entry.body.id, planId: plan.body.planId, confirmation: plan.body.confirmation })).body.deleted, true);
    assert.equal((await fetch(`http://127.0.0.1:${port}/`)).headers.get("content-type"), "text/html; charset=utf-8");
  } finally { child.kill(); await new Promise((resolve) => setTimeout(resolve, 100)); rmSync(directory, { recursive: true, force: true }); }
});
