import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

test("ADR-020: provenance events record derivation links at the four wired call sites, and unrelated call sites are left at '[]'", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pcs-provenance-derivation-"));
  const port = 21022;
  const environment = { ...process.env, PCS_PORT: String(port), PCS_DB: join(directory, "context.sqlite3"), PCS_NOTES_DIR: join(directory, "notes"), PCS_BACKUP_DIR: join(directory, "backups") };
  const child = spawn(process.execPath, ["--experimental-strip-types", "apps/api/src/server.ts"], { env: environment, stdio: "ignore" });
  const api = async (path: string, method = "GET", value?: unknown, headers?: Record<string, string>) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: value === undefined && !headers ? undefined : { ...(value !== undefined ? { "content-type": "application/json" } : {}), ...(headers ?? {}) }, body: value === undefined ? undefined : JSON.stringify(value) });
    return { response, body: await response.json() as any };
  };
  let db: DatabaseSync | undefined;
  try {
    let ready = false; for (let i = 0; i < 100 && !ready; i += 1) { try { ready = (await fetch(`http://127.0.0.1:${port}/health`)).ok; } catch {} await new Promise((resolve) => setTimeout(resolve, 100)); } assert.equal(ready, true);
    db = new DatabaseSync(join(directory, "context.sqlite3"));

    // --- Site 1: addRevision's confirmed/revised value event derives from that value's own most recent
    // prior provenance event (self-chaining a value's history). Manual entry creation goes through
    // createInitialRevision, which does NOT write a value-scoped provenance event, so the first explicit
    // revision has no parent (derived_from_ids_json === '[]'); the second revision derives from the first. ---
    const template = await api("/v1/context-templates", "POST", {
      name: "Revision chain test", purpose: "self_understanding",
      fields: [{ fieldKey: "note", label: "Note", valueType: "text", required: false, displayOrder: 1, sharingDefault: "purpose_only", sensitivity: "normal", reason: "Track a note over time" }],
    });
    assert.equal(template.response.status, 201);
    const templateId = template.body.item.id;
    await api(`/v1/context-templates/${templateId}/activate`, "POST");
    const entry = await api("/v1/context-entries", "POST", { templateId, values: { note: "v1" } });
    assert.equal(entry.response.status, 201);
    const entryId = entry.body.id;
    const detail1 = await api(`/v1/context-entries/${entryId}`);
    const valueId = detail1.body.values.find((value: any) => value.field_key === "note").id;

    const revision1 = await api(`/v1/context-entries/${entryId}/values/note/revisions`, "POST", { value: "v2", changeType: "correction", reason: "First correction" });
    assert.equal(revision1.response.status, 201);
    const valueEventsAfterFirst = db.prepare("SELECT id,derived_from_ids_json FROM context_provenance WHERE subject_type='value' AND subject_id=? ORDER BY created_at ASC").all(valueId) as Array<{ id: string; derived_from_ids_json: string }>;
    assert.equal(valueEventsAfterFirst.length, 1, "manual initial-revision creation must not itself write a value-scoped provenance event");
    assert.deepEqual(JSON.parse(valueEventsAfterFirst[0].derived_from_ids_json), [], "the first revision on a value has no prior value-scoped provenance event to derive from");
    const firstRevisionEventId = valueEventsAfterFirst[0].id;

    const revision2 = await api(`/v1/context-entries/${entryId}/values/note/revisions`, "POST", { value: "v3", changeType: "correction", reason: "Second correction" });
    assert.equal(revision2.response.status, 201);
    const valueEventsAfterSecond = db.prepare("SELECT id,derived_from_ids_json FROM context_provenance WHERE subject_type='value' AND subject_id=? ORDER BY created_at ASC").all(valueId) as Array<{ id: string; derived_from_ids_json: string }>;
    assert.equal(valueEventsAfterSecond.length, 2);
    assert.deepEqual(JSON.parse(valueEventsAfterSecond[1].derived_from_ids_json), [firstRevisionEventId], "the second revision must derive from the first revision's own provenance event");

    // --- Sites 2 and 3: POST /v1/context-entries/candidates. The entry-level candidate_extracted event
    // derives from the source document's most recent document-subject provenance event (matching content
    // hash); the value-level auto_confirmed_on_ingestion event derives from that same request's
    // candidate_extracted event. ---
    const candidateTemplate = await api("/v1/context-templates", "POST", {
      name: "Candidate chain test", purpose: "self_understanding",
      fields: [{ fieldKey: "step_count", label: "Step count", valueType: "number", required: false, displayOrder: 1, sharingDefault: "purpose_only", sensitivity: "normal", reason: "Track steps from a fitness note" }],
    });
    assert.equal(candidateTemplate.response.status, 201);
    const candidateTemplateId = candidateTemplate.body.item.id;
    await api(`/v1/context-templates/${candidateTemplateId}/activate`, "POST");
    const autoConfirmToggle = await api(`/v1/context-templates/${candidateTemplateId}/fields/step_count/auto-confirm`, "POST", { enabled: true });
    assert.equal(autoConfirmToggle.response.status, 200);

    const document = await api("/v1/documents/raw", "POST", { content: "Took 8000 steps today, per the fitness tracker note." });
    assert.equal(document.response.status, 201);
    const documentId = document.body.id;
    const documentContentHash = document.body.contentHash;
    const documentEventIds = (db.prepare("SELECT id FROM context_provenance WHERE subject_type='document' AND subject_id=? AND source_content_hash=?").all(documentId, documentContentHash) as Array<{ id: string }>).map((row) => row.id);
    assert.ok(documentEventIds.length >= 1, "the raw-import route must have written at least one document-subject provenance event to derive from");

    const candidate = await api("/v1/context-entries/candidates", "POST", { templateId: candidateTemplateId, sourceDocumentId: documentId, provider: "local", values: { step_count: 8000 } });
    assert.equal(candidate.response.status, 201);
    const candidateEntryId = candidate.body.id;

    const candidateEvent = db.prepare("SELECT id,derived_from_ids_json FROM context_provenance WHERE subject_type='entry' AND subject_id=? AND event_type='candidate_extracted'").get(candidateEntryId) as { id: string; derived_from_ids_json: string } | undefined;
    assert.ok(candidateEvent, "candidate_extracted provenance event must exist");
    const candidateDerivedFrom = JSON.parse(candidateEvent!.derived_from_ids_json);
    assert.equal(candidateDerivedFrom.length, 1);
    assert.ok(documentEventIds.includes(candidateDerivedFrom[0]), "candidate_extracted must derive from one of the source document's own provenance events");

    const candidateValueId = (db.prepare("SELECT id FROM context_values WHERE entry_id=? AND field_key='step_count'").get(candidateEntryId) as { id: string }).id;
    const autoConfirmedEvent = db.prepare("SELECT derived_from_ids_json FROM context_provenance WHERE subject_type='value' AND subject_id=? AND event_type='auto_confirmed_on_ingestion'").get(candidateValueId) as { derived_from_ids_json: string } | undefined;
    assert.ok(autoConfirmedEvent, "auto_confirmed_on_ingestion must have fired for a normal-sensitivity field with auto-confirm enabled");
    assert.deepEqual(JSON.parse(autoConfirmedEvent!.derived_from_ids_json), [candidateEvent!.id], "auto_confirmed_on_ingestion must derive from the candidate_extracted event created in the same request");

    // --- Site 4: accept-machine-measurement's accepted_as_machine_measurement event derives from the
    // received event logged when that integration_import_records row first came in via POST
    // /v1/integration-imports. ---
    const required = ["active_minutes", "ai_conversation_minutes", "deep_thinking_minutes", "window_switch_count", "idle_minutes", "away_minutes"];
    const measurementTemplate = await api("/v1/context-templates", "POST", {
      name: "dev-pace-daily-v1", purpose: "self_understanding",
      fields: required.map((fieldKey, index) => ({ fieldKey, label: fieldKey, valueType: "number", required: true, displayOrder: index + 1, sharingDefault: "purpose_only", sensitivity: "normal", analysisRole: "outcome", analysisRoleConfirmed: true, analysisUsage: "outcome", analysisMergeAllowed: true, reason: "Machine measurement" })),
    });
    assert.equal(measurementTemplate.response.status, 201);
    const measurementTemplateId = measurementTemplate.body.item.id;
    await api(`/v1/context-templates/${measurementTemplateId}/activate`, "POST");

    const importClient = await api("/v1/integration-clients", "POST", { name: "dev-pace importer", permissions: ["submit_import"] });
    assert.equal(importClient.response.status, 201);
    const importHeaders = { "x-pcs-client-id": importClient.body.id, authorization: `Bearer ${importClient.body.token}` };
    const measurement = { definitionVersion: "dev-pace-v1", sourceTool: "dev-pace", sourceToolVersion: "1.0.0", measuredAt: "2026-08-15T12:00:00.000Z" };
    const measurementValues = { active_minutes: 10, ai_conversation_minutes: 20, deep_thinking_minutes: 30, window_switch_count: 4, idle_minutes: 5, away_minutes: 6 };
    const received = await api("/v1/integration-imports", "POST", { id: "pd-import-1", sourceSystem: "dev_pace", sourceReferenceId: "dev-pace:2026-08-15", payload: { date: "2026-08-15", ...measurementValues, measurement }, createdAt: "2026-08-15T12:00:00.000Z" }, importHeaders);
    assert.equal(received.response.status, 201);
    const importId = received.body.id;
    const receivedEvent = db.prepare("SELECT id FROM context_provenance WHERE subject_type='integration_import' AND subject_id=? AND event_type='received'").get(importId) as { id: string } | undefined;
    assert.ok(receivedEvent, "POST /v1/integration-imports must write a received provenance event");

    const accepted = await api(`/v1/integration-imports/${importId}/accept-machine-measurement`, "POST", { templateId: measurementTemplateId });
    assert.equal(accepted.response.status, 201);
    const acceptedEvent = db.prepare("SELECT derived_from_ids_json FROM context_provenance WHERE subject_type='integration_import' AND subject_id=? AND event_type='accepted_as_machine_measurement'").get(importId) as { derived_from_ids_json: string } | undefined;
    assert.ok(acceptedEvent, "accepted_as_machine_measurement provenance event must exist");
    assert.deepEqual(JSON.parse(acceptedEvent!.derived_from_ids_json), [receivedEvent!.id], "accepted_as_machine_measurement must derive from the received event logged when the import first came in");

    // --- Unrelated, unwired call site: document indexing outside this ADR's scope (a document reindex
    // triggered with no local predecessor) must still write derived_from_ids_json = '[]', unchanged. ---
    const reindexEvent = db.prepare("SELECT derived_from_ids_json FROM context_provenance WHERE subject_type='document' AND subject_id=? ORDER BY created_at ASC LIMIT 1").get(documentId) as { derived_from_ids_json: string };
    assert.deepEqual(JSON.parse(reindexEvent.derived_from_ids_json), [], "document indexing is a legitimate root and must remain un-derived");
  } finally {
    db?.close();
    child.kill();
    await new Promise((resolve) => setTimeout(resolve, 150));
    rmSync(directory, { recursive: true, force: true });
  }
});
