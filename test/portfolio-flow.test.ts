import assert from "node:assert/strict";
import test from "node:test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("browser portfolio APIs keep template versions immutable and export previews bounded", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pcs-portfolio-"));
  const notes = join(directory, "notes"); mkdirSync(notes, { recursive: true });
  const port = 19600 + Math.floor(Math.random() * 150);
  const env = { ...process.env, PCS_PORT: String(port), PCS_DB: join(directory, "context.sqlite3"), PCS_NOTES_DIR: notes, PCS_AI_PROVIDER: "manual" };
  let child: ChildProcess = spawn(process.execPath, ["--experimental-strip-types", "apps/api/src/server.ts"], { env, stdio: "ignore" });
  const api = async (path: string, method = "GET", value?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: value === undefined ? undefined : { "content-type": "application/json" }, body: value === undefined ? undefined : JSON.stringify(value) });
    return { response, body: await response.json() as any };
  };
  try {
    for (let attempt = 0; attempt < 50; attempt += 1) { try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break; } catch { /* wait */ } await new Promise((resolve) => setTimeout(resolve, 60)); }
    const prompt = await api("/v1/template-drafts/generate", "POST", { theme: "作業開始" });
    assert.equal(prompt.body.mode, "manual"); assert.match(prompt.body.prompt, /schema/);
    const created = await api("/v1/context-templates", "POST", { name: "Daily", description: "Daily context", purpose: "self_understanding", fields: [{ fieldKey: "summary", label: "Summary", valueType: "text", required: true, displayOrder: 1, sharingDefault: "always", sensitivity: "normal", reason: "Explicit summary" }] });
    const templateId = created.body.item.id;
    await api(`/v1/context-templates/${templateId}/activate`, "POST");
    const version = await api(`/v1/context-templates/${templateId}/new-version`, "POST", { fields: [{ fieldKey: "summary", label: "Summary v2", valueType: "text", required: true, displayOrder: 1, sharingDefault: "always", sensitivity: "normal", reason: "Updated wording" }] });
    assert.equal(version.body.parentTemplateId, templateId); assert.equal(version.body.item.version, 2);
    const old = await api(`/v1/context-templates/${templateId}`); assert.equal(old.body.item.immutable, 1);
    const entry = await api("/v1/context-entries", "POST", { templateId, values: { summary: "A long but explicit user-confirmed note about how work should begin." } });
    const profile = await api("/v1/context-profiles", "POST", { name: "Agents profile", target: "agents_md", maximumCharacters: 120, maximumTokens: 30, includedFields: [{ templateId, fieldKey: "summary" }] });
    const preview = await api("/v1/context-exports/preview", "POST", { profileId: profile.body.id });
    assert.equal(preview.body.target, "agents_md"); assert.equal(preview.body.format, "agents"); assert.equal(preview.body.content.length <= 120, true); assert.equal(preview.body.estimatedTokens <= 30, true); assert.match(preview.body.previewFingerprint, /^[a-f0-9]{64}$/);
    const exported = await api("/v1/context-exports", "POST", { profileId: profile.body.id, target: "agents_md", destination: "local-test" });
    assert.equal(exported.response.status, 201); assert.equal((await api("/v1/context-exports")).body.items[0].target, "agents_md");
    const secret = await api("/v1/context-entries", "POST", { templateId, values: { summary: { nested_api_key: "ghp_12345678901234567890" } } });
    assert.equal(secret.response.status, 400); assert.equal(secret.body.error, "secret_value_prohibited");
    const detail = await api(`/v1/context-entries/${entry.body.id}`); assert.equal(detail.body.item.template_version, 1);
  } finally {
    child.kill(); await new Promise((resolve) => setTimeout(resolve, 100)); rmSync(directory, { recursive: true, force: true });
  }
});