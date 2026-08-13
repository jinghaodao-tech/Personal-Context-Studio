import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Closes three of the manual-verification gaps recorded in docs/spec/v1-scope.md's Verification
// section (2026-08-13): item 2 (an unconfirmed value must be excluded from a snapshot BY COUNT,
// not just silently absent), item 3 (source, provenance, revision, sensitivity, and valid-period
// metadata must all be present together on one confirmed value -- coverage was previously scattered
// across separate tests, none of which checked all five at once), and item 4 (a write/delete
// management action must be rejected when only integration-scoped credentials are presented, not
// just reads -- test/integration-access.test.ts only ever tried a GET).

function harness(port: number, adminToken?: string) {
  const directory = mkdtempSync(join(tmpdir(), "pcs-v1-scope-"));
  const notes = join(directory, "notes");
  mkdirSync(notes, { recursive: true });
  const environment = { ...process.env, PCS_PORT: String(port), PCS_DB: join(directory, "context.sqlite3"), PCS_NOTES_DIR: notes, PCS_BACKUP_DIR: join(directory, "backups"), ...(adminToken ? { PCS_ADMIN_TOKEN: adminToken } : {}) };
  const child = spawn(process.execPath, ["--experimental-strip-types", "apps/api/src/server.ts"], { env: environment, stdio: "ignore" });
  const api = async (path: string, method = "GET", value?: unknown, headers?: Record<string, string>) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { ...(value ? { "content-type": "application/json" } : {}), ...headers }, body: value ? JSON.stringify(value) : undefined });
    return { response, body: await response.json() as any };
  };
  const ready = async () => { for (let attempt = 0; attempt < 100; attempt += 1) { try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return true; } catch { /* wait */ } await new Promise((resolve) => setTimeout(resolve, 100)); } return false; };
  const cleanup = async () => { child.kill(); await new Promise((resolve) => setTimeout(resolve, 150)); try { rmSync(directory, { recursive: true, force: true }); } catch { /* Windows may release the SQLite handle after the test process exits. */ } };
  return { api, ready, cleanup, directory, notes };
}

test("v1-scope item 2: an unconfirmed value is excluded from a snapshot, by count, with the rest still visible", async () => {
  const port = 19960 + Math.floor(Math.random() * 20);
  const { api, ready, cleanup, notes } = harness(port);
  try {
    assert.equal(await ready(), true);
    writeFileSync(join(notes, "work.md"), "# Work\nEnergy was high, mood was steady.", "utf8");
    const document = await api("/v1/documents", "POST", { filePath: "work.md" });
    const template = await api("/v1/context-templates", "POST", { name: "Daily", purpose: "self_understanding", fields: [{ fieldKey: "energy", label: "Energy", valueType: "number", required: false, displayOrder: 1, sharingDefault: "always", sensitivity: "normal", analysisRole: "energy", analysisRoleConfirmed: true, analysisUsage: "outcome", analysisMergeAllowed: true, reason: "Review energy" }] });
    const templateId = template.body.item.id;
    await api(`/v1/context-templates/${templateId}/activate`, "POST");
    const profile = await api("/v1/context-profiles", "POST", { name: "Snapshot profile", target: "json", includedFields: [{ templateId, fieldKey: "energy" }] });
    const client = await api("/v1/integration-clients", "POST", { name: "Snapshot reader", permissions: ["read_snapshot"], allowedProfileIds: [profile.body.id] });
    const clientHeaders = { "x-pcs-client-id": client.body.id, authorization: `Bearer ${client.body.token}` };

    // One candidate gets reviewed and confirmed; a second is left pending review (unconfirmed).
    const confirmed = await api("/v1/context-entries/candidates", "POST", { templateId, sourceDocumentId: document.body.id, provider: "local", values: { energy: 4 } });
    await api(`/v1/context-entries/${confirmed.body.id}/values/energy/review`, "POST", { decision: "accepted", reason: "Matches the note" });
    const unconfirmed = await api("/v1/context-entries/candidates", "POST", { templateId, sourceDocumentId: document.body.id, provider: "local", values: { energy: 2 } });
    assert.equal((await api("/v1/reviews/pending")).body.items.some((item: any) => item.entry_id === unconfirmed.body.id), true, "the second candidate must still be pending review");

    const snapshot = await api(`/v1/context/analysis-snapshot?profileId=${profile.body.id}`, "GET", undefined, clientHeaders);
    assert.equal(snapshot.response.status, 200);
    // The exclusion must be visible as a count, not just an absence.
    assert.equal(snapshot.body.excluded.unconfirmed, 1);
    // The confirmed value must still be present.
    const confirmedRecord = snapshot.body.records.find((record: any) => record.id === confirmed.body.id);
    assert.ok(confirmedRecord, "the confirmed entry must be present in the snapshot");
    assert.equal(confirmedRecord.values.find((value: any) => value.fieldKey === "energy").value, 4);
    // The unconfirmed entry must not appear anywhere in the snapshot's records.
    assert.equal(snapshot.body.records.some((record: any) => record.id === unconfirmed.body.id), false);
  } finally { await cleanup(); }
});

