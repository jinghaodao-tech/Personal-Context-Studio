import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

test("ADR-017: concept registry and assertion kind (field default, explicit override, AI-candidate review gate, zero-backfill self-heal)", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pcs-concept-kind-"));
  const port = 21011;
  const environment = { ...process.env, PCS_PORT: String(port), PCS_DB: join(directory, "context.sqlite3"), PCS_NOTES_DIR: join(directory, "notes"), PCS_BACKUP_DIR: join(directory, "backups") };
  const child = spawn(process.execPath, ["--experimental-strip-types", "apps/api/src/server.ts"], { env: environment, stdio: "ignore" });
  const api = async (path: string, method = "GET", value?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: value === undefined ? undefined : { "content-type": "application/json" }, body: value === undefined ? undefined : JSON.stringify(value) });
    return { response, body: await response.json() as any };
  };
  let db: DatabaseSync | undefined;
  try {
    let ready = false; for (let i = 0; i < 100 && !ready; i += 1) { try { ready = (await fetch(`http://127.0.0.1:${port}/health`)).ok; } catch {} await new Promise((resolve) => setTimeout(resolve, 100)); } assert.equal(ready, true);
    db = new DatabaseSync(join(directory, "context.sqlite3"));

    // --- Field declares conceptKey + defaultKind at design time; concept registry row is upserted. ---
    const template = await api("/v1/context-templates", "POST", {
      name: "Daily check-in", purpose: "self_understanding",
      fields: [
        { fieldKey: "sleep_hours", label: "Sleep hours", valueType: "number", required: false, displayOrder: 1, sharingDefault: "purpose_only", sensitivity: "normal", conceptKey: "sleep.duration", defaultKind: "measurement", reason: "Track sleep" },
        { fieldKey: "mood_note", label: "Mood note", valueType: "text", required: false, displayOrder: 2, sharingDefault: "purpose_only", sensitivity: "normal", reason: "No default kind declared" },
      ],
    });
    assert.equal(template.response.status, 201);
    const templateId = template.body.item.id;
    const sleepField = template.body.item.fields.find((field: any) => field.field_key === "sleep_hours");
    assert.equal(sleepField.concept_key, "sleep.duration");
    assert.equal(sleepField.default_kind, "measurement");
    const concept = db.prepare("SELECT concept_key FROM context_concepts WHERE concept_key='sleep.duration'").get() as any;
    assert.ok(concept, "declaring a conceptKey on a field must upsert a context_concepts row");
    await api(`/v1/context-templates/${templateId}/activate`, "POST");

    // --- Manual entry, no explicit kind: resolves to the field's defaultKind. ---
    const entryDefault = await api("/v1/context-entries", "POST", { templateId, values: { sleep_hours: 7, mood_note: "fine" } });
    assert.equal(entryDefault.response.status, 201);
    const detailDefault = await api(`/v1/context-entries/${entryDefault.body.id}`);
    const sleepValueDefault = detailDefault.body.values.find((value: any) => value.field_key === "sleep_hours");
    const moodValueDefault = detailDefault.body.values.find((value: any) => value.field_key === "mood_note");
    assert.equal(sleepValueDefault.kind, "measurement");
    assert.equal(moodValueDefault.kind, null, "a field with no declared defaultKind must leave kind unstructured (null), not a guess");

    // --- Manual entry, explicit kind overrides the field default. ---
    const entryOverride = await api("/v1/context-entries", "POST", { templateId, values: { sleep_hours: 6 }, kind: { sleep_hours: "observation" } });
    assert.equal(entryOverride.response.status, 201);
    const detailOverride = await api(`/v1/context-entries/${entryOverride.body.id}`);
    assert.equal(detailOverride.body.values.find((value: any) => value.field_key === "sleep_hours").kind, "observation");

    // --- Invalid kind is rejected, not silently coerced. ---
    const entryInvalid = await api("/v1/context-entries", "POST", { templateId, values: { sleep_hours: 5 }, kind: { sleep_hours: "guess" } });
    assert.equal(entryInvalid.response.status, 400);
    assert.equal(entryInvalid.body.error, "context_value_kind_invalid");

    // --- AI candidate path: an AI-proposed kind rides in the same unconfirmed row as the value itself,
    // and only becomes authoritative once the human review step confirms it (ADR-002/ADR-017 gate). ---
    const document = await api("/v1/documents/raw", "POST", { content: "Slept about 6.5 hours, mood was fine, per the markdown note." });
    const candidate = await api("/v1/context-entries/candidates", "POST", { templateId, sourceDocumentId: document.body.id, provider: "local", values: { sleep_hours: 6.5 }, kind: { sleep_hours: "external_claim" } });
    assert.equal(candidate.response.status, 201);
    const beforeReview = await api(`/v1/context-entries/${candidate.body.id}`);
    const candidateValue = beforeReview.body.values.find((value: any) => value.field_key === "sleep_hours");
    assert.equal(candidateValue.user_confirmed, 0, "AI-proposed value must stay unconfirmed pending review");
    assert.equal(candidateValue.kind, "external_claim", "AI-proposed kind is visible but not yet authoritative -- gated the same way the value itself is");
    const reviewed = await api(`/v1/context-entries/${candidate.body.id}/values/sleep_hours/review`, "POST", { decision: "accepted", reason: "Matches the note" });
    assert.equal(reviewed.response.status, 200);
    const afterReview = await api(`/v1/context-entries/${candidate.body.id}`);
    const confirmedValue = afterReview.body.values.find((value: any) => value.field_key === "sleep_hours");
    assert.equal(confirmedValue.user_confirmed, 1);
    assert.equal(confirmedValue.kind, "external_claim", "kind is confirmed together with the value in the same review action -- no separate kind-approval step");

    // --- Zero-backfill promise: setting a field's default_kind after the fact (simulated at the DB layer,
    // since no API route currently edits an existing field's default_kind in place) must retroactively
    // change what GET returns for values that predate the default, via read-time COALESCE, without
    // touching the stored value row. ---
    const untaggedEntry = await api("/v1/context-entries", "POST", { templateId, values: { mood_note: "calm" } });
    const beforeBackfill = await api(`/v1/context-entries/${untaggedEntry.body.id}`);
    assert.equal(beforeBackfill.body.values.find((value: any) => value.field_key === "mood_note").kind, null);
    const rawKindBefore = (db.prepare("SELECT kind FROM context_values WHERE entry_id=? AND field_key='mood_note'").get(untaggedEntry.body.id) as any).kind;
    assert.equal(rawKindBefore, null);
    db.prepare("UPDATE context_template_fields SET default_kind='observation' WHERE template_id=? AND field_key='mood_note'").run(templateId);
    const afterBackfill = await api(`/v1/context-entries/${untaggedEntry.body.id}`);
    assert.equal(afterBackfill.body.values.find((value: any) => value.field_key === "mood_note").kind, "observation", "GET must resolve kind via COALESCE(value.kind, field.default_kind) at read time, retroactively, with zero migration");
    const rawKindStillNull = (db.prepare("SELECT kind FROM context_values WHERE entry_id=? AND field_key='mood_note'").get(untaggedEntry.body.id) as any).kind;
    assert.equal(rawKindStillNull, null, "the retroactive read must not have silently written to the stored row");

    // --- Self-heal on next revision: once the value IS revised for any other reason, the resolved kind gets persisted. ---
    const reconfirmed = await api(`/v1/context-entries/${untaggedEntry.body.id}/values/mood_note/reconfirm`, "POST", { reason: "Still true" });
    assert.equal(reconfirmed.response.status, 200);
    const rawKindAfterRevision = (db.prepare("SELECT kind FROM context_values WHERE entry_id=? AND field_key='mood_note'").get(untaggedEntry.body.id) as any).kind;
    assert.equal(rawKindAfterRevision, "observation", "addRevision must persist the resolved kind once the row is touched again");

    // --- CHECK constraint at the DB layer as a last line of defense, independent of API validation. ---
    let rejectedAtDb = false;
    try { db.prepare("UPDATE context_values SET kind='not_a_real_kind' WHERE entry_id=? AND field_key='mood_note'").run(untaggedEntry.body.id); }
    catch { rejectedAtDb = true; }
    assert.equal(rejectedAtDb, true, "context_values.kind must have a CHECK constraint, unlike confirmation_mode which was left unconstrained");
  } finally {
    db?.close();
    child.kill();
    await new Promise((resolve) => setTimeout(resolve, 150));
    rmSync(directory, { recursive: true, force: true });
  }
});
