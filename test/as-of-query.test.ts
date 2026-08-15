import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("ADR-019: bitemporal as-of query resolves valid time and does not leak future transaction-time knowledge", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pcs-as-of-"));
  const port = 21009;
  const environment = { ...process.env, PCS_PORT: String(port), PCS_DB: join(directory, "context.sqlite3"), PCS_NOTES_DIR: join(directory, "notes"), PCS_BACKUP_DIR: join(directory, "backups") };
  const child = spawn(process.execPath, ["--experimental-strip-types", "apps/api/src/server.ts"], { env: environment, stdio: "ignore" });
  const api = async (path: string, method = "GET", value?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: value === undefined ? undefined : { "content-type": "application/json" }, body: value === undefined ? undefined : JSON.stringify(value) });
    return { response, body: await response.json() as any };
  };
  try {
    let ready = false; for (let i = 0; i < 100 && !ready; i += 1) { try { ready = (await fetch(`http://127.0.0.1:${port}/health`)).ok; } catch {} await new Promise((resolve) => setTimeout(resolve, 100)); } assert.equal(ready, true);

    const template = await api("/v1/context-templates", "POST", {
      name: "Address history", purpose: "self_understanding",
      fields: [{ fieldKey: "address", label: "Address", valueType: "text", required: false, displayOrder: 1, sharingDefault: "private", sensitivity: "normal", reason: "Track address over time" }],
    });
    assert.equal(template.response.status, 201);
    const templateId = template.body.item.id;
    await api(`/v1/context-templates/${templateId}/activate`, "POST");

    const entry = await api("/v1/context-entries", "POST", { templateId, values: { address: "Address A" } });
    assert.equal(entry.response.status, 201);
    const entryId = entry.body.id;
    await wait(20);

    // Use offsets from the actual test-run time (never a hardcoded absolute date) so this
    // stays correct regardless of what day it runs. The initial revision's valid_from is
    // effectively "now" (recorded_at at entry-creation time); everything else is placed
    // safely after that using day-sized offsets.
    const day = 24 * 60 * 60 * 1000;
    const base = Date.now();
    const at = (offsetDays: number) => new Date(base + offsetDays * day).toISOString();

    const toB = await api(`/v1/context-entries/${entryId}/values/address/revisions`, "POST", { value: "Address B", changeType: "state_change", reason: "Moved to B", validFrom: at(30) });
    assert.equal(toB.response.status, 201);
    await wait(20);

    // Capture the transaction-time cutoff right here -- before "Address C" is ever recorded.
    const knownAsOfBeforeC = new Date().toISOString();
    await wait(20);

    const toC = await api(`/v1/context-entries/${entryId}/values/address/revisions`, "POST", { value: "Address C", changeType: "state_change", reason: "Moved to C", validFrom: at(60) });
    assert.equal(toC.response.status, 201);
    await wait(20);

    const retracted = await api(`/v1/context-entries/${entryId}/values/address/revisions`, "POST", { changeType: "retraction", reason: "No longer tracked", validFrom: at(90) });
    assert.equal(retracted.response.status, 201);

    const asOf = async (validAt: string, knownAsOf?: string) => api(`/v1/context-entries/${entryId}/values/address/as-of?validAt=${encodeURIComponent(validAt)}${knownAsOf ? `&knownAsOf=${encodeURIComponent(knownAsOf)}` : ""}`);

    // Before the field existed at all.
    const beforeAnything = await asOf(at(-9999));
    assert.equal(beforeAnything.body.found, false);

    // Each historical period, using full (current) knowledge.
    assert.equal((await asOf(at(10))).body.value, "Address A");
    assert.equal((await asOf(at(40))).body.value, "Address B");
    assert.equal((await asOf(at(70))).body.value, "Address C");
    const retractedResult = await asOf(at(100));
    assert.equal(retractedResult.body.retracted, true);
    assert.equal(retractedResult.body.value, undefined);

    // The key bitemporal check: ask about day 70 (which is "Address C" territory in full
    // hindsight) but restrict knowledge to knownAsOfBeforeC, when only A and B had ever been
    // recorded. This must return "Address B" (what PCS believed as of that recording time),
    // NOT "Address C" (transaction-time leak forward) and NOT found:false (which would happen
    // if B's stored valid_to -- mutated to day 60 by C's later creation -- were read directly
    // instead of being ignored per ADR-019's leak-proofing).
    const historicalBelief = await asOf(at(70), knownAsOfBeforeC);
    assert.equal(historicalBelief.response.status, 200);
    assert.equal(historicalBelief.body.found, true);
    assert.equal(historicalBelief.body.value, "Address B", "must reflect what was known at knownAsOfBeforeC, not the later correction to Address C");

    // A knownAsOf before the field existed at all: nothing is knowable yet.
    const beforeEntryExisted = await asOf(at(70), at(-9999));
    assert.equal(beforeEntryExisted.body.found, false);

    // Validation.
    const missingValidAt = await api(`/v1/context-entries/${entryId}/values/address/as-of`);
    assert.equal(missingValidAt.response.status, 400);
    assert.equal(missingValidAt.body.error, "as_of_valid_at_required");
    const badKnownAsOf = await api(`/v1/context-entries/${entryId}/values/address/as-of?validAt=${encodeURIComponent(at(70))}&knownAsOf=not-a-date`);
    assert.equal(badKnownAsOf.response.status, 400);
    assert.equal(badKnownAsOf.body.error, "as_of_known_as_of_invalid");
    const missingField = await api(`/v1/context-entries/${entryId}/values/does_not_exist/as-of?validAt=${encodeURIComponent(at(70))}`);
    assert.equal(missingField.response.status, 404);
  } finally {
    child.kill();
    await new Promise((resolve) => setTimeout(resolve, 150));
    rmSync(directory, { recursive: true, force: true });
  }
});
