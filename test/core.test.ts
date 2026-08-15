import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { calculateReconfirmAfter, eligibleForExport, formatExport, isSecretLike, validateField } from "../packages/domain/src/index.ts";
import { renderTargetWithDetail } from "../packages/export-renderers/src/index.ts";
import { decryptText, encryptText } from "../packages/crypto/src/index.ts";
import { listMarkdownFiles, readMarkdownSnapshot, resolveMarkdownPath } from "../packages/documents/src/index.ts";
import { LocalAiProviderError, createLocalAiProvider } from "../packages/ai-core/src/index.ts";
import { extractDocumentValues, extractionIsStale } from "../packages/entry-extraction/src/index.ts";
import { RuntimeManager } from "../packages/local-ai-runtime/src/index.ts";
import { validateContextAnalysisSnapshot, validateIntegrationImport, validateIntegrationTemplateRequest } from "../packages/integration-contracts/src/index.ts";

test("context fields have explicit contracts", () => {
  assert.equal(validateField({ fieldKey: "preferred_editor", label: "Preferred editor", valueType: "text", required: false, displayOrder: 1, sharingDefault: "purpose_only", sensitivity: "normal", reason: "Coding context" }).fieldKey, "preferred_editor");
  assert.throws(() => validateField({ fieldKey: "Bad Key", label: "x", valueType: "text", required: false, displayOrder: 1, sharingDefault: "always", sensitivity: "normal", reason: "x" }));
  assert.equal(validateField({ fieldKey: "energy", label: "Energy", valueType: "scale", required: false, displayOrder: 2, minimum: 1, maximum: 5, reconfirmationMode: "default", reconfirmationIntervalDays: 14, sharingDefault: "purpose_only", sensitivity: "normal", reason: "Short-term state" }).reconfirmationIntervalDays, 14);
  assert.throws(() => validateField({ fieldKey: "invalid_policy", label: "Invalid", valueType: "text", required: false, displayOrder: 3, reconfirmationMode: "none", reconfirmationIntervalDays: 7, sharingDefault: "always", sensitivity: "normal", reason: "Invalid policy" }));
});

test("exports exclude private, never, highly sensitive and secret-like values", () => {
  assert.equal(eligibleForExport({ sharing: "always", sensitivity: "normal", userConfirmed: true }), true);
  assert.equal(eligibleForExport({ sharing: "private", sensitivity: "normal", userConfirmed: true }), false);
  assert.equal(eligibleForExport({ sharing: "always", sensitivity: "highly_sensitive", userConfirmed: true }), false);
  assert.equal(isSecretLike("OPENAI_API_KEY=abc"), true);
  assert.match(formatExport([{ label: "Editor", value: "VS Code" }], "agents"), /User Context/);
  assert.match(renderTargetWithDetail([{ label: "Editor", value: "VS Code" }], "agents_md", "detailed"), /Detail level: detailed/);
  assert.equal(calculateReconfirmAfter("2026-01-01T00:00:00.000Z", 7), "2026-01-08T00:00:00.000Z");
  const key = Buffer.alloc(32, 7); const sealed = encryptText(JSON.stringify({ note: "private" }), key);
  assert.match(sealed, /^pcs:v1:/); assert.equal(decryptText(sealed, key), JSON.stringify({ note: "private" }));
});

test("integration contracts reject malformed local handoffs", () => {
  assert.equal(validateContextAnalysisSnapshot({ schemaVersion: "pcs-context-analysis-snapshot-v1", generatedAt: "2026-07-01T00:00:00.000Z", records: [], excluded: { unconfirmed: 0, nonShareable: 0, invalid: 0 } }).schemaVersion, "pcs-context-analysis-snapshot-v1");
  assert.equal(validateIntegrationTemplateRequest({ schemaVersion: "pcs-integration-template-request-v1", id: "request_1", sourceSystem: "workbench", sourceReferenceId: null, title: "Focus experiment", purpose: "Compare work conditions", durationDays: 7, requestedFields: [], createdAt: "2026-07-01T00:00:00.000Z" }).id, "request_1");
  assert.equal(validateIntegrationImport({ id: "import_1", sourceSystem: "workbench", payload: { status: "draft" } }).id, "import_1");
  assert.throws(() => validateIntegrationTemplateRequest({ schemaVersion: "pcs-integration-template-request-v1", sourceSystem: "Bad Name" }));
});

