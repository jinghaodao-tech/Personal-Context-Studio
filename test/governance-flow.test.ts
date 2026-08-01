import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("review, purpose-limited sharing, export history, conflicts, reconfirmation and backups form a safe flow", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pcs-governance-"));
  const notes = join(directory, "notes");
  mkdirSync(notes, { recursive: true });
  writeFileSync(join(notes, "work.md"), "# Work\nI had focused energy.", "utf8");
  const port = 19350 + Math.floor(Math.random() * 200);
  const environment = { ...process.env, PCS_PORT: String(port), PCS_DB: join(directory, "context.sqlite3"), PCS_NOTES_DIR: notes, PCS_BACKUP_DIR: join(directory, "backups") };
  let child = spawn(process.execPath, ["--experimental-strip-types", "apps/api/src/server.ts"], { env: environment, stdio: "ignore" });
  const api = async (path: string, method = "GET", value?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: value ? { "content-type": "application/json" } : undefined, body: value ? JSON.stringify(value) : undefined });
    return { response, body: await response.json() as any };
  };
  try {
    for (let attempt = 0; attempt < 40; attempt += 1) { try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break; } catch { /* wait */ } await new Promise((resolve) => setTimeout(resolve, 75)); }
    const document = await api("/v1/documents", "POST", { filePath: "work.md" });
    const template = await api("/v1/context-templates", "POST", { name: "Focus", purpose: "work", fields: [{ fieldKey: "energy", label: "Energy", valueType: "number", required: true, displayOrder: 1, sharingDefault: "purpose_only", sensitivity: "normal", reason: "Review energy" }] });
    await api(`/v1/context-templates/${template.body.item.id}/activate`, "POST");
    const first = await api("/v1/context-entries/candidates", "POST", { templateId: template.body.item.id, sourceDocumentId: document.body.id, provider: "local", values: { energy: 4 } });
    assert.equal((await api("/v1/reviews/pending")).body.items[0].entry_id, first.body.id);
    assert.equal((await api(`/v1/context-entries/${first.body.id}/values/energy/review`, "POST", { decision: "accepted", reason: "Matches the note", reconfirmAfter: "2000-01-01T00:00:00.000Z" })).body.decision, "accepted");
    assert.equal((await api(`/v1/context-entries/${first.body.id}/values/energy/reviews`)).body.items[0].decision, "accepted");
    const provenance = await api(`/v1/context-entries/${first.body.id}/provenance`);
    assert.equal(provenance.body.items.some((item: any) => item.event_type === "candidate_extracted" && item.source_content_hash), true);
    assert.equal(JSON.stringify(provenance.body.items).includes("I had focused energy"), false);
    assert.equal((await api("/v1/reconfirmations/due")).body.items.length, 1);
    const reconfirmed = await api(`/v1/context-entries/${first.body.id}/values/energy/reconfirm`, "POST", { reason: "Still accurate" });
    assert.equal(reconfirmed.response.status, 200);
    const reconfirmationHistory = await api(`/v1/context-entries/${first.body.id}/values/energy/revisions`);
    assert.equal(reconfirmationHistory.body.items.some((item: any) => item.change_type === "reaffirmation"), true);
    const purpose = await api("/v1/sharing-purposes", "POST", { name: "work-planning", description: "Planning assistance" });
    assert.deepEqual((await api(`/v1/context-entries/${first.body.id}/values/energy/purposes`, "PUT", { purposeIds: [purpose.body.id] })).body.purposeIds, [purpose.body.id]);
    const profile = await api("/v1/context-profiles", "POST", { name: "Work helper", target: "assistant", purposeId: purpose.body.id, includedFields: [{ templateId: template.body.item.id, fieldKey: "energy" }] });
    const preview = await api("/v1/context-exports/preview", "POST", { profileId: profile.body.id, format: "markdown", destination: "local test" });
    assert.match(preview.body.content, /Energy/); assert.equal(preview.body.omitted.purposeNotAllowed, 0);
    const exported = await api("/v1/context-exports", "POST", { profileId: profile.body.id, format: "markdown", destination: "local test", previewFingerprint: preview.body.previewFingerprint });
    assert.equal(exported.response.status, 201); const history = await api("/v1/context-exports"); assert.equal("content" in history.body.items[0], false); assert.equal(history.body.items[0].destination, "local test");
    const second = await api("/v1/context-entries/candidates", "POST", { templateId: template.body.item.id, sourceDocumentId: document.body.id, provider: "local", values: { energy: 2 } });
    await api(`/v1/context-entries/${second.body.id}/values/energy/review`, "POST", { decision: "accepted", reason: "Alternative extraction" });
    const conflicts = await api("/v1/context-conflicts"); assert.equal(conflicts.body.items.length, 1);
    assert.equal((await api(`/v1/context-conflicts/${conflicts.body.items[0].id}/resolve`, "POST", { status: "keep_latest", reason: "Keep the latest confirmed reading" })).response.status, 200);
    const afterConflict = await api(`/v1/context-entries/${first.body.id}`); assert.equal(afterConflict.body.values[0].lifecycle_state, "retracted");
    const rejected = await api("/v1/context-entries/candidates", "POST", { templateId: template.body.item.id, sourceDocumentId: document.body.id, provider: "local", values: { energy: 1 } });
    await api(`/v1/context-entries/${rejected.body.id}/values/energy/review`, "POST", { decision: "rejected", reason: "Not supported" });
    assert.equal((await api("/v1/reviews/pending")).body.items.some((item: any) => item.entry_id === rejected.body.id), false);
    const backup = await api("/v1/backups", "POST"); assert.equal(backup.response.status, 201); const backupList = await api("/v1/backups"); assert.equal(backupList.body.items[0].id, backup.body.id); assert.equal(backupList.body.items[0].available, true); assert.equal(backupList.body.items[0].integrityValid, true);
    const ops = await api("/v1/ops/status"); assert.equal(ops.response.status, 200); assert.ok(ops.body.migrationCount >= 1); assert.equal(typeof ops.body.encryptionConfigured, "boolean");
    const restorePlan = await api(`/v1/backups/${backup.body.id}/restore-plan`, "POST"); assert.equal(restorePlan.body.restartRequired, true);
    await api("/v1/sharing-purposes", "POST", { name: "after-backup" });
    const restored = await api(`/v1/backups/${backup.body.id}/restore`, "POST", { planId: restorePlan.body.planId, confirmation: restorePlan.body.confirmation }); assert.equal(restored.response.status, 202);
    await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    child = spawn(process.execPath, ["--experimental-strip-types", "apps/api/src/server.ts"], { env: environment, stdio: "ignore" });
    for (let attempt = 0; attempt < 40; attempt += 1) { try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break; } catch { /* wait */ } await new Promise((resolve) => setTimeout(resolve, 75)); }
    assert.equal((await api("/v1/sharing-purposes")).body.items.some((item: any) => item.name === "after-backup"), false);
  } finally {
    child.kill();
    await new Promise((resolve) => setTimeout(resolve, 100));
    rmSync(directory, { recursive: true, force: true });
  }
});
