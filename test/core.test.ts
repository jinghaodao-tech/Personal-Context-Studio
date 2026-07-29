import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eligibleForExport, formatExport, isSecretLike, validateCandidate, validateField } from "../packages/domain/src/index.ts";
import { listMarkdownFiles, readMarkdownSnapshot, resolveMarkdownPath } from "../packages/documents/src/index.ts";
import { validateAnalysisSnapshot, validateExperimentTemplateRequest } from "../packages/metheory-bridge/src/index.ts";

test("context fields and MeTheory candidates have explicit contracts", () => {
  assert.equal(validateField({ fieldKey: "preferred_editor", label: "Preferred editor", valueType: "text", required: false, displayOrder: 1, sharingDefault: "purpose_only", sensitivity: "normal", reason: "Coding context" }).fieldKey, "preferred_editor");
  assert.throws(() => validateField({ fieldKey: "Bad Key", label: "x", valueType: "text", required: false, displayOrder: 1, sharingDefault: "always", sensitivity: "normal", reason: "x" }));
  assert.equal(validateCandidate({ schemaVersion: "personal-context-candidate-v1", id: "context_1", sourceSystem: "metheory", sourceHypothesisId: "hypothesis_1", statement: "Clear plans help me begin work.", construct: "task_initiation", tendencyScope: "state_dependent", reviewStatus: "fits", evidenceSummary: { supportingCount: 3, contradictingCount: 1, periodStartAt: "2026-01-01", periodEndAt: "2026-01-08" }, caution: [], createdAt: "2026-01-08" }).id, "context_1");
});

test("exports exclude private, never, highly sensitive and secret-like values", () => {
  assert.equal(eligibleForExport({ sharing: "always", sensitivity: "normal", userConfirmed: true }), true);
  assert.equal(eligibleForExport({ sharing: "private", sensitivity: "normal", userConfirmed: true }), false);
  assert.equal(eligibleForExport({ sharing: "always", sensitivity: "highly_sensitive", userConfirmed: true }), false);
  assert.equal(isSecretLike("OPENAI_API_KEY=abc"), true);
  assert.match(formatExport([{ label: "Editor", value: "VS Code" }], "agents"), /User Context/);
});

test("MeTheory bridge contracts reject malformed local handoffs", () => {
  assert.equal(validateAnalysisSnapshot({ schemaVersion: "pcs-analysis-snapshot-v1", generatedAt: "2026-07-01T00:00:00.000Z", records: [], excluded: { unconfirmed: 0, nonShareable: 0, invalid: 0 } }).schemaVersion, "pcs-analysis-snapshot-v1");
  assert.equal(validateExperimentTemplateRequest({ schemaVersion: "pcs-experiment-template-request-v1", id: "request_1", sourceSystem: "metheory", hypothesisId: null, title: "Focus experiment", purpose: "Compare work conditions", durationDays: 7, requestedFields: [], createdAt: "2026-07-01T00:00:00.000Z" }).id, "request_1");
  assert.throws(() => validateExperimentTemplateRequest({ schemaVersion: "pcs-experiment-template-request-v1", sourceSystem: "metheory" }));
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
  const child = spawnMcp();
  try {
    const response = await child.request({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    const names = response.result.tools.map((tool: { name: string }) => tool.name);
    assert.deepEqual(names, ["search_documents", "get_document_excerpt", "list_reviewed_context", "list_pending_reviews"]);
    assert.equal(names.some((name: string) => /create|update|delete|write/.test(name)), false);
  } finally {
    child.close();
  }
});

function spawnMcp() {
  const child = spawn(process.execPath, ["--experimental-strip-types", "apps/mcp/src/main.ts"], { stdio: ["pipe", "pipe", "ignore"] });
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
