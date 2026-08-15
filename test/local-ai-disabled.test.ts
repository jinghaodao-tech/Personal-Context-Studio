import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalAiProvider } from "../packages/ai-core/src/index.ts";

// Closes the last open gap from docs/spec/v1-scope.md item 5 ("Markdown recording continues when
// local AI is stopped or unavailable"). Two things were true before this test: the `disabled`
// provider class existed but createLocalAiProvider() had no branch that ever returned it -- it was
// dead code, unreachable through any PCS_AI_PROVIDER value -- and no test ever exercised the actual
// behavioral guarantee (saving/indexing a Markdown document, then feeding it into the normal Review
// flow, must not depend on local AI being available). Both are addressed here: the config branch was
// added in packages/ai-core/src/index.ts, and this file proves the guarantee end-to-end.

test("createLocalAiProvider('disabled') is now actually reachable and reports unavailable", async () => {
  const provider = createLocalAiProvider({ provider: "disabled" });
  assert.equal(provider.id, "disabled");
  const health = await provider.healthCheck();
  assert.equal(health.available, false);
  assert.equal(health.running, false);
  assert.equal(health.errorCode, "disabled");
  await assert.rejects(() => provider.extractDocumentValues({ content: "x", template: { id: "t", fields: [] }, sourceContentHash: "hash" }), /disabled/);
});

test("v1-scope item 5: Markdown recording and Review both keep working while local AI is disabled and stopped", async () => {
  const port = 21020;
  const directory = mkdtempSync(join(tmpdir(), "pcs-ai-disabled-"));
  const notes = join(directory, "notes");
  mkdirSync(notes, { recursive: true });
  const child = spawn(process.execPath, ["--experimental-strip-types", "apps/api/src/server.ts"], {
    env: { ...process.env, PCS_PORT: String(port), PCS_DB: join(directory, "context.sqlite3"), PCS_NOTES_DIR: notes, PCS_BACKUP_DIR: join(directory, "backups"), PCS_AI_PROVIDER: "disabled" },
    stdio: "ignore"
  });
  const api = async (path: string, method = "GET", value?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: value ? { "content-type": "application/json" } : undefined, body: value ? JSON.stringify(value) : undefined });
    return { response, body: await response.json() as any };
  };
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100 && !ready; attempt += 1) { try { ready = (await fetch(`http://127.0.0.1:${port}/health`)).ok; } catch { await new Promise((resolve) => setTimeout(resolve, 100)); } }
    assert.equal(ready, true);

    // Local AI must genuinely be off, not just configured off -- also stop the runtime explicitly,
    // the way a user disabling AI actually would.
    await api("/v1/local-ai/stop", "POST");
    const status = await api("/v1/local-ai/status");
    assert.equal(status.body.provider.providerId, "disabled");
    assert.equal(status.body.provider.available, false);

    // Saving and indexing a Markdown document must not depend on local AI at all.
    writeFileSync(join(notes, "work.md"), "# Work\nFinished the quarterly report without AI running.", "utf8");
    const created = await api("/v1/documents", "POST", { filePath: "work.md" });
    assert.equal(created.response.status, 201);
    assert.equal(created.body.created, true);
    const list = await api("/v1/documents");
    assert.equal(list.body.items.some((item: any) => item.id === created.body.id), true);
    const searched = await api("/v1/documents/search", "POST", { query: "quarterly" });
    assert.equal(searched.body.items.some((item: any) => item.id === created.body.id), true);

    // The document must still be usable for Review as usual: a template, a manually-recorded
    // candidate referencing it (provider: "manual", not local AI), and it must land in the pending
    // review queue exactly like it would with AI enabled.
    const template = await api("/v1/context-templates", "POST", { name: "Work log", purpose: "self_understanding", fields: [{ fieldKey: "summary", label: "Summary", valueType: "text", required: false, displayOrder: 1, sharingDefault: "purpose_only", sensitivity: "normal", reason: "Record without AI" }] });
    await api(`/v1/context-templates/${template.body.item.id}/activate`, "POST");
    const candidate = await api("/v1/context-entries/candidates", "POST", { templateId: template.body.item.id, sourceDocumentId: created.body.id, provider: "manual", values: { summary: "Finished the quarterly report" } });
    assert.equal(candidate.response.status, 201);
    const pending = await api("/v1/reviews/pending");
    assert.equal(pending.body.items.some((item: any) => item.entry_id === candidate.body.id), true);
    const review = await api(`/v1/context-entries/${candidate.body.id}/values/summary/review`, "POST", { decision: "accepted", reason: "Matches the note, recorded manually" });
    assert.equal(review.response.status, 200);
  } finally {
    child.kill();
    await new Promise((resolve) => setTimeout(resolve, 150));
    try { rmSync(directory, { recursive: true, force: true }); } catch { /* Windows may release the SQLite handle after the test process exits. */ }
  }
});
