import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("raw document import and external-ai export follow ADR-016 (no import gate, consent-gated full export)", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pcs-external-ai-io-"));
  const port = 20250 + Math.floor(Math.random() * 100);
  const child = spawn(process.execPath, ["--experimental-strip-types", "apps/api/src/server.ts"], {
    env: { ...process.env, PCS_PORT: String(port), PCS_DB: join(directory, "context.sqlite3"), PCS_NOTES_DIR: join(directory, "notes"), PCS_BACKUP_DIR: join(directory, "backups") },
    stdio: "ignore",
  });
  const api = async (path: string, method = "GET", value?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: value === undefined ? undefined : { "content-type": "application/json" }, body: value === undefined ? undefined : JSON.stringify(value) });
    return { response, body: await response.json() as any };
  };
  try {
    let ready = false;
    for (let i = 0; i < 100 && !ready; i += 1) { try { ready = (await fetch(`http://127.0.0.1:${port}/health`)).ok; } catch {} await new Promise((resolve) => setTimeout(resolve, 100)); }
    assert.equal(ready, true);

    // --- import: content required ---
    const empty = await api("/v1/documents/raw", "POST", { content: "   " });
    assert.equal(empty.response.status, 400);
    assert.equal(empty.body.error, "document_content_required");

    // --- import: no title/recordedAt, immediately active, no pending state ---
    const longBody = "x".repeat(9000);
    const plain = await api("/v1/documents/raw", "POST", { content: longBody });
    assert.equal(plain.response.status, 201);
    assert.equal(plain.body.created, true);
    assert.match(plain.body.filePath, /^webai-import\/[a-z0-9_-]+\.md$/);
    const plainDoc = await api(`/v1/documents/${plain.body.id}`);
    assert.equal(plainDoc.response.status, 200);
    assert.equal(plainDoc.body.item.archived_at, null); // active immediately, no review/pending state

    // --- import: title with path-like and colon characters must not affect the on-disk path (no traversal surface: filename is always server-generated) ---
    const trap = await api("/v1/documents/raw", "POST", { content: "hello: world\nsecond line", title: "../../etc/passwd: nested", recordedAt: "2026-08-10T00:00:00.000Z" });
    assert.equal(trap.response.status, 201);
    assert.match(trap.body.filePath, /^webai-import\/[a-z0-9_-]+\.md$/);
    const trapDoc = await api(`/v1/documents/${trap.body.id}`);
    assert.equal(trapDoc.body.item.title.startsWith("../../etc/passwd"), true); // stored as plain title text, never interpreted as a path
    assert.equal(trapDoc.body.item.recorded_at, "2026-08-10T00:00:00.000Z");

    // --- export: missing query params ---
    const missingParams = await api(`/v1/documents/${plain.body.id}/export-for-external-ai`);
    assert.equal(missingParams.response.status, 400);
    assert.equal(missingParams.body.error, "external_ai_export_invalid");

    // --- export: unknown document ---
    const missingDoc = await api(`/v1/documents/does-not-exist/export-for-external-ai?providerId=chatgpt&destinationHost=chat.openai.com`);
    assert.equal(missingDoc.response.status, 404);
    assert.equal(missingDoc.body.error, "document_not_found");

    // --- export: no consent granted yet ---
    const noConsent = await api(`/v1/documents/${plain.body.id}/export-for-external-ai?providerId=chatgpt&destinationHost=chat.openai.com`);
    assert.equal(noConsent.response.status, 403);
    assert.equal(noConsent.body.error, "external_ai_consent_required");

    // --- grant consent, then export must return the FULL content, well past the 8000-char excerpt() cap ---
    const grant = await api("/v1/privacy/external-ai-consents", "POST", { scope: "document", providerId: "chatgpt", destinationHost: "https://chat.openai.com/c/abc", documentId: plain.body.id });
    assert.equal(grant.response.status, 201);
    assert.equal(grant.body.destinationHost, "chat.openai.com"); // normalized via destinationHost()

    const exported = await api(`/v1/documents/${plain.body.id}/export-for-external-ai?providerId=chatgpt&destinationHost=chat.openai.com`);
    assert.equal(exported.response.status, 200);
    assert.equal(exported.body.content.length >= 9000, true, "export must not be truncated by the 8000-char excerpt cap");
    assert.equal(exported.body.providerId, "chatgpt");
    assert.equal(exported.body.destinationHost, "chat.openai.com");

    // sanity: the excerpt endpoint on the same document is still capped (unaffected by this change)
    const excerpted = await api(`/v1/documents/${plain.body.id}/excerpt?maxCharacters=50000`);
    assert.equal(excerpted.response.status, 200);
    assert.equal(excerpted.body.excerpt.length <= 8000 + 4, true, "excerpt() cap is unchanged by the new export endpoint");

    // --- a different destination host must NOT be authorized by the chat.openai.com consent ---
    const wrongHost = await api(`/v1/documents/${plain.body.id}/export-for-external-ai?providerId=chatgpt&destinationHost=evil.example.com`);
    assert.equal(wrongHost.response.status, 403);

    // --- revoke consent, export must go back to 403 ---
    const consentId = grant.body.id;
    const revoked = await api(`/v1/privacy/external-ai-consents/${consentId}/revoke`, "POST");
    assert.equal(revoked.response.status, 200);
    const afterRevoke = await api(`/v1/documents/${plain.body.id}/export-for-external-ai?providerId=chatgpt&destinationHost=chat.openai.com`);
    assert.equal(afterRevoke.response.status, 403);
  } finally {
    child.kill();
    await new Promise((resolve) => setTimeout(resolve, 150));
    rmSync(directory, { recursive: true, force: true });
  }
});
