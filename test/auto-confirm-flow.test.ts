import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

test("opt-in auto-confirm: gating, endpoint, ingestion, and re-consent-on-drift", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pcs-auto-confirm-"));
  const notes = join(directory, "notes");
  mkdirSync(notes, { recursive: true });
  writeFileSync(join(notes, "work.md"), "# Work\nSlept 7 hours, mood was good, task went fine.", "utf8");
  const port = 19750 + Math.floor(Math.random() * 200);
  const environment = { ...process.env, PCS_PORT: String(port), PCS_DB: join(directory, "context.sqlite3"), PCS_NOTES_DIR: notes, PCS_BACKUP_DIR: join(directory, "backups") };
  const child = spawn(process.execPath, ["--experimental-strip-types", "apps/api/src/server.ts"], { env: environment, stdio: "ignore" });
  const api = async (path: string, method = "GET", value?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: value ? { "content-type": "application/json" } : undefined, body: value ? JSON.stringify(value) : undefined });
    return { response, body: await response.json() as any };
  };
  try {
    for (let attempt = 0; attempt < 100; attempt += 1) { try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break; } catch { /* wait */ } await new Promise((resolve) => setTimeout(resolve, 100)); }

    const document = await api("/v1/documents", "POST", { filePath: "work.md" });
    const template = await api("/v1/context-templates", "POST", {
      name: "Daily check-in",
      purpose: "self_understanding",
      fields: [
        { fieldKey: "task_clarity", label: "Task clarity", valueType: "number", required: false, displayOrder: 1, sharingDefault: "purpose_only", sensitivity: "normal", analysisRole: "task_clarity", analysisRoleConfirmed: true, analysisUsage: "outcome", analysisMergeAllowed: true, reason: "Review clarity" },
        { fieldKey: "sleep_hours", label: "Sleep hours", valueType: "number", required: false, displayOrder: 2, sharingDefault: "purpose_only", sensitivity: "normal", analysisRole: "sleep_hours", analysisRoleConfirmed: true, analysisUsage: "condition", analysisMergeAllowed: true, reason: "Review sleep" },
      ],
    });
    const templateId = template.body.item.id;
    await api(`/v1/context-templates/${templateId}/activate`, "POST");

    // --- Gate 1: sensitivity must be normal ---
    const sensitiveTemplate = await api("/v1/context-templates", "POST", {
      name: "Sensitive test",
      purpose: "self_understanding",
      fields: [{ fieldKey: "note", label: "Note", valueType: "text", required: false, displayOrder: 1, sharingDefault: "private", sensitivity: "sensitive", reason: "n/a" }],
    });
    const sensitiveTemplateId = sensitiveTemplate.body.item.id;
    const sensitivityRejected = await api(`/v1/context-templates/${sensitiveTemplateId}/fields/note/auto-confirm`, "POST", { enabled: true });
    assert.equal(sensitivityRejected.response.status, 409);
    assert.equal(sensitivityRejected.body.error, "auto_confirm_requires_normal_sensitivity");

    // --- Gate 2: not-flagged, normal-sensitivity field enables with no extra consent ---
    const clarityEnabled = await api(`/v1/context-templates/${templateId}/fields/task_clarity/auto-confirm`, "POST", { enabled: true });
    assert.equal(clarityEnabled.response.status, 200);
    assert.equal(clarityEnabled.body.detectorFlagged, false);
    assert.equal(clarityEnabled.body.elevatedConsentRequired, false);

    // --- Gate 3: flagged (physiological) field is rejected without elevated consent ---
    const sleepRejected = await api(`/v1/context-templates/${templateId}/fields/sleep_hours/auto-confirm`, "POST", { enabled: true });
    assert.equal(sleepRejected.response.status, 409);
    assert.equal(sleepRejected.body.error, "auto_confirm_elevated_consent_required");
    assert.equal(sleepRejected.body.detectorFlagged, true);

    // --- Gate 3b: flagged field enables once elevated consent is given ---
    const sleepEnabled = await api(`/v1/context-templates/${templateId}/fields/sleep_hours/auto-confirm`, "POST", { enabled: true, elevatedConsent: true });
    assert.equal(sleepEnabled.response.status, 200);
    assert.equal(sleepEnabled.body.detectorFlagged, true);

    // --- Ingestion: both enabled fields should be auto-confirmed on candidate creation ---
    const candidate = await api("/v1/context-entries/candidates", "POST", { templateId, sourceDocumentId: document.body.id, provider: "local", values: { task_clarity: 4, sleep_hours: 7 } });
    assert.equal(candidate.response.status, 201);
    const entryDetail = await api(`/v1/context-entries/${candidate.body.id}`);
    const clarityValue = entryDetail.body.values.find((value: any) => value.field_key === "task_clarity");
    const sleepValue = entryDetail.body.values.find((value: any) => value.field_key === "sleep_hours");
    // The entry-detail API does not expose confirmation_mode directly, so check the DB column that
    // the ingestion route actually writes (this is the real signal the feature is supposed to produce).
    const readConfirmationMode = (fieldKey: string) => {
      const db = new DatabaseSync(join(directory, "context.sqlite3"));
      try { return (db.prepare("SELECT confirmation_mode FROM context_values WHERE entry_id=? AND field_key=?").get(candidate.body.id, fieldKey) as any)?.confirmation_mode; }
      finally { db.close(); }
    };
    assert.equal(readConfirmationMode("task_clarity"), "auto_confirmed_low_sensitivity");
    assert.equal(readConfirmationMode("sleep_hours"), "auto_confirmed_low_sensitivity");
    assert.equal(clarityValue.user_confirmed, 1);
    assert.equal(sleepValue.user_confirmed, 1);
    // Auto-confirmed values must not show up in the pending review queue.
    const pending = await api("/v1/reviews/pending");
    assert.equal(pending.body.items.some((item: any) => item.entry_id === candidate.body.id), false);
    // Auto-confirmation must be provenance-tracked as a system action, not silently indistinguishable from human review.
    const provenance = await api(`/v1/context-entries/${candidate.body.id}/provenance`);
    assert.equal(provenance.body.items.some((item: any) => item.event_type === "auto_confirmed_on_ingestion" && item.actor_type === "system"), true);

    // --- Re-consent-on-drift: if the field's stored detector snapshot (version/flagged) no longer
    // matches what the detector would compute today -- e.g. because the field was edited after consent
    // was granted -- ingestion must NOT trust the stale consent and must fall back to manual review.
    // We simulate drift directly at the DB layer (the same effect a field edit + detector-version bump
    // would have) since editing an active template's field currently only happens through the
    // integration-review edit path, not a plain user-facing route. ---
    const driftDb = new DatabaseSync(join(directory, "context.sqlite3"));
    driftDb.prepare("UPDATE context_template_fields SET auto_confirm_detector_version='stale-detector-v0' WHERE template_id=? AND field_key='sleep_hours'").run(templateId);
    driftDb.close();
    const driftCandidate = await api("/v1/context-entries/candidates", "POST", { templateId, sourceDocumentId: document.body.id, provider: "local", values: { sleep_hours: 8 } });
    const driftDb2 = new DatabaseSync(join(directory, "context.sqlite3"));
    try {
      const driftMode = (driftDb2.prepare("SELECT confirmation_mode FROM context_values WHERE entry_id=? AND field_key='sleep_hours'").get(driftCandidate.body.id) as any)?.confirmation_mode;
      assert.notEqual(driftMode, "auto_confirmed_low_sensitivity");
    } finally { driftDb2.close(); }
  } finally {
    child.kill();
    await new Promise((resolve) => setTimeout(resolve, 100));
    rmSync(directory, { recursive: true, force: true });
  }
});
