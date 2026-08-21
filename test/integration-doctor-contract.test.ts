import test from "node:test";
import assert from "node:assert/strict";
import { checkSnapshotContract, checkImportContract } from "../packages/integration-doctor/src/checks/contract.ts";
import type { ConnectorManifest } from "../packages/integration-doctor/src/types.ts";

const METHEORY_MANIFEST: ConnectorManifest = {
  manifestVersion: "pcs-connector-manifest-v1",
  connectorId: "metheory",
  displayName: "MeTheory",
  sourceSystem: "metheory",
  pcsContract: { minimumRevision: "pcs-analysis-snapshot-v2.1", maximumRevision: "pcs-analysis-snapshot-v3.x" },
  transport: { protocol: "http", baseUrl: "http://127.0.0.1:8300", localhostOnly: true },
  auth: { mode: "integration-client", headers: ["x-pcs-client-id", "authorization"], profileScoped: true },
  permissions: { required: ["read_snapshot", "submit_template_request"], optional: [] },
  capabilities: { readSnapshot: true, submitImport: false, submitTemplateRequest: true },
  endpoints: { readSnapshot: "GET /v1/context/analysis-snapshot-v3", submitTemplateRequest: "POST /v1/integration-template-requests" },
};

// Minimal valid V3 snapshot, matching the pattern used in test/core.test.ts's
// own coverage of validateContextAnalysisSnapshot: an empty records array
// and empty excluded object are legitimate, since the validator only walks
// records/excluded entries that exist.
const validV3Snapshot = {
  schemaVersion: "pcs-analysis-snapshot-v3",
  contractRevision: "pcs-analysis-snapshot-v3.0",
  snapshotId: "snapshot-1",
  profileId: "profile-1",
  generatedAt: "2026-08-09T08:00:00.000Z",
  period: { startAt: "2026-08-09T00:00:00.000Z", endAt: "2026-08-10T00:00:00.000Z", timezone: "Asia/Tokyo" },
  records: [],
  excluded: {},
};

test("Contract Checker: a real, valid v3.0 snapshot passes schema and is within MeTheory's declared [v2.1, v3.x] range", () => {
  const results = checkSnapshotContract(validV3Snapshot, METHEORY_MANIFEST);
  const problems = results.filter((result) => result.status === "ERROR" || result.status === "FATAL");
  assert.deepEqual(problems, [], `expected no ERROR/FATAL, got: ${JSON.stringify(problems, null, 2)}`);
  const schemaResult = results.find((result) => result.checkId === "contract.snapshotSchema");
  const rangeResult = results.find((result) => result.checkId === "contract.revisionRange");
  assert.equal(schemaResult?.status, "PASS");
  assert.equal(rangeResult?.status, "PASS");
});

test("Contract Checker: an invalid payload (missing required fields) is reported as a structured ERROR, not an uncaught throw", () => {
  const results = checkSnapshotContract({ schemaVersion: "pcs-analysis-snapshot-v3", contractRevision: "pcs-analysis-snapshot-v3.0" }, METHEORY_MANIFEST);
  assert.equal(results.length, 1);
  assert.equal(results[0].status, "ERROR");
  assert.equal(results[0].code, "PCS-DOC-3002");
});

test("Contract Checker: a real, valid v3.0 payload outside a stale manifest range is flagged, not silently accepted", () => {
  // Note on why this test doesn't just feed a bogus contractRevision like
  // "v4.0": PCS's own validateContextAnalysisSnapshot requires an exact
  // match against PCS_ANALYSIS_CONTRACT_V3_REVISION for the v3 branch, so a
  // fabricated/unsupported revision value fails PCS's schema check before
  // ever reaching this checker's range comparison (see the v2.0 test
  // below). The realistic way a real, schema-valid payload ends up outside
  // a manifest's declared range is the opposite direction: PCS moved
  // forward to a revision it already validates fine, but the *manifest*
  // wasn't updated to include it. That's what this test models.
  const staleManifest: ConnectorManifest = { ...METHEORY_MANIFEST, pcsContract: { minimumRevision: "pcs-analysis-snapshot-v2.1", maximumRevision: "pcs-analysis-snapshot-v2.x" } };
  const results = checkSnapshotContract(validV3Snapshot, staleManifest);
  const schemaResult = results.find((result) => result.checkId === "contract.snapshotSchema");
  const rangeResult = results.find((result) => result.checkId === "contract.revisionRange");
  assert.equal(schemaResult?.status, "PASS", "the v3.0 payload itself is genuinely valid per PCS's own validator");
  assert.equal(rangeResult?.status, "ERROR");
  assert.equal(rangeResult?.code, "PCS-DOC-3001");
});

test("Contract Checker: a contractRevision below the manifest's declared minimum is flagged", () => {
  // v2.0 predates MeTheory's stated minimum of v2.1. Schema-wise this still
  // has to be a real, valid v2 payload for validateContextAnalysisSnapshot
  // to get past the schema check and reach the range check at all -- but
  // v2.0 doesn't equal PCS's actual PCS_ANALYSIS_CONTRACT_REVISION constant
  // ("pcs-analysis-snapshot-v2.1"), so the validator itself would reject it
  // in the real API. This test is about the range-comparison logic in
  // isolation, not about whether PCS could ever really emit this value.
  const results = checkSnapshotContract({ ...validV3Snapshot, schemaVersion: "pcs-analysis-snapshot-v2", contractRevision: "pcs-analysis-snapshot-v2.0" }, METHEORY_MANIFEST);
  const schemaResult = results.find((result) => result.checkId === "contract.snapshotSchema");
  // Confirms the premise stated above: PCS's real validator does reject
  // this contractRevision (it only accepts the exact current constant), so
  // this exercises the schema-error path, not the range-check path.
  assert.equal(schemaResult?.status, "ERROR");
});