test("Markdown documents stay in the configured root and use canonical dates", () => {
  const directory = mkdtempSync(join(tmpdir(), "pcs-documents-"));
  const outside = mkdtempSync(join(tmpdir(), "pcs-outside-"));
  try {
    mkdirSync(join(directory, "daily"));
    writeFileSync(join(directory, "daily", "2026-07-10.md"), "---\ndate: 2026-07-09\ntitle: Daily note\n---\nbody", "utf8");
    writeFileSync(join(outside, "private.md"), "outside", "utf8");
    const snapshot = readMarkdownSnapshot(directory, "daily/2026-07-10.md");
    assert.equal(snapshot.title, "Daily note");
    assert.equal(snapshot.recordedAt, "2026-07-09T00:00:00.000Z");
    assert.deepEqual(listMarkdownFiles(directory), ["daily/2026-07-10.md"]);
    assert.throws(() => resolveMarkdownPath(directory, join(outside, "private.md")), /document_path_invalid/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("MCP surface exposes read-only tools", async () => {
  const api = createServer((request, response) => {
    if (request.url?.startsWith("/v1/context/analysis-snapshot") && request.headers.authorization === "Bearer test-token") {
      response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ schemaVersion: "pcs-context-analysis-snapshot-v1", generatedAt: "2026-08-16T00:00:00.000Z", records: [], excluded: { unconfirmed: 0, nonShareable: 0, invalid: 0 } })); return;
    }
    response.writeHead(404); response.end();
  });
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
  const address = api.address(); const port = typeof address === "object" && address ? address.port : 0;
  const child = spawnMcp({ PCS_API_URL: `http://127.0.0.1:${port}`, PCS_CLIENT_ID: "client_test", PCS_CLIENT_TOKEN: "test-token" });
  try {
    const response = await child.request({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    const names = response.result.tools.map((tool: { name: string }) => tool.name);
    assert.deepEqual(names, ["list_reviewed_context"]);
    assert.equal(names.some((name: string) => /create|update|delete|write/.test(name)), false);
    const call = await child.request({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_reviewed_context", arguments: { profileId: "profile_test" } } });
    assert.equal(call.result.isError, undefined);
    assert.deepEqual(call.result.structuredContent.records, []);
  } finally {
    child.close(); api.close();
  }
});

test("PCS-owned AI providers and extraction stay local or explicit", async () => {
  const manual = createLocalAiProvider({ provider: "manual" });
  const defaultProvider = createLocalAiProvider();
  assert.equal(defaultProvider.id, "manual");
  assert.match(manual.manualExtractionPrompt!({ content: "private note", sourceContentHash: "hash", template: { id: "template_1", fields: [] } }), /private note/);
  await assert.rejects(() => manual.extractDocumentValues({ content: "x", sourceContentHash: "hash", template: { id: "template_1", fields: [] } }), LocalAiProviderError);
  assert.throws(() => createLocalAiProvider({ provider: "openai-compatible-local", baseUrl: "https://example.com/v1" }), /remote_local_ai_endpoint/);
  const extracted = await extractDocumentValues({ documentId: "doc_1", template: { id: "template_1", fields: [] }, content: "record", sourceUpdatedAt: "2026-07-01T00:00:00.000Z", provider: createLocalAiProvider({ provider: "mock" }) });
  assert.equal(extractionIsStale(extracted, "changed record"), true);
  await assert.rejects(() => new RuntimeManager().start(), /runtime_executable_unavailable/);
});

function spawnMcp(environment: Record<string, string> = {}) {
  const child = spawn(process.execPath, ["--experimental-strip-types", "apps/mcp/src/main.ts"], { env: { ...process.env, ...environment }, stdio: ["pipe", "pipe", "ignore"] });
  child.stdout.setEncoding("utf8");
  let buffer = "";
  const waiting: Array<(value: any) => void> = [];
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) waiting.shift()?.(JSON.parse(line));
  });
  return {
    request(value: unknown) {
      return new Promise<any>((resolve) => {
        waiting.push(resolve);
        child.stdin.write(`${JSON.stringify(value)}\n`);
      });
    },
    close() { child.kill(); },
  };
}

test("official analysis contract rejects unsafe ranges, choices, periods, timezone and excluded counts", () => {
  const base = { schemaVersion: "pcs-analysis-snapshot-v2", contractRevision: "pcs-analysis-snapshot-v2.1", snapshotId: "snapshot-1", profileId: "profile-1", generatedAt: "2026-07-02T00:00:00.000Z", period: { startAt: "2026-07-01T00:00:00.000Z", endAt: "2026-07-03T00:00:00.000Z", timezone: "Asia/Tokyo" }, records: [], excluded: {} };
  assert.equal(validateContextAnalysisSnapshot(base).schemaVersion, "pcs-analysis-snapshot-v2");
  assert.throws(() => validateContextAnalysisSnapshot({ ...base, period: { ...base.period, endAt: base.period.startAt } }), /invalid/);
  assert.throws(() => validateContextAnalysisSnapshot({ ...base, period: { ...base.period, timezone: "Not/AZone" } }), /invalid/);
  assert.throws(() => validateContextAnalysisSnapshot({ ...base, excluded: { invalid: -1 } }), /invalid/);
});

test("rejects malformed V2 records, duplicate fields, applicability and unknown keys", () => {
  const baseValue = { fieldKey: "clarity", label: "Clarity", valueType: "scale", value: 2, templateId: "t", templateVersionId: "v1", analysisRole: "condition", analysisRoleConfirmed: true, analysisUsage: "condition", analysisMergeAllowed: false, scaleFingerprint: "scale|1|5", minimum: 1, maximum: 5, provenance: { source: "user_input", sourceId: "entry", userConfirmed: true, recordedAt: "2026-08-01T00:00:00.000Z", transformVersion: "test", privacyLevel: "normal" } };
  const base = { schemaVersion: "pcs-analysis-snapshot-v2", contractRevision: "pcs-analysis-snapshot-v2.1", snapshotId: "snapshot", profileId: "profile", generatedAt: "2026-08-01T00:00:00.000Z", period: { startAt: "2026-08-01T00:00:00.000Z", endAt: "2026-08-02T00:00:00.000Z", timezone: "UTC" }, records: [{ id: "record", recordedAt: "2026-08-01T00:00:00.000Z", sourceDocumentId: null, values: [baseValue] }], excluded: {} };
  assert.equal(validateContextAnalysisSnapshot(base).records.length, 1);
  assert.throws(() => validateContextAnalysisSnapshot({ ...base, records: [{ ...base.records[0], values: [{ ...baseValue, value: 6 }] }] }), /out_of_range/);
  assert.throws(() => validateContextAnalysisSnapshot({ ...base, records: [{ ...base.records[0], extra: true }] }), /record_invalid/);
  assert.throws(() => validateContextAnalysisSnapshot({ ...base, extra: true }), /snapshot_invalid/);
  assert.throws(() => validateContextAnalysisSnapshot({ ...base, records: [{ ...base.records[0], values: [baseValue, baseValue] }] }), /duplicate_field/);
  assert.throws(() => validateContextAnalysisSnapshot({ ...base, records: [{ ...base.records[0], values: [{ ...baseValue, applicability: [{ condition: "workday", validFrom: "2026-08-02T00:00:00.000Z", validTo: "2026-08-01T00:00:00.000Z" }] }] }] }), /applicability_invalid/);
  assert.equal((validateContextAnalysisSnapshot({ ...base, records: [{ ...base.records[0], values: [{ ...baseValue, applicability: [] }] }] }) as any).records[0].values[0].applicability?.length, 0);
  assert.throws(() => validateContextAnalysisSnapshot({ ...base, records: [{ ...base.records[0], values: [{ ...baseValue, applicability: [{ condition: null, validFrom: null, validTo: null }] }] }] }), /applicability_invalid/);
  assert.throws(() => validateContextAnalysisSnapshot({ ...base, records: [{ ...base.records[0], values: [{ ...baseValue, applicability: [{ condition: "workday", validFrom: null, validTo: null }, { condition: " WORKDAY ", validFrom: null, validTo: null }] }] }] }), /applicability_duplicate/);
});

test("V3 distinguishes user-confirmed and machine-measured values", () => {
  const value = { fieldKey: "active_minutes", label: "Active minutes", valueType: "duration_minutes", value: 42, templateId: "activity", templateVersionId: "v1", analysisRole: "condition", analysisRoleConfirmed: true, analysisUsage: "condition", analysisMergeAllowed: true, scaleFingerprint: "duration_minutes", confirmationMode: "machine_measured", measurement: { definitionVersion: "dev-pace-1", sourceTool: "dev-pace", sourceToolVersion: "0.2.0", measuredAt: "2026-08-09T08:00:00.000Z" }, provenance: { source: "system", sourceId: "dev-pace:2026-08-09", userConfirmed: false, recordedAt: "2026-08-09T08:00:00.000Z", transformVersion: "pcs-v3", privacyLevel: "normal" } };
  const snapshot = { schemaVersion: "pcs-analysis-snapshot-v3", contractRevision: "pcs-analysis-snapshot-v3.0", snapshotId: "snapshot", profileId: "profile", generatedAt: "2026-08-09T08:00:00.000Z", period: { startAt: "2026-08-09T00:00:00.000Z", endAt: "2026-08-10T00:00:00.000Z", timezone: "Asia/Tokyo" }, records: [{ id: "record", recordedAt: "2026-08-09T08:00:00.000Z", sourceDocumentId: null, values: [value] }], excluded: {} };
  const validated = validateContextAnalysisSnapshot(snapshot) as any;
  assert.equal(validated.records[0].values[0].confirmationMode, "machine_measured");
  assert.throws(() => validateContextAnalysisSnapshot({ ...snapshot, records: [{ ...snapshot.records[0], values: [{ ...value, measurement: undefined }] }] }), /measurement_required/);
  assert.throws(() => validateContextAnalysisSnapshot({ ...snapshot, records: [{ ...snapshot.records[0], values: [{ ...value, confirmationMode: "user_confirmed", provenance: { ...value.provenance, source: "user_input", userConfirmed: true } }] }] }), /measurement_forbidden/);
});
