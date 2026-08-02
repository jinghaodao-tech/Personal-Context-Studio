import test from "node:test";
import assert from "node:assert/strict";
import { matchIntegrationFields } from "../packages/domain/src/index.ts";

const existing = [{ fieldKey: "clarity", label: "明確さ", valueType: "scale", required: true, displayOrder: 1, options: [], analysisRole: "task_clarity", analysisRoleConfirmed: true, analysisUsage: "condition", analysisMergeAllowed: true, sharingDefault: "purpose_only", sensitivity: "normal", reason: "condition" as const }];

test("integration matcher uses semantic metadata and reports reusable fields", () => {
  const result = matchIntegrationFields([{ fieldKey: "task_clarity", label: "予定の明確さ", valueType: "scale", analysisRole: "task_clarity", analysisUsage: "condition" }], existing as any);
  assert.equal(result[0].kind, "exact_match");
  assert.deepEqual(result[0].existingFieldKeys, ["clarity"]);
});

test("integration matcher does not merge a same-name incompatible field", () => {
  const result = matchIntegrationFields([{ fieldKey: "clarity", label: "明確さ", valueType: "number", analysisRole: "task_clarity", analysisUsage: "condition" }], existing as any);
  assert.equal(result[0].kind, "incompatible");
});

test("integration matcher rejects a purpose mismatch", () => {
  const result = matchIntegrationFields([{ fieldKey: "clarity", label: "Clarity", valueType: "scale", analysisRole: "task_clarity", analysisUsage: "condition", purpose: "health_tracking" }], [{ ...existing[0], valueType: "scale", templatePurpose: "self_understanding" }] as any);
  assert.equal(result[0].kind, "incompatible");
  assert.deepEqual(result[0].reasons, ["purpose_mismatch"]);
});