test("v1-scope item 3: source, provenance, revision, sensitivity, and valid-period metadata are all present together on one confirmed value", async () => {
  const port = 19980 + Math.floor(Math.random() * 20);
  const { api, ready, cleanup, notes } = harness(port);
  try {
    assert.equal(await ready(), true);
    writeFileSync(join(notes, "work.md"), "# Work\nFocus was high today.", "utf8");
    const document = await api("/v1/documents", "POST", { filePath: "work.md" });
    const template = await api("/v1/context-templates", "POST", { name: "Focus", purpose: "self_understanding", fields: [{ fieldKey: "focus", label: "Focus", valueType: "number", required: false, displayOrder: 1, sharingDefault: "purpose_only", sensitivity: "normal", analysisRole: "focus", analysisRoleConfirmed: true, analysisUsage: "outcome", analysisMergeAllowed: true, reason: "Review focus" }] });
    const templateId = template.body.item.id;
    await api(`/v1/context-templates/${templateId}/activate`, "POST");

    // Two conflicting confirmed candidates for the same field force a conflict, so we can resolve
    // it manually with a valid-period window and get a revision with valid_from/valid_to populated.
    const first = await api("/v1/context-entries/candidates", "POST", { templateId, sourceDocumentId: document.body.id, provider: "local", values: { focus: 3 } });
    await api(`/v1/context-entries/${first.body.id}/values/focus/review`, "POST", { decision: "accepted", reason: "First reading" });
    const second = await api("/v1/context-entries/candidates", "POST", { templateId, sourceDocumentId: document.body.id, provider: "local", values: { focus: 7 } });
    await api(`/v1/context-entries/${second.body.id}/values/focus/review`, "POST", { decision: "accepted", reason: "Second reading" });
    const conflict = (await api("/v1/context-conflicts")).body.items.find((item: any) => item.status === "unresolved");
    assert.ok(conflict, "two confirmed values for the same field must produce a conflict");
    const firstValueId = (await api(`/v1/context-entries/${first.body.id}`)).body.values[0].id;
    const resolution = await api(`/v1/context-conflicts/${conflict.id}/resolve`, "POST", {
      status: "resolved_manually", baseValueId: firstValueId, newValue: 5, sharing: "purpose_only", sensitivity: "sensitive",
      validFrom: "2026-08-01T00:00:00.000Z", validTo: "2026-09-01T00:00:00.000Z", reason: "Corrected using both readings"
    });
    assert.equal(resolution.response.status, 200);

    // 1. source -- where the value's data came from.
    const detail = await api(`/v1/context-entries/${first.body.id}`);
    const value = detail.body.values.find((item: any) => item.field_key === "focus");
    assert.equal(value.source, "manual_import");
    assert.ok(value.source_id, "source_id must reference the originating document");

    // 2. sensitivity -- must reflect the manual resolution's explicit override.
    assert.equal(value.sensitivity, "sensitive");

    // 3. revision -- the correction from the manual resolution, distinct from the initial revision.
    const revisions = (await api(`/v1/context-entries/${first.body.id}/values/focus/revisions`)).body.items;
    assert.ok(revisions.some((revision: any) => revision.change_type === "initial"));
    const correction = revisions.find((revision: any) => revision.change_type === "correction");
    assert.ok(correction, "the manual resolution must produce a correction revision");

    // 4. valid-period -- the window set on that same correction revision.
    assert.equal(correction.valid_from, "2026-08-01T00:00:00.000Z");
    assert.equal(correction.valid_to, "2026-09-01T00:00:00.000Z");

    // 5. provenance -- a separate, append-only audit trail for the same entry (distinct from the
    // value's own source column and from its revision history).
    const provenance = (await api(`/v1/context-entries/${first.body.id}/provenance`)).body.items;
    assert.equal(provenance.some((item: any) => item.event_type === "candidate_extracted" && item.source_content_hash), true);
  } finally { await cleanup(); }
});

test("v1-scope item 4: a destructive management action is rejected when only integration credentials are presented", async () => {
  const port = 20000 + Math.floor(Math.random() * 20);
  const adminToken = "v1-scope-admin-token";
  const { api, ready, cleanup } = harness(port, adminToken);
  const managementHeaders = { "x-pcs-admin-token": adminToken };
  try {
    assert.equal(await ready(), true);
    const template = await api("/v1/context-templates", "POST", { name: "Deletable", purpose: "test", fields: [{ fieldKey: "value", label: "Value", valueType: "text", required: false, displayOrder: 1, sharingDefault: "private", sensitivity: "normal", reason: "n/a" }] }, managementHeaders);
    const templateId = template.body.item.id;
    const profile = await api("/v1/context-profiles", "POST", { name: "Scope profile", target: "json", includedFields: [{ templateId, fieldKey: "value" }] }, managementHeaders);
    const client = await api("/v1/integration-clients", "POST", { name: "Read only", permissions: ["read_snapshot"], allowedProfileIds: [profile.body.id] }, managementHeaders);
    const integrationHeaders = { "x-pcs-client-id": client.body.id, authorization: `Bearer ${client.body.token}` };

    // A read with only integration credentials on a management-only route is already covered by
    // test/integration-access.test.ts. What's missing is a write/delete attempt.
    const archiveAttempt = await api(`/v1/context-templates/${templateId}/archive`, "POST", undefined, integrationHeaders);
    assert.equal(archiveAttempt.response.status, 401);
    assert.equal(archiveAttempt.body.error, "management_authorization_required");
    // Confirm the archive genuinely did not happen -- not just that the response looked like a rejection.
    const stillActive = await api(`/v1/context-templates/${templateId}`, "GET", undefined, managementHeaders);
    assert.notEqual(stillActive.body.item.status, "archived");

    // Revoking another client is equally destructive and must be equally rejected.
    const revokeAttempt = await api(`/v1/integration-clients/${client.body.id}/revoke`, "POST", undefined, integrationHeaders);
    assert.equal(revokeAttempt.response.status, 401);
    const stillListed = await api("/v1/integration-clients", "GET", undefined, managementHeaders);
    assert.equal(stillListed.body.items.find((item: any) => item.id === client.body.id)?.is_active, 1);
  } finally { await cleanup(); }
});