test("Contract Checker: range comparison is exercised directly against an accepted v2.1 payload (MeTheory's own stated minimum)", () => {
  const v2Snapshot = { schemaVersion: "pcs-analysis-snapshot-v2", contractRevision: "pcs-analysis-snapshot-v2.1", snapshotId: "snapshot-1", profileId: "profile-1", generatedAt: "2026-08-09T08:00:00.000Z", period: { startAt: "2026-08-09T00:00:00.000Z", endAt: "2026-08-10T00:00:00.000Z", timezone: "Asia/Tokyo" }, records: [], excluded: {} };
  const results = checkSnapshotContract(v2Snapshot, METHEORY_MANIFEST);
  const rangeResult = results.find((result) => result.checkId === "contract.revisionRange");
  assert.equal(rangeResult?.status, "PASS");
});

test("Contract Checker: a mismatched contract family (different prefix) is an ERROR, not a range comparison", () => {
  const manifest: ConnectorManifest = { ...METHEORY_MANIFEST, pcsContract: { minimumRevision: "pcs-other-contract-v1.0", maximumRevision: "pcs-other-contract-v1.x" } };
  const results = checkSnapshotContract(validV3Snapshot, manifest);
  const rangeResult = results.find((result) => result.checkId === "contract.revisionRange");
  assert.equal(rangeResult?.status, "ERROR");
  assert.equal(rangeResult?.code, "PCS-DOC-3001");
  assert.match(rangeResult!.message, /prefix mismatch/);
});

test("Contract Checker: legacy V1 snapshot (no contractRevision) reports INFO, not a failure", () => {
  const v1Snapshot = { schemaVersion: "pcs-context-analysis-snapshot-v1", generatedAt: "2026-08-09T08:00:00.000Z", records: [], excluded: { unconfirmed: 0, nonShareable: 0, invalid: 0 } };
  const results = checkSnapshotContract(v1Snapshot, METHEORY_MANIFEST);
  const schemaResult = results.find((result) => result.checkId === "contract.snapshotSchema");
  const rangeResult = results.find((result) => result.checkId === "contract.revisionRange");
  assert.equal(schemaResult?.status, "PASS");
  assert.equal(rangeResult?.status, "INFO");
});

test("Contract Checker: a snapshot with contractRevision but a manifest missing pcsContract is a reported ERROR, not a throw", () => {
  // Defensive path: checkManifest (PCS-DOC-1006) is supposed to prevent a
  // readSnapshot=true manifest from omitting pcsContract, but this checker
  // doesn't trust that another checker actually ran first.
  const manifestWithoutContract: ConnectorManifest = { ...METHEORY_MANIFEST, pcsContract: undefined };
  const results = checkSnapshotContract(validV3Snapshot, manifestWithoutContract);
  const rangeResult = results.find((result) => result.checkId === "contract.revisionRange");
  assert.equal(rangeResult?.status, "ERROR");
  assert.equal(rangeResult?.code, "PCS-DOC-3001");
});

// dev-pace's real submit_import connector (dev-pace_public/pcs-adapter/adapter.py's
// build_import()) -- IntegrationImportV1 shape, no schemaVersion/contractRevision
// field at all, which is exactly why checkImportContract has no range check.
const REAL_DEV_PACE_IMPORT = {
  id: "dev-pace-day-2026-05-24",
  sourceSystem: "dev_pace",
  sourceReferenceId: "2026-05-24",
  createdAt: "2026-08-09T09:04:47.023179Z",
  payload: {
    active_minutes: 27.45,
    ai_conversation_minutes: 41.4,
    away_minutes: 0.0,
    date: "2026-05-24",
    deep_thinking_minutes: 17.0,
    idle_minutes: 0.0,
    measurement: { definitionVersion: "dev-pace-daily-v1", measuredAt: "2026-08-09T09:04:47.023179Z", sourceTool: "dev-pace", sourceToolVersion: "0.1.0" },
    window_switch_count: 14,
  },
};

test("checkImportContract: dev-pace's real submit_import payload passes PCS's own validateIntegrationImport", () => {
  const results = checkImportContract(REAL_DEV_PACE_IMPORT);
  assert.equal(results.length, 1);
  assert.equal(results[0].status, "PASS");
  assert.equal(results[0].code, "PCS-DOC-3002");
});

test("checkImportContract: an invalid import payload (missing sourceSystem) is a structured ERROR, not an uncaught throw", () => {
  const { sourceSystem: _sourceSystem, ...withoutSourceSystem } = REAL_DEV_PACE_IMPORT;
  const results = checkImportContract(withoutSourceSystem);
  assert.equal(results.length, 1);
  assert.equal(results[0].status, "ERROR");
  assert.equal(results[0].code, "PCS-DOC-3002");
});
