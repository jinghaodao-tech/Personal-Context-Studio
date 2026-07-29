import assert from "node:assert/strict";
import test from "node:test";
import { eligibleForExport, formatExport, isSecretLike, validateCandidate, validateField } from "../packages/domain/src/index.ts";
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
